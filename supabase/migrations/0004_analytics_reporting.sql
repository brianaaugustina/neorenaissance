-- Migration 0004 — Analytics & Reporting data layer
-- Creates platform_snapshots (per-platform per-period normalized metrics) +
-- analytics_csv_uploads (tracks manual Substack/Spotify CSV uploads) + the
-- analytics-uploads Storage bucket. Paste into Supabase SQL editor.

-- ============================================
-- platform_snapshots — one row per platform per reporting period
-- Upsert key: (platform, period_type, period_end_date)
-- ============================================
create table if not exists public.platform_snapshots (
  id uuid primary key default gen_random_uuid(),

  -- Platform identity. Free-form text so adding a new platform (e.g., Threads,
  -- YouTube Shorts analytics split) doesn't require a schema migration.
  platform text not null,

  -- Period shape: daily | weekly | monthly. Cadence ships monthly-only but the
  -- column accepts other values for future weekly / daily pulses.
  period_type text not null,
  period_end_date date not null,

  -- Normalized cross-platform keys live here. Each platform client sets a
  -- subset: total_views, unique_visitors, followers, subscribers,
  -- engagement_rate, new_subscribers, etc. The shape is platform-defined — the
  -- LLM summary reads whatever is present.
  metrics jsonb not null default '{}'::jsonb,

  -- The raw API response or parsed CSV, preserved unmodified. Never shown to
  -- the LLM; kept for debugging + future reprocessing with better schemas.
  raw_payload jsonb,

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint valid_period_type check (period_type in ('daily', 'weekly', 'monthly')),
  constraint platform_snapshots_unique unique (platform, period_type, period_end_date)
);

create index if not exists platform_snapshots_platform_idx on public.platform_snapshots (platform);
create index if not exists platform_snapshots_period_end_idx on public.platform_snapshots (period_end_date desc);
create index if not exists platform_snapshots_platform_period_idx
  on public.platform_snapshots (platform, period_type, period_end_date desc);

drop trigger if exists platform_snapshots_updated_at on public.platform_snapshots;
create trigger platform_snapshots_updated_at
  before update on public.platform_snapshots
  for each row execute function moddatetime('updated_at');

-- ============================================
-- analytics_csv_uploads — audit trail for manual Substack/Spotify uploads
-- ============================================
create table if not exists public.analytics_csv_uploads (
  id uuid primary key default gen_random_uuid(),

  platform text not null, -- 'substack' | 'spotify'
  filename text not null,
  storage_path text not null,

  -- Period the CSV covers. Briana selects this at upload time.
  period_start_date date not null,
  period_end_date date not null,

  -- Linking to the snapshot produced by parsing this CSV. Null until parsed
  -- successfully. Also null when parse_error is set.
  parsed_into_snapshot_id uuid references public.platform_snapshots(id),
  parse_error text,

  uploaded_at timestamptz not null default now()
);

create index if not exists analytics_csv_uploads_platform_idx
  on public.analytics_csv_uploads (platform, uploaded_at desc);
create index if not exists analytics_csv_uploads_period_idx
  on public.analytics_csv_uploads (period_end_date desc);

-- ============================================
-- RLS — service role only, matches agent_outputs pattern
-- ============================================
alter table public.platform_snapshots enable row level security;
alter table public.analytics_csv_uploads enable row level security;

drop policy if exists "platform_snapshots service role all" on public.platform_snapshots;
create policy "platform_snapshots service role all"
  on public.platform_snapshots for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "analytics_csv_uploads service role all" on public.analytics_csv_uploads;
create policy "analytics_csv_uploads service role all"
  on public.analytics_csv_uploads for all
  to service_role
  using (true)
  with check (true);

-- ============================================
-- Storage bucket — analytics-uploads (private, service-role-only)
-- Mirrors the showrunner-clips pattern from migration 0002.
-- ============================================
insert into storage.buckets (id, name, public)
values ('analytics-uploads', 'analytics-uploads', false)
on conflict (id) do nothing;

drop policy if exists "analytics-uploads service role all" on storage.objects;
create policy "analytics-uploads service role all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'analytics-uploads')
  with check (bucket_id = 'analytics-uploads');
