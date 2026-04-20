import { NextResponse } from 'next/server';
import {
  exchangeCodeForTokens,
  saveGoogleTokensFromExchange,
} from '@/lib/analytics/google-oauth';
import { upsertOAuthToken } from '@/lib/analytics/oauth-tokens';

export const maxDuration = 30;

// GET /api/auth/google/callback?code=...&state=...
// Google redirects here after consent. Validates state, exchanges the auth
// code for tokens, persists them, and redirects the user back to the next URL.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const cookieHeader = req.headers.get('cookie') ?? '';
  const readCookie = (name: string): string | null => {
    const match = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
  };

  const next = readCookie('google_oauth_next') ?? '/agents/analytics-reporting';

  if (errorParam) {
    return redirectWithError(url.origin, next, `Google consent error: ${errorParam}`);
  }

  if (!code || !state) {
    return redirectWithError(url.origin, next, 'Missing code or state from Google redirect');
  }

  const expectedState = readCookie('google_oauth_state');
  if (!expectedState || expectedState !== state) {
    return redirectWithError(url.origin, next, 'OAuth state mismatch — retry the connect flow');
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveGoogleTokensFromExchange(tokens);

    // Best-effort: fetch channel metadata once so the dashboard can show
    // "Connected · {channel title}" without requiring a full analytics run.
    // Non-fatal — swallow errors and continue.
    try {
      const chanResp = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (chanResp.ok) {
        const chanJson = (await chanResp.json()) as {
          items?: Array<{
            id: string;
            snippet?: { title?: string };
            statistics?: { subscriberCount?: string };
          }>;
        };
        const channel = chanJson.items?.[0];
        if (channel) {
          await upsertOAuthToken({
            platform: 'google',
            accessToken: tokens.access_token,
            expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            scope: tokens.scope,
            tokenType: tokens.token_type,
            raw: {
              channel_id: channel.id,
              channel_title: channel.snippet?.title ?? null,
              subscriber_count_at_consent: channel.statistics?.subscriberCount
                ? Number(channel.statistics.subscriberCount)
                : null,
              connected_at: new Date().toISOString(),
            },
          });
        }
      }
    } catch (e) {
      console.warn('[google callback] channel metadata fetch failed (non-fatal):', e);
    }

    // Clear the one-shot state cookies and send the user back.
    const res = NextResponse.redirect(new URL(`${next}?googleOAuth=connected`, url.origin));
    res.cookies.set('google_oauth_state', '', { path: '/', maxAge: 0 });
    res.cookies.set('google_oauth_next', '', { path: '/', maxAge: 0 });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Google token exchange failed';
    return redirectWithError(url.origin, next, msg);
  }
}

function redirectWithError(origin: string, nextPath: string, message: string) {
  const target = new URL(
    `${nextPath}?googleOAuth=error&message=${encodeURIComponent(message.slice(0, 200))}`,
    origin,
  );
  const res = NextResponse.redirect(target);
  res.cookies.set('google_oauth_state', '', { path: '/', maxAge: 0 });
  res.cookies.set('google_oauth_next', '', { path: '/', maxAge: 0 });
  return res;
}
