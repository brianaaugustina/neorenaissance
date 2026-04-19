import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/client';
import { LandscapeBody } from '@/components/LandscapeBody';
import { formatPtDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Stable per-output detail page at /outputs/[agent]/[outputId]. The agent
// slug is redundant with the id but makes the URL readable + shareable.
// If the slug doesn't match the row's agent_id, we 404 — keeps people
// from manufacturing URLs with mismatched slugs.

interface OutputRow {
  id: string;
  agent_id: string;
  venture: string;
  output_type: string;
  approval_status: string;
  approval_queue_id: string | null;
  run_id: string | null;
  parent_output_id: string | null;
  tags: string[] | null;
  created_at: string;
  approved_at: string | null;
  rejection_reason: string | null;
  draft_content: Record<string, unknown> | null;
  final_content: Record<string, unknown> | null;
}

export default async function OutputDetailPage({
  params,
}: {
  params: Promise<{ agent: string; outputId: string }>;
}) {
  const { agent, outputId } = await params;
  const db = supabaseAdmin();

  const { data: row, error } = await db
    .from('agent_outputs')
    .select('*')
    .eq('id', outputId)
    .single();
  if (error || !row) notFound();
  const output = row as OutputRow;

  if (output.agent_id !== agent) {
    notFound();
  }

  // Resolve the active content — final_content takes precedence (approvals
  // capture edited content here). Fall back to the draft.
  const content = (output.final_content ?? output.draft_content ?? {}) as Record<string, unknown>;

  // Pull parent queue item for status-appropriate action links.
  let queueItem: { id: string; status: string | null } | null = null;
  if (output.approval_queue_id) {
    const { data } = await db
      .from('approval_queue')
      .select('id, status')
      .eq('id', output.approval_queue_id)
      .single();
    if (data) queueItem = data as { id: string; status: string | null };
  }

  // Pull children for context (e.g., Showrunner parent → captions + metadata)
  const { data: childrenRaw } = await db
    .from('agent_outputs')
    .select('id, agent_id, output_type, approval_status, created_at, tags')
    .eq('parent_output_id', outputId)
    .order('created_at', { ascending: true });
  const children = (childrenRaw ?? []) as Array<
    Pick<OutputRow, 'id' | 'agent_id' | 'output_type' | 'approval_status' | 'created_at' | 'tags'>
  >;

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[960px] mx-auto">
      <header className="mb-6">
        <Link href="/outputs" className="text-xs gold hover:underline">
          ← Back to outputs
        </Link>
        <div className="mt-3 text-xs muted flex flex-wrap items-center gap-2">
          <span className="uppercase tracking-wider">{output.agent_id}</span>
          <span>·</span>
          <span>{output.output_type.replace(/_/g, ' ')}</span>
          <span>·</span>
          <StatusBadge status={output.approval_status} />
          <span>·</span>
          <span>Created {formatPtDateTime(output.created_at)}</span>
          {output.approved_at && (
            <>
              <span>·</span>
              <span>Approved {formatPtDateTime(output.approved_at)}</span>
            </>
          )}
        </div>
        <h1 className="serif text-2xl md:text-3xl mt-2">
          {describeOutput(output.output_type, content)}
        </h1>
      </header>

      {/* Status-aware banner */}
      <StatusBanner output={output} queueItem={queueItem} />

      <section className="card p-5 md:p-6 text-sm">
        <OutputContent outputType={output.output_type} content={content} />
      </section>

      {output.tags && output.tags.length > 0 && (
        <section className="mt-6">
          <div className="text-xs muted uppercase tracking-wider mb-2">Tags</div>
          <div className="flex flex-wrap gap-1.5">
            {output.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] px-2 py-0.5 rounded-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Children — Showrunner parent shows metadata + captions + calendar entries */}
      {children.length > 0 && (
        <section className="mt-6">
          <div className="text-xs muted uppercase tracking-wider mb-2">
            Related outputs from this run
          </div>
          <ul className="space-y-1 text-sm">
            {children.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between border-b py-1.5"
                style={{ borderColor: 'var(--border)' }}
              >
                <span>
                  <span className="muted uppercase tracking-wider text-xs mr-2">
                    {c.output_type.replace(/_/g, ' ')}
                  </span>
                  <StatusBadge status={c.approval_status} />
                </span>
                <Link
                  href={`/outputs/${c.agent_id}/${c.id}`}
                  className="text-xs gold hover:underline"
                >
                  View ↗
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queueItem && (
        <p className="text-xs muted mt-6">
          Action on this output happens in the dashboard queue card for run{' '}
          <Link
            href={`/queue/${queueItem.id}/review`}
            className="gold hover:underline"
          >
            {queueItem.id.slice(0, 8)}
          </Link>
          . This page is the read view.
        </p>
      )}
    </main>
  );
}

function describeOutput(type: string, c: Record<string, unknown>): string {
  const str = (k: string): string => (typeof c[k] === 'string' ? (c[k] as string) : '');
  switch (type) {
    case 'daily_briefing':
      return 'Daily briefing';
    case 'weekly_plan':
      return `Weekly plan${str('week_start') ? ` — ${str('week_start')}` : ''}`;
    case 'substack_post':
      return str('substack_title') || str('episode_title') || 'Substack post';
    case 'episode_metadata':
      return str('youtube_title') || str('spotify_title') || 'Episode metadata';
    case 'social_caption':
      return `Clip caption${c.clip_index ? ` ${c.clip_index}` : ''}`;
    case 'calendar_entry':
      return `Calendar entry${c.kind ? ` (${String(c.kind)})` : ''}`;
    case 'pipeline_check':
      return 'Pipeline check';
    case 'pitch_email':
      return `Sponsorship pitch — ${str('brand_name') || 'brand'}`;
    case 'press_pitch_founder_first':
    case 'press_pitch_show_first':
    case 'press_pitch_hybrid':
      return `Press pitch — ${str('outlet') || 'outlet'}`;
    case 'research_batch':
      return `Sponsorship research batch`;
    case 'press_research':
      return `Press research batch`;
    case 'editorial_landscape_briefing':
      return `Landscape briefing — ${str('month_label') || 'month'}`;
    default:
      return type.replace(/_/g, ' ');
  }
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'approved'
      ? 'var(--ok)'
      : status === 'edited'
        ? 'var(--gold)'
        : status === 'rejected'
          ? 'var(--danger)'
          : status === 'pending'
            ? 'var(--muted)'
            : 'var(--muted)';
  return (
    <span style={{ color }} className="text-xs uppercase tracking-wider">
      {status}
    </span>
  );
}

function StatusBanner({
  output,
  queueItem,
}: {
  output: OutputRow;
  queueItem: { id: string; status: string | null } | null;
}) {
  const qStatus = queueItem?.status;
  // Resolved: approved + no actionable work downstream.
  const showrunnerResolved =
    output.output_type === 'substack_post' && qStatus === 'approved'
      ? isShowrunnerFullyScheduled(output.final_content ?? output.draft_content ?? {})
      : false;
  const scheduled = typeof (output.final_content ?? output.draft_content ?? {}) === 'object' &&
    !!((output.final_content ?? output.draft_content ?? {}) as Record<string, unknown>).scheduled_at;

  let text = '';
  let color = 'var(--muted)';
  if (output.approval_status === 'rejected') {
    text = `Rejected${output.rejection_reason ? `: ${output.rejection_reason}` : ''}`;
    color = 'var(--danger)';
  } else if (scheduled) {
    text = 'Scheduled — published by NotionSocial on the date/time set.';
    color = 'var(--ok)';
  } else if (showrunnerResolved) {
    text = 'Complete — every clip scheduled, Newsletter saved.';
    color = 'var(--ok)';
  } else if (qStatus === 'approved') {
    text = 'Approved. Act on downstream steps in the dashboard queue.';
    color = 'var(--ok)';
  } else if (qStatus === 'superseded') {
    text = 'Superseded by a newer run. See the latest in the queue.';
    color = 'var(--gold-dim)';
  } else if (qStatus === 'pending') {
    text = 'Pending review — act via the queue card on the dashboard.';
    color = 'var(--gold)';
  } else if (output.approval_status === 'pending') {
    text = 'Pending — no queue item linked (child output).';
  }

  if (!text) return null;
  return (
    <div
      className="mb-4 text-sm border rounded-md px-3 py-2"
      style={{ borderColor: color, color }}
    >
      {text}
    </div>
  );
}

function isShowrunnerFullyScheduled(content: Record<string, unknown>): boolean {
  interface Clip { scheduled_at?: unknown }
  const captions = Array.isArray(content.clip_captions)
    ? (content.clip_captions as Clip[])
    : [];
  if (captions.length === 0) return true;
  return captions.every((c) => !!c.scheduled_at);
}

function OutputContent({
  outputType,
  content,
}: {
  outputType: string;
  content: Record<string, unknown>;
}) {
  // Briefings — render sanitized HTML via LandscapeBody (client-side DOMPurify).
  if (outputType === 'daily_briefing' || outputType === 'editorial_landscape_briefing') {
    const html =
      typeof content.briefing_html === 'string'
        ? (content.briefing_html as string)
        : typeof content.html === 'string'
          ? (content.html as string)
          : undefined;
    const markdown =
      typeof content.briefing_markdown === 'string'
        ? (content.briefing_markdown as string)
        : typeof content.markdown === 'string'
          ? (content.markdown as string)
          : undefined;
    if (html || markdown) {
      return <LandscapeBody html={html} markdown={markdown} />;
    }
  }

  // For everything else, render each top-level field. Skip internal bookkeeping.
  const entries = Object.entries(content).filter(([k]) => {
    return ![
      'raw_output',
      'inputs',
      'superseded_by_queue_id',
      'notion_entries_created',
      'notion_entry_ids',
      'superseded_feedback',
    ].includes(k);
  });
  if (entries.length === 0) {
    return <p className="muted text-xs">(no content body)</p>;
  }
  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <div key={key}>
          <div className="text-xs muted uppercase tracking-wider mb-1">
            {key.replace(/_/g, ' ')}
          </div>
          <FieldValue value={value} />
        </div>
      ))}
    </div>
  );
}

function FieldValue({ value }: { value: unknown }) {
  if (value == null || value === '') {
    return <p className="muted text-xs">(empty)</p>;
  }
  if (typeof value === 'string') {
    return <pre className="whitespace-pre-wrap text-sm">{value}</pre>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <p>{String(value)}</p>;
  }
  return (
    <pre className="whitespace-pre-wrap text-xs muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
