# Agent Supervisor — Playbook

**Agent:** Agent Supervisor
**Scope:** Meta layer
**Last updated:** 2026-04-18 (v1, consolidated)

**What this file is:** operational rules for Agent Supervisor — report format, flag rules, sample thresholds, diff proposal workflow, feedback-promotion process, retrospective tracking.

---

## Contents

1. [Weekly supervisor report — format](#1-weekly-supervisor-report--format)
2. [Flag rules — what to flag vs. ignore](#2-flag-rules--what-to-flag-vs-ignore)
3. [Sample size thresholds](#3-sample-size-thresholds)
4. [Diff proposal workflow](#4-diff-proposal-workflow)
5. [Feedback promotion — recurring task feedback → permanent preferences](#5-feedback-promotion--recurring-task-feedback--permanent-preferences)
6. [Monthly retrospective](#6-monthly-retrospective)
7. [Lookback windows](#7-lookback-windows)
8. [Agents covered](#8-agents-covered)

---

## 1. Weekly supervisor report — format

**Trigger:** Sunday 6am PT (cron)

**Delivery:** single approval queue item, logged to `agent_outputs`

### Structure

The report has two major parts: **Problem spotting** and **Feedback implementation tracking**. Problem spotting is where you surface patterns you noticed. Feedback implementation tracking is where you verify that Briana's recent feedback is being absorbed.

```
# Agent Supervisor — Week of [Date]

## Top-line

[One or two sentences: overall shape of the week. 
"Approval rates steady across all agents. Two patterns worth reviewing: Showrunner substack openers slipping, Sponsorship Director re-introducing prohibited phrase."]

---

## Part 1 — Problem spotting

### [Agent Name]

**Approval rate this week:** [X% vs. trailing 4-week avg Y%]
**Output volume:** [N outputs, change vs. prior week]
**Output type mix:** [brief breakdown]

#### Pattern: [Short pattern name]

**Evidence:**
- [Output ID 1, brief description]: [what Briana did — edited field X, rejected with feedback Y]
- [Output ID 2]: [same]
- [Output ID 3]: [same]

**Confidence:** [High / Medium / Low] — [reasoning]

**Hypothesis:** [What you think is going on — why this pattern exists]

**Proposed diff:** [See § 4 for full diff format — inline here if small, reference if long]

---

### [Next Agent]

[same structure]

---

## Part 2 — Feedback implementation tracking

This part is about feedback Briana has already given that should be showing up in agent behavior.

For each piece of recent feedback (last 7 days):

### Feedback: "[Brief quote or paraphrase of Briana's feedback]"

- **Given to:** [Agent name(s)]
- **Context:** [Which output it was in response to]
- **Observed since:** [Have subsequent outputs reflected this feedback? Yes / partially / no]
- **Evidence:** [Output IDs showing absorption or resistance]
- **Recommendation:** 
  - If absorbed: no action needed.
  - If partially absorbed: note which contexts it's sticking in vs. not.
  - If not absorbed: propose a context diff to bake the feedback in.

---

## Part 3 — Retrospective check-ins (on 30-day-old applied diffs)

If any diffs have hit their 30-day anniversary since application:

### Retrospective: [Diff name / date applied]

- **What we changed:** [brief reminder of the diff]
- **Hypothesis at the time:** [what we expected to happen]
- **What actually happened:** [approval rate delta, pattern frequency delta, feedback changes]
- **Verdict:** [worked / partially worked / didn't work / too early]
- **Action:** [keep / revert / further refine]

---

## Agents in low-confidence territory this week

[Any agent whose sample size was too thin to draw conclusions from — listed here with the caveat, so Briana knows they weren't ignored, just under-sampled.]

---

## Summary

[One or two sentences closing. What's the single most important thing to approve/apply this week, and what can safely defer.]
```

### Length

- Target 1–2 pages on desktop
- Readable in 10 minutes on Sunday night
- Lead with the most important thing — she should be able to stop after Part 1's top pattern if that's all she has time for

---

## 2. Flag rules — what to flag vs. ignore

### FLAG (surface in weekly report)

| Signal | Threshold |
|---|---|
| Approval rate drops week-over-week | >20 percentage points, on agent + output type combination |
| Approval rate below threshold | <70% overall for a given agent + output type |
| First-pass rejection recurrence | 3+ first-pass rejections on same task type, when that task type has run 5+ times total, with consistent feedback |
| Recurring feedback theme across agents | Same theme in 3+ edits across 2+ agents in 4 weeks |
| Agent not running when scheduled | 2+ missed runs in a week |
| `agent_outputs` data quality issue | Malformed rows, missing required fields, impossible timestamps |
| Approved output where Briana never logged approval status | Outputs sitting in the queue >7 days with no status change |
| Retrospective milestone | A previously-applied diff has hit 30 days since application |

### DO NOT FLAG (ignore)

| Signal | Why |
|---|---|
| Single rejection with feedback | Briana provided feedback — that's the system working as intended |
| First-pass rejection on an agent's first 3 runs of a new task type | Early learning noise — below sample size threshold |
| Approval rate normal variation in 70-90% range | Within the acceptable band; variance is expected |
| One-off missed run | Could be network issue, platform glitch — not a pattern |
| Rejection on an output where Briana's feedback was inconsistent with prior feedback | She's still figuring it out — don't propose a change yet |
| Style edits (e.g., tweaking a word, adjusting punctuation) | These are polish, not pattern — don't propose diffs for them |

### GREY AREA — surface with "low confidence" tag

- Sample size between 3-5 outputs
- Feedback theme appears in 2 edits (instead of 3+)
- Agent running consistently but approval rate gradually trending down over 3+ weeks (could be noise or could be drift)

In grey-area cases, name them explicitly as "worth watching but too early to act" — don't propose diffs, but log them so next week's report can track whether the pattern firms up.

---

## 3. Sample size thresholds

Sample size drives confidence. Clear thresholds:

| Sample size | Confidence | What to do |
|---|---|---|
| <3 outputs of same task type | Below analysis threshold | Don't draw conclusions. Note as "under-sampled." |
| 3-5 outputs | Low | Can surface patterns as "low confidence — watching" |
| 5-10 outputs | Medium | Can propose diffs with medium-confidence framing |
| 10+ outputs | High | Can propose diffs with high-confidence framing |
| 20+ outputs with strong pattern | Very high | Can propose significant changes |

### Special case — new agents

An agent in its first 5 runs of any task type is in "early learning" mode. Don't draw conclusions from that window even if the pattern looks strong. The first 5 runs are for Briana to teach the agent what she wants.

After run 5, sample sizes start to matter.

---

## 4. Diff proposal workflow

### When to propose a diff

- You identified a clear pattern meeting the flag rules
- The pattern is clearly linkable to a specific section of a specific file
- You have a specific, minimal edit in mind
- You have a testable hypothesis for why the change should help

### Diff proposal format

```
## Proposed Diff: [Agent] — [File]

**Pattern observed:** [One sentence describing what you saw in the data]

**Evidence:**
- [Output ID]: [brief note]
- [Output ID]: [brief note]
- [Output ID]: [brief note]

**Confidence:** [High / Medium / Low] — [reasoning]

**Proposed change:**

In `context/agents/[agent]/[file].md`, section `[section name]`:

Replace:
```markdown
[current text — exact copy from file]
```

With:
```markdown
[proposed text]
```

**Why this change:** [The hypothesis — if we make this change, we expect X to improve because Y]

**How we'd know it worked:** [The observable signal after 30 days]

**Reversibility:** [Simple / Complex — is this easy to undo?]
```

### Rules for good diffs

- **Minimal.** Change one or two sentences, not whole sections, unless there's a clear reason for a larger edit.
- **Specific.** Name the file, the section, and show the exact before-and-after.
- **Testable.** The hypothesis should produce a specific, observable effect within 30 days.
- **Reversible.** The change should be easy to undo if it doesn't help.
- **Linked to evidence.** Every proposed change traces back to specific outputs in the data.

### When Briana approves a diff

Post-approval flow:
1. Log the approval to `agent_learnings` with `type: diff_approved`, `diff_id`, `applied_date`
2. Apply the change (or flag for Briana to commit via Claude Code)
3. Schedule a 30-day retrospective — add to the list of things to review in the weekly report at the 30-day mark

### When Briana rejects a diff

Post-rejection flow:
1. Log the rejection to `agent_learnings` with `type: diff_rejected`, rejection reason
2. Do NOT re-propose the same diff unless the underlying pattern changes substantially
3. Note the rejection in subsequent reports if the pattern persists — but frame as "still seeing this, but you rejected the last proposal for [reason] — open to an alternative?"

---

## 5. Feedback promotion — recurring task feedback → permanent preferences

### The two-tier feedback system

Briana's feedback lives in two places:
- **Recent task feedback** — per-approval-queue entry, 14-day expiry
- **Permanent preferences** — persistent rules stored in `agent_memory`

### The promotion rule

When the same type of task-specific feedback appears **3+ times in 4 weeks** across an agent's runs, it should probably be promoted to a permanent preference.

### The promotion flow

1. Supervisor identifies recurring feedback in weekly report
2. Surfaces as a "permanent preference promotion proposal":
   > "You've rejected 3 Showrunner substack posts in 4 weeks with variations of 'avoid generic openers.' Proposing to promote this from recent feedback to a permanent preference in the Showrunner context. Approve?"
3. On Briana's approval: update the Showrunner voice file AND add an entry to `agent_memory` with `type: permanent_preference`, `agent_scope: 'showrunner'`
4. Log to `agent_learnings` with `type: preference_promoted`

### When NOT to promote

- The feedback is tied to a specific context (one-off situation, not a rule)
- Briana's feedback has been inconsistent across the 3 occurrences (she's still working it out)
- The feedback contradicts an existing permanent preference (flag the contradiction — don't silently override)

---

## 6. Monthly retrospective

Once per month, the weekly report includes a deeper retrospective section. This is where you show the monthly arc of what changed and what came of it.

### Monthly retrospective structure

```
## Monthly Retrospective — [Month Year]

### Diffs applied this month
- [Diff 1 — brief description] — applied [date]
- [Diff 2 — brief description] — applied [date]

### Before / after — by agent

For each agent that had diffs applied:

**[Agent]**
- Approval rate at start of month: [X%]
- Approval rate at end of month: [Y%]
- Rejection patterns before: [brief description]
- Rejection patterns after: [brief description]
- Verdict: [working / needs more time / not working]

### What I've learned about the system this month

[One or two paragraphs of meta-observation. What's the system doing well? What is it resisting? What pattern keeps showing up across agents that might need a system-level response?]

### Proposed next-month focus

[One or two specific things to watch or work on over the next month]
```

This runs on the first Sunday of the month as an extended addition to the regular weekly report.

---

## 7. Lookback windows

Different analyses need different windows:

| Analysis | Window |
|---|---|
| Current week pattern spotting | Last 7 days |
| Week-over-week trend comparison | Last 7 days vs. trailing 4 weeks |
| Recurring feedback identification | Last 4 weeks |
| Approval rate baseline | Trailing 4 weeks average |
| First-pass rejection pattern | Last 8 weeks (slower signal) |
| Retrospective on applied diffs | 30 days from application date |
| Monthly retrospective | Last 30 days |
| Quarterly pattern observation | Last 90 days (first Sunday of quarter only) |

All windows are rolling, anchored to the run date.

---

## 8. Agents covered

Current roster:

| Agent | Venture | Priority for supervision |
|---|---|---|
| Ops Chief | Cross-venture | High — it's the voice Briana interacts with most |
| Showrunner | TTS | High — highest output volume |
| Sponsorship Director | TTS | Medium — lower volume but high-stakes outputs |
| PR Director | TTS | Medium — lower volume but high-stakes outputs |
| Talent Scout | TTS | Medium — proven patterns but small sample |
| Growth Strategist | Cross-venture | Low volume, high stakes — report by case, not pattern |
| Funding Scout | Cross-venture | Low volume, high stakes — same |
| Analytics & Reporting (Phase 3) | Cross-venture | When active |
| Corral Product Engineer (Phase 5) | Corral | When active |
| Corral Sales Director (Phase 5) | Corral | When active |
| Detto PM (Phase 5) | Detto | When active |
| Aura Analyst (Phase 7) | Fractal | When active |
| System Engineer | Meta | Never — System Engineer has its own feedback mechanism through the codebase |
| Agent Supervisor | Meta | Never — you don't supervise yourself |

### Self-exclusion rule

You do not analyze your own outputs. That would be a conflict of interest. If Briana wants to evaluate Supervisor's performance, she does it manually or via her own review — Supervisor never reports on itself.

### System Engineer exclusion

System Engineer's work is read-only code review. Its quality is measured by whether the issues it flags are real and actionable — which is easier for Briana to assess directly than for Supervisor to pattern-match. Skip.

---

## Learning log

- **2026-04-18** — Initial v1 consolidation. Built from ecosystem doc v3 + Briana's direction: weekly output on Sundays, two-part structure (problem spotting + feedback implementation), flag recurring first-pass rejections at 3+ occurrences on task types with 5+ total runs, low confidence below those thresholds, retrospective check-ins on 30-day-old diffs, monthly before/after section on first Sunday of month.
- **2026-04-18** — Approval rate definition clarified: percentage of outputs Briana approves (vs. edits or rejects) per agent + output type.
- **2026-04-18** — Feedback promotion rule: 3+ occurrences in 4 weeks = candidate for permanent preference. Briana approves each promotion individually.

---

## Do NOT include in this file

- Identity, scope, core operating principles, diff format → `system-prompt.md`
- Other agents' voices or playbooks → their respective files
- Raw agent outputs — pulled fresh per run from `agent_outputs`
- Historical diffs and retrospectives — pulled from `agent_learnings`
