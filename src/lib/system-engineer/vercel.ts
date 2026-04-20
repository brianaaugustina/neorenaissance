// Vercel error log pull for System Engineer.
// Lists recent deployments across the account/team, flags failed builds and
// recent runtime error spikes. Graceful degrade on missing token.

import { env } from '../env';

export function isVercelConfigured(): boolean {
  return !!env.vercel.token;
}

export interface VercelDeploymentSummary {
  uid: string;
  name: string | null;
  target: string | null;
  state: string;
  created_at: string;
  url: string;
}

export interface VercelSnapshot {
  configured: boolean;
  deployments_last_7d: number;
  failed_deployments: VercelDeploymentSummary[];
  sample_successful: VercelDeploymentSummary[];
  error?: string;
}

function buildVercelQuery(extra: Record<string, string> = {}): string {
  const params: Record<string, string> = { ...extra };
  if (env.vercel.teamId) params.teamId = env.vercel.teamId;
  return new URLSearchParams(params).toString();
}

export async function getVercelSnapshot(params: {
  sinceIso: string;
}): Promise<VercelSnapshot> {
  const base: VercelSnapshot = {
    configured: isVercelConfigured(),
    deployments_last_7d: 0,
    failed_deployments: [],
    sample_successful: [],
  };
  if (!env.vercel.token) {
    return { ...base, error: 'VERCEL_TOKEN not set' };
  }

  try {
    // Vercel v6 deployments endpoint. Filter by createdAt gte (in ms epoch).
    const sinceMs = new Date(params.sinceIso).getTime();
    const res = await fetch(
      `https://api.vercel.com/v6/deployments?${buildVercelQuery({
        limit: '100',
        since: String(sinceMs),
      })}`,
      {
        headers: { Authorization: `Bearer ${env.vercel.token}` },
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return {
        ...base,
        error: `Vercel deployments query failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      deployments?: Array<{
        uid: string;
        name?: string;
        target?: string | null;
        state: string;
        createdAt: number;
        url: string;
      }>;
    };
    const deployments = json.deployments ?? [];
    const summaries: VercelDeploymentSummary[] = deployments.map((d) => ({
      uid: d.uid,
      name: d.name ?? null,
      target: d.target ?? null,
      state: d.state,
      created_at: new Date(d.createdAt).toISOString(),
      url: `https://${d.url}`,
    }));
    return {
      ...base,
      deployments_last_7d: summaries.length,
      failed_deployments: summaries.filter((s) =>
        ['ERROR', 'CANCELED', 'FAILED'].includes(s.state.toUpperCase()),
      ),
      sample_successful: summaries
        .filter((s) => s.state.toUpperCase() === 'READY')
        .slice(0, 5),
    };
  } catch (e) {
    return {
      ...base,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
