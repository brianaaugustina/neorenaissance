-- Migration 0003 — add 'ignored' to agent_outputs.approval_status
-- Queue cards gain an Ignore button: removes the item from the queue,
-- keeps the row, marks it as a known-incorrect sample the Supervisor
-- (Phase 4) can learn from.
--
-- Distinct from 'rejected' — ignored items aren't worth feedback, but
-- they are worth remembering so the agent avoids producing similar
-- outputs. Paste into Supabase SQL editor; safe to re-run.

alter table public.agent_outputs
  drop constraint if exists valid_approval_status;

alter table public.agent_outputs
  add constraint valid_approval_status check (
    approval_status in ('pending', 'approved', 'edited', 'rejected', 'expired', 'ignored')
  );
