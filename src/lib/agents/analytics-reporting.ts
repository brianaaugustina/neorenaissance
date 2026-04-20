// Analytics & Reporting agent — pulls from each platform client, writes
// normalized snapshots to platform_snapshots, produces an analytics_report
// agent_output consumed by Growth Strategist + Ops Chief.
//
// Degrades gracefully: platforms with missing credentials are reported as
// "not configured" rather than crashing the whole run. Platforms whose API
// call fails are reported with the error visible so Briana can see what
// broke.

import { logOutput, setApprovalQueueId } from '../agent-outputs';
import {
  getConvertkitSnapshot,
  isConvertkitConfigured,
  type ConvertkitSnapshot,
} from '../analytics/convertkit';
import {
  isGoogleConnected,
  isGoogleOAuthConfigured,
} from '../analytics/google-oauth';
import {
  getPosthogSnapshot,
  isPosthogConfigured,
  type PosthogSnapshot,
} from '../analytics/posthog';
import {
  getLatestSnapshotsByPeriod,
  upsertPlatformSnapshot,
  type PlatformName,
  type PlatformSnapshot,
  type PeriodType,
} from '../analytics/snapshots';
import {
  getYoutubeSnapshot,
  type YoutubeSnapshot,
} from '../analytics/youtube';
import {
  depositToQueue,
  logRunComplete,
  logRunStart,
  supabaseAdmin,
} from '../supabase/client';
import { todayIsoPT } from '../time';
import { think } from './base';

const AGENT_NAME = 'analytics-reporting';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';

export interface AnalyticsReport {
  period: { type: PeriodType; start: string; end: string };
  generated_at: string;
  platforms: {
    posthog?: PosthogSnapshot & { snapshot_id?: string };
    convertkit?: ConvertkitSnapshot & { snapshot_id?: string };
    substack?: { source: 'csv'; snapshot_id: string; metrics: Record<string, unknown> };
    spotify?: { source: 'csv'; snapshot_id: string; metrics: Record<string, unknown> };
    // OAuth platforms land here once 5b-B ships — shape intentionally open.
    youtube?: unknown;
    meta?: unknown;
    tiktok?: unknown;
  };
  not_configured: PlatformName[];
  errored: Array<{ platform: PlatformName; error: string }>;
  cross_platform_summary: string;
  notable_spikes: Array<{
    platform: PlatformName;
    metric: string;
    change: string;
    note: string;
  }>;
}

// ============================================================================
// Period math — previous calendar month when cron fires on the 1st
// ============================================================================

function previousMonthPeriod(now: Date): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed; previous month = m - 1
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of current = last day of prev
  return { start, end };
}

// ============================================================================
// Main entrypoint
// ============================================================================

export interface RunAnalyticsReportParams {
  trigger?: 'cron' | 'manual';
  /** YYYY-MM-DD — last day of the reporting period. Defaults to end of
   *  previous calendar month (what the monthly cron wants). */
  periodEndDate?: string;
  periodType?: PeriodType;
}

export interface RunAnalyticsReportResult {
  runId: string;
  queueId: string;
  outputId: string;
  report: AnalyticsReport;
  tokensUsed: number;
  costEstimate: number;
}

export async function runAnalyticsMonthlyReport(
  params: RunAnalyticsReportParams = {},
): Promise<RunAnalyticsReportResult> {
  const trigger = params.trigger ?? 'manual';
  const periodType = params.periodType ?? 'monthly';

  // Resolve period. Manual trigger with explicit periodEndDate allows
  // backfilling a specific month (e.g., '2026-03-31' re-runs March).
  let periodStart: string;
  let periodEnd: string;
  if (params.periodEndDate) {
    periodEnd = params.periodEndDate;
    if (periodType === 'monthly') {
      const d = new Date(periodEnd);
      const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      periodStart = first.toISOString().slice(0, 10);
    } else {
      // Weekly / daily — default to 7- or 1-day window ending on the date.
      const d = new Date(periodEnd);
      const daysBack = periodType === 'weekly' ? 6 : 0;
      d.setUTCDate(d.getUTCDate() - daysBack);
      periodStart = d.toISOString().slice(0, 10);
    }
  } else {
    const p = previousMonthPeriod(new Date());
    periodStart = p.start;
    periodEnd = p.end;
  }

  const run = await logRunStart(AGENT_NAME, trigger);

  try {
    // ── Tier 1: parallel pull ────────────────────────────────────────────────
    const notConfigured: PlatformName[] = [];
    const errored: AnalyticsReport['errored'] = [];

    const [posthog, convertkit] = await Promise.all([
      isPosthogConfigured()
        ? getPosthogSnapshot({ periodStart, periodEnd })
        : (() => {
            notConfigured.push('posthog');
            return null;
          })(),
      isConvertkitConfigured()
        ? getConvertkitSnapshot({ periodStart, periodEnd })
        : (() => {
            notConfigured.push('convertkit');
            return null;
          })(),
    ]);

    // Persist Tier 1 snapshots + collect platform entries for the report.
    const platforms: AnalyticsReport['platforms'] = {};

    if (posthog) {
      if (posthog.error) errored.push({ platform: 'posthog', error: posthog.error });
      const snap = await upsertPlatformSnapshot({
        platform: 'posthog',
        periodType,
        periodEndDate: periodEnd,
        metrics: {
          total_views: posthog.total_page_views,
          unique_visitors: posthog.unique_visitors,
          top_pages: posthog.top_pages,
        },
        rawPayload: posthog as unknown as Record<string, unknown>,
      });
      platforms.posthog = { ...posthog, snapshot_id: snap.id };
    }

    if (convertkit) {
      if (convertkit.error)
        errored.push({ platform: 'convertkit', error: convertkit.error });
      const snap = await upsertPlatformSnapshot({
        platform: 'convertkit',
        periodType,
        periodEndDate: periodEnd,
        metrics: {
          subscribers: convertkit.total_subscribers,
          new_subscribers: convertkit.new_subscribers_in_period,
          broadcasts_sent: convertkit.broadcast_stats.length,
        },
        rawPayload: convertkit as unknown as Record<string, unknown>,
      });
      platforms.convertkit = { ...convertkit, snapshot_id: snap.id };
    }

    // ── Tier 3: pick up any CSV uploads whose period_end_date matches ───────
    const csvSnapshots = await getLatestSnapshotsByPeriod(periodType, periodEnd);
    if (csvSnapshots.substack) {
      platforms.substack = {
        source: 'csv',
        snapshot_id: csvSnapshots.substack.id,
        metrics: csvSnapshots.substack.metrics,
      };
    } else {
      notConfigured.push('substack');
    }
    if (csvSnapshots.spotify) {
      platforms.spotify = {
        source: 'csv',
        snapshot_id: csvSnapshots.spotify.id,
        metrics: csvSnapshots.spotify.metrics,
      };
    } else {
      notConfigured.push('spotify');
    }

    // ── Tier 2: OAuth platforms (YouTube wired in 5b-B1; meta + tiktok TBD) ──
    let youtube: YoutubeSnapshot | null = null;
    if (isGoogleOAuthConfigured() && (await isGoogleConnected())) {
      youtube = await getYoutubeSnapshot({ periodStart, periodEnd });
      if (youtube.error) errored.push({ platform: 'youtube', error: youtube.error });
      const snap = await upsertPlatformSnapshot({
        platform: 'youtube',
        periodType,
        periodEndDate: periodEnd,
        metrics: {
          total_views: youtube.views_in_period,
          total_subscribers: youtube.total_subscribers_lifetime,
          total_views_lifetime: youtube.total_views_lifetime,
          subscribers_gained: youtube.subscribers_gained,
          subscribers_lost: youtube.subscribers_lost,
          net_subscribers_change: youtube.net_subscribers_change,
          estimated_minutes_watched: youtube.estimated_minutes_watched,
          average_view_duration_seconds: youtube.average_view_duration_seconds,
          top_videos: youtube.top_videos,
          traffic_sources: youtube.traffic_sources,
          channel_title: youtube.channel_title,
        },
        rawPayload: youtube as unknown as Record<string, unknown>,
      });
      // Cast keeps AnalyticsReport['platforms'] typing honest; youtube shape is
      // intentionally open in that interface.
      platforms.youtube = { ...youtube, snapshot_id: snap.id };
    } else {
      notConfigured.push('youtube');
    }

    notConfigured.push('meta', 'tiktok');

    // ── LLM summarization pass ──────────────────────────────────────────────
    const summaryPrompt = buildSummaryPrompt({
      periodStart,
      periodEnd,
      platforms,
      notConfigured,
      errored,
    });
    let cross_platform_summary = '';
    let notable_spikes: AnalyticsReport['notable_spikes'] = [];
    let tokensUsed = 0;
    let costEstimate = 0;

    try {
      const result = await think({
        systemPrompt: summaryPrompt.system,
        userPrompt: summaryPrompt.user,
        maxTokens: 2000,
      });
      tokensUsed = result.inputTokens + result.outputTokens;
      costEstimate = result.costEstimate;
      const parsed = parseSummaryJson(result.text);
      cross_platform_summary = parsed.summary;
      notable_spikes = parsed.spikes;
    } catch (e) {
      console.error('[analytics-reporting] summary pass failed:', e);
      cross_platform_summary =
        'Summary unavailable — LLM summarization failed. Raw platform metrics are in the per-platform sections.';
    }

    const report: AnalyticsReport = {
      period: { type: periodType, start: periodStart, end: periodEnd },
      generated_at: new Date().toISOString(),
      platforms,
      not_configured: notConfigured,
      errored,
      cross_platform_summary,
      notable_spikes,
    };

    const configuredPlatforms = Object.keys(platforms);
    const summaryLine =
      configuredPlatforms.length > 0
        ? `${periodType} report for ${periodStart} → ${periodEnd} · ${configuredPlatforms.length} platform(s): ${configuredPlatforms.join(', ')}`
        : `${periodType} report for ${periodStart} → ${periodEnd} · no platforms configured yet`;

    const outputId = await logOutput({
      agentId: 'analytics-reporting',
      venture: 'cross',
      outputType: 'analytics_report',
      runId: run.id,
      draftContent: report as unknown as Record<string, unknown>,
      tags: [
        'analytics-report',
        periodType,
        periodEnd,
        ...configuredPlatforms.map((p) => `platform:${p}`),
      ],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'report',
      title: `Analytics report — ${periodStart} → ${periodEnd}`,
      summary: summaryLine,
      full_output: report as unknown as Record<string, unknown>,
      initiative: 'Cross-venture',
      run_id: run.id,
      agent_output_id: outputId,
    });
    await setApprovalQueueId(outputId, queueId);

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed,
      model: MODEL,
      contextSummary: `platforms=${configuredPlatforms.join(',') || 'none'} not_configured=${notConfigured.join(',')} errored=${errored.length}`,
      outputSummary: summaryLine,
      approvalQueueId: queueId,
      costEstimate: Number(costEstimate.toFixed(4)),
    });

    return {
      runId: run.id,
      queueId,
      outputId,
      report,
      tokensUsed,
      costEstimate,
    };
  } catch (e: any) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: MODEL,
      error: e?.message ?? String(e),
    });
    throw e;
  }
}

// ============================================================================
// Summary-pass prompt
// ============================================================================

function buildSummaryPrompt(args: {
  periodStart: string;
  periodEnd: string;
  platforms: AnalyticsReport['platforms'];
  notConfigured: PlatformName[];
  errored: AnalyticsReport['errored'];
}): { system: string; user: string } {
  const system = `You are the Analytics & Reporting agent for Artisanship. Your job is NOT to recommend actions — that's Growth Strategist's job. Your job is to turn raw platform metrics into a concise, honest narrative summary + flag notable spikes.

Rules:
- Cite actual numbers from the data provided. Don't invent.
- Don't round generously — use the real figure.
- Don't editorialize ("great week for the show!"). Stick to what the numbers say.
- If a platform is "not configured" or has an error, say so plainly.
- Notable spikes = changes or anomalies worth attention. Empty array is fine.
- Briana's ventures: The Trades Show (podcast + YouTube), The Corral (jobs board), Detto (voice tool). Frame accordingly.

Output format (strict JSON):

<!-- BEGIN_SUMMARY -->
{
  "summary": "2-4 paragraph narrative summary. Lead with the most important signal. Cite specific numbers. Acknowledge what's not configured. Do NOT recommend actions.",
  "spikes": [
    {
      "platform": "posthog" | "convertkit" | "substack" | "spotify" | "youtube" | "meta" | "tiktok",
      "metric": "string",
      "change": "string (e.g., '+47% MoM', 'first week above 1K')",
      "note": "one sentence explaining what this is"
    }
  ]
}
<!-- END_SUMMARY -->

Return ONLY the wrapped JSON.`;

  const user = `Reporting period: ${args.periodStart} → ${args.periodEnd}

# Platform data

${Object.entries(args.platforms)
  .map(([name, data]) => `## ${name}\n${JSON.stringify(data, null, 2).slice(0, 2500)}`)
  .join('\n\n')}

# Not configured
${args.notConfigured.length ? args.notConfigured.join(', ') : '(all available platforms have data)'}

# Errored pulls
${args.errored.length ? args.errored.map((e) => `- ${e.platform}: ${e.error}`).join('\n') : '(none)'}

Produce the summary + notable_spikes JSON.`;

  return { system, user };
}

function parseSummaryJson(text: string): {
  summary: string;
  spikes: AnalyticsReport['notable_spikes'];
} {
  const start = text.indexOf('<!-- BEGIN_SUMMARY -->');
  const end = text.indexOf('<!-- END_SUMMARY -->');
  const body =
    start >= 0 && end >= 0
      ? text.slice(start + '<!-- BEGIN_SUMMARY -->'.length, end).trim()
      : text;

  try {
    const jsonStart = body.indexOf('{');
    const jsonEnd = body.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return { summary: body.trim(), spikes: [] };
    }
    const parsed = JSON.parse(body.slice(jsonStart, jsonEnd + 1)) as {
      summary?: string;
      spikes?: AnalyticsReport['notable_spikes'];
    };
    return {
      summary: parsed.summary ?? '',
      spikes: Array.isArray(parsed.spikes) ? parsed.spikes : [],
    };
  } catch {
    return { summary: body.trim(), spikes: [] };
  }
}

// ============================================================================
// Retrieval — used by Growth Strategist + Ops Chief
// ============================================================================

export interface LatestAnalyticsReport {
  outputId: string;
  generatedAt: string;
  report: AnalyticsReport;
}

export async function getLatestAnalyticsReport(): Promise<LatestAnalyticsReport | null> {
  const { data, error } = await supabaseAdmin()
    .from('agent_outputs')
    .select('id, created_at, draft_content, final_content')
    .eq('agent_id', 'analytics-reporting')
    .eq('output_type', 'analytics_report')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[analytics-reporting] getLatestAnalyticsReport failed:', error);
    return null;
  }
  if (!data) return null;
  const report = (data.final_content ?? data.draft_content ?? {}) as AnalyticsReport;
  return {
    outputId: data.id as string,
    generatedAt: data.created_at as string,
    report,
  };
}

// Dashboard convenience — surface recent snapshots + today's date
export async function dashboardOverview(): Promise<{
  latestByPlatform: Partial<Record<PlatformName, PlatformSnapshot>>;
  today: string;
}> {
  const { data, error } = await supabaseAdmin()
    .from('platform_snapshots')
    .select('*')
    .order('period_end_date', { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = (data ?? []) as PlatformSnapshot[];
  const latestByPlatform: Partial<Record<PlatformName, PlatformSnapshot>> = {};
  for (const row of rows) {
    if (!latestByPlatform[row.platform]) latestByPlatform[row.platform] = row;
  }
  return { latestByPlatform, today: todayIsoPT() };
}
