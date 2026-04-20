'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Tab = 'substack' | 'metadata' | 'captions';
type EpisodeType = 'solo' | 'interview';

interface ClipRow {
  description: string;
  publishDate: string;
  file?: File | null;
}

const DEFAULT_PLATFORMS = ['IN@tradesshow', 'TIKTOK@tradesshow', 'LI@brianaottoboni'];

export function ShowrunnerInput() {
  const [tab, setTab] = useState<Tab>('substack');

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b" style={{ borderColor: 'var(--rule)' }}>
        {(['substack', 'metadata', 'captions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-2 text-sm transition"
            style={{
              borderBottom:
                tab === t ? '2px solid var(--ink)' : '2px solid transparent',
              color: tab === t ? 'var(--ink)' : 'var(--muted)',
              marginBottom: '-1px',
            }}
          >
            {t === 'substack'
              ? 'Substack post'
              : t === 'metadata'
                ? 'Title & description'
                : 'Social captions'}
          </button>
        ))}
      </div>

      {tab === 'substack' && <SubstackForm />}
      {tab === 'metadata' && <MetadataForm />}
      {tab === 'captions' && <CaptionsForm />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared field styles
// ---------------------------------------------------------------------------
const fieldStyle = { borderRadius: 0, borderColor: 'var(--rule)' } as const;
const buttonStyle = {
  borderRadius: 0,
  borderColor: 'var(--ink)',
  color: 'var(--ink)',
} as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs muted uppercase tracking-wider">{children}</span>
  );
}

// ---------------------------------------------------------------------------
// Substack post form
// ---------------------------------------------------------------------------
function SubstackForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [episodeType, setEpisodeType] = useState<EpisodeType>('interview');
  const [transcript, setTranscript] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestLinks, setGuestLinks] = useState('');
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

  const submit = () => {
    if (!transcript.trim() || wordCount < 100) {
      setError('Transcript must be at least 100 words.');
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/showrunner/substack/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            episodeType,
            guestName: guestName.trim() || undefined,
            guestLinks: guestLinks.trim() || undefined,
          }),
        });
        const raw = await res.text();
        let data: { error?: string; substackTitle?: string } = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setSuccess(`Done — "${data.substackTitle || 'Substack post'}" queued.`);
        setTranscript('');
        setGuestName('');
        setGuestLinks('');
        if (fileRef.current) fileRef.current.value = '';
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs muted">
        Drafts the Substack post from the episode transcript. One queue item per run.
      </p>

      <textarea
        value={transcript}
        onChange={(e) => {
          setTranscript(e.target.value);
          setSuccess(null);
          setError(null);
        }}
        placeholder="Paste episode transcript here..."
        rows={6}
        className="w-full bg-transparent border px-3 py-2 text-sm resize-y"
        style={fieldStyle}
        disabled={isPending}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label
          className="px-3 py-1.5 text-xs border cursor-pointer transition"
          style={{ ...fieldStyle, color: 'var(--muted)' }}
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

      {episodeType === 'interview' && (
        <div
          className="space-y-2 pt-2 border-t"
          style={{ borderColor: 'var(--rule)' }}
        >
          <SectionLabel>Guest</SectionLabel>
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Guest name"
            className="w-full bg-transparent border px-3 py-2 text-sm"
            style={fieldStyle}
            disabled={isPending}
          />
          <textarea
            value={guestLinks}
            onChange={(e) => setGuestLinks(e.target.value)}
            placeholder="Guest links — one per line"
            rows={3}
            className="w-full bg-transparent border px-3 py-2 text-sm resize-y"
            style={fieldStyle}
            disabled={isPending}
          />
        </div>
      )}

      <SoloToggle episodeType={episodeType} setEpisodeType={setEpisodeType} disabled={isPending} />

      <button
        onClick={submit}
        disabled={isPending || wordCount < 100}
        className="ml-auto px-4 py-2 text-sm border transition disabled:opacity-40 min-h-[36px] block"
        style={buttonStyle}
      >
        {isPending ? 'Running…' : 'Run agent'}
      </button>

      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      {success && <p className="text-xs" style={{ color: 'var(--ok)' }}>{success}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Title & description form
// ---------------------------------------------------------------------------
function MetadataForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [episodeType, setEpisodeType] = useState<EpisodeType>('interview');
  const [transcript, setTranscript] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestLinks, setGuestLinks] = useState('');
  const [timestampedOutline, setTimestampedOutline] = useState('');
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

  const submit = () => {
    if (!transcript.trim() || wordCount < 100) {
      setError('Transcript must be at least 100 words.');
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/showrunner/metadata/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            episodeType,
            guestName: guestName.trim() || undefined,
            guestLinks: guestLinks.trim() || undefined,
            timestampedOutline: timestampedOutline.trim() || undefined,
          }),
        });
        const raw = await res.text();
        let data: { error?: string; youtubeTitle?: string } = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setSuccess(`Done — "${data.youtubeTitle || 'Episode metadata'}" queued.`);
        setTranscript('');
        setGuestName('');
        setGuestLinks('');
        setTimestampedOutline('');
        if (fileRef.current) fileRef.current.value = '';
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs muted">
        Drafts YouTube title, Spotify title, and shared episode description from the transcript.
      </p>

      <textarea
        value={transcript}
        onChange={(e) => {
          setTranscript(e.target.value);
          setSuccess(null);
          setError(null);
        }}
        placeholder="Paste episode transcript here..."
        rows={6}
        className="w-full bg-transparent border px-3 py-2 text-sm resize-y"
        style={fieldStyle}
        disabled={isPending}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label
          className="px-3 py-1.5 text-xs border cursor-pointer transition"
          style={{ ...fieldStyle, color: 'var(--muted)' }}
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

      {episodeType === 'interview' && (
        <div
          className="space-y-2 pt-2 border-t"
          style={{ borderColor: 'var(--rule)' }}
        >
          <SectionLabel>Guest</SectionLabel>
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Guest name"
            className="w-full bg-transparent border px-3 py-2 text-sm"
            style={fieldStyle}
            disabled={isPending}
          />
          <textarea
            value={guestLinks}
            onChange={(e) => setGuestLinks(e.target.value)}
            placeholder="Guest links — one per line"
            rows={3}
            className="w-full bg-transparent border px-3 py-2 text-sm resize-y"
            style={fieldStyle}
            disabled={isPending}
          />
        </div>
      )}

      <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--rule)' }}>
        <SectionLabel>
          Timestamped outline{' '}
          <span className="muted" style={{ opacity: 0.5 }}>
            (optional — leave empty to auto-generate)
          </span>
        </SectionLabel>
        <textarea
          value={timestampedOutline}
          onChange={(e) => setTimestampedOutline(e.target.value)}
          placeholder={`Chapter markers, one per line:\n00:00 Intro\n01:25 Topic A\n...`}
          rows={4}
          className="w-full bg-transparent border px-3 py-2 text-sm resize-y font-mono"
          style={fieldStyle}
          disabled={isPending}
        />
      </div>

      <SoloToggle episodeType={episodeType} setEpisodeType={setEpisodeType} disabled={isPending} />

      <button
        onClick={submit}
        disabled={isPending || wordCount < 100}
        className="ml-auto px-4 py-2 text-sm border transition disabled:opacity-40 min-h-[36px] block"
        style={buttonStyle}
      >
        {isPending ? 'Running…' : 'Run agent'}
      </button>

      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      {success && <p className="text-xs" style={{ color: 'var(--ok)' }}>{success}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Social captions form — clips-only, no full transcript
// ---------------------------------------------------------------------------
function CaptionsForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [episodeType, setEpisodeType] = useState<EpisodeType>('interview');
  const [episodeContextNote, setEpisodeContextNote] = useState('');
  const [clips, setClips] = useState<ClipRow[]>([
    { description: '', publishDate: '', file: null },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const addClip = () =>
    setClips((prev) => [...prev, { description: '', publishDate: '', file: null }]);
  const updateClip = (i: number, patch: Partial<ClipRow>) =>
    setClips((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeClip = (i: number) =>
    setClips((prev) => prev.filter((_, idx) => idx !== i));

  const submit = () => {
    const activeClips = clips.filter((c) => c.description.trim());
    if (activeClips.length === 0) {
      setError('At least one clip (with description) is required.');
      return;
    }
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const hasFiles = activeClips.some((c) => c.file);
        let res: Response;

        if (hasFiles) {
          const form = new FormData();
          form.append('episodeType', episodeType);
          if (episodeContextNote.trim())
            form.append('episodeContextNote', episodeContextNote.trim());

          const clipsPayload = activeClips.map((c, i) => {
            const fieldName = `clipFile_${i}`;
            if (c.file) form.append(fieldName, c.file, c.file.name);
            return {
              description: c.description.trim(),
              publishDate: c.publishDate || undefined,
              platforms: DEFAULT_PLATFORMS,
              fileFieldName: c.file ? fieldName : undefined,
            };
          });
          form.append('clips', JSON.stringify(clipsPayload));

          res = await fetch('/api/agents/showrunner/captions/run', {
            method: 'POST',
            body: form,
          });
        } else {
          res = await fetch('/api/agents/showrunner/captions/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              episodeType,
              episodeContextNote: episodeContextNote.trim() || undefined,
              clips: activeClips.map((c) => ({
                description: c.description.trim(),
                publishDate: c.publishDate || undefined,
                platforms: DEFAULT_PLATFORMS,
              })),
            }),
          });
        }

        const raw = await res.text();
        let data: { error?: string; captionCount?: number } = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setSuccess(
          `Done — ${data.captionCount} caption${data.captionCount === 1 ? '' : 's'} queued.`,
        );
        setClips([{ description: '', publishDate: '', file: null }]);
        setEpisodeContextNote('');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs muted">
        Writes one caption per clip. Each clip needs its own description / transcript;
        attach the video file here and it stays in Showrunner storage until you schedule.
      </p>

      <div className="space-y-2">
        <SectionLabel>
          Episode context note{' '}
          <span className="muted" style={{ opacity: 0.5 }}>
            (optional — tone alignment only, not the full transcript)
          </span>
        </SectionLabel>
        <input
          type="text"
          value={episodeContextNote}
          onChange={(e) => setEpisodeContextNote(e.target.value)}
          placeholder="e.g. Episode is about craftsmanship in the age of AI"
          className="w-full bg-transparent border px-3 py-2 text-sm"
          style={fieldStyle}
          disabled={isPending}
        />
      </div>

      <div className="pt-2 border-t" style={{ borderColor: 'var(--rule)' }}>
        <div className="flex items-center justify-between mb-2">
          <SectionLabel>Clips</SectionLabel>
          <button
            onClick={addClip}
            disabled={isPending}
            className="text-xs hover:underline"
            style={{ color: 'var(--ink)' }}
            type="button"
          >
            + Add clip
          </button>
        </div>

        {clips.map((clip, i) => (
          <div
            key={i}
            className="space-y-2 border p-3 mb-2"
            style={{ borderColor: 'var(--rule)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs muted">Clip {i + 1}</span>
              {clips.length > 1 && (
                <button
                  onClick={() => removeClip(i)}
                  disabled={isPending}
                  className="text-xs muted hover:opacity-80"
                  type="button"
                >
                  Remove
                </button>
              )}
            </div>
            <textarea
              value={clip.description}
              onChange={(e) => updateClip(i, { description: e.target.value })}
              placeholder="Paste the clip transcript / description (Showrunner reads this to write the caption)"
              rows={3}
              className="w-full bg-transparent border px-3 py-2 text-sm resize-y"
              style={fieldStyle}
              disabled={isPending}
            />
            <div className="flex flex-wrap items-center gap-3">
              <label
                className="px-3 py-1.5 text-xs border cursor-pointer transition"
                style={{ ...fieldStyle, color: 'var(--muted)' }}
              >
                {clip.file ? `📎 ${clip.file.name}` : 'Upload clip video'}
                <input
                  type="file"
                  accept="video/*,image/*"
                  onChange={(e) =>
                    updateClip(i, { file: e.target.files?.[0] ?? null })
                  }
                  className="hidden"
                  disabled={isPending}
                />
              </label>
              {clip.file && (
                <button
                  onClick={() => updateClip(i, { file: null })}
                  disabled={isPending}
                  type="button"
                  className="text-xs muted hover:opacity-80"
                >
                  Clear file
                </button>
              )}
              <input
                type="date"
                value={clip.publishDate}
                onChange={(e) => updateClip(i, { publishDate: e.target.value })}
                disabled={isPending}
                className="bg-transparent border px-2 py-1 text-xs"
                style={fieldStyle}
              />
            </div>
          </div>
        ))}
      </div>

      <SoloToggle episodeType={episodeType} setEpisodeType={setEpisodeType} disabled={isPending} />

      <button
        onClick={submit}
        disabled={isPending || clips.every((c) => !c.description.trim())}
        className="ml-auto px-4 py-2 text-sm border transition disabled:opacity-40 min-h-[36px] block"
        style={buttonStyle}
      >
        {isPending ? 'Running…' : 'Run agent'}
      </button>

      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      {success && <p className="text-xs" style={{ color: 'var(--ok)' }}>{success}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared solo toggle
// ---------------------------------------------------------------------------
function SoloToggle({
  episodeType,
  setEpisodeType,
  disabled,
}: {
  episodeType: EpisodeType;
  setEpisodeType: (t: EpisodeType) => void;
  disabled: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 pt-2 border-t"
      style={{ borderColor: 'var(--rule)' }}
    >
      <input
        id="solo-toggle"
        type="checkbox"
        checked={episodeType === 'solo'}
        onChange={(e) => setEpisodeType(e.target.checked ? 'solo' : 'interview')}
        disabled={disabled}
      />
      <label htmlFor="solo-toggle" className="text-xs muted cursor-pointer">
        Solo episode (uncheck for guest interview)
      </label>
    </div>
  );
}
