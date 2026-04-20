// System Engineer — weekly code-health agent.
// Reads GitHub (4 tracked repos via read-only PAT) + Vercel error logs,
// produces a batched, severity-ranked report with Fix / Defer / Ignore
// actions per finding. Delegate hidden until Phase 5 engineer agents exist.

import { logLearning, logOutput, setApprovalQueueId } from '../agent-outputs';
import {
  countBySeverity,
  generateFindingId,
  getDeferredIgnoredTitleSet,
  getPreviousFindings,
  reconcileFindings,
  type Finding,
  type FindingCategory,
  type FindingSeverity,
  type RepoShortId,
} from '../system-engineer/findings';
import {
  getRepoPackageJson,
  getRepoSnapshot,
  getTrackedRepos,
  isGithubConfigured,
  listRepoCommitsSince,
  type TrackedRepo,
} from '../system-engineer/github';
import {
  getVercelSnapshot,
  isVercelConfigured,
  type VercelSnapshot,
} from '../system-engineer/vercel';
import {
  depositToQueue,
  logRunComplete,
  logRunStart,
  supabaseAdmin,
} from '../supabase/client';
import { todayIsoPT } from '../time';
import { loadContextFile, think } from './base';

const AGENT_NAME = 'system-engineer';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';

export interface RepoScanInput {
  repo: TrackedRepo;
  configured: boolean;
  snapshot: {
    default_branch: string;
    last_pushed_at: string | null;
    open_issues_count: number;
    languages: Record<string, number>;
    top_level_files: string[];
    has_ci: boolean;
    has_tests_dir: boolean;
    has_github_dir: boolean;
  } | null;
  pkg: {
    name: string | null;
    version: string | null;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  } | null;
  commits: Array<{
    sha: string;
    message: string;
    author: string | null;
    committed_at: string;
    url: string;
  }>;
  error: string | null;
}

export interface CodebaseHealthReport {
  period: { start: string; end: string };
  generated_at: string;
  top_line: string;
  severity_counts: Record<FindingSeverity, number>;
  repos: Array<{
    short_id: RepoShortId;
    label: string;
    slug: string | null;
    configured: boolean;
    error: string | null;
    findings_count: number;
  }>;
  findings: Finding[];
  vercel: VercelSnapshot;
  source_refs: {
    tracked_repos: number;
    configured_repos: number;
    commits_observed: number;
    failed_deployments: number;
  };
}

// ============================================================================
// Prompt + output types
// ============================================================================

const FINDING_INSTRUCTIONS = `
You are System Engineer. Review this repo snapshot and produce a list of
findings. Dry, specific, ranked. Severity per playbook §3:
  Critical = security, data loss, production outage, PII/reputation.
  Medium = functional bugs, tech debt, outdated deps, test gaps, performance.
  Low = style, docs, nice-to-haves, minor refactors.

Err one severity LOWER when in doubt. Real Criticals are rare.

# Output format (strict JSON wrapped in markers)

<!-- BEGIN_FINDINGS -->
{
  "findings": [
    {
      "severity": "critical" | "medium" | "low",
      "category": "security" | "dependencies" | "tests" | "performance" | "code-quality" | "git-hygiene" | "error-logs",
      "title": "One-line description of the finding",
      "impact": "One short clause — what happens if unaddressed",
      "fix_suggestion": "One short clause — what to change",
      "effort": "S" | "M" | "L",
      "file_refs": ["path/to/file.ts:line", "optional additional refs"]
    }
  ]
}
<!-- END_FINDINGS -->

# Rules
- Only return findings that are clearly actionable. No "I would refactor this."
- Prefer fewer specific findings over many vague ones.
- Don't flag personal taste architecture opinions.
- If the repo has no findings worth flagging, return an empty findings array.
- file_refs: if you genuinely can't point to a file/line (e.g., architectural),
  set to empty array.

Return ONLY the wrapped JSON.
`.trim();

function loadSystemEngineerContextFiles(): string {
  return [
    loadContextFile('system.md'),
    loadContextFile('agents/system-engineer/system-prompt.md'),
    loadContextFile('agents/system-engineer/playbook.md'),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function renderRepoSnapshot(input: RepoScanInput, recentVercel?: VercelSnapshot): string {
  if (!input.configured) {
    return `Repo not configured (env var missing) — skipping.`;
  }
  if (input.error) {
    return `Error fetching repo: ${input.error}`;
  }
  const snap = input.snapshot;
  const pkg = input.pkg;
  const commits = input.commits;
  const lines: string[] = [];
  if (snap) {
    lines.push(
      `Default branch: ${snap.default_branch} · last pushed: ${snap.last_pushed_at ?? '(unknown)'} · open issues: ${snap.open_issues_count}`,
    );
    const topLangs = Object.entries(snap.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name)
      .join(', ');
    if (topLangs) lines.push(`Languages: ${topLangs}`);
    lines.push(
      `Top-level files: ${snap.top_level_files.join(', ') || '(empty)'}`,
    );
    lines.push(
      `Has CI: ${snap.has_ci} · has tests dir: ${snap.has_tests_dir} · has .github: ${snap.has_github_dir}`,
    );
  }
  if (pkg) {
    const deps = Object.keys(pkg.dependencies).slice(0, 20).join(', ');
    const devDeps = Object.keys(pkg.devDependencies).slice(0, 10).join(', ');
    lines.push(
      `package.json: name=${pkg.name ?? '?'} · v${pkg.version ?? '?'} · ${Object.keys(pkg.dependencies).length} deps, ${Object.keys(pkg.devDependencies).length} devDeps`,
    );
    if (deps) lines.push(`  deps sample: ${deps}${Object.keys(pkg.dependencies).length > 20 ? ', …' : ''}`);
    if (devDeps) lines.push(`  devDeps sample: ${devDeps}${Object.keys(pkg.devDependencies).length > 10 ? ', …' : ''}`);
    if (Object.keys(pkg.scripts).length > 0) {
      lines.push(`  scripts: ${Object.keys(pkg.scripts).join(', ')}`);
    }
  } else {
    lines.push('package.json: not found (not a Node project, or missing)');
  }
  if (commits.length > 0) {
    lines.push(`\nRecent commits (last 7 days, top ${Math.min(10, commits.length)}):`);
    for (const c of commits.slice(0, 10)) {
      lines.push(
        `  - [${c.sha.slice(0, 7)}] ${c.message.slice(0, 100)} — ${c.author ?? '?'} · ${c.committed_at.slice(0, 10)}`,
      );
    }
  } else {
    lines.push('\nRecent commits: none in last 7 days');
  }
  if (recentVercel && input.repo.shortId === 'agent-system') {
    if (recentVercel.failed_deployments.length > 0) {
      lines.push(
        `\nVercel failed deployments (last 7 days, account-wide): ${recentVercel.failed_deployments.length}`,
      );
      for (const d of recentVercel.failed_deployments.slice(0, 5)) {
        lines.push(
          `  - ${d.state} ${d.name ?? ''} ${d.target ?? ''} · ${d.created_at.slice(0, 10)} · ${d.url}`,
        );
      }
    }
  }
  return lines.join('\n');
}

function parseFindingsJson(text: string): Array<
  Omit<Finding, 'id' | 'status' | 'first_seen_at' | 'last_seen_at' | 'days_open' | 'action_taken' | 'repo_short_id'>
> {
  const start = text.indexOf('<!-- BEGIN_FINDINGS -->');
  const end = text.indexOf('<!-- END_FINDINGS -->');
  const body =
    start >= 0 && end >= 0
      ? text.slice(start + '<!-- BEGIN_FINDINGS -->'.length, end).trim()
      : text;
  try {
    const jsonStart = body.indexOf('{');
    const jsonEnd = body.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return [];
    const parsed = JSON.parse(body.slice(jsonStart, jsonEnd + 1)) as {
      findings?: Array<{
        severity: FindingSeverity;
        category: FindingCategory;
        title: string;
        impact: string;
        fix_suggestion: string;
        effort: 'S' | 'M' | 'L';
        file_refs?: string[];
      }>;
    };
    return (parsed.findings ?? []).filter(
      (f) => f.severity && f.title && f.impact && f.fix_suggestion,
    ).map((f) => ({
      severity: f.severity,
      category: f.category ?? 'code-quality',
      title: f.title,
      impact: f.impact,
      fix_suggestion: f.fix_suggestion,
      effort: f.effort,
      file_refs: Array.isArray(f.file_refs) ? f.file_refs : [],
    }));
  } catch (e) {
    console.error('[system-engineer] findings parse failed:', e);
    return [];
  }
}

// ============================================================================
// Per-repo scan — one think() call per repo to keep context tight
// ============================================================================

async function gatherRepoInput(repo: TrackedRepo, sinceIso: string): Promise<RepoScanInput> {
  if (!repo.slug) {
    return {
      repo,
      configured: false,
      snapshot: null,
      pkg: null,
      commits: [],
      error: null,
    };
  }
  const [snapRes, pkgRes, commitsRes] = await Promise.all([
    getRepoSnapshot(repo.slug),
    getRepoPackageJson(repo.slug),
    listRepoCommitsSince(repo.slug, sinceIso),
  ]);
  const error = !snapRes.ok
    ? snapRes.error
    : !pkgRes.ok
      ? pkgRes.error
      : !commitsRes.ok
        ? commitsRes.error
        : null;
  return {
    repo,
    configured: true,
    snapshot: snapRes.ok ? snapRes.snapshot : null,
    pkg: pkgRes.ok ? pkgRes.pkg : null,
    commits: commitsRes.ok ? commitsRes.commits : [],
    error,
  };
}

interface ScanRepoResult {
  candidates: Array<
    Omit<Finding, 'id' | 'status' | 'first_seen_at' | 'last_seen_at' | 'days_open' | 'action_taken'>
  >;
  tokensUsed: number;
  costEstimate: number;
}

async function scanRepo(
  input: RepoScanInput,
  vercel: VercelSnapshot,
  systemBase: string,
): Promise<ScanRepoResult> {
  if (!input.configured || input.error) {
    return { candidates: [], tokensUsed: 0, costEstimate: 0 };
  }

  const user = `# Repo: ${input.repo.label} (${input.repo.slug ?? 'unknown'})
Priority: ${input.repo.priority}

# Snapshot
${renderRepoSnapshot(input, vercel)}

# Today
${todayIsoPT()}

Produce findings JSON for this repo wrapped between BEGIN_FINDINGS / END_FINDINGS markers.
Consider category guidance per playbook §2, severity per §3. Return [] if nothing actionable.`;

  const result = await think({
    systemPrompt: systemBase + '\n\n---\n\n' + FINDING_INSTRUCTIONS,
    userPrompt: user,
    maxTokens: 4000,
  });
  const parsed = parseFindingsJson(result.text);
  return {
    candidates: parsed.map((f) => ({ ...f, repo_short_id: input.repo.shortId })),
    tokensUsed: result.inputTokens + result.outputTokens,
    costEstimate: result.costEstimate,
  };
}

// ============================================================================
// Main entrypoint
// ============================================================================

export interface RunSystemEngineerParams {
  trigger?: 'cron' | 'manual';
  /** Restrict to a single repo when doing a focused scan. */
  focusRepoShortId?: RepoShortId;
}

export interface RunSystemEngineerResult {
  runId: string;
  queueId: string;
  outputId: string;
  report: CodebaseHealthReport;
  tokensUsed: number;
  costEstimate: number;
}

export async function runSystemEngineerWeekly(
  params: RunSystemEngineerParams = {},
): Promise<RunSystemEngineerResult> {
  const trigger = params.trigger ?? 'manual';
  const sinceIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const run = await logRunStart(AGENT_NAME, trigger);
  try {
    const tracked = getTrackedRepos().filter(
      (r) => !params.focusRepoShortId || r.shortId === params.focusRepoShortId,
    );

    const [repoInputs, vercel, previousFindings, deferredTitles] = await Promise.all([
      Promise.all(tracked.map((r) => gatherRepoInput(r, sinceIso))),
      isVercelConfigured() ? getVercelSnapshot({ sinceIso }) : Promise.resolve({
        configured: false,
        deployments_last_7d: 0,
        failed_deployments: [],
        sample_successful: [],
        error: 'VERCEL_TOKEN not set',
      } satisfies VercelSnapshot),
      getPreviousFindings(),
      getDeferredIgnoredTitleSet(),
    ]);

    const systemBase = loadSystemEngineerContextFiles();

    // Per-repo think() calls in sequence to keep token usage predictable.
    const allCandidates: Array<
      Omit<Finding, 'id' | 'status' | 'first_seen_at' | 'last_seen_at' | 'days_open' | 'action_taken'>
    > = [];
    let totalTokens = 0;
    let totalCost = 0;
    for (const input of repoInputs) {
      if (!input.configured || input.error) continue;
      try {
        const { candidates, tokensUsed, costEstimate } = await scanRepo(
          input,
          vercel,
          systemBase,
        );
        for (const c of candidates) allCandidates.push(c);
        totalTokens += tokensUsed;
        totalCost += costEstimate;
      } catch (e) {
        console.error(`[system-engineer] scan failed for ${input.repo.label}:`, e);
      }
    }

    const findings = reconcileFindings({
      candidates: allCandidates,
      previous: previousFindings,
      deferredIgnoredTitles: deferredTitles,
      nowIso,
    });

    const counts = countBySeverity(findings);
    const repoSummary = repoInputs.map((i) => ({
      short_id: i.repo.shortId,
      label: i.repo.label,
      slug: i.repo.slug,
      configured: i.configured,
      error: i.error,
      findings_count: findings.filter((f) => f.repo_short_id === i.repo.shortId).length,
    }));

    const topLine = `${counts.critical} Critical, ${counts.medium} Medium, ${counts.low} Low across ${repoSummary.filter((r) => r.configured).length} configured repo${repoSummary.filter((r) => r.configured).length === 1 ? '' : 's'}${vercel.failed_deployments.length > 0 ? ` · ${vercel.failed_deployments.length} failed Vercel deployment${vercel.failed_deployments.length === 1 ? '' : 's'}` : ''}.`;

    const report: CodebaseHealthReport = {
      period: { start: sinceIso.slice(0, 10), end: nowIso.slice(0, 10) },
      generated_at: nowIso,
      top_line: topLine,
      severity_counts: counts,
      repos: repoSummary,
      findings,
      vercel,
      source_refs: {
        tracked_repos: tracked.length,
        configured_repos: repoSummary.filter((r) => r.configured).length,
        commits_observed: repoInputs.reduce((a, i) => a + i.commits.length, 0),
        failed_deployments: vercel.failed_deployments.length,
      },
    };

    const outputId = await logOutput({
      agentId: 'system-engineer',
      venture: 'cross',
      outputType: 'weekly_codebase_health_report',
      runId: run.id,
      draftContent: report as unknown as Record<string, unknown>,
      tags: [
        'weekly_codebase_health_report',
        `critical-${counts.critical}`,
        `medium-${counts.medium}`,
        `low-${counts.low}`,
        ...repoSummary.filter((r) => r.configured).map((r) => `covers-${r.short_id}`),
      ],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'report',
      title: `System Engineer — ${sinceIso.slice(0, 10)} → ${nowIso.slice(0, 10)}`,
      summary: topLine,
      full_output: report as unknown as Record<string, unknown>,
      initiative: 'Cross-venture',
      run_id: run.id,
      agent_output_id: outputId,
    });
    await setApprovalQueueId(outputId, queueId);

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed: totalTokens,
      model: MODEL,
      contextSummary: `repos=${repoSummary.filter((r) => r.configured).length}/${tracked.length} findings=${findings.length} c=${counts.critical} m=${counts.medium} l=${counts.low} vercel_fails=${vercel.failed_deployments.length}`,
      outputSummary: topLine,
      approvalQueueId: queueId,
      costEstimate: Number(totalCost.toFixed(4)),
    });

    return {
      runId: run.id,
      queueId,
      outputId,
      report,
      tokensUsed: totalTokens,
      costEstimate: totalCost,
    };
  } catch (e: any) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: MODEL,
      error: e?.message ?? String(e),
    });
    throw e;
  }
}

// ============================================================================
// Finding actions — Fix / Defer / Ignore
// ============================================================================

interface QueueItemWithReport {
  id: string;
  agent_output_id: string | null;
  full_output: CodebaseHealthReport;
}

async function loadReportFromQueue(queueItemId: string): Promise<QueueItemWithReport> {
  const { data, error } = await supabaseAdmin()
    .from('approval_queue')
    .select('id, agent_name, agent_output_id, full_output')
    .eq('id', queueItemId)
    .single();
  if (error || !data) throw new Error('Queue item not found');
  if (data.agent_name !== 'system-engineer') {
    throw new Error('Not a system-engineer report');
  }
  return {
    id: data.id as string,
    agent_output_id: (data.agent_output_id as string | null) ?? null,
    full_output: (data.full_output ?? {}) as CodebaseHealthReport,
  };
}

async function mutateReport(params: {
  queueItemId: string;
  agentOutputId: string | null;
  mutate: (r: CodebaseHealthReport) => CodebaseHealthReport;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from('approval_queue')
    .select('full_output')
    .eq('id', params.queueItemId)
    .single();
  if (!item) return;
  const next = params.mutate((item.full_output ?? {}) as CodebaseHealthReport);
  await db
    .from('approval_queue')
    .update({ full_output: next as unknown as Record<string, unknown> })
    .eq('id', params.queueItemId);
  if (params.agentOutputId) {
    await db
      .from('agent_outputs')
      .update({ draft_content: next as unknown as Record<string, unknown> })
      .eq('id', params.agentOutputId);
  }
}

export async function markFindingFix(params: {
  queueItemId: string;
  findingId: string;
}): Promise<void> {
  const item = await loadReportFromQueue(params.queueItemId);
  const f = item.full_output.findings?.find((x) => x.id === params.findingId);
  if (!f) throw new Error(`Finding ${params.findingId} not found`);
  if (f.action_taken) throw new Error('Finding already acted on');
  await mutateReport({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    mutate: (r) => ({
      ...r,
      findings: (r.findings ?? []).map((x) =>
        x.id === params.findingId
          ? {
              ...x,
              status: 'marked-fix',
              action_taken: {
                kind: 'fix',
                note: null,
                learning_id: null,
                taken_at: new Date().toISOString(),
              },
            }
          : x,
      ),
    }),
  });
}

export async function markFindingDefer(params: {
  queueItemId: string;
  findingId: string;
  reason: string;
}): Promise<{ learningId: string }> {
  const item = await loadReportFromQueue(params.queueItemId);
  const f = item.full_output.findings?.find((x) => x.id === params.findingId);
  if (!f) throw new Error(`Finding ${params.findingId} not found`);
  if (f.action_taken) throw new Error('Finding already acted on');

  const learningId = await logLearning({
    agentId: 'system-engineer',
    learningType: 'failure_mode',
    title: f.title,
    content: `[DEFERRED] ${params.reason}\n\nOriginal impact: ${f.impact}\nOriginal fix suggestion: ${f.fix_suggestion}`,
    sourceOutputIds: item.agent_output_id ? [item.agent_output_id] : [],
    proposedBy: 'system-engineer',
  });

  await mutateReport({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    mutate: (r) => ({
      ...r,
      findings: (r.findings ?? []).map((x) =>
        x.id === params.findingId
          ? {
              ...x,
              status: 'deferred',
              action_taken: {
                kind: 'defer',
                note: params.reason,
                learning_id: learningId,
                taken_at: new Date().toISOString(),
              },
            }
          : x,
      ),
    }),
  });

  return { learningId };
}

export async function markFindingIgnore(params: {
  queueItemId: string;
  findingId: string;
}): Promise<{ learningId: string }> {
  const item = await loadReportFromQueue(params.queueItemId);
  const f = item.full_output.findings?.find((x) => x.id === params.findingId);
  if (!f) throw new Error(`Finding ${params.findingId} not found`);
  if (f.action_taken) throw new Error('Finding already acted on');

  const learningId = await logLearning({
    agentId: 'system-engineer',
    learningType: 'failure_mode',
    title: f.title,
    content: `[IGNORED]\nOriginal impact: ${f.impact}\nOriginal fix suggestion: ${f.fix_suggestion}`,
    sourceOutputIds: item.agent_output_id ? [item.agent_output_id] : [],
    proposedBy: 'system-engineer',
  });

  await mutateReport({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    mutate: (r) => ({
      ...r,
      findings: (r.findings ?? []).map((x) =>
        x.id === params.findingId
          ? {
              ...x,
              status: 'ignored',
              action_taken: {
                kind: 'ignore',
                note: null,
                learning_id: learningId,
                taken_at: new Date().toISOString(),
              },
            }
          : x,
      ),
    }),
  });

  return { learningId };
}

// ============================================================================
// On-demand finding detail expansion
// ============================================================================

export async function expandFinding(params: {
  queueItemId: string;
  findingId: string;
}): Promise<string> {
  const item = await loadReportFromQueue(params.queueItemId);
  const f = item.full_output.findings?.find((x) => x.id === params.findingId);
  if (!f) throw new Error(`Finding ${params.findingId} not found`);
  const repo = getTrackedRepos().find((r) => r.shortId === f.repo_short_id);

  const fileContentBlocks: string[] = [];
  if (repo?.slug && isGithubConfigured() && f.file_refs.length > 0) {
    const { getFileContent } = await import('../system-engineer/github');
    for (const ref of f.file_refs.slice(0, 3)) {
      const path = ref.split(':')[0];
      const res = await getFileContent(repo.slug, path);
      if (res.ok) {
        fileContentBlocks.push(`### ${ref}\n\n\`\`\`\n${res.content.slice(0, 3000)}\n\`\`\``);
      }
    }
  }

  const system = loadSystemEngineerContextFiles();
  const user = `Expand on this finding with a deeper analysis. Stay concise.

# Finding
Repo: ${repo?.label ?? f.repo_short_id}
ID: ${f.id}
Severity: ${f.severity}
Category: ${f.category}
Title: ${f.title}
Impact: ${f.impact}
Fix suggestion: ${f.fix_suggestion}
Effort: ${f.effort}
File refs: ${f.file_refs.join(', ') || '(none)'}

${fileContentBlocks.length > 0 ? `# Relevant file content\n${fileContentBlocks.join('\n\n')}` : ''}

Produce ~10-30 lines of plain prose covering:
1. Why this matters (1-2 sentences)
2. Concrete reproduction or observation steps (if applicable)
3. Specific recommended fix with code pointers
4. Any edge cases or tradeoffs

Return as plain text, no JSON wrapper.`;

  const result = await think({
    systemPrompt: system,
    userPrompt: user,
    maxTokens: 2000,
  });

  const expansion = result.text.trim();

  // Log as child output so it's discoverable from the weekly report
  const childOutputId = await logOutput({
    agentId: 'system-engineer',
    venture: 'cross',
    outputType: 'finding_detail_expansion',
    draftContent: { finding_id: f.id, expansion },
    parentOutputId: item.agent_output_id ?? undefined,
    tags: ['finding_detail_expansion', f.id, f.severity, f.category],
  });
  void childOutputId;

  return expansion;
}

// Re-export for API routes
export { generateFindingId };
