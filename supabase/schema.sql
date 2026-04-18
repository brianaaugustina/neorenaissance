-- Artisanship Agents — Supabase schema
-- Paste this into the Supabase SQL editor for project uqqaqkthgkjebsuyxbut.
-- Run top-to-bottom. Safe to re-run: uses IF NOT EXISTS.
--
-- This file is the Phase 1 bootstrap snapshot (base tables only). All changes
-- from 2026-04-18 onward live as numbered migrations in ./migrations/.
-- Apply them in filename order after running this file.

-- ============================================
-- AGENT RUNS (Observability)
-- Declared first because approval_queue references it.
-- ============================================
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  duration_ms INTEGER,
  tokens_used INTEGER,
  model TEXT DEFAULT 'claude-sonnet-4-6',
  context_summary TEXT,
  output_summary TEXT,
  error TEXT,
  approval_queue_id UUID,
  cost_estimate DECIMAL(8,4)
);

CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_name);
CREATE INDEX IF NOT EXISTS idx_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started ON agent_runs(started_at DESC);

-- ============================================
-- APPROVAL QUEUE
-- ============================================
CREATE TABLE IF NOT EXISTS approval_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT NOT NULL,
  summary TEXT,
  full_output JSONB,
  initiative TEXT,
  feedback TEXT,
  run_id UUID REFERENCES agent_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_queue(status);
CREATE INDEX IF NOT EXISTS idx_approval_agent ON approval_queue(agent_name);
CREATE INDEX IF NOT EXISTS idx_approval_created ON approval_queue(created_at DESC);

-- Now wire the back-reference from agent_runs.approval_queue_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_approval_queue_id_fkey'
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_approval_queue_id_fkey
      FOREIGN KEY (approval_queue_id) REFERENCES approval_queue(id);
  END IF;
END$$;

-- ============================================
-- AGENT MEMORY
-- ============================================
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_name, key)
);

CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_name);

-- ============================================
-- CHAT MESSAGES
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL DEFAULT 'ops_chief',
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_date DESC);
CREATE INDEX IF NOT EXISTS idx_chat_agent ON chat_messages(agent_name);
