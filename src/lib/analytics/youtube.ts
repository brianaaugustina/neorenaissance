// YouTube Analytics + YouTube Data v3 client.
// Two APIs:
//   - youtubeanalytics.googleapis.com/v2/reports  — views, watch time, subs+/- , retention, traffic sources
//   - www.googleapis.com/youtube/v3/channels     — channel snapshot (total subs, total views, channel title)
//
// Both call with the same OAuth access token minted via google-oauth.ts.

import {
  getValidGoogleAccessToken,
  isGoogleConnected,
  isGoogleOAuthConfigured,
} from './google-oauth';

export interface YoutubeSnapshot {
  configured: boolean;
  connected: boolean;
  channel_id: string | null;
  channel_title: string | null;
  // Lifetime stats from v3 channels endpoint
  total_subscribers_lifetime: number | null;
  total_views_lifetime: number | null;
  total_videos_lifetime: number | null;
  // Period metrics from Analytics v2 reports
  views_in_period: number;
  estimated_minutes_watched: number;
  average_view_duration_seconds: number;
  subscribers_gained: number;
  subscribers_lost: number;
  net_subscribers_change: number;
  top_videos: Array<{
    video_id: string;
    views: number;
    title?: string;
  }>;
  traffic_sources: Array<{
    source: string;
    views: number;
  }>;
  period: { start: string; end: string };
  not_connected_reason?: string;
  error?: string;
}

export async function getYoutubeSnapshot(params: {
  periodStart: string;
  periodEnd: string;
}): Promise<YoutubeSnapshot> {
  const base: YoutubeSnapshot = {
    configured: isGoogleOAuthConfigured(),
    connected: false,
    channel_id: null,
    channel_title: null,
    total_subscribers_lifetime: null,
    total_views_lifetime: null,
    total_videos_lifetime: null,
    views_in_period: 0,
    estimated_minutes_watched: 0,
    average_view_duration_seconds: 0,
    subscribers_gained: 0,
    subscribers_lost: 0,
    net_subscribers_change: 0,
    top_videos: [],
    traffic_sources: [],
    period: { start: params.periodStart, end: params.periodEnd },
  };

  if (!base.configured) {
    return {
      ...base,
      not_connected_reason: 'GOOGLE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI not set',
    };
  }

  const connected = await isGoogleConnected();
  if (!connected) {
    return {
      ...base,
      not_connected_reason:
        'Google OAuth consent not completed — visit /agents/analytics-reporting and click "Connect YouTube"',
    };
  }

  try {
    const accessToken = await getValidGoogleAccessToken();
    if (!accessToken) throw new Error('Could not mint Google access token');

    // ── Channel snapshot (v3) ──────────────────────────────────────────────
    const channelResp = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!channelResp.ok) {
      throw new Error(
        `YouTube Data API channels failed (${channelResp.status}): ${(await channelResp.text()).slice(0, 200)}`,
      );
    }
    const channelJson = (await channelResp.json()) as {
      items?: Array<{
        id: string;
        snippet?: { title?: string };
        statistics?: {
          subscriberCount?: string;
          viewCount?: string;
          videoCount?: string;
        };
      }>;
    };
    const channel = channelJson.items?.[0];
    if (!channel) {
      throw new Error('No YouTube channel associated with this Google account');
    }

    const channel_id = channel.id;
    const channel_title = channel.snippet?.title ?? null;
    const stats = channel.statistics ?? {};

    // ── Period summary (Analytics v2) ──────────────────────────────────────
    const summary = await fetchAnalyticsReport(accessToken, {
      ids: 'channel==MINE',
      startDate: params.periodStart,
      endDate: params.periodEnd,
      metrics:
        'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost',
    });
    const summaryRow = summary.rows?.[0] ?? [];
    const views_in_period = Number(summaryRow[0] ?? 0);
    const estimated_minutes_watched = Number(summaryRow[1] ?? 0);
    const average_view_duration_seconds = Number(summaryRow[2] ?? 0);
    const subscribers_gained = Number(summaryRow[3] ?? 0);
    const subscribers_lost = Number(summaryRow[4] ?? 0);

    // ── Top videos (Analytics v2 with dimension=video) ─────────────────────
    let top_videos: YoutubeSnapshot['top_videos'] = [];
    try {
      const topReport = await fetchAnalyticsReport(accessToken, {
        ids: 'channel==MINE',
        startDate: params.periodStart,
        endDate: params.periodEnd,
        metrics: 'views',
        dimensions: 'video',
        sort: '-views',
        maxResults: '10',
      });
      const videoIds: string[] = [];
      top_videos = (topReport.rows ?? []).map((r) => {
        const videoId = String(r[0] ?? '');
        videoIds.push(videoId);
        return { video_id: videoId, views: Number(r[1] ?? 0) };
      });

      // Resolve video titles (best-effort; skip if quota is tight)
      if (videoIds.length > 0) {
        const titleResp = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoIds.join(',')}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (titleResp.ok) {
          const titleJson = (await titleResp.json()) as {
            items?: Array<{ id: string; snippet?: { title?: string } }>;
          };
          const titleMap = new Map<string, string>();
          for (const item of titleJson.items ?? []) {
            if (item.snippet?.title) titleMap.set(item.id, item.snippet.title);
          }
          top_videos = top_videos.map((v) => ({
            ...v,
            title: titleMap.get(v.video_id),
          }));
        }
      }
    } catch (e) {
      console.warn('[analytics/youtube] top_videos fetch failed (non-fatal):', e);
    }

    // ── Traffic sources ────────────────────────────────────────────────────
    let traffic_sources: YoutubeSnapshot['traffic_sources'] = [];
    try {
      const trafficReport = await fetchAnalyticsReport(accessToken, {
        ids: 'channel==MINE',
        startDate: params.periodStart,
        endDate: params.periodEnd,
        metrics: 'views',
        dimensions: 'insightTrafficSourceType',
        sort: '-views',
        maxResults: '10',
      });
      traffic_sources = (trafficReport.rows ?? []).map((r) => ({
        source: String(r[0] ?? 'unknown'),
        views: Number(r[1] ?? 0),
      }));
    } catch (e) {
      console.warn('[analytics/youtube] traffic sources fetch failed (non-fatal):', e);
    }

    return {
      ...base,
      connected: true,
      channel_id,
      channel_title,
      total_subscribers_lifetime: stats.subscriberCount
        ? Number(stats.subscriberCount)
        : null,
      total_views_lifetime: stats.viewCount ? Number(stats.viewCount) : null,
      total_videos_lifetime: stats.videoCount ? Number(stats.videoCount) : null,
      views_in_period,
      estimated_minutes_watched,
      average_view_duration_seconds,
      subscribers_gained,
      subscribers_lost,
      net_subscribers_change: subscribers_gained - subscribers_lost,
      top_videos,
      traffic_sources,
    };
  } catch (e) {
    console.error('[analytics/youtube] fetch failed:', e);
    return {
      ...base,
      connected: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ============================================================================
// Analytics v2 report helper
// ============================================================================

async function fetchAnalyticsReport(
  accessToken: string,
  params: Record<string, string>,
): Promise<{ rows?: unknown[][]; columnHeaders?: Array<{ name: string }> }> {
  const url = `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `YouTube Analytics report failed (${res.status}) for ${params.metrics}: ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as {
    rows?: unknown[][];
    columnHeaders?: Array<{ name: string }>;
  };
}
