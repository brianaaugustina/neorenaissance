// Supabase Storage helpers — private bucket for Showrunner clip files.
//
// Files land here at initial input time. They're transferred to Notion's
// Content DB files property per-clip at schedule time (see showrunner
// scheduling route). The bucket is service-role-only; every call here uses
// supabaseAdmin().

import { supabaseAdmin } from './supabase/client';

export const SHOWRUNNER_CLIPS_BUCKET = 'showrunner-clips';

// Path convention: {runId}/clip-{index}-{slug}.{ext}
// runId == per-episode directory. One run = one episode package.
export function buildClipStoragePath(params: {
  runId: string;
  clipIndex: number;
  filename: string;
}): string {
  const safeExt = extractExtension(params.filename) || 'bin';
  const slug = slugify(stripExtension(params.filename)) || 'clip';
  return `${params.runId}/clip-${params.clipIndex}-${slug}.${safeExt}`;
}

export async function uploadClipFile(params: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
}): Promise<void> {
  const client = supabaseAdmin();
  const { error } = await client.storage
    .from(SHOWRUNNER_CLIPS_BUCKET)
    .upload(params.storagePath, params.buffer, {
      contentType: params.contentType,
      upsert: true,
      cacheControl: '3600',
    });
  if (error) {
    console.error('[storage] uploadClipFile failed:', error);
    throw error;
  }
}

export async function downloadClipFile(
  storagePath: string,
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const client = supabaseAdmin();
  const { data, error } = await client.storage
    .from(SHOWRUNNER_CLIPS_BUCKET)
    .download(storagePath);
  if (error || !data) {
    console.error('[storage] downloadClipFile failed:', error);
    throw error ?? new Error('No data returned');
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  return { buffer, contentType: data.type ?? null };
}

export async function removeClipFile(storagePath: string): Promise<void> {
  const client = supabaseAdmin();
  const { error } = await client.storage
    .from(SHOWRUNNER_CLIPS_BUCKET)
    .remove([storagePath]);
  if (error) {
    console.error('[storage] removeClipFile failed:', error);
    throw error;
  }
}

// Supabase Storage signed URLs — unused for core flow (server-side only
// access) but exposed for debugging / preview scenarios.
export async function getClipSignedUrl(
  storagePath: string,
  expiresInSeconds = 300,
): Promise<string> {
  const client = supabaseAdmin();
  const { data, error } = await client.storage
    .from(SHOWRUNNER_CLIPS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) throw error ?? new Error('No signed URL');
  return data.signedUrl;
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
