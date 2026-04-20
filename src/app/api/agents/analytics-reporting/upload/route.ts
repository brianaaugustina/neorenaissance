import { NextResponse } from 'next/server';
import {
  parseSpotifyCsv,
  parseSubstackCsv,
} from '@/lib/analytics/csv-parsers';
import {
  createCsvUploadRow,
  markCsvUploadFailed,
  markCsvUploadParsed,
  upsertPlatformSnapshot,
  type PlatformName,
} from '@/lib/analytics/snapshots';
import { uploadAnalyticsCsv } from '@/lib/analytics/storage';

export const maxDuration = 60;

// POST /api/agents/analytics-reporting/upload
// multipart/form-data body:
//   platform: 'substack' | 'spotify'
//   periodStart: YYYY-MM-DD
//   periodEnd: YYYY-MM-DD
//   file: the CSV file
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const platform = String(form.get('platform') ?? '') as PlatformName;
    const periodStart = String(form.get('periodStart') ?? '');
    const periodEnd = String(form.get('periodEnd') ?? '');
    const file = form.get('file');

    if (platform !== 'substack' && platform !== 'spotify') {
      return NextResponse.json(
        { error: "platform must be 'substack' or 'spotify'" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return NextResponse.json(
        { error: 'periodStart and periodEnd must be YYYY-MM-DD' },
        { status: 400 },
      );
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'file too large (max 20 MB)' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileText = buffer.toString('utf-8');

    // Store raw CSV first so we always have a trail even if parsing fails.
    const { storagePath } = await uploadAnalyticsCsv({
      platform,
      periodStart,
      periodEnd,
      buffer,
      filename: file.name,
    });
    const uploadId = await createCsvUploadRow({
      platform,
      filename: file.name,
      storagePath,
      periodStartDate: periodStart,
      periodEndDate: periodEnd,
    });

    // Parse + upsert snapshot. Capture parse errors into the upload row.
    try {
      if (platform === 'substack') {
        const parsed = parseSubstackCsv(fileText, { start: periodStart, end: periodEnd });
        if (parsed.csv_kind === 'unknown') {
          throw new Error(
            "Couldn't recognize Substack CSV shape — expected subscriber list or post stats headers.",
          );
        }
        const snap = await upsertPlatformSnapshot({
          platform: 'substack',
          periodType: 'monthly',
          periodEndDate: periodEnd,
          metrics: {
            subscribers: parsed.total_subscribers,
            paid_subscribers: parsed.paid_subscribers,
            free_subscribers: parsed.free_subscribers,
            avg_open_rate: parsed.avg_open_rate,
            avg_click_rate: parsed.avg_click_rate,
            top_posts: parsed.top_posts,
            csv_kind: parsed.csv_kind,
          },
          rawPayload: parsed as unknown as Record<string, unknown>,
        });
        await markCsvUploadParsed({ uploadId, snapshotId: snap.id });
        return NextResponse.json({
          ok: true,
          uploadId,
          snapshotId: snap.id,
          csvKind: parsed.csv_kind,
          subscribers: parsed.total_subscribers,
        });
      }

      // Spotify
      const parsed = parseSpotifyCsv(fileText, { start: periodStart, end: periodEnd });
      if (parsed.csv_kind === 'unknown') {
        throw new Error(
          "Couldn't recognize Spotify for Podcasters CSV shape — expected episode / plays columns.",
        );
      }
      const snap = await upsertPlatformSnapshot({
        platform: 'spotify',
        periodType: 'monthly',
        periodEndDate: periodEnd,
        metrics: {
          total_plays: parsed.total_plays_in_period,
          total_listeners: parsed.total_listeners,
          avg_completion_rate: parsed.avg_completion_rate,
          top_episodes: parsed.top_episodes,
          csv_kind: parsed.csv_kind,
        },
        rawPayload: parsed as unknown as Record<string, unknown>,
      });
      await markCsvUploadParsed({ uploadId, snapshotId: snap.id });
      return NextResponse.json({
        ok: true,
        uploadId,
        snapshotId: snap.id,
        csvKind: parsed.csv_kind,
        totalPlays: parsed.total_plays_in_period,
      });
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      await markCsvUploadFailed({ uploadId, parseError: msg });
      return NextResponse.json({
        ok: false,
        uploadId,
        parseError: msg,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
