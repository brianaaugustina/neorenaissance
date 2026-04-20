// Supabase adapter for the oauth_tokens table. Single-tenant (one row per
// platform) — will grow a user_id column if we ever multi-user.

import { supabaseAdmin } from '../supabase/client';

export type OAuthPlatform = 'google' | 'meta' | 'tiktok';

export interface OAuthTokenRow {
  id: string;
  platform: OAuthPlatform;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  scope: string | null;
  token_type: string | null;
  raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertTokenParams {
  platform: OAuthPlatform;
  accessToken: string | null;
  refreshToken?: string | null; // preserve existing when not provided
  expiresAt: string | null;
  scope?: string | null;
  tokenType?: string | null;
  raw?: Record<string, unknown>;
}

export async function upsertOAuthToken(
  params: UpsertTokenParams,
): Promise<OAuthTokenRow> {
  // If refreshToken isn't passed, don't overwrite the existing one. Google's
  // token refresh response only returns access_token; the refresh token is
  // what was minted at consent time and we need to preserve it.
  const existing = await getOAuthToken(params.platform);

  const { data, error } = await supabaseAdmin()
    .from('oauth_tokens')
    .upsert(
      {
        platform: params.platform,
        access_token: params.accessToken,
        refresh_token:
          params.refreshToken !== undefined
            ? params.refreshToken
            : (existing?.refresh_token ?? null),
        token_expires_at: params.expiresAt,
        scope: params.scope ?? existing?.scope ?? null,
        token_type: params.tokenType ?? existing?.token_type ?? null,
        raw: params.raw ?? existing?.raw ?? null,
      },
      { onConflict: 'platform' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as OAuthTokenRow;
}

export async function getOAuthToken(
  platform: OAuthPlatform,
): Promise<OAuthTokenRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('oauth_tokens')
    .select('*')
    .eq('platform', platform)
    .maybeSingle();
  if (error) {
    console.error('[oauth-tokens] getOAuthToken failed:', error);
    return null;
  }
  return (data as OAuthTokenRow | null) ?? null;
}

export async function deleteOAuthToken(platform: OAuthPlatform): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('oauth_tokens')
    .delete()
    .eq('platform', platform);
  if (error) throw error;
}
