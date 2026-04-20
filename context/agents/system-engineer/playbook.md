# System Engineer — Playbook

**Agent:** System Engineer
**Scope:** Meta layer (read-only code review)
**Last updated:** 2026-04-18 (v1, consolidated)

**What this file is:** Operational rules for System Engineer — weekly report format, what to scan for vs. skip, severity criteria per finding category, delegation routing, focused-scan workflows.

---

## Contents

1. [Weekly codebase health report — format](#1-weekly-codebase-health-report--format)
2. [What to scan for — by category](#2-what-to-scan-for--by-category)
3. [Severity rubric per category](#3-severity-rubric-per-category)
4. [Repo-specific priorities](#4-repo-specific-priorities)
5. [Delegation routing](#5-delegation-routing)
6. [Focused scan workflows](#6-focused-scan-workflows)
7. [Finding lifecycle — surfacing, deferring, closing](#7-finding-lifecycle--surfacing-deferring-closing)
8. [Integration with Ops Chief](#8-integration-with-ops-chief)

---

## 1. Weekly codebase health report — format

**Trigger:** Saturday 8pm PT (cron)
**Delivery:** single approval queue item, logged to `agent_outputs`
**Goal:** Briana can triage in 5 minutes on Sunday

### Structure

```
# System Engineer — Week of [Date]

## Top-line
[1-2 sentences. "2 Critical, 5 Medium, 8 Low across 2 active repos. Detto has a Critical: exposed API key in commit abc123. Everything else is triage-at-leisure."]

---

## Detto (trydetto.com)

### Critical

- [ ] [C-D01] **[One-line description of finding]** — [Action: Fix / Delegate / Defer]
  - *Impact:* [one short clause]
  - *Fix:* [one short clause]
  - *Effort:* [S/M/L]
  - [Expand ↓]

### Medium

- [ ] [M-D01] **[One-line description]** — [Action]
  - *Impact:* [short]
  - *Fix:* [short]
  - *Effort:* [S/M/L]

### Low

- [ ] [L-D01] **[One-line description]** — [Action]
  - (Low findings get one line only in default view; expand for detail)

---

## Agent System / Dashboard

### Critical
[Same structure]

### Medium
[Same structure]

### Low
[Same structure]

---

## The Trades Show site — light monitoring

[Only surface if something notable changed. Normally: "No changes. Stable."]

---

## Briana Augustina personal site — light monitoring

[Same — typically "Stable."]

---

## Error log highlights
[If anything new or spiking from Vercel / Supabase this week]

## Summary
[1-2 sentences closing. What's most important to address this week.]
```

### Finding ID format

Each finding gets a stable ID for tracking across weeks:

- **Severity prefix:** C (Critical), M (Medium), L (Low)
- **Repo letter:** D (Detto), A (Agent system), T (TTS site), B (Briana personal site), CO (Corral, future)
- **Sequence number:** per repo per severity

Example: `C-D01` = first-ever Critical finding in Detto repo.

IDs are stable — if a finding persists from week to week, it keeps the same ID. If it's fixed and a new one surfaces later, that's a new ID.

### Default view vs. expanded view

**Default view (one line per finding):**
- Finding ID + title + action buttons

**Expanded view (when Briana taps):**
- Full description
- Code references (file + line numbers when applicable)
- Why it matters (the impact paragraph)
- Recommended fix (specific steps)
- Effort estimate (S/M/L + rough hours)
- Any links to commits, PRs, error log entries

### Action buttons per finding

Each finding surfaces with action buttons:
- **Fix** (Briana will handle)
- **Delegate to [agent]** (routes to appropriate engineer agent — see § 5)
- **Defer** (log as deferred, stop re-surfacing unless severity changes)
- **Ignore** (close; don't surface again)

---

## 2. What to scan for — by category

### Security
- Exposed secrets in commits (API keys, tokens, passwords)
- Unauthenticated endpoints that should be authenticated
- Missing CSRF protection on state-changing endpoints
- SQL injection risk (raw queries in user-facing code)
- Known CVEs in dependencies (via `npm audit`, `pip check`, etc.)
- Improper CORS configuration
- Missing input validation on user-facing endpoints

### Dependencies
- Outdated packages with available patch versions
- Outdated packages with security advisories
- Pending breaking changes (major version bumps available)
- Unused dependencies (declared but not imported)
- Duplicate dependencies across monorepo packages

### Tests
- Drops in coverage (overall or per-file)
- Critical paths without test coverage
- Disabled / skipped tests that haven't been re-enabled
- Flaky tests (if test logs are accessible)

### Performance
- Build time regressions
- Bundle size increases
- Lighthouse score drops (if measured)
- Database query patterns that look expensive (N+1 patterns, missing indexes suggested by query plans)

### Code quality
- Duplicated logic across files (3+ instances of same function)
- Dead code (unreachable branches, unused exports)
- TODO / FIXME comments older than 90 days
- Overly long files (>500 lines, suggest split)
- Functions >100 lines (suggest decomposition)

### Git hygiene
- Commits without tests (for repos with test infrastructure)
- Large unreviewed changes (>500 line commits)
- Stale branches (no activity >30 days)
- Merge commits on main when rebase is the convention

### Error logs (from Vercel / Supabase)
- New error types not previously seen
- Error rate spikes (10+ of same error in 24h)
- Correlation between recent commits and error rate changes

### What to SKIP

- **Purely stylistic preferences** (double vs. single quotes, spacing) unless there's a linter config being violated
- **Personal-taste architecture opinions** ("I'd use a different pattern here") — only flag architecture issues when they're clearly problems, not preferences
- **Refactoring suggestions that would take more effort than the value they'd return**
- **Changes in stable repos** (TTS site, personal site) unless something actively broke
- **Any commentary on design decisions Briana clearly made deliberately** — she's the architect; your job is to catch bugs, not redesign her system

---

## 3. Severity rubric per category

### Critical threshold (surface prominently, escalate if found mid-week)

- **Security:** any exposed secret in a public repo or in commit history; any unauthenticated admin endpoint; any CVE rated High or Critical in a production dependency
- **Data loss:** any change touching migrations that could delete or corrupt data without rollback; any code path that could cause data loss under normal use; missing backups on critical tables
- **Production outage risk:** any change that could crash prod; any missing error handling on a critical user path; any upstream dependency without fallback on a critical path
- **PII / reputation:** any sensitive data (PII, payment info, auth tokens) being logged, sent to third parties without consent, or stored unencrypted

### Medium threshold (surface normally, in weekly report)

- **Bugs:** functional bugs that don't break prod but degrade UX
- **Tech debt:** patterns that will cost >2 hours to fix later if left unaddressed
- **Dependencies:** outdated packages without security patches; packages with available major version bumps that should eventually happen
- **Tests:** coverage drops >10%; critical paths without tests
- **Performance:** regressions that noticeably affect users but aren't breaking
- **Code quality:** 3+ instances of duplicated logic; functions that have grown beyond reasonable size

### Low threshold (surface briefly, for triage at leisure)

- **Style:** linter violations that aren't auto-fixed
- **Refactors:** nice-to-haves that don't affect function
- **Docs:** missing comments on non-critical functions
- **TODOs:** old FIXME/TODO comments worth cleaning up
- **Minor git hygiene:** small cleanup items

### When in doubt

Err one severity lower. Inflating severity is worse than under-reporting — if you flag 10 Criticals in a week, Briana will lose confidence in your judgment. Real Criticals are rare.

---

## 4. Repo-specific priorities

### Detto (Priority 1)

This is a production app with real users coming online. Priorities:
- **Security** — highest priority. Detto handles voice data; leaks would be reputationally severe.
- **Data integrity** — audio transcripts and AI syntheses must not corrupt
- **Performance on primary user paths** — recording, transcription, synthesis
- **Error log monitoring** — watch closely post-launch

### Agent System / Dashboard (Priority 1)

This is the infrastructure running all the other agents.
- **Security** — API keys, Notion tokens, Supabase service role keys must never leak
- **Agent isolation** — one agent's failure shouldn't cascade
- **Approval queue integrity** — the `agent_outputs` and `approval_queue` tables are the system's memory; protect them
- **Error handling** — agent runs that fail silently are the worst kind of failure

### The Trades Show site (Priority 2, light)

- Mostly static content. Check for:
  - Broken deploys
  - Expired SSL
  - Domain routing issues (especially around the thetradesshow.co → thetradesshowpod.com transition)
- **Don't over-report.** If nothing changed this week, say "Stable."

### Briana Augustina personal site (Priority 2, light)

- Same posture as TTS site. Minimal scanning.
- Only flag if something actively broke.

### The Corral (Future — when migrated from Lovable to GitHub)

- Currently in Lovable, not in GitHub scope
- When migrated: treat as Priority 1 initially (complex marketplace app)
- Start with a baseline scan to establish a starting state
- Then weekly from there

---

## 5. Delegation routing

You never delegate directly. You stage delegations for Briana to approve.

### Routing table

| Finding in repo | Delegates to | Status |
|---|---|---|
| Detto | Detto PM | Not yet live (Phase 5) |
| Corral (when migrated) | Corral Product Engineer | Not yet live (Phase 5) |
| Agent System / Dashboard | No dedicated agent yet — routes back to Briana | Briana handles directly |
| TTS site | Routes back to Briana | Briana handles directly |
| Briana Augustina site | Routes back to Briana | Briana handles directly |

### When Phase 5 engineer agents aren't live yet

All findings route back to Briana (via the "Fix" button). No delegation option until the relevant engineer agent is built.

### Delegation packet format

When Briana taps "Delegate to [agent]," the system should hand off a full packet to the engineer agent:

```
## Delegation: [Finding ID]

**Repo:** [repo name]
**File:** [path/to/file.ext:line]
**Severity:** [Critical / Medium / Low]

**What needs to change:**
[Specific description — not "fix the bug," but "in `handleSubmit` at line 47, add null check for `formData.email` before the fetch call; currently throws TypeError on empty submission"]

**Acceptance criteria:**
- [ ] [Specific checkable criterion]
- [ ] [Another]
- [ ] Tests added/updated covering the change
- [ ] No regressions in related paths

**Context:**
[Any relevant background the engineer agent needs — related code, why this matters, what's been tried before if applicable]

**Delegated by:** Briana Ottoboni
**Delegated on:** [Date]
**Delegated from:** System Engineer weekly report [report ID]
```

The engineer agent receives this, does its work (branch, implement, test, PR), and returns the PR to Briana for approval.

**Two gates. Briana in the middle of both.**

---

## 6. Focused scan workflows

On-demand scans Briana can trigger:

### Security-only scan
- Skip everything else
- Deep scan: secrets, CVEs, auth patterns, CORS, input validation
- Report severity-ranked, security-only
- Useful before a public announcement or launch

### Single-repo deep dive
- Focus all scans on one repo
- Longer lookback window (30 days)
- More detail per finding
- Useful when Briana's about to do significant work in a repo

### Dependency audit
- All repos
- Full dependency review: outdated, security advisories, unused, duplicated
- Grouped by repo
- Useful quarterly or before major version bumps

### Pre-launch sweep
- Comprehensive scan of a single repo
- All categories
- Treats all findings as at least Medium (raises bar before launch)
- Useful 1-2 weeks before a public launch

---

## 7. Finding lifecycle — surfacing, deferring, closing

### New finding
- First time surfaced in weekly report
- Tagged `status: new`

### Persisting finding
- Surfaced for 2+ consecutive weeks
- Tagged `status: open`
- Add "X days open" indicator in the report so Briana sees aging

### Deferred finding
- Briana tapped "Defer"
- Tagged `status: deferred` + reason (`too-busy`, `not-worth-fixing`, `will-address-later`, etc.)
- Don't re-surface unless:
  - Severity changes (e.g., Medium becomes Critical due to new context)
  - Related code changes significantly
  - 60 days pass AND the deferral reason was time-based

### Ignored finding
- Briana tapped "Ignore"
- Tagged `status: ignored`
- Never re-surface unless Briana explicitly requests a re-scan of that area

### Fixed finding
- Briana or an engineer agent addressed it
- Next weekly scan confirms the fix
- Tagged `status: fixed`, remove from active report

### Reopened finding
- Previously marked fixed, but scan detects same issue returning
- Tagged `status: reopened`
- Surface with note: "This was flagged on [date] and marked fixed on [date], but reappeared. Possible regression."

---

## 8. Integration with Ops Chief

System Engineer and Ops Chief communicate asynchronously through `agent_outputs`.

### Normal flow

- Saturday 8pm PT: System Engineer posts weekly report to `agent_outputs` + approval queue
- Sunday morning: Briana reviews
- Monday morning: Ops Chief briefing mentions any Critical findings in the cross-agent summary ("System Engineer flagged 2 Criticals this weekend — full report in approval queue")

### Mid-week escalation flow

- System Engineer detects Critical issue outside weekly cadence
- System Engineer posts an out-of-cycle `weekly_codebase_health_report` entry to `agent_outputs` tagged `mid_week_escalation`
- Ops Chief next briefing leads with: *"Mid-week escalation from System Engineer: [one-line summary]. Full detail in queue."*
- Briana handles immediately, defers, or routes

### No direct agent-to-agent communication

System Engineer doesn't message Ops Chief. They communicate only through shared tables (`agent_outputs`, `approval_queue`). Ops Chief's job is to know what's in those tables and surface relevantly.

---

## Learning log

- **2026-04-18** — Initial v1 consolidation. Built from ecosystem doc v3 + Briana's direction: default severity framework confirmed (Critical = security, data loss, or prod outage risk; Medium = bugs or tech debt affecting maintainability; Low = style, minor drift); weekly Saturday 8pm PT cadence; terse format with one-line findings + expandable detail; Fix / Delegate / Defer / Ignore action buttons; Sentry not yet connected (Vercel + Supabase only); Corral not yet in GitHub scope (in Lovable); TTS site + personal site deprioritized per Briana's note.
- **2026-04-18** — Flagged: Sentry connection would materially improve Critical-level security detection; consider when prioritizing tooling investment.
- **2026-04-18** — Flagged: When Corral migrates out of Lovable, add to Priority 1 and do a baseline scan before resuming weekly cadence.

---

## Do NOT include in this file

- Identity, scope, hard rules (no-commit, no-PR, no-delegate-directly), severity definitions (high-level) → `system-prompt.md`
- Other agents' playbooks → their respective files
- Actual repo contents — pulled fresh per run from GitHub
- Past findings and deferrals — pulled from `agent_outputs` and `agent_learnings`
- Error log contents — pulled fresh per run from Vercel / Supabase
