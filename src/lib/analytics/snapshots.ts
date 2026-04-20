// Supabase helpers for platform_snapshots + analytics_csv_uploads tables.
// All writes are service-role-only; no public read path.

import { supabaseAdmin } from '../supabase/client';

export type PlatformName =
  | 'posthog'
  | 'convertkit'
  | 'youtube'
  | 'meta'
  | 'tiktok'
  | 'substack'
  | 'spotify';

export type PeriodType = 'daily' | 'weekly' | 'monthly';

export interface PlatformSnapshot {
  id: string;
  platform: PlatformName;
  period_type: PeriodType;
  period_end_date: string; // YYYY-MM-DD
  metrics: Record<string, unknown>;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertSnapshotParams {
  platform: PlatformName;
  periodType: PeriodType;
  periodEndDate: string;
  metrics: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
}

export async function upsertPlatformSnapshot(
  params: UpsertSnapshotParams,
): Promise<PlatformSnapshot> {
  const { data, error } = await supabaseAdmin()
    .from('platform_snapshots')
    .upsert(
      {
        platform: params.platform,
        period_type: params.periodType,
        period_end_date: params.periodEndDate,
        metrics: params.metrics,
        raw_payload: params.rawPayload ?? null,
      },
      { onConflict: 'platform,period_type,period_end_date' },
    )
    .select('*')
    .single();
  if (error) {
    console.error('[analytics/snapshots] upsert failed:', error);
    throw error;
  }
  return data as PlatformSnapshot;
}

// Fetch the latest snapshot for each platform for a given period_type. Used
// by the monthly report to assemble the cross-platform view. Returns a map
// keyed by platform; platforms with no snapshot are absent (caller handles).
export async function getLatestSnapshotsByPeriod(
  periodType: PeriodType,
  periodEndDate: string,
): Promise<Partial<Record<PlatformName, PlatformSnapshot>>> {
  const { data, error } = await supabaseAdmin()
    .from('platform_snapshots')
    .select('*')
    .eq('period_type', periodType)
    .eq('period_end_date', periodEndDate);
  if (error) {
    console.error('[analytics/snapshots] fetch failed:', error);
    throw error;
  }
  const map: Partial<Record<PlatformName, PlatformSnapshot>> = {};
  for (const row of (data ?? []) as PlatformSnapshot[]) {
    map[row.platform] = row;
  }
  return map;
}

// Recent snapshots across all platforms — used by the dashboard to show
// "what data do we have?" at a glance.
export async function listRecentSnapshots(limit = 30): Promise<PlatformSnapshot[]> {
  const { data, error } = await supabaseAdmin()
    .from('platform_snapshots')
    .select('*')
    .order('period_end_date', { ascending: false })
    .order('platform', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PlatformSnapshot[];
}

// ============================================================================
// analytics_csv_uploads helpers
// ============================================================================

export interface CsvUpload {
  id: string;
  platform: PlatformName;
  filename: string;
  storage_path: string;
  period_start_date: string;
  period_end_date: string;
  parsed_into_snapshot_id: string | null;
  parse_error: string | null;
  uploaded_at: string;
}

export async function createCsvUploadRow(params: {
  platform: PlatformName;
  filename: string;
  storagePath: string;
  periodStartDate: string;
  periodEndDate: string;
}): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('analytics_csv_uploads')
    .insert({
      platform: params.platform,
      filename: params.filename,
      storage_path: params.storagePath,
      period_start_date: params.periodStartDate,
      period_end_date: params.periodEndDate,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function markCsvUploadParsed(params: {
  uploadId: string;
  snapshotId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('analytics_csv_uploads')
    .update({ parsed_into_snapshot_id: params.snapshotId, parse_error: null })
    .eq('id', params.uploadId);
  if (error) throw error;
}

export async function markCsvUploadFailed(params: {
  uploadId: string;
  parseError: string;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('analytics_csv_uploads')
    .update({ parse_error: params.parseError, parsed_into_snapshot_id: null })
    .eq('id', params.uploadId);
  if (error) throw error;
}

export async function listRecentCsvUploads(limit = 20): Promise<CsvUpload[]> {
  const { data, error } = await supabaseAdmin()
    .from('analytics_csv_uploads')
    .select('*')
    .order('uploaded_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CsvUpload[];
}
