// Google OAuth 2.0 helper — consent URL construction, code exchange, and
// access-token refresh. Access tokens are cached with their expiry in
// oauth_tokens; we mint new ones when the cached one is within 60 seconds of
// expiry.
//
// Scopes requested for YouTube Analytics:
//   - yt-analytics.readonly : analytics reports (views, watch time, etc.)
//   - youtube.readonly      : channel metadata (title, subscriberCount)

import { env } from '../env';
import {
  getOAuthToken,
  upsertOAuthToken,
  type OAuthTokenRow,
} from './oauth-tokens';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export function isGoogleOAuthConfigured(): boolean {
  const g = env.googleOAuth;
  return !!(g.clientId && g.clientSecret && g.redirectUri);
}

export function buildGoogleConsentUrl(state: string): string {
  const { clientId, redirectUri } = env.googleOAuth;
  if (!clientId || !redirectUri) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_REDIRECT_URI not set');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // `offline` + `consent` together guarantee we get a refresh_token even on
    // re-consent. `select_account` forces the account + channel chooser so
    // Briana can pick The Trades Show brand account (vs. her default
    // "Briana Ottoboni" personal channel) every time she reconnects.
    access_type: 'offline',
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    scope: GOOGLE_SCOPES.join(' '),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = env.googleOAuth;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth not configured');
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = env.googleOAuth;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth not configured');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

// Persist the consent-time response. Google returns refresh_token only on the
// first consent (and on re-consent with prompt=consent), so we always store
// whatever came back.
export async function saveGoogleTokensFromExchange(
  resp: GoogleTokenResponse,
  raw?: Record<string, unknown>,
): Promise<OAuthTokenRow> {
  const expiresAt = new Date(Date.now() + resp.expires_in * 1000).toISOString();
  return upsertOAuthToken({
    platform: 'google',
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token ?? null,
    expiresAt,
    scope: resp.scope,
    tokenType: resp.token_type,
    raw,
  });
}

// Get an access token that's valid for at least 60 more seconds. If the
// cached one is near-expiry, refresh using the stored refresh token.
export async function getValidGoogleAccessToken(): Promise<string | null> {
  const row = await getOAuthToken('google');
  if (!row || !row.refresh_token) return null;

  const now = Date.now();
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;

  if (row.access_token && expiresAt - now > 60_000) {
    return row.access_token;
  }

  // Refresh
  const resp = await refreshAccessToken(row.refresh_token);
  const newExpiresAt = new Date(Date.now() + resp.expires_in * 1000).toISOString();
  await upsertOAuthToken({
    platform: 'google',
    accessToken: resp.access_token,
    // Do NOT pass refreshToken — refresh responses don't include it, and
    // passing undefined would incorrectly overwrite the stored one with null.
    expiresAt: newExpiresAt,
    scope: resp.scope ?? row.scope,
    tokenType: resp.token_type ?? row.token_type,
  });
  return resp.access_token;
}

export async function isGoogleConnected(): Promise<boolean> {
  const row = await getOAuthToken('google');
  return !!(row?.refresh_token);
}
