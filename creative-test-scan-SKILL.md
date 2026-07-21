---
name: creative-test-scan
description: >
  Scan client Meta Ads accounts to find creative concepts that are ready for
  performance review. Identifies ads that have been live for 5+ days in Meta,
  checks whether the Notion creative board card already has a Test Performance
  writeup, applies readiness thresholds (spend and conversion minimums), and
  outputs a prioritized list of concepts ready for review. Use this skill whenever
  the user asks to "scan for tests", "check what's ready for review", "find tests
  to review", "run the scan", "any tests ready?", "creative scan", or any variation
  of wanting to know which creative tests across clients have enough data for a
  performance writeup. Also trigger when the user says "check the boards",
  "what needs reviewing", or "scan accounts". Can run for all clients or a
  specific subset.
---

# Creative Test Scan

Scan client creative boards in Notion to discover concepts that have been live
long enough and accumulated enough data for a meaningful performance review.
Pull Meta Ads data only for those targeted concepts, apply readiness thresholds,
and output a prioritized queue that feeds directly into the
creative-test-performance skill.

## Why this exists

Creative tests need to run for a minimum period and accumulate enough conversions
before a review is meaningful. Without a systematic scan, tests either get
reviewed too early (unreliable conclusions) or sit unreviewed while budget
continues to flow into underperformers. This skill automates the discovery step
so the team can focus on analysis rather than manual checking.

## Inputs

The user provides:
1. **Client name(s)** (optional) - if omitted, scan all default clients in `references/clients.md` (Luna and Mooncup are excluded by default)
2. **Any overrides** (optional) - e.g. "include tests with 5+ days" or "lower the spend threshold to £50"

## Client Configuration

Load client details from the reference file at `references/clients.md`. This
contains Meta account IDs, Notion Creative Board data source IDs, optimization
events, currency, Stage property mappings, and any client-specific filters.

**If a client is not yet in the file** (e.g. a new client), resolve the Notion
data source via `notion-search "[Client] creative board"` on first run and add
it to the file.

## Architecture: Notion-first

This skill reads from the Notion creative board first and only pulls Meta data
for concepts that need a writeup. This is much more efficient than the inverse
(scanning every ad in the account) because:

- Most ads in a Meta account are not Elements-managed concept tests, but every
  Elements concept has a card on the creative board
- Cards already at `07 - Finished - win/lose` are skipped automatically
- Cards with a populated Test Performance section are skipped automatically
- Only the small set of `06 - Live` cards without a current writeup get a Meta
  query - so we read a fraction of the ad data we'd otherwise pull

### Subagent vs sequential

The previous version of this skill required a Task subagent per client to avoid
context exhaustion. **Subagents may not work in every session** - if the host
environment carries a large MCP / tool surface, the subagent's inherited prompt
can exceed its input limit before any work begins (a real failure observed in
production: every Agent call returns "Prompt is too long").

**Default behaviour:** try parallel subagents first (one per client). If a
subagent launch fails with "Prompt is too long" or similar, fall back to running
clients **sequentially in the main context**. The Notion-first architecture
makes sequential viable because the per-client read is now small (typically
3-10 cards plus a targeted Meta query per ready card, not the full account).

If running sequentially, do clients in this order so the most actionable
findings appear first:
1. Ezra
2. Leafe
3. Wolf & Badger
4. TouchNote
5. Alexia
6. Lucky Beau
7. Pie

## Workflow

### Step 1: Identify target clients

If the user named specific clients, use those. Otherwise, use the default set
from `references/clients.md` (excludes Luna and Mooncup).

### Step 2: For each client (subagent or sequential), run the per-client flow

The per-client flow has 5 stages. The same flow runs in a subagent or in the
main context.

#### 2a. Pull Live cards from the Notion Creative Board

Query the client's Creative Board data source (from `references/clients.md`)
for cards where `Stage = "06 - Live"`.

Use `notion-search` with `data_source_url: "<board>"` and a query targeting Live
cards. If `notion-search` does not support direct Stage filters, fetch the
board's data source and use the schema to query - or just search broadly and
filter results by Stage in code.

For each Live card, capture:
- `title` (e.g. "UGC: cut down of biohacker Dan")
- `Meta Concept Name` property (e.g. `DAN-BIOHACKER-CUTDOWN`) - this is the
  identifier you'll match against ad names in Meta
- `notion_url` and `notion_page_id`
- `Created` / last edit date

#### 2b. Skip cards that already have a Test Performance writeup

Fetch each Live card via `notion-fetch`. Inspect the Test Performance callout:

- **Empty TP** = the section exists but contains placeholder text like
  `*Impression to reg rates:*` / `***Winning variant:***` / `***Learnings:***`
  with no real data. **Needs writeup.**
- **Populated TP** = the section contains a Summary, classification (Win/Lose),
  variant comparison table, or learnings. **Skip.**
- **Stale TP** = the section is populated but references a previous test round
  while the current ads are a re-cut (different created_time, different ad
  names). **Add a "Round 2" callout** rather than overwriting.

Bucket each card into one of: `needs_writeup`, `already_done`, `needs_round_2`.

#### 2c. Pull Meta data for ONLY the cards that need writeups

For each card in `needs_writeup` or `needs_round_2`, search Meta Ads for ads
matching the `Meta Concept Name`:

1. Call `list_ads` with the account ID (no status filter, paginate). Apply any
   client-specific filter from `references/clients.md` (UK campaigns for Ezra,
   "UGC Only" ad sets for W&B, etc.).
2. Keep ads whose name contains the concept slug (case-insensitive substring
   match, but DO NOT collapse distinct slugs - `popup-reviews` and
   `popup-reviews-evergreen` are separate concepts).
3. Keep only ads with `effective_status` ACTIVE / ADSET_PAUSED / CAMPAIGN_PAUSED.
4. Pull insights at `level: "ad"` for the matched ads:
   - Use `get_insights` for standard accounts
   - Use `export_insights` for Ezra (custom pixel events) and Wolf & Badger
     (purchase_roas / action_values pass-through). See `references/clients.md`.
   - `time_range`: `{since: <ad_created_time or campaign relaunch date>, until: <today>}`. Do not use `date_preset: "lifetime"` (invalid).
   - Fields: standard `["spend", "impressions", "actions"]` for most clients;
     for custom-event clients use `["spend", "conversions", "conversion_values"]`.

5. Aggregate per concept: total spend, total optimization events, days live
   (from earliest `created_time` of any matched ad).

#### 2d. Apply readiness threshold

For each concept, check:
- Days live >= 5 (or user override)
- Spend >= £100 OR optimization events >= 10 (USD threshold is the same number)
- For Ezra the optimisation event is `event_eatc` (add to cart), NOT bookings - apply this threshold and the zero-event kill flag on eATC. Bookings (`event_eb`) are reference only and ROAS is not used.

Bucket as:
- **`ready`** - meets threshold, has writeup-empty card, ready for review
- **`gathering_data`** - card exists, ads live, but below threshold
- **High-spend zero-conv flag** - spend >= £150 with 0 events (urgent kill)

#### 2e. Stragglers pass (optional but recommended)

After processing all Live cards, do a sanity check for ads running in Meta
that don't have a corresponding Live card:

1. List all active ads on the account (with the same client-specific filter)
2. Extract concept slugs from ad names per the naming convention
3. Compare against the slugs covered by Live Notion cards in step 2a
4. Any concept slug that has material recent spend (>= £100) but no Live card
   match is a **straggler**. Report these so the team can decide whether to
   create a card retroactively.

This catches cases where Meta has live creative that hasn't been briefed via
Notion (rare but happens with quick recuts or test-of-test variants).

#### 2f. Return JSON

Each subagent (or each sequential client iteration) returns:

```json
{
  "client": "[CLIENT]",
  "ready": [
    {
      "concept": "NAME",
      "variants": 2,
      "adset_ids": ["123"],
      "spend": 150.50,
      "optimization_events": 12,
      "days_live": 14,
      "notion_url": "https://notion.so/...",
      "notion_page_id": "abc123",
      "round": 1
    }
  ],
  "needs_round_2": [
    {"concept": "NAME", "spend": 2253.30, "optimization_events": 0, "notion_url": "..."}
  ],
  "gathering_data": [
    {"concept": "NAME", "spend": 45.00, "optimization_events": 3, "days_live": 5}
  ],
  "already_done": 3,
  "stragglers": [
    {"concept_slug": "bookUGC-animation", "spend": 463.13, "events": 4, "note": "no matching Live card on board"}
  ],
  "flags": ["concept X has $1,750 spend with 0 optimisation events (eATC for Ezra)"],
  "errors": []
}
```

### Step 3: Aggregate and present summary

After all clients complete, present:

**For each client:**
- **Ready for review:** Table of concepts with variants, spend, events, days live, Notion link. Sort by spend descending (most urgent first).
- **Round 2 needed:** Concepts whose card has a previous-round writeup but the current re-cut needs its own analysis.
- **Still gathering data:** Brief list of concepts not yet at threshold.
- **Already done:** Count of skipped concepts.
- **Stragglers:** Concept slugs running in Meta with no matching Live card.
- **Flags:** Any urgent zero-conversion situations.

**Across all clients:**
```
Scan complete: X concepts ready for review across Y clients.
- [Client A]: N ready, M Round 2, K stragglers
- [Client B]: ...

Next step: Run creative-test-performance for each ready concept.
```

### Step 4: Hand off to creative-test-performance

After presenting the queue, ask the user which concepts to review. The user can:
1. **Review all ready** - run creative-test-performance per concept in sequence
2. **Review specific ones** - pick from the list
3. **Skip for now** - just use the scan as information

## Client-Specific Filtering

Filters are noted in `references/clients.md`. Two patterns:

### Ad Set Name Filtering (e.g. Wolf & Badger "UGC Only" ad sets)

When `Filter: Only "UGC Only" ad sets`:
1. Call `list_ad_sets` with account ID and status ACTIVE
2. Keep ad set IDs whose names contain "UGC Only" (case-insensitive)
3. Filter ads down to those `adset_id`s

`list_ads` doesn't return ad set names, so the resolution must happen first.

**Wolf & Badger specifics:** Elements-produced UGC and motion content runs in
the `UGC Only` ad sets across markets - the current known IDs are
`52606243394930` (UK UGC Only) and `52606247876530` (US UGC Only). If
`list_ad_sets` times out on the W&B account (common on larger accounts), use
`export_insights` at `level: "adset"` with a wide date range to enumerate
ad sets instead - it returns adset_id alongside adset_name reliably. The
legacy `elements` ad sets stopped spending in Feb 2026 and should NOT be
treated as a fallback.

### Campaign/Market Filtering (e.g. Ezra "UK only")

When `Filter: UK campaigns only`:
1. Call `list_campaigns` with account ID
2. Keep campaign IDs whose names start with the market keyword (e.g. `UK_`)
3. Filter ads down to those `campaign_id`s

Same pattern - the indicator lives in the campaign name, not the ad name.

## Readiness Thresholds Reference

These defaults can be overridden by the user:

| Parameter | Default | Description |
|-----------|---------|-------------|
| Minimum days live | 5 | Days since ad `created_time` in Meta |
| Minimum spend | £100 / $100 | Total concept spend across all variants |
| Minimum optimization events | 10 | Total conversions across all variants |
| High-spend alert | £150 / $150 | Flag concepts with this spend but 0 conversions |

## Edge Cases

- **Subagent launch fails with "Prompt is too long"**: this is the inherited
  tool-schema problem. Fall back to sequential execution in the main context.
  Document any clients you couldn't process.
- **Card with no `Meta Concept Name` property**: search Meta by the card title
  slug (lowercased, hyphenated). If no match, mark as `card_without_ads` and
  flag - the card may have been briefed but never launched.
- **Card with `Meta Concept Name` but no ads matching in Meta**: same as above
  - card without ads. Could mean ads were paused without updating the Stage.
- **Ads with multiple concept slugs in the name** (legacy naming): take the
  longest matching slug from the Live cards rather than the prefix.
- **Brand new account with no Live cards**: report "no live tests to scan" for
  that client and skip the Meta read entirely.
- **Client with no Creative Board in Notion**: skip the Notion-first read and
  fall back to the all-ads scan from the legacy workflow (preserved in git
  history) - report this fallback explicitly so the team knows.
- **Paused ad sets with recent spend**: still include - they had recent spend
  even if the ad set is now off. Common when creative is being rotated.
- **Multiple optimization events**: use the client's primary event from
  `references/clients.md`. For TouchNote where web and app concepts coexist,
  pick per concept based on the ad set's optimization goal.
- **Stale TP writeup vs current re-cut**: don't overwrite. Add a new
  "Test Performance - Round 2" callout. The original writeup is part of the
  test history.
- **`list_ad_sets` / `list_ads` timing out on large accounts** (observed on
  W&B): fall back to `export_insights` at the appropriate level with a wide
  date range. It returns the IDs and names needed to apply filters and is
  more reliable than the list endpoints on big accounts.
