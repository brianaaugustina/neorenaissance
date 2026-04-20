// PostHog client — lightweight REST wrapper. No SDK dep; we just fetch the
// HogQL query endpoint directly. Returns normalized metrics for a period.

import { env } from '../env';

export interface PosthogSnapshot {
  configured: boolean;
  total_page_views: number;
  unique_visitors: number;
  top_pages: Array<{ path: string; views: number }>;
  period: { start: string; end: string };
  not_configured_reason?: string;
  error?: string;
}

export function isPosthogConfigured(): boolean {
  const a = env.analytics;
  return !!(a.posthogApiKey && a.posthogProjectId);
}

export async function getPosthogSnapshot(params: {
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
}): Promise<PosthogSnapshot> {
  const { posthogApiKey, posthogProjectId, posthogHost } = env.analytics;

  if (!posthogApiKey || !posthogProjectId) {
    return {
      configured: false,
      total_page_views: 0,
      unique_visitors: 0,
      top_pages: [],
      period: { start: params.periodStart, end: params.periodEnd },
      not_configured_reason: 'POSTHOG_API_KEY / POSTHOG_PROJECT_ID not set in .env.local',
    };
  }

  // HogQL query — total pageviews + unique persons + top-10 paths. Date range
  // is inclusive of both endpoints.
  // PostHog's `$pageview` event carries a `$pathname` property per visit.
  const queryBody = {
    query: {
      kind: 'HogQLQuery',
      query: `
        SELECT
          count() AS total_views,
          count(DISTINCT distinct_id) AS unique_visitors
        FROM events
        WHERE event = '$pageview'
          AND timestamp >= toDate('${params.periodStart}')
          AND timestamp <= toDate('${params.periodEnd}') + INTERVAL 1 DAY
      `.trim(),
    },
  };

  const topPagesBody = {
    query: {
      kind: 'HogQLQuery',
      query: `
        SELECT
          properties.$pathname AS path,
          count() AS views
        FROM events
        WHERE event = '$pageview'
          AND timestamp >= toDate('${params.periodStart}')
          AND timestamp <= toDate('${params.periodEnd}') + INTERVAL 1 DAY
        GROUP BY path
        ORDER BY views DESC
        LIMIT 10
      `.trim(),
    },
  };

  try {
    const [summaryResp, topPagesResp] = await Promise.all([
      fetch(`${posthogHost}/api/projects/${posthogProjectId}/query/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${posthogApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(queryBody),
      }),
      fetch(`${posthogHost}/api/projects/${posthogProjectId}/query/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${posthogApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(topPagesBody),
      }),
    ]);

    if (!summaryResp.ok) {
      const text = await summaryResp.text();
      throw new Error(`PostHog summary query failed (${summaryResp.status}): ${text.slice(0, 200)}`);
    }
    if (!topPagesResp.ok) {
      const text = await topPagesResp.text();
      throw new Error(`PostHog top-pages query failed (${topPagesResp.status}): ${text.slice(0, 200)}`);
    }

    const summaryJson = (await summaryResp.json()) as { results?: Array<[number, number]> };
    const topPagesJson = (await topPagesResp.json()) as {
      results?: Array<[string | null, number]>;
    };

    const summaryRow = summaryJson.results?.[0];
    const total_page_views = Number(summaryRow?.[0] ?? 0);
    const unique_visitors = Number(summaryRow?.[1] ?? 0);

    const top_pages = (topPagesJson.results ?? [])
      .filter((r): r is [string, number] => typeof r[0] === 'string')
      .map((r) => ({ path: r[0], views: Number(r[1]) }));

    return {
      configured: true,
      total_page_views,
      unique_visitors,
      top_pages,
      period: { start: params.periodStart, end: params.periodEnd },
    };
  } catch (e) {
    console.error('[analytics/posthog] fetch failed:', e);
    return {
      configured: true,
      total_page_views: 0,
      unique_visitors: 0,
      top_pages: [],
      period: { start: params.periodStart, end: params.periodEnd },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
