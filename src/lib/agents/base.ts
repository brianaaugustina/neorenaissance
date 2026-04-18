import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env';
import {
  logOutput,
  setApprovalQueueId,
  type AgentId,
  type Venture,
} from '../agent-outputs';
import {
  depositToQueue,
  logRunComplete,
  logRunStart,
  type DepositParams,
} from '../supabase/client';

// ---------------------------------------------------------------------------
// Claude client — Sonnet 4.6 per roadmap. Swap via CLAUDE_MODEL env if needed.
// ---------------------------------------------------------------------------
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';
const anthropic = new Anthropic({ apiKey: env.anthropic.apiKey });

// Rough Sonnet pricing in USD per 1M tokens. For cost_estimate only.
const PRICE_IN_PER_MTOK = 3;
const PRICE_OUT_PER_MTOK = 15;

// ---------------------------------------------------------------------------
// Context file loader
// ---------------------------------------------------------------------------
// Context markdown lives at the repo root so it's easy to edit.
const CONTEXT_ROOT = path.resolve(process.cwd(), 'context');

export function loadContextFile(relPath: string): string {
  const p = path.join(CONTEXT_ROOT, relPath);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// Base agent
// ---------------------------------------------------------------------------
export interface ThinkParams {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface ThinkResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
}

export async function think(p: ThinkParams): Promise<ThinkResult> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: p.maxTokens ?? 2000,
    system: p.systemPrompt,
    messages: [{ role: 'user', content: p.userPrompt }],
  });
  const text = res.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
  const inputTokens = res.usage.input_tokens;
  const outputTokens = res.usage.output_tokens;
  const costEstimate =
    (inputTokens / 1_000_000) * PRICE_IN_PER_MTOK +
    (outputTokens / 1_000_000) * PRICE_OUT_PER_MTOK;
  return { text, inputTokens, outputTokens, costEstimate };
}

// ---------------------------------------------------------------------------
// Run lifecycle helper — wraps gather → think → deposit → log.
// ---------------------------------------------------------------------------
// Optional agent_outputs config. When present, runAgent logs a parent
// agent_outputs row for the run (with draft_content = full_output), links it
// to the approval_queue item, and calls `children` so the agent can log
// per-sub-output rows (e.g. one row per Showrunner caption).
export interface RunAgentOutputConfig<C> {
  venture: Venture;
  outputType: string;
  tags?: (ctx: C, result: ThinkResult) => string[];
  children?: (args: {
    ctx: C;
    result: ThinkResult;
    runId: string;
    parentOutputId: string;
  }) => Promise<void>;
}

export interface RunAgentParams<C> {
  agentName: string;
  trigger: 'cron' | 'manual' | 'chat';
  gatherContext: () => Promise<C>;
  summarizeContext: (ctx: C) => string;
  buildPrompt: (ctx: C) => { system: string; user: string } | Promise<{ system: string; user: string }>;
  buildDeposit: (ctx: C, result: ThinkResult) => Omit<DepositParams, 'agent_name' | 'run_id' | 'agent_output_id'>;
  onSuccess?: (ctx: C, result: ThinkResult, queueId: string) => Promise<void> | void;
  output?: RunAgentOutputConfig<C>;
  maxTokens?: number;
}

export interface RunAgentResult<C> {
  runId: string;
  queueId: string;
  outputId: string | null;
  result: ThinkResult;
  context: C;
}

export async function runAgent<C>(p: RunAgentParams<C>): Promise<RunAgentResult<C>> {
  const run = await logRunStart(p.agentName, p.trigger);
  try {
    const ctx = await p.gatherContext();
    const prompts = await p.buildPrompt(ctx);
    const result = await think({
      systemPrompt: prompts.system,
      userPrompt: prompts.user,
      maxTokens: p.maxTokens ?? 3000,
    });
    const depositFields = p.buildDeposit(ctx, result);

    // Log the parent agent_outputs row before the queue insert so we can
    // thread the id into the queue row. approval_queue_id is filled after
    // the queue insert completes.
    let outputId: string | null = null;
    if (p.output) {
      outputId = await logOutput({
        agentId: p.agentName as AgentId,
        venture: p.output.venture,
        outputType: p.output.outputType,
        draftContent: (depositFields.full_output ?? {}) as Record<string, unknown>,
        runId: run.id,
        tags: p.output.tags?.(ctx, result),
      });
    }

    const queueId = await depositToQueue({
      ...depositFields,
      agent_name: p.agentName,
      run_id: run.id,
      agent_output_id: outputId ?? undefined,
    });

    if (outputId) {
      await setApprovalQueueId(outputId, queueId);
    }

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed: result.inputTokens + result.outputTokens,
      model: MODEL,
      contextSummary: p.summarizeContext(ctx),
      outputSummary: depositFields.title,
      approvalQueueId: queueId,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    // Children log after run completion — they're auxiliary rows and don't
    // gate the success signal to Briana.
    if (p.output?.children && outputId) {
      try {
        await p.output.children({
          ctx,
          result,
          runId: run.id,
          parentOutputId: outputId,
        });
      } catch (childErr) {
        console.error('[runAgent] children logging failed (non-fatal):', childErr);
      }
    }

    if (p.onSuccess) await p.onSuccess(ctx, result, queueId);
    return { runId: run.id, queueId, outputId, result, context: ctx };
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
