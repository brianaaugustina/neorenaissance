'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface ClipRow {
  description: string;
  publishDate: string;
  file: File | null;
}

const DEFAULT_PLATFORMS = ['IN@tradesshow', 'TIKTOK@tradesshow', 'LI@brianaottoboni'];

export function ShowrunnerInput() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [episodeType, setEpisodeType] = useState<'solo' | 'interview'>('solo');
  const [transcript, setTranscript] = useState('');
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  const handleTranscriptFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setTranscript(reader.result as string);
      setSuccess(null);
      setError(null);
    };
    reader.readAsText(file);
  };

  const addClip = () =>
    setClips((prev) => [...prev, { description: '', publishDate: '', file: null }]);

  const updateClip = (i: number, patch: Partial<ClipRow>) =>
    setClips((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const removeClip = (i: number) => setClips((prev) => prev.filter((_, idx) => idx !== i));

  const submit = () => {
    if (!transcript.trim() || wordCount < 100) {
      setError('Transcript must be at least 100 words.');
      return;
    }
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const hasClips = clips.some((c) => c.description.trim());
        const hasFiles = clips.some((c) => c.file);

        let res: Response;
        if (hasFiles) {
          // Multipart path — upload clip files alongside metadata.
          const form = new FormData();
          form.set('transcript', transcript);
          form.set('episodeType', episodeType);
          const clipPayload = clips
            .filter((c) => c.description.trim())
            .map((c, i) => {
              const fileFieldName = c.file ? `clip_file_${i}` : undefined;
              if (c.file && fileFieldName) form.set(fileFieldName, c.file);
              return {
                description: c.description.trim(),
                publishDate: c.publishDate || undefined,
                platforms: DEFAULT_PLATFORMS,
                fileFieldName,
              };
            });
          form.set('clips', JSON.stringify(clipPayload));
          res = await fetch('/api/agents/showrunner/run', { method: 'POST', body: form });
        } else {
          // JSON path — no files, just metadata.
          res = await fetch('/api/agents/showrunner/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transcript,
              episodeType,
              clips: hasClips
                ? clips
                    .filter((c) => c.description.trim())
                    .map((c) => ({
                      description: c.description.trim(),
                      publishDate: c.publishDate || undefined,
                      platforms: DEFAULT_PLATFORMS,
                    }))
                : [],
            }),
          });
        }

        const raw = await res.text();
        let data: { error?: string; episodeTitle?: string; captionCount?: number } = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          // Non-JSON response (usually a platform error page like 413 from Vercel)
          if (res.status === 413) {
            throw new Error(
              'Video file too large for direct upload (Vercel 4.5MB limit). See alternative upload options.',
            );
          }
          throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200) || res.statusText}`);
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setSuccess(
          `Done — "${data.episodeTitle || 'Content package'}" queued with ${data.captionCount} clip caption${data.captionCount === 1 ? '' : 's'}.`,
        );
        setTranscript('');
        setClips([]);
        if (fileRef.current) fileRef.current.value = '';
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-xs muted">Type</label>
        <select
          value={episodeType}
          onChange={(e) => setEpisodeType(e.target.value as 'solo' | 'interview')}
          className="bg-transparent border rounded-md px-3 py-1.5 text-sm min-h-[36px]"
          style={{ borderColor: 'var(--border)' }}
        >
          <option value="solo">Solo</option>
          <option value="interview">Interview</option>
        </select>
      </div>

      <textarea
        value={transcript}
        onChange={(e) => {
          setTranscript(e.target.value);
          setSuccess(null);
          setError(null);
        }}
        placeholder="Paste episode transcript here..."
        rows={6}
        className="w-full bg-transparent border rounded-md px-3 py-2 text-sm resize-y"
        style={{ borderColor: 'var(--border)' }}
        disabled={isPending}
      />

      <div className="flex flex-wrap items-center gap-3">
        <label
          className="px-3 py-1.5 text-xs rounded-md border cursor-pointer hover:bg-white/5 transition"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          Upload .txt / .md / .srt
          <input
            ref={fileRef}
            type="file"
            accept="text/plain,text/markdown,text/*,.txt,.md,.srt,.text,.vtt"
            onChange={handleTranscriptFile}
            className="hidden"
            disabled={isPending}
          />
        </label>

        {wordCount > 0 && (
          <span className="text-xs muted">{wordCount.toLocaleString()} words</span>
        )}
      </div>

      {/* Clips list */}
      <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs muted uppercase tracking-wider">Clips (optional)</span>
          <button
            onClick={addClip}
            disabled={isPending}
            className="text-xs gold hover:underline"
            type="button"
          >
            + Add clip
          </button>
        </div>

        {clips.length === 0 && (
          <p className="text-xs muted">
            Add clips to have Showrunner write one social caption per clip and create Notion Content entries with the video attached.
          </p>
        )}

        {clips.map((clip, i) => (
          <div
            key={i}
            className="space-y-2 border rounded-md p-3 mb-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs muted">Clip {i + 1}</span>
              <button
                onClick={() => removeClip(i)}
                disabled={isPending}
                className="text-xs muted hover:text-white/80"
                type="button"
              >
                Remove
              </button>
            </div>
            <textarea
              value={clip.description}
              onChange={(e) => updateClip(i, { description: e.target.value })}
              placeholder="Describe the clip (e.g. Elias explaining the weathering process, 0:32-1:15)"
              rows={2}
              className="w-full bg-transparent border rounded-md px-3 py-2 text-sm resize-y"
              style={{ borderColor: 'var(--border)' }}
              disabled={isPending}
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs muted">
                Publish
                <input
                  type="date"
                  value={clip.publishDate}
                  onChange={(e) => updateClip(i, { publishDate: e.target.value })}
                  className="ml-2 bg-transparent border rounded-md px-2 py-1 text-xs"
                  style={{ borderColor: 'var(--border)' }}
                  disabled={isPending}
                />
              </label>
              <label
                className="px-3 py-1.5 text-xs rounded-md border cursor-pointer hover:bg-white/5 transition"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                {clip.file ? clip.file.name : 'Attach video file'}
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => updateClip(i, { file: e.target.files?.[0] ?? null })}
                  className="hidden"
                  disabled={isPending}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={isPending || wordCount < 100}
        className="ml-auto px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px] block"
        style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
      >
        {isPending ? 'Running...' : 'Run Showrunner'}
      </button>

      {error && (
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs" style={{ color: 'var(--ok)' }}>
          {success}
        </p>
      )}
    </div>
  );
}
