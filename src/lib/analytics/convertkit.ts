// ConvertKit / Kit API v3 client — key-auth REST.
// https://developers.convertkit.com/
//
// Endpoints used:
//   GET /v3/account?api_secret=  (subscriber summary)
//   GET /v3/subscribers?api_secret=&from=&to=  (total count, new-in-period)
//   GET /v3/broadcasts?api_key=  (recent broadcasts)
//   GET /v3/broadcasts/{id}/stats?api_secret= (open/click rates)

import { env } from '../env';

export interface ConvertkitSnapshot {
  configured: boolean;
  total_subscribers: number;
  new_subscribers_in_period: number;
  broadcast_stats: Array<{
    subject: string;
    sent_at: string | null;
    recipients: number;
    open_rate: number | null;
    click_rate: number | null;
  }>;
  period: { start: string; end: string };
  not_configured_reason?: string;
  error?: string;
}

export function isConvertkitConfigured(): boolean {
  return !!(env.analytics.convertkitApiKey && env.analytics.convertkitApiSecret);
}

export async function getConvertkitSnapshot(params: {
  periodStart: string;
  periodEnd: string;
}): Promise<ConvertkitSnapshot> {
  const { convertkitApiKey, convertkitApiSecret } = env.analytics;

  if (!convertkitApiKey || !convertkitApiSecret) {
    return {
      configured: false,
      total_subscribers: 0,
      new_subscribers_in_period: 0,
      broadcast_stats: [],
      period: { start: params.periodStart, end: params.periodEnd },
      not_configured_reason:
        'CONVERTKIT_API_KEY / CONVERTKIT_API_SECRET not set in .env.local',
    };
  }

  try {
    // Subscriber counts
    const [totalResp, newResp, broadcastsResp] = await Promise.all([
      fetch(
        `https://api.convertkit.com/v3/subscribers?api_secret=${encodeURIComponent(convertkitApiSecret)}&per_page=1`,
      ),
      fetch(
        `https://api.convertkit.com/v3/subscribers?api_secret=${encodeURIComponent(convertkitApiSecret)}&from=${params.periodStart}&to=${params.periodEnd}&per_page=1`,
      ),
      fetch(
        `https://api.convertkit.com/v3/broadcasts?api_key=${encodeURIComponent(convertkitApiKey)}`,
      ),
    ]);

    if (!totalResp.ok || !newResp.ok || !broadcastsResp.ok) {
      const failed = [
        !totalResp.ok ? `total(${totalResp.status})` : null,
        !newResp.ok ? `new(${newResp.status})` : null,
        !broadcastsResp.ok ? `broadcasts(${broadcastsResp.status})` : null,
      ]
        .filter(Boolean)
        .join(' ');
      throw new Error(`ConvertKit: ${failed}`);
    }

    const totalJson = (await totalResp.json()) as { total_subscribers?: number };
    const newJson = (await newResp.json()) as { total_subscribers?: number };
    const broadcastsJson = (await broadcastsResp.json()) as {
      broadcasts?: Array<{
        id: number;
        subject: string;
        published_at?: string | null;
        send_at?: string | null;
      }>;
    };

    // Per-broadcast stats — keep it bounded (last 10 broadcasts in period) so
    // we don't hammer the API on large accounts.
    const broadcasts = (broadcastsJson.broadcasts ?? [])
      .filter((b) => {
        const when = b.published_at ?? b.send_at;
        if (!when) return false;
        const d = when.slice(0, 10);
        return d >= params.periodStart && d <= params.periodEnd;
      })
      .slice(0, 10);

    const broadcast_stats: ConvertkitSnapshot['broadcast_stats'] = [];
    for (const b of broadcasts) {
      try {
        const statsResp = await fetch(
          `https://api.convertkit.com/v3/broadcasts/${b.id}/stats?api_secret=${encodeURIComponent(convertkitApiSecret)}`,
        );
        if (!statsResp.ok) continue;
        const statsJson = (await statsResp.json()) as {
          broadcast?: {
            stats?: {
              recipients?: number;
              open_rate?: number;
              click_rate?: number;
            };
          };
        };
        const s = statsJson.broadcast?.stats;
        broadcast_stats.push({
          subject: b.subject,
          sent_at: b.published_at ?? b.send_at ?? null,
          recipients: s?.recipients ?? 0,
          open_rate: s?.open_rate ?? null,
          click_rate: s?.click_rate ?? null,
        });
      } catch {
        // Skip broadcasts whose stats endpoint fails — partial data is fine.
      }
    }

    return {
      configured: true,
      total_subscribers: totalJson.total_subscribers ?? 0,
      new_subscribers_in_period: newJson.total_subscribers ?? 0,
      broadcast_stats,
      period: { start: params.periodStart, end: params.periodEnd },
    };
  } catch (e) {
    console.error('[analytics/convertkit] fetch failed:', e);
    return {
      configured: true,
      total_subscribers: 0,
      new_subscribers_in_period: 0,
      broadcast_stats: [],
      period: { start: params.periodStart, end: params.periodEnd },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
