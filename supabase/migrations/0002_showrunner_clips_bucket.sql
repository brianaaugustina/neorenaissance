-- Migration 0002 — Showrunner clip-file storage
-- Creates a private Supabase Storage bucket for clip video files. Files land
-- here at initial input, stay until scheduling, then get transferred to Notion
-- (Content DB Files property) per-clip when Briana hits Schedule.
--
-- Paste into Supabase SQL editor. Safe to re-run — uses ON CONFLICT / IF NOT EXISTS.

-- ============================================
-- Bucket — private, service-role-only access
-- ============================================
insert into storage.buckets (id, name, public)
values ('showrunner-clips', 'showrunner-clips', false)
on conflict (id) do nothing;

-- Service role bypasses RLS by default; explicit policies here are belt-and-
-- suspenders so any future anon path is blocked.
drop policy if exists "showrunner-clips service role all" on storage.objects;
create policy "showrunner-clips service role all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'showrunner-clips')
  with check (bucket_id = 'showrunner-clips');

-- No anon access; no policy for anon or authenticated. Storage objects in this
-- bucket are accessible only via server-side code holding the service key.
