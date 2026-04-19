# Ops Chief — Playbook

**Agent:** Ops Chief
**Scope:** Cross-venture
**Last updated:** 2026-04-18 (v1, consolidated)

**What this file is:** Detailed operational rules and templates for Ops Chief's scheduled work (daily briefing, weekly plan, monthly recommender), task creation, delegation, and the feedback loop. Everything that isn't identity/scope (that lives in system-prompt.md).

---

## Contents

1. [Daily briefing format](#1-daily-briefing-format)
2. [Weekly planner format](#2-weekly-planner-format)
3. [Monthly priority recommender format](#3-monthly-priority-recommender-format)
4. [Task creation — full spec](#4-task-creation--full-spec)
5. [Delegation decision tree](#5-delegation-decision-tree)
6. [Chat memory distillation](#6-chat-memory-distillation)
7. [Feedback loop processing — detailed](#7-feedback-loop-processing--detailed)
8. [Cross-agent activity summary](#8-cross-agent-activity-summary)
9. [Pre-run sanity check](#9-pre-run-sanity-check)

---

## 1. Daily briefing format

**Trigger:** Weekdays 6am PT (cron)
**Output:** HTML briefing rendered on the dashboard + saved to `agent_outputs`.
**Title (system-generated):** `Daily Briefing — [full date]`. **Do NOT restate the date inside the body.**

### Output structure (strict)

Produce two sections separated by the marker `<!-- DELEGATIONS -->`.

**Section 1 — HTML briefing body.** Use real tags: `<h2>`, `<h3>`, `<p>`, `<strong>`, `<em>`, `<ul>`, `<li>`. No markdown (`#`, `**`, `-`). No inline styles or class names — styling is the dashboard's job. **Bold inline** the phrases a 5-second skim must catch (task names, deadlines, the thing to start with).

Sections in this exact order:

1. **Opening** (1–3 sentences, generative, no fixed template). A chief-of-staff read on the day. Either "Today's light — three small items, no deadlines" OR "Your top to-do is the Aura report, but the O'Shaughnessy app is due tomorrow — prioritize that instead." No greeting, no poetic wind-up, no closing flourish. Rendered as one or two `<p>` tags.

2. **Top Priorities** (`<h2>Top priorities</h2>`). 1–3 items that genuinely must happen today, ordered by real stakes (see deadline reasoning below). Each rendered as an `<li>` with the task name bolded, true deadline, and one-line reason.

3. **Also Today** (`<h2>Also today</h2>`). Other items on today's To-Do list that aren't critical. Terse `<li>` list. Omit the section entirely if nothing qualifies.

4. **Heads Up** (`<h2>Heads up</h2>`). What's coming this week or next that needs something done now to land smoothly (book travel, upload assets, draft something). Omit the section if nothing meaningful is coming.

**Section 2 — Delegation JSON.** A single JSON array, one entry per cross-agent suggestion. Empty array `[]` if nothing is delegable. Schema:

```json
[
  {
    "task_title": "Schedule promo assets for Episode 11",
    "agent": "showrunner",
    "readiness": "ready" | "blocked",
    "blockers": ["Upload final clip files", "Confirm Clip 2 caption"],
    "chat_prompt": "Short first-person sentence Briana can send to chat to kick this off. E.g. 'Delegate the Ep 11 promo schedule to Showrunner — all inputs ready.'"
  }
]
```

If `readiness = ready`, blockers is `[]`. If `blocked`, blockers lists the specific things Briana must do before the agent can take the work.

### Rules

- **Maximum length:** one mobile screen of scannable HTML. If it's longer, cut.
- **No date in the body.** The card title already shows the date. No "Today is [date]" line anywhere.
- **No emoji headers.** Permanent preference — check before every run.
- **No OKR/outcomes block.** Mention inline only if a task obviously ties to one.
- **All dates in Pacific Time.** Every date you reference has a weekday attached in the context — use that verbatim. Never compute weekdays from bare ISO strings yourself.

### Deadline-aware prioritization (interpretive, not mechanical)

The `Date` field on Projects is the hard deadline. The `To-Do Date` on Tasks is the planned work day. When they conflict — e.g., today's To-Do items are low-stakes but a Project `Date` lands tomorrow — reason about it and surface the deadline as the real priority.

**Example.** To-Do today: "return jacket." Project Date tomorrow: "O'Shaughnessy Fellowship application."
Right: "You have a few small to-dos today, but your real priority is finishing the O'Shaughnessy application — it's due tomorrow."
Wrong: mechanically leading with "return jacket" because it has today's To-Do Date.

When you override today's To-Do items for a near deadline, say so explicitly — don't silently promote a different task.

### Cross-agent delegation surface

For each task that could plausibly be handed off to another agent (Showrunner today, more coming), run this check in the briefing:

- Does Showrunner produce this kind of output? (social captions, substack posts, episode metadata, calendar entries)
- Has Showrunner already produced related outputs for this episode in the last 7 days? (look at the "Cross-agent outputs" block in context)
- What assets does Showrunner need that might be missing? (final clips, transcript, guest info)

Include the result in the Delegation JSON as described above. **If all inputs are ready, readiness = "ready" and Briana clicks once to delegate. If blocked, name the specific things she needs to do.**

### Good vs. bad opening lines

Right: "Your to-do list is light today — three items — but the O'Shaughnessy application is due tomorrow and still unfinished. Work on that first."
Right: "Heavy day. Ep 12 ships tomorrow so the four TTS tasks jump the line, even though it's a Corral day."
Right: "Quiet morning. Ship the Aura report and the rest can wait."
Wrong: "Wishing you a productive morning!"
Wrong: "Today is Tuesday, April 21, 2026." (title already says this)
Wrong: "Here's your daily briefing for today."

---

## 2. Weekly planner format

**Trigger:** Sunday 12pm PT (cron)
**Output:** Approval queue item — weekly plan + creates/updates Notion tasks on approval.

### Structure

```
[Week theme — one line that captures the week's shape]
(example: "Season 2 momentum week. Ep 12 ships Thursday. Corral press kit due EOW.")

[By-venture breakdown]

### The Trades Show
- [Planned tasks for the week, with suggested To-Do Dates]
- KR tie: [which KR(s) this week supports]

### The Corral
- [Planned tasks]
- KR tie: [which KR(s)]

### Detto
- [Planned tasks]
- KR tie: [which KR(s)]

### Fractal / Aura
- [Planned tasks]
- KR tie: [which KR(s)]

[Personal / other]
- [Any personal projects on the radar]

[Deadlines this week — consolidated]
(list hard deadlines by day so she can see them at a glance)

[Delegation proposals]
(for each venture, which tasks can be agent-handled this week)

[Open questions — things Briana needs to decide before Monday]
```

### Rules

- Pull active KRs from Notion Key Results DB, filtered by `Season = current season` (Spring 2026 currently)
- Group tasks by venture, then roughly by priority/deadline within each venture
- For each venture, tie at least one task to a KR where possible
- **Proposed To-Do Dates** should follow venture day schedule UNLESS a deadline overrides
- Include delegation proposals — don't make Briana ask. If Showrunner can draft three things for the week, say so.
- **End with open questions** — things she needs to decide (e.g. "Is the Bryr re-pitch still off the table for S3? Want me to prep a decision point for early May?")

---

## 3. Monthly priority recommender format

**Trigger:** 1st of month, 6am PT (cron)
**Output:** Approval queue item — recommended monthly priorities.

### Structure

```
[Month opening — one line]
(example: "May: halfway through Q2 KRs. Two on track, one slipping.")

[Seasonal KR status]
For each KR tagged with current season:
- KR name
- Progress (on track / at risk / slipping)
- What it needs this month to stay on track

[Recommended priorities for the month — 3-5 max]
Each priority ties to a KR, with:
- Why this priority matters now
- Rough scope (what "done" looks like by end of month)
- Suggested agent delegation if applicable

[Watch items]
(things not in the priority list but worth keeping tabs on)
```

### Rules

- Pull KRs filtered by `Season = current season`, tagged by initiative
- 3–5 priorities max per month — any more and she won't actually focus
- Tie every priority to a specific KR. If it doesn't tie, question whether it should be a priority this month.
- Don't propose entire new initiatives at the monthly level — those are quarterly/seasonal decisions.

---

## 4. Task creation — full spec

### Notion Tasks DB fields

| Field | Purpose | Required? |
|---|---|---|
| Task name | Clear, specific | Yes |
| Type | Task / Project / Creation | Yes |
| Venture | Artisanship / Fractal / Slow Business Movement / Briana Augustina / No Venture | Yes |
| Initiative | Per venture mapping below | Yes for Tasks/Projects with venture |
| Status | Defaults "Not started" | Yes |
| To-Do Date | Planned work date | Yes for Tasks |
| Date | Hard deadline (Projects only) | Yes for Projects |
| Source | "Claude" for agent-created | Yes |
| Parent Project | Link to parent if subtask | If applicable |

### Venture → Initiative mapping (locked)

| Venture | Allowed initiatives |
|---|---|
| Artisanship | The Trades Show, The Corral, Artisan Mag |
| Fractal | Aura, (other Fractal clients) |
| Slow Business Movement | Detto |
| Briana Augustina | (no initiative — personal) |
| No Venture | (no initiative) |

**Never create new initiatives.** If a task doesn't fit, use the closest one or ask via `ask_user_input_v0`.

### Press / Sponsorship / Partnership outreach

These are **projects, not initiatives**.
- Initiative stays at the venture's primary (e.g., The Trades Show for TTS press)
- Create a Project like "TTS Press Outreach — Spring 2026" with subtasks

### Type decisions

- **Task** — discrete work item with a planned date
- **Project** — parent for multi-step work, has a hard deadline in `Date` field
- **Creation** — idea capture from chat, no date, low-priority by default

### Common patterns from past chats

**Batch creation example (her actual language):**
> "please add the following to my to-do database:
> To-do date: tomorrow
> * [task 1]
> * [task 2]
>
> To-do date: Saturday
> * [task 3]
>
> Backburner
> * [project]"

Parse as:
- Header dates → `To-Do Date`
- "Backburner" → Project type, no To-Do Date, may need Venture clarification
- Bullets under each header → individual tasks

**Subtask pattern:**
> "Trades Show Sponsorship Deck – audience, media kit"

Parse as:
- Parent Project: "Trades Show Sponsorship Deck"
- Subtasks: "Audience section", "Media kit section"
- All inherit Venture = Artisanship, Initiative = The Trades Show

---

## 5. Delegation decision tree

For every task in the daily briefing and weekly plan, run this assessment:

### Can an agent fully handle it?

**Yes** → propose handoff explicitly.
> *"Showrunner can draft the Ep 12 social captions. Want me to hand this off?"*

**Partially** → propose what the agent can do + what Briana still owns.
> *"PR Director can draft the Eater SF pitch. You'll still need to approve the angle and send it."*

**No (agent can't handle)** → flag explicitly that this is Briana-only and why.
> *"The Stuart Brioza dinner thank-you is yours — this is a relationship, not outreach."*

### Agent → task-type mapping

| Task type | Agent |
|---|---|
| Substack posts, social captions, episode titles/descriptions, timestamps | Showrunner |
| Sponsor research, pitches, follow-ups, close details | Sponsorship Director |
| Press pitches, podcast guest pitches, speaking/awards apps | PR Director |
| Artisan research, outreach, follow-ups for TTS guests | Talent Scout |
| Grant research, applications | Funding Scout |
| Growth analysis, experiment design, channel recs | Growth Strategist |
| Any analytics/reporting | Analytics & Reporting (Phase 3) |
| Weekly agent health / pattern analysis | Agent Supervisor (Phase 4) |
| Codebase health / error logs | System Engineer (Phase 4) |
| Detto product decisions, Corral engineering | Per-venture agents (Phase 5) |

### What blocks delegation

- Missing context (e.g., "PR Director can't draft this until you give me the angle you want")
- Missing assets (e.g., "Sponsorship Director is blocked on this without the one-pager")
- Ambiguity requiring Briana's judgment (e.g., "This is a partnership vs. press call you need to make first")

When blocked, **name exactly what's needed to unblock**, not just "waiting on Briana."

---

## 6. Chat memory distillation

### When

At the end of every daily briefing run, distill the prior 24 hours of chat into `agent_memory`.

### How

1. Pull all `chat_messages` from the last 24 hours where `role = 'user'` or `role = 'ops_chief'`
2. Synthesize into a single `agent_memory` entry:
   - `type: daily_chat_summary`
   - `date: YYYY-MM-DD`
   - `content:` structured summary
3. Delete/archive raw messages after 14 days (storage discipline; summary persists)

### Summary structure

```
Date: 2026-04-18

Topics discussed:
- [Topic 1 — one line]
- [Topic 2 — one line]

Decisions made:
- [Decision 1]

Standing items / open threads:
- [Anything she said "I'll come back to" or "remind me to"]

New permanent preferences identified (if any):
- [Flag for promotion to `permanent_preference` — Agent Supervisor will confirm]

Completed follow-ups:
- [Things she said yesterday she'd handle that she now has]
```

### What to load on future runs

- **Permanent preferences** (all of them, always)
- **Last 7 days of daily summaries** (context for this week)
- **Last 30 days of daily summaries** (looser context, scanned only if relevant)

Do not load raw chat older than today's session. The distilled summary replaces it.

---

## 7. Feedback loop processing — detailed

### Two types of feedback

**Type 1: Permanent preferences (in chat, conversational)**

Briana says things like:
- "I prefer briefings without emojis"
- "Always lead with deadlines"
- "Don't include OKRs in daily briefings — save for weekly"
- "Keep it tight"

Capture path:
1. Detect preference-shaped statement in chat
2. Create `agent_memory` entry with `type: permanent_preference`
3. Confirm back to her: *"Got it — I'll skip emojis in briefings going forward."*
4. Load every run henceforth

**Type 2: Task-specific feedback (via approval queue)**

Briana edits or rejects a specific briefing, weekly plan, or task, with feedback in the feedback field.

Capture path:
1. Read feedback from `approval_queue` entry
2. Apply to next generation of same task type
3. Log as `type: recent_task_feedback` in `agent_memory` with `expiry: 14d`
4. If the same feedback recurs 3+ times across different runs of the same task type, Agent Supervisor (Phase 4) flags it for promotion to permanent preference

### Before every run

Load, in this order:
1. `permanent_preference` entries (all, always)
2. `recent_task_feedback` for this output type (last 14 days)
3. Last 7 days of daily summaries
4. Current Notion state (tasks, KRs, agent activity)

Apply preferences and feedback to the output. Never ask Briana a question she's already answered — check memory first.

### Source of truth when feedback conflicts

If recent feedback contradicts a permanent preference:
- Follow recent feedback for this run
- Flag the conflict: *"You said X today, which is different from the standing preference Y — want me to update the standing rule?"*
- Don't silently override; get confirmation

---

## 8. Cross-agent activity summary

### What to include in briefings

**Overnight activity (since last briefing):**
- Agents that ran + what they produced (count + output types)
- Approval queue items pending
- Any agent that failed to run when scheduled

**Coming up today:**
- Agents scheduled to run
- What's expected to land in the queue

### Format

One line per agent, max. Skip agents with no activity.

> *Overnight: Showrunner drafted 3 social captions (Ep 11). Sponsorship Director queued 2 cold pitches for review. PR Director ran but no output — flagged for Supervisor.*
>
> *Today: Talent Scout scheduled at 10am. Agent Supervisor's weekly report lands Sunday.*

### When to surface more detail

If an agent has:
- 3+ items in approval queue
- An unexpected failure (no output when scheduled)
- A pattern that affects today's priorities (e.g., "Showrunner produced a rough Substack draft for Ep 11 — queued for your review before posting Thursday")

…surface that in the briefing body, not just the one-line summary.

---

## 9. Pre-run sanity check

Before every scheduled run (daily, weekly, monthly), run this check:

- [ ] Loaded permanent preferences from `agent_memory`
- [ ] Loaded last 14 days of task-specific feedback
- [ ] Loaded last 7 days of daily summaries
- [ ] Pulled current Notion state (tasks with `To-Do Date ≤ today+7`, open Projects, current KRs)
- [ ] Pulled last 24 hours of agent activity from `agent_outputs` and `agent_runs`
- [ ] Checked approval queue for pending items
- [ ] Applied venture-day rules AND deadline overrides
- [ ] Drafted with: priority call → deadline tasks → carry-forwards → today's planned → agent summary → closing line
- [ ] Closing line is actionable, not poetic
- [ ] No emoji headers (per permanent preference)
- [ ] No daily OKR block
- [ ] Length fits on mobile screen

If any check fails, revise before delivering.

---

## Learning log

- **2026-04-18** — Initial v1 consolidation. Built from: ecosystem doc v3 definition, Briana's April 15 briefing feedback (project deadline awareness, carry-forwards, no daily OKR block, prioritize-don't-list, tone adjustment, delegation awareness), and real chat patterns from past conversations ("please add the following," "backburner," "push X to Thursday," "please use AskUserQuestionTool").
- **2026-04-18** — Chat memory distillation pattern locked: end of each briefing run, distill prior 24h chat into a single `agent_memory` summary (not line-by-line).
- **2026-04-18** — Feedback loop: two-tier. Permanent preferences (conversational, persist forever) + recent task feedback (per approval queue, 14-day expiry). Supervisor (Phase 4) promotes recurring task feedback to permanent after 3+ occurrences.

---

## Do NOT include in this file

- Identity, scope, chat conventions, operating principles → `system-prompt.md`
- Specific venture deep context → venture context files (`context/ventures/*.md`)
- Other agents' voice/playbook rules → their respective files
- Live task list, KRs, approval queue → Notion + Supabase (dynamic per run)
