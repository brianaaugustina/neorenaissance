# Growth Strategist — Playbook

**Agent:** Growth Strategist
**Scope:** Cross-venture
**Last updated:** 2026-04-18 (v1, consolidated)

**What this file is:** Operational framework for Growth Strategist — analytical approach, experiment template, channel mix per venture, data sources, synergy rules, report formats. Everything that isn't identity/scope (that lives in system-prompt.md).

---

## Contents

1. [Venture goals & what growth means for each](#1-venture-goals--what-growth-means-for-each)
2. [Where KRs live — and how to read them](#2-where-krs-live--and-how-to-read-them)
3. [Data sources](#3-data-sources)
4. [Experiment framework](#4-experiment-framework)
5. [Channel mix per venture](#5-channel-mix-per-venture)
6. [Cross-venture synergy patterns](#6-cross-venture-synergy-patterns)
7. [Quarterly growth review — format](#7-quarterly-growth-review--format)
8. [Monthly pulse check — format](#8-monthly-pulse-check--format)
9. [Experiment proposal — format](#9-experiment-proposal--format)
10. [Confidence framework](#10-confidence-framework)

---

## 1. Venture goals & what growth means for each

Each venture has a different growth definition. Don't mix them up.

### The Trades Show

**What growth means:** deeper reach with the design-conscious, craft-curious audience. Quality of audience > quantity. Retention on YouTube/Spotify matters more than top-of-funnel IG reach.

**Primary metrics to watch:**
- YouTube subscribers + watch time (quality signal)
- Spotify follows + listen-through rate
- Substack subscribers (Trade Secrets on ConvertKit/Substack)
- IG engaged audience (saves, shares — more than likes)

**Lagging metrics that matter:**
- Episode-to-episode audience retention
- Cross-episode viewer recurrence
- Sponsor inquiry rate (a signal of audience-sponsor fit)

### The Corral

**What growth means:** artisans using the jobs board + employers posting legitimate artisan jobs. A chicken-and-egg marketplace — supply (artisans) and demand (employers) have to grow together.

**Primary metrics:**
- Monthly active artisans browsing jobs
- Job postings per week (legitimacy filter applied)
- Application conversion rate (artisan → apply)
- Newsletter subscribers (warm pipeline for both sides)

### Detto

**What growth means:** finding early users who genuinely think by talking — not growth-hack users. The product works or doesn't for a specific kind of user; the goal is finding more of *that* user.

**Primary metrics:**
- Waitlist → early access conversion
- Weekly active users (WAU)
- Session length + sessions per week (the "did it become a habit" signal)
- Qualitative user signals (email replies, NPS-style feedback)

### Fractal / Aura

**What growth means:** expansion within Aura account + selective new-client pipeline. Briana isn't chasing agency-style scale — she's building a quality consultancy.

**Primary metrics:**
- Aura partner enrollment growth (direct KR)
- Aura campaign performance (opens, clicks, enrollments)
- Inbound inquiries for Fractal (not a volume game — 2-3 good ones a quarter is the goal)

---

## 2. Where KRs live — and how to read them

KRs live in the **Notion Key Results database**. They are tagged by:
- **Initiative** (The Trades Show, The Corral, Detto, Aura, etc.)
- **Season** (e.g. Spring 2026, Summer 2026)

### How to pull current KRs

Filter Notion Key Results DB where:
- `Season = [current season]`
- `Status ≠ Complete or Archived`

Group results by Initiative. That's your working KR set for the current quarter/season.

### How to use them

- Every recommendation ties to at least one KR
- When reviewing trends, ask: is this KR at risk? on track? ahead?
- When recommending experiments: the hypothesis should explicitly connect to a specific KR

If a KR isn't clear or is missing critical detail, flag to Briana — don't invent KR intent.

---

## 3. Data sources

All connected and authorized:

| Platform | What to pull | When |
|---|---|---|
| **PostHog** | Product analytics for Detto + Corral + any web apps | Every run |
| **YouTube Studio** | Views, subscribers, watch time, traffic sources, audience geo + demo | Monthly pulse + quarterly |
| **Spotify for Creators** | Listens, follows, retention, episode-level performance | Monthly + quarterly |
| **Meta Business Suite** | IG + Facebook analytics for @tradesshow, @artisancorral, @brianaaugustina | Monthly + quarterly |
| **TikTok Analytics** | @tradesshow TikTok analytics (cross-posted reels) | Monthly + quarterly |
| **Substack** | Trade Secrets subscriber growth, open rates, engagement | Monthly + quarterly |
| **ConvertKit** | Current newsletter platform — subscriber growth, campaign performance, tag-level data | Monthly + quarterly |
| **Reddit Ads** | If any Reddit ad tests running | Per-experiment |

### Platforms NOT in rotation (flagged for future)

- **Customer.io** — Briana is not currently using (has mixed feelings about ConvertKit; may migrate). Track this as a potential platform change; when/if it happens, add to data sources.
- **LinkedIn analytics** — if/when @brianaaugustina LinkedIn becomes more active
- **Pinterest analytics** — cross-posting reels happens but not a growth channel yet

### When a data source is unavailable

- If a connection is broken or down, note it in the output with "data unavailable" for that section — don't fabricate numbers, don't skip silently
- If a new platform launches (e.g. if Detto adds a referral program), add it to the data source list and note the integration work needed

---

## 4. Experiment framework

Every experiment has four mandatory parts. Anything missing one isn't an experiment.

### The four parts

| Part | Purpose | Example |
|---|---|---|
| **Hypothesis** | What you expect to happen, and why | "TTS short-form clips featuring a specific artisan quote (vs. workshop B-roll) will drive 30%+ more saves on IG, because quote-driven content is more share-prone." |
| **Method** | Exactly what you'll do, for how long, on which platform | "For 4 weeks, post 2 reels per week alternating quote-driven (Group A) and B-roll-driven (Group B). Track saves per reel." |
| **Success metric** | The specific number or pattern that would confirm the hypothesis | "Saves: Group A avg > Group B avg by ≥30% over 8 reels." |
| **Timeline** | Start and end date, with built-in review point | "Start May 1. Mid-check May 15 (4 reels done). End May 28. Results writeup by May 31." |

### Experiment discipline rules

- **Minimum length:** 1 month. Current traffic is too thin for shorter cycles.
- **One experiment per venture at a time.** Parallel within a venture pollutes signal.
- **Cross-venture parallel is fine.** TTS can run a content experiment while Corral runs a partnership experiment.
- **Write up results whether successful or not.** Failed experiments teach as much as successful ones. Log to `agent_outputs` with `output_type: experiment_results` so Supervisor can track patterns over time.
- **One experiment can inform the next.** "We tested X, saw Y, now testing Z because of what Y revealed" is a strong chain.

### What's NOT an experiment

- "Let's post more on Instagram" — no hypothesis, no method, no metric
- "Maybe try TikTok" — not even a hypothesis
- "Grow the newsletter" — goal, not experiment

---

## 5. Channel mix per venture

### The Trades Show

| Channel | Role | Current investment | Recommended adjustment signal |
|---|---|---|---|
| YouTube | Primary long-form video home | High | Watch-time drops >10% MoM → revisit |
| Spotify | Primary audio home | High | Retention drops → episode quality review |
| Substack (Trade Secrets) | Newsletter + long-form writing | Medium | Subscriber growth stalls → content cadence review |
| Instagram (@tradesshow) | Reel distribution + discovery | Medium | Reel saves stagnate → test content format shift |
| TikTok | Secondary reel distribution | Low | Engagement spikes → increase investment |
| LinkedIn (@brianaaugustina) | Thought leadership, founder-facing | Low-Medium | — |
| Pinterest | Cross-post only | Very low | — |
| Reddit Ads | Experimental for audience targeting | Project-based | Per experiment |

### The Corral

| Channel | Role | Current investment | Recommended adjustment signal |
|---|---|---|---|
| Newsletter | Primary supply-side nurture | High | Open rate drops >5% → subject line audit |
| Instagram (@artisancorral) | Supply-side awareness | Medium | — |
| Organic SEO | Long-term job discovery | Ongoing | — |
| Partnership outreach | Demand-side (employer) | Medium | — |

### Detto

| Channel | Role | Current investment | Signal |
|---|---|---|---|
| Waitlist landing page (trydetto.com) | Primary conversion surface | High | CTR / form completion rate |
| Founder social (@brianaaugustina) | Early user acquisition | Medium | — |
| Product Hunt / direct outreach | Early-access push | Project-based | — |

### Fractal / Aura

Fractal is a consultancy — "growth" is:
- Aura partner enrollment growth (client-side KR)
- Inbound inquiries (passive pipeline)

Not a channel-mix question in the traditional sense. Focus on Aura campaign performance analysis + occasional Fractal inbound review.

---

## 6. Cross-venture synergy patterns

Look for these in every quarterly review. They're the highest-leverage moves.

### TTS → Corral

- TTS audience is the ideal supply-side of Corral (artisans themselves + people who'd hire them)
- Mechanism: Substack posts → Corral newsletter signups; episode descriptions → Corral CTA; interview Qs that surface hiring needs
- **Watch for:** Corral newsletter signup bumps after TTS episodes drop

### TTS → Detto

- TTS audience skews to a thoughtful creator/maker class — plausible Detto early users
- Mechanism: Substack writing about "thinking by talking" + artisan stories that include the creative process; Detto waitlist mention where relevant
- **Watch for:** Detto waitlist signup source if TTS Substack ever drives meaningful volume

### Corral → TTS

- Artisan employers posting to Corral may be potential TTS sponsors
- Mechanism: flag employer accounts with strong brand presence for Sponsorship Director
- **Watch for:** employer accounts with >$X revenue signals or brand recognition

### Fractal → TTS

- Aura is a Fractal client, and their audience segmentation work generates data relevant to TTS positioning
- Mechanism: Aura cohort insights inform TTS Substack content + audience segmentation
- **Caution:** no cross-contamination of confidential client data — use insights, not raw data

### Briana personal → all ventures

- Her founder platform (@brianaaugustina, personal Substack if any) feeds all four
- Mechanism: her public profile amplifies each venture's reach
- **Caution:** don't burn out her personal channel on cross-promotion — she's the founder, not an influencer

### Anti-synergies (things that look like synergies but aren't)

- Don't funnel Detto users (creator/productivity types) → TTS if they're not craft-interested. Wrong audience.
- Don't cross-promote Aura campaigns (corporate financial wellness) on Trades Show channels. Audience mismatch.
- Don't promote personal consulting on Trades Show platform. Conflates the show with Briana's other work.

---

## 7. Quarterly growth review — format

**Trigger:** 1st of quarter, 8am PT (cron)

### Structure

```
# Q[X] 2026 Growth Review

## Top-line read
[One paragraph: the shape of the quarter across all ventures. What worked, what didn't, what's new.]

## By venture

### The Trades Show
- Key metrics: [YT, Spotify, Substack, IG — numbers + trends]
- KRs: [status of each Spring KR tied to TTS]
- What worked: [specific tactics that moved metrics]
- What didn't: [specific tactics that didn't]
- Recommendation: [3-5 priorities for next quarter, each tied to a KR]
- Proposed experiments: [1 primary experiment for Q[X+1]]

### The Corral
[same structure]

### Detto
[same structure]

### Fractal / Aura
[same structure — note that this is client-facing, not audience-facing]

## Cross-venture synergies

- [Observed synergy 1 + data]
- [Observed synergy 2 + data]
- [Missed synergy opportunity — recommendation]

## Channel mix recommendations
[Which channels to double down on, reduce, or test — ranked]

## Open questions for Briana
[Things you need her decision on before next quarter]
```

### Length

Longer than a daily briefing — this is meant to be read on laptop, not mobile. 2-3 pages max. Lead with the top-line read so she can stop reading if that's enough.

---

## 8. Monthly pulse check — format

**Trigger:** 1st of month, 9am PT (cron)

### Structure

```
# [Month] Pulse

## Trending up
- [Metric, venture, context — 1 line]

## Trending down
- [Metric, venture, context — 1 line]

## Active experiments
- [Experiment name, venture, status, days remaining]

## Needs attention
- [Anything requiring a decision this month]

## Coming up
- [Experiments launching, campaigns ending, KR checkpoints]
```

### Length

Half a page. This is a scan, not a deep read. Goal: she knows in 2 minutes what's happening and what she needs to look at.

---

## 9. Experiment proposal — format

```
# Experiment: [Name]

**Venture:** [One venture — don't propose cross-venture experiments as a single experiment]
**KR tie:** [Which Spring KR this supports]
**Status:** Proposed

## Hypothesis
[What you expect to happen and why — one clear sentence]

## Method
- What: [Specific action — platform, content type, frequency]
- When: [Start date, end date]
- How measured: [Which metrics, pulled from which source]

## Success metric
[The specific number or pattern that would validate the hypothesis]

## What failure looks like
[The specific number or pattern that would invalidate it — so you know when to stop]

## Risks / things that could go wrong
[Honest assessment — what could make this test uninformative?]

## Effort estimate
- Briana time: [hours]
- Cost: [dollars, if any]
- Other agent time: [if Showrunner, PR Director, etc. needs to execute]

## Expected impact if hypothesis is correct
[What changes — both short-term metric and longer-term strategic implication]

## Review checkpoint
[Mid-experiment date + what to check]
```

---

## 10. Confidence framework

When reporting results or recommendations, tag confidence level explicitly.

| Confidence | When to use |
|---|---|
| **High** | Strong signal, sufficient sample size, consistent pattern over multiple periods |
| **Medium** | Clear signal but sample size is limited OR pattern is only one period |
| **Low** | Suggestive signal, too thin to conclude, may be noise |

Never state high confidence you don't have. When low, say:

> "Early signal, low confidence — too thin to act on. Recommend another 4 weeks of data before deciding."

### When sample size is definitely too small

- <30 data points in a time series
- <4 weeks of data for a new channel
- <3 experiments of the same type

In those cases, recommend extending the window before drawing conclusions.

---

## Learning log

- **2026-04-18** — Initial v1. Built from ecosystem doc v3 definition + Briana's direction on: KRs tagged by initiative/season in Notion, all analytics platforms connected (PostHog, YouTube, Spotify, Meta, TikTok, Substack, ConvertKit), Reddit Ads added as additional channel, no exceptions on channels to avoid, experiment cadence = 1 per venture at a time, minimum length 1 month.
- **2026-04-18** — ConvertKit flagged as potentially-replaced with Customer.io in future. Watch for migration.

---

## Do NOT include in this file

- Identity, scope, core operating principles → `system-prompt.md`
- Venture-specific positioning deep dives → venture context files
- Actual KR values → Notion (dynamic, pulled per run)
- Past experiment results → `agent_outputs` (dynamic)
