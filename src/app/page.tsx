import { loadDashboardData } from '@/lib/dashboard/load';
import { MyView } from '@/components/MyView';
import { AgentHQ } from '@/components/AgentHQ';
import { OpsChiefChat } from '@/components/OpsChiefChat';
import { RunOpsChiefButton } from '@/components/RunOpsChiefButton';
import { DashboardShell } from '@/components/DashboardShell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
  const data = await loadDashboardData();
  const errorEntries = Object.entries(data.errors);

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[1600px] mx-auto">
      <header className="flex items-baseline justify-between mb-6 md:mb-8">
        <div>
          <h1 className="serif text-3xl md:text-4xl gold">Artisanship</h1>
          <p className="muted text-sm mt-1">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
        <RunOpsChiefButton />
      </header>

      {errorEntries.length > 0 && (
        <div className="card p-4 mb-6 text-sm" style={{ borderColor: 'var(--danger)' }}>
          <div className="serif mb-2" style={{ color: 'var(--danger)' }}>
            Data fetch issues
          </div>
          <ul className="space-y-1 muted">
            {errorEntries.map(([k, v]) => (
              <li key={k}>
                <span className="font-mono text-xs">{k}</span>: {v}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DashboardShell
        myView={
          <MyView
            todayIso={data.todayIso}
            weekStartIso={data.weekStartIso}
            weekEndIso={data.weekEndIso}
            todaysTasks={data.todaysTasks}
            overdueTasks={data.overdueTasks}
            weekTasks={data.weekTasks}
            initiatives={data.initiatives}
          />
        }
        agentHQ={<AgentHQ pending={data.pendingQueue} completedToday={data.completedToday} agentRuns={data.agentRuns} />}
        chat={
          <section className="card p-5 md:p-6">
            <h2 className="serif text-2xl mb-4">Chat with Ops Chief</h2>
            <OpsChiefChat initialHistory={data.chatHistory} />
          </section>
        }
      />
    </main>
  );
}
