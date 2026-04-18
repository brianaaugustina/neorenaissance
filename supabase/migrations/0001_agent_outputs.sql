-- Migration 0001 — agent_outputs + agent_learnings data layer
-- Spec: docs/agent-outputs-claude-code-handoff.md
-- Paste into Supabase SQL editor for project uqqaqkthgkjebsuyxbut. Safe to re-run.

-- ============================================
-- Extensions (already enabled; safety no-ops)
-- ============================================
create extension if not exists vector;
create extension if not exists moddatetime;

-- ============================================
-- agent_outputs — append-only log of every agent draft
-- ============================================
create table if not exists public.agent_outputs (
  id uuid primary key default gen_random_uuid(),

  -- Identity
  agent_id text not null,
  venture text not null,
  output_type text not null,

  -- Linking
  run_id uuid,
  approval_queue_id uuid,
  parent_output_id uuid references public.agent_outputs(id),

  -- Content
  draft_content jsonb not null,
  final_content jsonb,
  edit_diff jsonb,

  -- Approval state
  approval_status text not null default 'pending',
  rejection_reason text,

  -- Post-publish (filled by Phase 6 automations)
  published_at timestamptz,
  published_url text,
  metrics_30d jsonb,

  -- Discovery
  tags text[] default array[]::text[],
  embedding vector(1536),

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,

  constraint valid_approval_status check (
    approval_status in ('pending', 'approved', 'edited', 'rejected', 'expired')
  )
);

create index if not exists agent_outputs_agent_id_idx on public.agent_outputs (agent_id);
create index if not exists agent_outputs_venture_idx on public.agent_outputs (venture);
create index if not exists agent_outputs_created_at_idx on public.agent_outputs (created_at desc);
create index if not exists agent_outputs_approval_status_idx on public.agent_outputs (approval_status);
create index if not exists agent_outputs_output_type_idx on public.agent_outputs (output_type);
create index if not exists agent_outputs_run_id_idx on public.agent_outputs (run_id);
create index if not exists agent_outputs_parent_output_id_idx on public.agent_outputs (parent_output_id);
create index if not exists agent_outputs_tags_idx on public.agent_outputs using gin (tags);
-- IVFFlat vector index deferred until embeddings are populated (Phase 6).

drop trigger if exists agent_outputs_updated_at on public.agent_outputs;
create trigger agent_outputs_updated_at
  before update on public.agent_outputs
  for each row execute function moddatetime('updated_at');

-- ============================================
-- agent_learnings — Supervisor / System Engineer retrospectives
-- ============================================
create table if not exists public.agent_learnings (
  id uuid primary key default gen_random_uuid(),

  agent_id text not null,
  learning_type text not null,

  title text not null,
  content text not null,

  source_output_ids uuid[] default array[]::uuid[],

  proposed_by text not null,
  applied boolean default false,
  applied_at timestamptz,
  context_doc_path text,
  git_commit_sha text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint valid_learning_type check (
    learning_type in ('retrospective', 'pattern', 'context_update', 'failure_mode', 'success_mode')
  )
);

create index if not exists agent_learnings_agent_id_idx on public.agent_learnings (agent_id);
create index if not exists agent_learnings_applied_idx on public.agent_learnings (applied);
create index if not exists agent_learnings_created_at_idx on public.agent_learnings (created_at desc);

drop trigger if exists agent_learnings_updated_at on public.agent_learnings;
create trigger agent_learnings_updated_at
  before update on public.agent_learnings
  for each row execute function moddatetime('updated_at');

-- ============================================
-- Row Level Security — service role only; no anon
-- ============================================
alter table public.agent_outputs enable row level security;
alter table public.agent_learnings enable row level security;

drop policy if exists "service_role_all_agent_outputs" on public.agent_outputs;
create policy "service_role_all_agent_outputs"
  on public.agent_outputs for all
  to service_role using (true) with check (true);

drop policy if exists "service_role_all_agent_learnings" on public.agent_learnings;
create policy "service_role_all_agent_learnings"
  on public.agent_learnings for all
  to service_role using (true) with check (true);

-- ============================================
-- approval_queue.agent_output_id — links a queue item to its parent output row
-- ============================================
alter table public.approval_queue
  add column if not exists agent_output_id uuid references public.agent_outputs(id);

create index if not exists approval_queue_agent_output_id_idx
  on public.approval_queue (agent_output_id);

-- Backfill note: existing approval_queue rows have agent_output_id = null.
-- draft/final/diff is not reconstructable — starting fresh is correct.
