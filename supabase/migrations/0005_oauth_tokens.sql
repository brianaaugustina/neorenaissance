-- Migration 0005 — oauth_tokens
-- Persists OAuth refresh tokens per external platform. Single-tenant: one row
-- per platform is sufficient until we ever have multiple users. Access tokens
-- are cached with their expiry so we don't mint a new one on every request.
--
-- Paste into Supabase SQL editor. Safe to re-run.

create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),

  -- Platform identifier: 'google' | 'meta' | 'tiktok'. Free-form text so a
  -- later platform (Slack, Spotify future) doesn't need a migration.
  platform text not null,

  -- Token material
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  token_type text,

  -- Platform-specific metadata (channel id, IG business id, etc.). Unmodified.
  raw jsonb,

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Single-tenant: one row per platform. When multi-user lands, add a user_id
  -- column and change the unique constraint.
  constraint oauth_tokens_platform_unique unique (platform)
);

create index if not exists oauth_tokens_platform_idx on public.oauth_tokens (platform);

drop trigger if exists oauth_tokens_updated_at on public.oauth_tokens;
create trigger oauth_tokens_updated_at
  before update on public.oauth_tokens
  for each row execute function moddatetime('updated_at');

-- RLS — service role only. OAuth tokens are secrets; never expose to anon.
alter table public.oauth_tokens enable row level security;

drop policy if exists "oauth_tokens service role all" on public.oauth_tokens;
create policy "oauth_tokens service role all"
  on public.oauth_tokens for all
  to service_role
  using (true)
  with check (true);
