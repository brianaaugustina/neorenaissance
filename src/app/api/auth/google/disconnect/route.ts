import { NextResponse } from 'next/server';
import { deleteOAuthToken } from '@/lib/analytics/oauth-tokens';

export const maxDuration = 30;

// Removes stored Google OAuth tokens. Next call to /api/auth/google/start
// will re-consent from scratch and a fresh refresh_token will be minted.
export async function POST() {
  try {
    await deleteOAuthToken('google');
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Disconnect failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
