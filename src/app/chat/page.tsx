import { AgentDashNav } from '@/components/AgentDashNav';
import { ChatPageClient } from '@/components/ChatPageClient';
import { AGENT_REGISTRY } from '@/lib/agents/registry';
import { getChatHistory, supabaseAdmin } from '@/lib/supabase/client';
import { todayIsoPT } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const sp = await searchParams;
  const todayIso = todayIsoPT();

  // Load Ops Chief chat history (currently the only wired agent chat).
  const history = await getChatHistory(todayIso, 200).catch(() => [] as Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>);

  // Pull recent runs per agent so we can preview a "last activity" line in
  // the sidebar. One query, grouped client-side.
  let lastRunsByAgent: Record<string, { started_at: string; output_summary: string | null; status: string }> = {};
  try {
    const { data } = await supabaseAdmin()
      .from('agent_runs')
      .select('agent_name, started_at, status, output_summary')
      .order('started_at', { ascending: false })
      .limit(500);
    const rows = (data ?? []) as Array<{
      agent_name: string;
      started_at: string;
      status: string;
      output_summary: string | null;
    }>;
    for (const r of rows) {
      const key = r.agent_name.replace(/_/g, '-');
      if (!lastRunsByAgent[key]) {
        lastRunsByAgent[key] = {
          started_at: r.started_at,
          output_summary: r.output_summary,
          status: r.status,
        };
      }
    }
  } catch {
    lastRunsByAgent = {};
  }

  return (
    <>
      <AgentDashNav />
      <ChatPageClient
        agents={AGENT_REGISTRY.map((a) => ({
          id: a.id,
          aliases: a.aliases ?? [],
          name: a.name,
          tagline: a.tagline,
          venture: a.venture,
          layer: a.layer,
        }))}
        initialActiveId={sp.agent ?? 'ops_chief'}
        opsChiefHistory={history.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        }))}
        lastRunsByAgent={lastRunsByAgent}
      />
    </>
  );
}
