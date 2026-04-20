import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import {
  buildGoogleConsentUrl,
  isGoogleOAuthConfigured,
} from '@/lib/analytics/google-oauth';

export const maxDuration = 30;

// GET /api/auth/google/start
// Redirects the browser to Google's consent screen. A random state value is
// set as an httpOnly cookie and round-tripped to the callback for CSRF
// protection.
export async function GET(req: Request) {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          'Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID / CLIENT_SECRET / REDIRECT_URI in .env.local.',
      },
      { status: 400 },
    );
  }

  const state = randomBytes(24).toString('hex');
  const url = buildGoogleConsentUrl(state);

  // Optional `next` query param — where to redirect after callback completes.
  // Defaults to the analytics dashboard page.
  const incoming = new URL(req.url);
  const next = incoming.searchParams.get('next') ?? '/agents/analytics-reporting';

  const res = NextResponse.redirect(url);
  res.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600, // 10 min — long enough for a slow Google consent click
  });
  res.cookies.set('google_oauth_next', next, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
