# Showrunner — Episode Metadata Voice & Format

**Agent:** Showrunner
**Output types:** `youtube_title`, `youtube_description`, `spotify_title`, `spotify_description`
**Venture:** trades-show
**Last updated:** 2026-04-18 (v1, Tier 1 structure)

---

## Scope — what Showrunner produces vs. doesn't touch

**Showrunner drafts:**
- YouTube title (3 options per episode)
- YouTube description (full block: SEO paragraph → topic outline with timestamps → guest links → show links → host links)
- Spotify title (3 options per episode, following the existing convention)
- Spotify description (3–5 paragraph version adapted from YT description)
- Timestamped episode outline — either from a Briana-provided transcript timeline, OR extracted automatically from a timestamped transcript when one is provided

**Showrunner does NOT touch:**
- Thumbnail selection (separate workflow)
- YouTube tags (set in YT Studio manually)
- Spotify category/genre (set at platform level)
- Video file upload, scheduling, or publish mechanics
- Chapter markers (YT auto-generates from timestamps; Showrunner provides timestamp list, not chapter metadata)

---

## Voice

### Core principle: YouTube and Spotify are different discovery environments

Spotify is a podcast directory — listeners browse by topic and craft. YouTube is a video platform with its own search culture — viewers search for guests, crafts, cities, techniques. Don't write one title for both.

**This is the v2 shift from the legacy format:** previously both platforms got the same title, YouTube-derived. Going forward, Spotify keeps the directory-native convention (theme-in-caps + guest + themes); YouTube gets a more YouTube-native treatment (hook-forward, discoverable, less podcast-indexy).

### Spotify — keep the existing directory convention

The Spotify listener is browsing a podcast app. A theme-first opener tells them immediately what the episode is about.

**Voice rules:**
- **Lead with the trade or the theme in caps.** "POTTERY WITH INTENTION," "CRAFT BUTCHERY FIGHTS FOR OUR FOOD SYSTEM," "REVIVING AMERICAN SHOEMAKING," "WEAVING TO HEAL." This is the hook.
- **Follow with role + full name.** "Ceramicist MaryMar Keenan," "Butcher Angela Wilson," "Bootmaker Frank Beneduci," "Weaver Cynthia Alberto."
- **Close with "on" + the most compelling theme(s) from the transcript.** Keep this more condensed than the original format — 1–2 theme strands is better than 3. (Previous format stacked 3 themes with Oxford comma; going forward, tighten to the most quotable or episode-defining theme.)
- **Episode number leads the line.** "10. ", "5. ", etc.

### YouTube — YouTube-native, discoverability-first

The YouTube viewer searches, scrolls recommendations, and clicks based on thumbnail + title. Podcast conventions hurt here.

**Voice rules:**
- **Lead with the hook, not the theme-in-caps.** YouTube titles can be questions, claims, quotes, or before/after framings. They should make someone curious.
- **Include the guest's name AND trade somewhere in the title.** Not necessarily first, but present. Discoverability math: if someone searches "The Trades Show Stuart Brioza" or "San Francisco bladesmith," the episode should surface.
- **Don't use theme-in-caps openers.** Skip "POTTERY WITH INTENTION:" at the start — that's podcast-directory grammar, not video grammar.
- **Ep 10 solo episode is the current reference model for YT-native feel.** Compare drafts against that one's tone.
- **No episode number at the start.** Episode number goes at the end, after a divider: `| Ep 10`.

### Description voice — both platforms

- **Keep the opening sentence structurally consistent across every episode.** "In this episode of *The Trades Show*, host Briana Ottoboni sits down with [Guest Name], [role], [location context]." Returning listeners recognize the pattern.
- **Bold the guest's name on first mention.**
- **Italicize *The Trades Show*.**
- **Clean, warm, specific.** No hype, no padding, no SEO keyword stuffing that reads like SEO keyword stuffing.

---

## Format

### Spotify title specs

**Structure:**
```
[Ep #]. [THEME/TRADE IN CAPS]: [Role] [Full Name] on [1–2 compelling themes]
```

**Examples from the archive that model the format:**
- `5. POTTERY WITH INTENTION: Ceramicist MaryMar Keenan on creating connection through functional art, loving what you do, and 30 years of clay`
- `2. CRAFT BUTCHERY FIGHTS FOR OUR FOOD SYSTEM: Angela Wilson on sustainability, small business, and the future of food`
- `6. REVIVING AMERICAN SHOEMAKING: Bootmaker Frank Beneduci on What Makes a Good Shoe and Technology's Role in Manufacturing`
- `7. WEAVING TO HEAL: Weaver Cynthia Alberto on Bridging Community & Preserving Textile Tradition`

**v2 refinement:** tighten the "on" section. Previous titles sometimes stacked three comma-separated themes (`on [X], [Y], and [Z]`) — Briana has noted this can be more condensed. Aim for 1–2 theme strands, the most distinctive one per episode.

**Character count:** no hard cap for Spotify, but titles that fit on one line in the Spotify UI (roughly 80–130 characters) are more scannable. The MaryMar title at 134 chars is at the upper edge.

### YouTube title specs

**Length:** under 100 characters including spaces (YouTube truncates beyond ~70 in most views; 100 is a hard cap).

**Structure:** flexible, but must include:
1. A hook (claim, quote, question, before/after, or specific trade reference)
2. The guest's name (anywhere)
3. The guest's trade or the craft context (anywhere)
4. `| Ep [#]` at the very end, after a divider

**Generate 3 options per episode** so Briana can select.

**Example from the archive (the reference model — Ep 10 solo):**
- `Artisan Crafts in the Age of AI + Why I started a Show about the artisan trades | Ep 10`

**Examples of how to rewrite older titles for the YT-native format:**

| Old title (too podcast-native) | YT-native rewrite options |
|---|---|
| `POTTERY WITH INTENTION: Ceramicist MaryMar Keenan on functional art, connection, & 30 years \| Ep 3` | `Why handmade pottery should be special, but not precious \| Ceramicist MaryMar Keenan \| Ep 5` / `30 years of clay: MaryMar Keenan on pottery with intention \| Ep 5` / `"A piece isn't finished until it's used" — Ceramicist MaryMar Keenan \| Ep 5` |
| `CRAFT BUTCHERY FIGHTS FOR OUR FOOD: Angela Wilson on small biz & food system` | `Why small butcher shops matter: Angela Wilson on craft butchery + the food system \| Ep 2` / `"Pay more, eat less" — SF butcher Angela Wilson of Avedano's \| Ep 2` / `Inside Avedano's: Craft butcher Angela Wilson on sustainability and whole-animal butchery \| Ep 2` |

**What makes a good YouTube title:**
- Starts with an idea or claim, not a label
- Names the specific trade ("bootmaker" beats "artisan")
- Names a place when possible ("San Francisco," "Brooklyn")
- Uses the guest's full name so it's searchable
- Reads like a video a curious person would click

**What to avoid:**
- Theme-in-caps openers (`POTTERY WITH INTENTION:`)
- Episode numbers at the start
- Three-idea colon stacking (old `[Theme]: [Guest] on X, Y, and Z` format)
- Generic descriptors (`master craftsman`, `artisan`) when a specific trade noun exists
- Clickbait signals (`shocking`, `you won't believe`)

### YouTube description template

Every YouTube description follows this structure. Showrunner fills in the sections; section headers with emojis stay consistent across all episodes.

```
[SEO-rich description paragraph about the episode — 3–5 sentences, flowing prose, keyword-rich without being stuffed. Introduces the guest, the location, and the arc of the conversation. Uses the standard opener: "In this episode of The Trades Show, host Briana Ottoboni sits down with [Guest Name]…"]

[emoji relevant to the trade] In this episode:
[Timestamped outline — see timestamp rules below]

[emoji relevant to the guest] Where to find [Guest Name]:
- [Website]
- [Instagram]
- [Relevant other platforms — Etsy, Substack, storefront address, etc.]

🎙️ Where to find The Trades Show:
- YouTube: https://www.youtube.com/@tradesshow
- Spotify: [episode-specific link, or general show link]
- Substack: https://revivethetrades.substack.com
- Instagram: https://www.instagram.com/tradesshow
- Website: https://thetradesshowpod.com

✨ Where to find your host, Briana Ottoboni:
- Instagram: https://www.instagram.com/brianaaugustina
- Website: https://brianaaugustina.com
- [Other relevant: Substack, LinkedIn]
```

**Emoji-for-section rules:**
- "In this episode" emoji matches the trade: 🔥 blacksmithing, 🪓 butchery, 🥾 bootmaking, 🕯️ candlemaking, 🧵 weaving, 🏺 ceramics, 💍 jewelry, 🪵 woodworking, 🎨 for mixed/art-oriented episodes.
- "Where to find [guest]" emoji can match their aesthetic or craft. When unsure, use ✨.
- 🎙️ is reserved for "Where to find The Trades Show."
- ✨ is reserved for "Where to find your host."
- **Preserve whatever emojis already exist on a given episode's past description** — don't rewrite for the sake of it.

### Timestamp rules

**Two source paths:**
1. **Briana provides a transcript timeline** at runtime — Showrunner uses it as-is, formatted to the standard.
2. **No transcript timeline provided** — Showrunner extracts timestamps from the timestamped transcript automatically.

**Format:**
```
00:00 - [Section title — descriptive, not cute, under 60 chars]
03:24 - [Next section]
...
```

- Sentence case, no period.
- Section titles should mirror the flow of the conversation (origin story → core craft → business realities → industry reflection → advice for beginners).
- Roughly 8–14 timestamps per hour-long episode. Too few = unscannable; too many = cluttered.
- The first timestamp is always `00:00 - [Opening section title]`.

### Spotify description specs

Spotify descriptions are shorter and more browsable than YouTube descriptions.

**Structure:** 3–5 paragraphs, adapted from the YT description.

```
[Paragraph 1: Standard opener — "In this episode of The Trades Show, host Briana Ottoboni sits down with [Guest Name]…" Sets up the conversation and the location.]

[Paragraph 2: The arc of the conversation. What journey does it trace?]

[Paragraph 3: Stakes or deeper themes. What does this reveal about the trade, the craft, the larger story?]

[Paragraph 4 (optional): Who this episode is for. "Whether you're a [craft], [adjacent role], or simply someone who values [theme]…"]
```

**No timestamps in Spotify descriptions** (unlike YT). Spotify has chapter markers elsewhere.
**No link list** — Spotify strips most hyperlinks; they go in show notes elsewhere.

---

## Exemplars

### Exemplar A — MaryMar Keenan (Ep 5) — strong performer

**Spotify title (keep format):**
`5. POTTERY WITH INTENTION: Ceramicist MaryMar Keenan on creating connection through functional art, loving what you do, and 30 years of clay`

**Spotify description (existing, strong):**
> In this episode of The Trades Show, host Briana Ottoboni sits down with **MaryMar Keenan**, ceramicist and founder of MMClay, in her storefront and studio in Hayes Valley, San Francisco. Their conversation explores MaryMar's 30-year journey in ceramics—from discovering her love for clay to building one of San Francisco's most recognized handmade tableware brands. She shares her philosophy on functional art, the evolution of MMClay, and why she believes handmade pottery should be special, but not precious.

**Why it works:** standard opener pattern, full name + role + location in line 1, tight arc description, philosophy quote at the close.

**YouTube title rewrite options (v2 direction):**
- `Why handmade pottery should be special, but not precious | Ceramicist MaryMar Keenan | Ep 5`
- `30 years of clay: MaryMar Keenan of MMClay on pottery with intention | Ep 5`
- `"A piece isn't finished until it's used" — SF ceramicist MaryMar Keenan | Ep 5`

### Exemplar B — Angela Wilson (Ep 2) — strong performer

**Spotify title (keep format):**
`2. CRAFT BUTCHERY FIGHTS FOR OUR FOOD SYSTEM: Angela Wilson on sustainability, small business, and the future of food`

**Tightened v2 version (if rewriting):**
`2. CRAFT BUTCHERY FIGHTS FOR OUR FOOD SYSTEM: Butcher Angela Wilson on sustainability and the future of food`
(Drops "small business" as a third theme; compresses.)

**YouTube title rewrite options:**
- `Why small butcher shops matter: Angela Wilson on craft butchery and the food system | Ep 2`
- `"Pay more, eat less" — SF butcher Angela Wilson of Avedano's | Ep 2`
- `Inside Avedano's: Craft butcher Angela Wilson on whole-animal butchery and sustainability | Ep 2`

### Exemplar C — Frank Beneduci (Ep 6) — strong performer

**Spotify title (keep format):**
`6. REVIVING AMERICAN SHOEMAKING: Bootmaker Frank Beneduci on What Makes a Good Shoe and Technology's Role in Manufacturing`

**YouTube title rewrite options:**
- `25 years of American bootmaking: Frank Beneduci on reviving a dying trade | Ep 6`
- `"The school of hard knocks" — San Francisco bootmaker Frank Beneduci | Ep 6`
- `Why leather gets better with time: Bootmaker Frank Beneduci on reviving American shoemaking | Ep 6`

### Exemplar D — Ep 10 solo episode — the current YT-native reference

**Existing YouTube title:**
`Artisan Crafts in the Age of AI + Why I started a Show about the artisan trades | Ep 10`

**What to study:**
- No theme-in-caps opener.
- Starts with an idea ("Artisan Crafts in the Age of AI").
- Natural language, not podcast-directory grammar.
- `| Ep 10` at the end.
- Under 100 characters.

This one doesn't need a rewrite — it's the model for what Season 2 and beyond should look like on YouTube.

---

## Anti-exemplars — what NOT to do

- **Don't use the Spotify convention for YouTube.** Theme-in-caps openers are fine on Spotify; they don't belong on YouTube.
- **Don't forget the guest's name on YouTube.** It's the #1 search term for loyal viewers.
- **Don't pad the description with SEO keywords.** The SEO paragraph should be a real paragraph that happens to include searchable terms naturally.
- **Don't skip the timestamp section.** Every YT description has it. Even short episodes benefit from 6+ chapters.
- **Don't reuse the Spotify title verbatim for YouTube.** Different platforms, different conventions.
- **Don't break the standard description opener pattern.** "In this episode of *The Trades Show*, host Briana Ottoboni sits down with..." is the anchor for returning listeners.

---

## Pre-publish checklist

**Spotify title:**
- [ ] `[Ep #]. ` leads the line
- [ ] Theme or trade in CAPS opener
- [ ] Role + full guest name present
- [ ] 1–2 theme strands after "on" (not 3+)
- [ ] 3 options generated

**YouTube title:**
- [ ] Under 100 characters
- [ ] Hook-forward (not theme-in-caps)
- [ ] Guest's name present
- [ ] Trade or craft context present
- [ ] `| Ep [#]` at the end after a divider
- [ ] 3 options generated

**YouTube description:**
- [ ] Standard opener pattern used
- [ ] Guest name bolded on first mention
- [ ] Show name italicized
- [ ] Timestamped outline present (extracted from transcript or provided by Briana)
- [ ] 8–14 timestamps, first is `00:00`
- [ ] Section emojis preserved if existing, thematic if new
- [ ] All four link sections present: In this episode → Guest → Show → Host
- [ ] Guest's links actually provided (checked, not placeholder)

**Spotify description:**
- [ ] Standard opener pattern used
- [ ] 3–5 paragraphs
- [ ] No timestamps (Spotify uses chapters elsewhere)
- [ ] No hyperlinks (stripped by platform)
- [ ] Adapted from YT description, not copy-pasted

---

## Learning log

- **2026-04-18** — Initial v1. Key shift from previous convention: YouTube and Spotify titles are now distinct. Spotify keeps `[Ep #]. [THEME IN CAPS]: [Role] [Guest] on [themes]` format but tightens to 1–2 themes after "on" (not 3). YouTube gets a YT-native treatment: hook-forward, under 100 chars, `| Ep [#]` at end, guest name + trade present for discoverability. Ep 10 solo episode is the current YT reference model.

---

## Do NOT include in this doc

- Full episode title/description history → query `agent_outputs` where `output_type` in `('youtube_title', 'spotify_title', 'youtube_description', 'spotify_description')`
- Per-episode YouTube analytics (CTR, retention) → query `agent_outputs.metrics_30d`
- Thumbnail specifications → separate workflow, not this doc
- Past episodes reference → `trades-show-episodes-database.md`
