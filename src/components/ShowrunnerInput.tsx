'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';

export function ShowrunnerInput() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [episodeType, setEpisodeType] = useState<'solo' | 'interview'>('solo');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const wordCount = transcript.trim()
    ? transcript.trim().split(/\s+/).length
    : 0;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        const res = await fetch('/api/agents/showrunner/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, episodeType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        setSuccess(
          `Done — "${data.episodeTitle || 'Content package'}" queued with ${data.captionCount} captions.`,
        );
        setTranscript('');
        if (fileRef.current) fileRef.current.value = '';
        router.refresh();
      } catch (e: any) {
        setError(e.message);
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* Episode type */}
      <div className="flex items-center gap-3">
        <label className="text-xs muted">Type</label>
        <select
          value={episodeType}
          onChange={(e) =>
            setEpisodeType(e.target.value as 'solo' | 'interview')
          }
          className="bg-transparent border rounded-md px-3 py-1.5 text-sm min-h-[36px]"
          style={{ borderColor: 'var(--border)' }}
        >
          <option value="solo">Solo</option>
          <option value="interview">Interview</option>
        </select>
      </div>

      {/* Transcript input */}
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

      {/* File upload + word count + submit */}
      <div className="flex flex-wrap items-center gap-3">
        <label
          className="px-3 py-1.5 text-xs rounded-md border cursor-pointer hover:bg-white/5 transition"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          Upload .txt / .md / .srt
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.srt,.text"
            onChange={handleFile}
            className="hidden"
            disabled={isPending}
          />
        </label>

        {wordCount > 0 && (
          <span className="text-xs muted">
            {wordCount.toLocaleString()} words
          </span>
        )}

        <button
          onClick={submit}
          disabled={isPending || wordCount < 100}
          className="ml-auto px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
          style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
        >
          {isPending ? 'Running...' : 'Run Showrunner'}
        </button>
      </div>

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
