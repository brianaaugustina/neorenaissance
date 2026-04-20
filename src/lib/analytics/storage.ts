// Analytics uploads — private Supabase Storage bucket for Substack / Spotify
// CSV exports. Mirrors the showrunner-clips pattern: private bucket, service-
// role-only, upsert-based upload. Raw CSVs are preserved for re-parsing if
// the parser schema changes later.

import { createHash } from 'crypto';
import { supabaseAdmin } from '../supabase/client';

export const ANALYTICS_UPLOADS_BUCKET = 'analytics-uploads';

// Path: {platform}/{periodEnd}/{hash}-{filename}
// hash guards against double-uploads of the same file while keeping the
// original filename visible for debugging.
export function buildAnalyticsCsvPath(params: {
  platform: string;
  periodEnd: string;
  filename: string;
  buffer: Buffer;
}): string {
  const safe = slugify(stripExtension(params.filename)) || 'upload';
  const ext = extractExtension(params.filename) || 'csv';
  const hash = createHash('sha1').update(params.buffer).digest('hex').slice(0, 12);
  return `${params.platform}/${params.periodEnd}/${hash}-${safe}.${ext}`;
}

export async function uploadAnalyticsCsv(params: {
  platform: string;
  periodStart: string;
  periodEnd: string;
  buffer: Buffer;
  filename: string;
}): Promise<{ storagePath: string }> {
  const storagePath = buildAnalyticsCsvPath({
    platform: params.platform,
    periodEnd: params.periodEnd,
    filename: params.filename,
    buffer: params.buffer,
  });
  const client = supabaseAdmin();
  const { error } = await client.storage
    .from(ANALYTICS_UPLOADS_BUCKET)
    .upload(storagePath, params.buffer, {
      contentType: 'text/csv',
      upsert: true,
      cacheControl: '3600',
    });
  if (error) {
    console.error('[analytics/storage] upload failed:', error);
    throw error;
  }
  return { storagePath };
}

export async function downloadAnalyticsCsv(storagePath: string): Promise<string> {
  const client = supabaseAdmin();
  const { data, error } = await client.storage
    .from(ANALYTICS_UPLOADS_BUCKET)
    .download(storagePath);
  if (error || !data) throw error ?? new Error('No data returned');
  return await data.text();
}

function extractExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? filename : filename.slice(0, dot);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
