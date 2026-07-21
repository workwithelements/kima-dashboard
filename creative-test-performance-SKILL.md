---
name: creative-test-performance
description: >
  Pull Meta Ads performance data for a creative concept test and update its Notion
  production card with funnel rates, winning variant, and learnings. Determines
  a recommended win/lose outcome relative to peers and flags the concept for
  team review via Slack in #team (does NOT auto-update the Stage property).
  Use this skill whenever the user asks about creative test performance,
  ad test results, variant performance, hook test results, or wants to fill in
  the Test Performance section of a creative board card. Also trigger when the
  user mentions "test performance", "how did the test do", "pull the results",
  "update the card with performance", "review creative", or references a specific
  ad identifier and wants to see how it performed. The user provides a client
  name and an ad name identifier - the skill handles the rest.
---

# Creative Test Performance

Pull Meta Ads performance data for a creative concept, calculate funnel rates by
variant, classify each variant against its peers, identify the winner, write up
the "why", compare the concept against other concepts in the same ad set,
push everything into the Notion creative board card, determine a recommended
win/lose outcome, and send a Slack notification to `#team` (C087TGJERS5)
for team review. The team manually updates the Stage property after
reviewing the writeup.

## Inputs

The user provides:
1. **Client name** - used to find the correct Meta ad account
2. **Ad name identifier** - the string that appears in Meta ad names for this concept (e.g. `UGC_Alanna_running`)
3. **Notion page URL** (optional) - if not provided, ask for it or search the client's creative board

## Workflow

### Step 1: Match client to Meta ad account

Use `get_ad_accounts` to list all available ad accounts. Match the client name
to the account name (e.g. "Mooncup" -> "Facebook Mooncup Ltd"). If the match is
ambiguous, ask the user to confirm.

### Step 2: Find all ads matching the identifier

Search for ads containing the identifier string. This is important: **search
across all statuses**, not just active ads. Variants that underperformed may
have been paused, but their data is still needed for the analysis.

Use `list_ads` with the matched account ID. **You MUST paginate through every
page of `list_ads` until `has_next_page` is false** - do not stop after the
first page. Concepts often have ads scattered across pages; missing one ad
quietly produces wrong totals downstream. Search across all statuses
(ACTIVE, PAUSED, ARCHIVED) on every page.

If the original writeup or any reference material includes a Facebook ad
preview link with an ad ID (e.g. `facebook.com/ads/library/?id=XXXXX`), use
that ID as a sanity check - if your `list_ads` results do not include that
exact ad ID, keep paginating.

Parse the ad names to identify the variant hook/differentiator. Ad names
follow a convention like:
```
DDMMYY_Format_Creator_identifier-hook-slug_body_product_funnel_Version
```
The hook slug (the part after the identifier) is what distinguishes variants.

Also record the **ad set ID** and **campaign ID** from the ad listing - these
are needed for the peer comparison in Step 7.

#### CRITICAL: Group by ad set (market)

Concepts often run in **multiple ad sets**, which on most clients are split by
**market** (UK / US prospecting, retention, app install). **All analysis from
Steps 3-8 must be performed independently for each ad set.** Group the matched
ads by ad set ID, then run the full workflow per group.

The output (Step 8) presents each market as its own section
(e.g. `## 🇺🇸 US Market`, `## 🇬🇧 UK Market`). Each market gets its own combined
variant + adset-average table, peer ranking, and classification. Learnings are
consolidated across markets into a single list at the end.

**Do not invent "SP" / "HP" or other framing if it's not in the actual adset
names.** Use the real adset names from Meta and label markets by what the
adset name says (UK / US / etc.).

#### CRITICAL: Do not collapse similar concept slugs

Treat slugs like `popup-reviews` and `popup-reviews-evergreen` as separate
concepts. Match the FULL slug between the creator segment and the body tag in
the naming convention, and don't aggregate by prefix. Collapsing distinct slugs
was a real bug and caused concepts to be missed in past scans.

### Step 3: Pull performance insights (dual time window)

Pull data for **two time windows** for each matching ad.

**A. Lifetime window** - from `created_time` to today:
- Shows cumulative performance and total contribution
- Used for the writeup output (the Notion card shows only lifetime data)
- Useful for understanding the full story of the test

**B. Recent window (last 7 days)** - from 7 days ago to today:
- Shows current performance trajectory
- Catches creative fatigue (ads that performed well initially but died)
- This is the PRIMARY window for winner determination
- The recent window is used **internally** for the win/lose call - it does NOT
  appear as its own section in the Notion writeup

For both windows, use:
- **fields**: `["ad_name", "impressions", "actions", "action_values", "cost_per_action_type", "spend", "reach"]`
- **level**: `ad`

From the `actions` array, extract these key events:
- `landing_page_view` - for landing rate
- `add_to_cart` - for cart rate
- `initiate_checkout` - for checkout rate (also TouchNote's optimisation event)
- `purchase` - for purchase rate (most ecomm clients' optimisation event)
- `view_content` - for post-click intent
- Also note `link_click` and `video_view` for context

**Post-click events** are the sum of: `view_content`, `add_to_cart`,
`initiate_checkout`, and `purchase` (or equivalent). These measure whether
people who click are actually engaging on-site.

Different clients may optimise for different actions. The standard funnel is
landing -> cart -> purchase, but some clients track registrations, leads, or other
events. Adapt accordingly - see the client-specific tables in Step 8.

#### Custom pixel events (Ezra and any client with custom conversions)

Some accounts don't fire standard Meta pixel events - only custom conversions
with names like `event_eatc` (email add-to-cart), `event_eic` (initiate
checkout), `event_evc` (view complete). These do NOT appear in the default
`actions` array; `get_insights` shows them lumped as
`offsite_conversion.fb_pixel_custom`.

To pull per-custom-event counts and values per ad, use `export_insights`:

```
mcp__meta-ads__export_insights
  object_id: <ad_id>
  level: ad
  fields: ["impressions", "clicks", "spend", "conversions", "conversion_values"]
  time_range: {"since": "YYYY-MM-DD", "until": "YYYY-MM-DD"}
  format: json
```

The `conversions` array returns one row per custom event, where `action_type`
is shaped `offsite_conversion.fb_pixel_custom.event_<name>` (the suffix is
the custom event name). Same shape for `conversion_values`.

**Ezra event mapping** (confirmed 2026-04-20):

| Event name | Meaning |
|---|---|
| `event_eatc` | Add to Cart (optimisation event - PRIMARY for win/lose) |
| `event_eic`  | Initiate Checkout |
| `event_evc`  | View Content |
| `event_elp`  | Landing Page View |
| `event_el`   | Lead |
| `event_efl`  | Form Lead |
| `event_eb`   | Booking (revenue-bearing; reference only, NEVER the win/lose basis) |

For Ezra, use `event_eatc` (add to cart) as the optimisation event for ALL win/lose classification - we optimise towards it and per-creative booking volume is too sparse to discriminate. CPA = spend / `event_eatc` count, benchmarked against the adset-average cost-per-eATC. Reference `event_eb` (booking) volume and value as supporting context only, never as the win/lose basis. Do NOT report ROAS for Ezra: in-platform booking value is structurally undervalued, and the metric that matters is a blended CAC the team adds manually from external attribution.

#### Pull adset-level lifetime insights (one per market)

For each adset the concept runs in, also pull adset-level insights over the
**lifetime** window (matching the concept's earliest `created_time` in that
adset). This produces the "adset (total)" column in the variant + adset table
in the writeup.

```
mcp__meta-ads__get_insights
  object_id: <adset_id>
  level: adset
  fields: ["impressions", "spend", "actions"]
  time_range: {"since": "YYYY-MM-DD", "until": "YYYY-MM-DD"}
```

### Step 4: Calculate funnel rates by variant

**RATES ONLY.** Volumes (raw conversion counts, landing page view counts)
are hard to compare across variants with different spend levels. Do all
variant comparison using rates, keeping Impressions and Spend for context
on sample size and scale, but not as comparison metrics.

For each variant, calculate these rates using the **recent window** data for
the winner-determination decision in Step 5, and the **lifetime window** for
the output tables in Step 8:

| Metric | Formula |
|---|---|
| **Landing rate** | Landing page views / Impressions |
| **Landing -> {mid-funnel} rate** | Mid-funnel event / Landing page views |
| **{Mid-funnel} -> {final} rate** | Final event / Mid-funnel event |
| **CPA** | Spend / Optimisation event count |
| **ROAS** *(ecomm only)* | Action value (purchase) / Spend |
| **Post-click rate** | Post-click events / Impressions |
| **Spend share** | Variant spend / Total concept spend x 100 |

**Funnel stage mapping per client**:

| Client | Landing rate | Mid-funnel | Final event | CPA label |
|---|---|---|---|---|
| Mooncup, Lucky Beau, Alexia | LPV/Impr | ATC/LPV | Purchase/ATC | CPA (Purchase) |
| W&B | LPV/Impr | ATC/LPV | Purchase/ATC | ROAS + CPA (Purchase) |
| Ezra | LPV/Impr | eATC/LPV | eIC/eATC | CPA (eATC) |
| TouchNote | LPV/Impr | ATC/LPV | IC/ATC | CPIC |
| Pie, Leafe | LPV/Impr | n/a | Reg/LPV | CPR (Complete Reg) |
| Luna | LPV/Impr | Install/Click | Onboard/Install | CPOC |

Sort variants by CPA (best first) - or by ROAS descending for ROAS-primary
clients.

Flag any variants with small sample sizes (fewer than ~10 landing page views
or less than £75 spend) as statistically unreliable.

#### Tracking artefact: ATC -> IC ratios over 100%

For clients optimising for IC (TouchNote), the ATC -> IC rate frequently appears
above 100% (e.g. 600%, 1350%, 2600%). This is a **tracking artefact**, not a
real conversion efficiency win. It happens when Meta records IC events without
a corresponding ATC pixel fire (one-step buy flow, pixel timing, deduplication
across event sources). When you see ATC -> IC ratios above 100% with low absolute
ATC counts (single-digit ATCs producing double-digit ICs), call this out in a
footnote under the table. **Do not let the eye-catching ATC -> IC headline drive
classification.** Trust CPA / CPP / CPIC as the actual efficiency signal.

### Step 5: Classify and identify the winning variant

**Do NOT use Meta's spend allocation as the primary winner signal.** Spend
allocation is a lagging indicator - the algorithm can continue spending on an
ad that has stopped converting due to inertia, learning phase delays, or
frequency saturation. Use a conversion-first classification:

#### Classification decision tree (applied per variant using recent window data)

Apply these checks in order. The first match wins:

1. **No Delivery**: 0 impressions -> skip this variant
2. **Insufficient Data**: Spend < £75 AND impressions < 2,500 AND post-click
   events < 30 -> "Insufficient Data" (cannot reliably classify)
3. **Non-Contributing**: Spend >= £75 AND 0 optimisation events ->
   "Loser (Non-Contributing)" - spending money but generating nothing
4. **Best Performer**: Conversion rate >= peer median AND >= 5 events ->
   "Best Performer"
5. **High Delivery, Low Conversion**: Spend share >= 20% BUT 0 conversions or
   CPA > median -> flag as "Fatigue / Algorithm Lag" - Meta is spending but the
   creative isn't converting. This is a critical insight.
6. **Viable (Under-scaled)**: Spend < £150 AND (good post-click rate OR good
   CPA) -> "Viable" - promising but hasn't had enough budget to prove itself
7. **Loser**: Below-median CPA with >= 5 conversions, OR below-median post-click
   rate with < 5 conversions -> "Loser"
8. **Fallback**: Mixed signals -> "Inconclusive"

#### Selecting the winner

The winning variant is the one with the best combination of:
1. **Conversion efficiency** (CPA, or ROAS for ROAS-primary clients) - primary signal
2. **Conversion rate** (events / impressions) - tiebreaker for similar CPAs
3. **Post-click intent** - secondary signal showing demand quality

If no variant has conversions in the recent window, report on landing rate and
post-click rate and note the test needs more time or all variants are fatigued.

#### Detecting fatigue

**CRITICAL**: If a variant has a healthy lifetime conversion rate but zero
recent conversions with continued high spend, explicitly call out creative
fatigue. Compare lifetime vs recent rates side by side (not raw volumes).
This is one of the most valuable insights - it tells the team when to rotate
creative.

### Step 6: Write up the "why"

This is the most valuable part. Analyse why the winning variant won by
connecting the performance data back to the creative execution. Reference the
Notion creative brief (the script table) to tie specific creative choices to
outcomes.

Consider:
- **Hook structure**: What emotional arc does the winning hook use? Problem
  framing vs achievement framing? Curiosity vs direct benefit?
- **Visual direction**: What does the winning variant show in the first 1-3
  seconds that stops the scroll?
- **Mid-funnel signals**: If a variant has strong landing->cart but weak landing
  rate, the creative resonates once people arrive but doesn't stop the scroll.
  The opposite pattern (strong landing rate, weak cart) means people click but
  aren't convinced on-site.
- **Fatigue patterns**: If the lifetime winner is now a recent loser, what does
  that tell us about the shelf-life of that creative approach?
- **Spend allocation vs reality**: If Meta is still pouring budget into a
  non-converting variant, note the disconnect. This is useful context for
  manual budget reallocation.
- **Market split**: If the concept runs in multiple markets and performance
  diverges (e.g. wins in US, loses in UK), what does that tell us about the
  creative's portability and the market dynamics?
- **Actionable takeaways**: What should inform the next round of creative?

Write 3-4 concise bullet points. Each learning should be specific and
actionable, not generic.

### Step 7: Peer comparison - concept vs other concepts in the same adset (per market)

Compare the concept against its peer concepts **within the same adset** (the
market scope). The peer ranking is per-adset because the writeup format
presents results per market.

For each market the concept ran in, build a peer ranking using ads from the
**same adset** with material spend in the test window.

**The peer set per adset must include any concept that:**
1. Ran in the **same adset** as the test concept.
2. Had **material spend** (>= 100 in the account currency) during the test
   window (the test concept's earliest `created_time` to today, or the
   user-specified window).
3. Targets the same primary audience / job (this is automatic since they're in
   the same adset).

**Excluded from the peer set:**
- Concepts that didn't spend materially in the test window (< 100 in account currency)
- Catalogue / DPA / dynamic product ads (these aren't concept tests)

#### 7a. Find all ads in the adset

Use `list_ads` filtered by `adset_id` (or filter the full list by adset). Make
sure to paginate completely. Search across all statuses.

#### 7b. Group ads by concept

Parse each ad name to extract the concept identifier from:
```
DDMMYY_Format_Creator_concept-hook-slug_body_product_funnel_Version
```

Group ads by their full concept slug. Treat variants of the same slug as one
concept, but do not merge slugs that differ (`popup-reviews` vs
`popup-reviews-evergreen` are DIFFERENT concepts).

#### 7c. Pull concept-level insights

For each concept group, pull insights over the lifetime window on each ad ID.
Aggregate at the concept level, keeping the analysis on rates.

After aggregation, drop any concept whose total spend in the window is below
the material-spend threshold (100 in account currency).

#### 7d. Build the peer rates table per adset

Rank concepts by CPA ascending (best first) - or by ROAS descending for
ROAS-primary clients. This rate-based approach normalises for different
spend levels across concepts.

**Optional: include an "Adset blended" row** in the peer table - sum spend,
conversions, revenue across all peers (including the test concept) and compute
the blended CPA / ROAS. Place visually between better-than-average and
worse-than-average concepts. Bold it.

Present as a Notion table:

Default columns:
```
Concept | Landing Rate | Landing->{Mid} Rate | {Mid}->{Final} Rate | CPA
```

ROAS-primary columns:
```
Concept | Landing Rate | Landing->ATC Rate | ATC->Purchase Rate | ROAS | CPA
```

Mark the current concept row with `<- this concept` suffix. If a concept
appears in another market's peer ranking and would clash, label it with the
market suffix: `brand-review-overlay (UK)` vs `brand-review-overlay (US)`.

### Step 8: Update the Notion creative board card

Fetch the Notion page to see its current content structure. Look for the
**Test Performance** section (typically inside a purple callout block with the
🔢 icon).

#### Output structure - canonical, strict

The content inside the callout must follow this exact structure. This is the
**canonical layout** - use it for all cards for consistency.

```
[sub_sub_header] Test Performance          <- already exists in the callout
[text]           💡 **Summary**:           <- placeholder, manually written later
[text]           {result_emoji} {Result one-liner}
[text]           📅 Test period: Lifetime ({start} - {end})
[text]           📊 Conversion event: {event_name}
[text]           👁️ Preview: {ad preview link(s) - one per market if multiple ads}
[text]           📍 {Ad / adset / market context - which adsets, which ad IDs}
[toggle heading] ### Full Summary          <- toggle contains ALL detailed data
  [h2]             ## 🇺🇸 US Market         <- ONLY if concept ran in US
  [text bold]      Variants vs US adset average (lifetime, {window})
  [table]          Variant vs adset-average table (single combined table)
  [divider]
  [text bold]      📊 Peer Ranking - US adset (by CPA, lifetime)
  [table]          Peer rates table for US adset
  [divider]
  [h2]             ## 🇬🇧 UK Market         <- ONLY if concept ran in UK
  [text bold]      Variants vs UK adset average (lifetime, {window})
  [table]          Variant vs adset-average table (single combined table)
  [divider]
  [text bold]      📊 Peer Ranking - UK adset (by CPA, lifetime)
  [table]          Peer rates table for UK adset
  [divider]
  [text bold]      💡 Key Learnings
  [bulleted_list]  3-4 actionable learnings (consolidated across markets)
```

#### Format rules - strict

- **2 sections by market (adset) where applicable.** If a concept ran in both
  UK and US adsets, write two separate sections under `## 🇺🇸 US Market` and
  `## 🇬🇧 UK Market` headers. If only one market, only one section - skip
  both market headers in the single-market case.
- **One top table per market = variant breakdown vs adset average.** The
  single table inside each market section combines the variant columns AND an
  "adset (total)" column on the right. Do NOT use two separate tables (one for
  variants, one for "concept vs adset average") - they are merged into one.
- **One peer ranking per market.** Immediately below the variant+adset table,
  the peer ranking for that adset only.
- **Do NOT include a cross-market per-ad breakdown table.** The market sections
  already separate the data; a redundant top-level "US ad vs UK ad" table
  bloats the writeup.
- **Do NOT include a "Recent 7-day window" section in the writeup output.** The
  recent window is used during analysis (Step 5 - winner determination), but
  only lifetime data appears in the Notion writeup.
- **Order markets US first, UK second** when both apply (for consistency).
- **Adset is the campaign / market, not "HP" or "SP".** Use the actual market
  label (UK / US / etc.) and the adset name from Meta. Do not invent SP/HP
  framing if it isn't in the actual adset names.

##### Summary line

`💡 **Summary**:` - no content after the colon. The team fills this in
manually after reviewing the analysis.

##### Result line

Directly below the summary, show the overall concept outcome from Step 9 using
the appropriate emoji:

- `🏆 Win` - concept outperformed peers
- `❌ Lose` - concept underperformed peers
- `🔍 Inconclusive` - not enough data or mixed signals

If the concept wins in one market and loses in another, lead with the split:
`🏆 Win in {US}, ❌ Lose in {UK} - {one-line gist}`.

**CRITICAL formatting rules**:

- Do NOT use the word "Winner" anywhere in the header section
- Do NOT include variant names, hook names, or classification labels in
  the result line
- Do NOT prefix metric names (like "Impression to ATC") to any line
- Keep each line clean and simple

##### Test period line

`📅 Test period: Lifetime ({start} - {end})` - use the actual date range the
ad(s) ran (e.g. `Lifetime (19 May - 1 Jun 2026)`).

##### Conversion event line

Show which event was used to evaluate the test:

`📊 Conversion event: {Event Name}`

For example: `📊 Conversion event: Purchase` or
`📊 Conversion event: Complete Registration` or
`📊 Conversion event: Initiate Checkout`.

##### Preview links

Below the conversion event line, include a preview link per market. When
multiple markets are involved, use pipe separators:

`👁️ Preview: [US ad](url) | [UK ad](url)`

Preferred format is a Facebook Ad Library link:
```
https://www.facebook.com/ads/library/?id={ad_id}
```

##### Adset / market context line

Always include a `📍` line listing the adsets the concept ran in and the
specific ad IDs, so a reader can verify the audit downstream. Example:

```
📍 Two ads in two markets: US ad 52602137549028 in US adset 52579356532628
(US_PRO_ASC_CON_JAN26) and UK ad 52602135852828 in UK adset 6981422001224
(UK_PRO_ASC_CON_JAN26).
```

If only one market: omit the "two ads in two markets" framing and just state
the single adset.

**Client-specific conversion events**:

Always check this table before starting the analysis - the conversion event
affects CPA calculations, variant classification, peer rankings, table
headers, and the "Conversion event" line in the Notion output.

| Client | Conversion Event | Meta action_type |
|---|---|---|
| Ezra (Project Kami) | Add to Cart (custom pixel) - PRIMARY; bookings `event_eb` reference only, no ROAS | `offsite_conversion.fb_pixel_custom.event_eatc` (via `export_insights`) |
| TouchNote | Initiate Checkout | `initiate_checkout` (or `offsite_conversion.fb_pixel_initiate_checkout` / `omni_initiated_checkout`) |
| Pie | Complete Registration | `complete_registration` |
| Leafe | Complete Registration | `complete_registration` |
| Luna | Onboarding Completed | Custom app event (may need fallback - see daily-account-summary config) |
| All other ecomm clients | Purchase | `purchase` (or `offsite_conversion.fb_pixel_purchase`) |

When a client uses a non-default event, adapt everything accordingly:
- CPA = Spend / {event count} (not purchases)
- Table column headers use the event name (e.g. "Reg Rate" / "CPR")
- Peer comparison ranks by that event's CPA
- The Notion output's "Conversion event" line shows the actual event used
- Classification thresholds (e.g. ">=5 conversions") apply to the client's event

**ROAS-primary clients**:

For these clients, ROAS replaces CPA as the lead metric everywhere.

| Client | Primary Metric | Notes |
|---|---|---|
| W&B (Wolf & Badger) | ROAS | Lead all headlines with ROAS; rank peers by ROAS (highest first) |
| All other ecomm clients | CPA | ROAS included as a secondary row but CPA drives ranking/classification |

When a client is ROAS-primary:
- Peer comparison table ranks by ROAS descending (highest first)
- Peer table columns lead with ROAS
- Variant comparison tables lead with ROAS row above CPA
- Win/lose classification uses ROAS thresholds (see Step 9a)
- Headlines and result summaries lead with ROAS (e.g. "4.88x ROAS" not "£X CPA")
- The best-performing variant is determined by highest ROAS (not lowest CPA)

**For W&B specifically**: use `export_insights` at `level: ad` to pull
per-variant data. The MCP does not return `purchase_roas` at ad level for
this account, so ROAS must be calculated from `action_values`:

```
mcp__meta-ads__export_insights
  object_id: <ad_id>
  level: ad
  fields: ["ad_name", "impressions", "spend", "actions", "action_values"]
  time_range: {"since": "YYYY-MM-DD", "until": "YYYY-MM-DD"}
  format: json
```

Compute ROAS: find `action_type: "offsite_conversion.fb_pixel_purchase"`
(fall back to `"purchase"`) in `action_values`, then `ROAS = value / spend`.

##### Full Summary toggle

**ALL detailed data** (variant tables, peer rankings, key learnings) must be
wrapped inside a Notion toggle heading block. This keeps the card clean and
scannable.

Toggle heading text: `### Full Summary`

Use a `toggle` block type (or `heading_3` with `toggleable: true`). All
per-market sections, peer tables, and learnings become child blocks of this
toggle.

##### Combined variant + adset-average table (per market)

A single native Notion table per market. Combines variant columns AND an
adset-average column.

**Multi-variant column structure:**

```
Metric | V1 "hook" | V2 "hook" | V3 "hook" | Concept blended | {market} adset (total)
```

**Single-variant column structure** (typical for statics and most batch writeups):

```
Metric | Concept | {market} adset (total)
```

**Rows (in order)** - mostly rates, with volumes only for context:

| Row | Value type | Notes |
|---|---|---|
| Impressions | Volume | For sample-size context only |
| Spend | Volume | For scale context only |
| Landing rate | Rate % | LPV / Impressions |
| Landing -> {mid-funnel} rate | Rate % | e.g. ATC/LPV |
| {Mid-funnel} -> {final} rate | Rate % | e.g. Purchase/ATC, IC/ATC for TouchNote |
| CPA ({event}) | Currency | Spend / final-event count |
| CPP (Purchase) | Currency | Ecomm clients - Spend / Purchase count |
| ROAS | Multiplier | ROAS-primary clients only - "4.88x" |
| Classification | Label | From Step 5 - leave blank for adset column |

**Do NOT include rows for** Landing Page Views, Add to Carts, Initiate
Checkouts, Purchases, or other raw volumes as separate rows. Rates make
variants comparable; volumes do not.

If ATC -> IC rates above 100% appear (the tracking artefact noted in Step 4),
add a footnote below the table explaining the quirk, e.g.:

> \* ATC -> IC over 100% is a low-count tracking quirk - {N} ATCs tracked vs
> {M} ICs, meaning people are reaching checkout without an explicit cart-add
> event. Not a real efficiency win; CPIC and CPP are the trustworthy signals.

##### Peer rates table (per market)

A native Notion table comparing concepts in the **same adset** by rates, not
absolute numbers. Normalises for different spend levels.

Default columns:
```
Concept | Landing Rate | Landing->{Mid} Rate | {Mid}->{Final} Rate | CPA
```

ROAS-primary columns:
```
Concept | Landing Rate | Landing->ATC Rate | ATC->Purchase Rate | ROAS | CPA
```

Sort rows by CPA ascending (best first) - or by ROAS descending for ROAS-primary.
Highlight the current concept with `<- this concept` suffix in its name cell.

##### Key learnings

3-4 bulleted items at the bottom of the toggle. Each learning should be
specific and actionable. Consolidate across markets - do not write separate
"UK learnings" and "US learnings" lists. If the concept wins in one market and
loses in another, the split itself is the most important learning.

Reference the rates in the tables above rather than repeating raw numbers.

#### Writing to Notion - use the internal API via Chrome

**IMPORTANT**: The Notion MCP tools (`notion-update-page`, `notion-create-comment`)
have a known serialization bug that can cause them to fail with "Expected object,
received string" on complex payloads. If they fail, fall back to the Chrome
internal API approach below.

For the typical writeup case where the existing card already has a Test
Performance callout placeholder, prefer `notion-update-page` with the
`update_content` command and small targeted operations:

1. **Surgical replacements**: Use `update_content` with `old_str` / `new_str`
   to replace specific sections one at a time. Keep each operation small
   (~10 lines max) to avoid timeouts.
2. **Verify after each batch**: Re-fetch the page to confirm the replacement
   landed cleanly. Large multi-operation calls sometimes time out partway
   through and leave the page in a half-edited state.
3. **Watch for orphaned content**: If `old_str` doesn't match the full block,
   you'll leave residual content. Always include the closing tags
   (`</details>`, `</callout>`) in the `old_str` when replacing a callout
   section.

If `notion-update-page` consistently fails, fall back to the Chrome internal
API approach using `saveTransactions`. See the prior version of this skill
for the detailed Chrome workflow (UUIDs, `listAfter`, table format reference).

### Step 9: Determine win/lose outcome (recommendation only)

After completing the analysis, determine whether the concept as a whole was
successful relative to its **adset peers** (per market). Uses the peer
comparison data from Step 7.

#### 9a. Win/lose decision logic (per market, then consolidated)

**CRITICAL**: Evaluate performance at the **variant level**, not the blended
concept level. A concept with one strong variant and several weak ones is
still valuable - the team simply scales the winning variant. The blended
concept CPA is misleading when underperforming variants drag down the average.

**How it works per market**: Take the **best-performing variant** in that
market (by recent CPA - or highest recent ROAS for ROAS-primary clients) and
compare that variant's rates against the peer concepts in the same adset.

**Two-tier classification.** Because peers are scoped to the adset, the
Win/Lose call must reflect both how the concept's best variant compares to
other concepts AND how the concept's overall delivery compares to the adset
blended average. A concept can be a variant-level Win (its best variant beats
the median peer) but a concept-level Lose (the blended concept CPA / ROAS is
materially worse than adset blended). When this split occurs, **call the
concept a LOSE and call the variant a Win separately in the Summary line.**

A concept is classified as a **WIN** (per market) if ALL of these are true:

1. **Best variant beats peers**: The best variant's CPA is lower than the
   median peer concept CPA in the window (or higher ROAS for ROAS-primary),
   AND that variant has >= 3 conversions in the window.
2. **Blended concept beats adset average**: The concept's blended CPA is below
   the adset blended CPA, or for ROAS-primary the blended concept ROAS is
   above the adset blended ROAS.
3. **Sufficient spend**: The concept has at least 5 conversions across all
   variants in the window.

A concept is classified as a **LOSE** (per market) if ANY of these are true:

1. All active variants have 0 conversions despite >= 150 in account currency total concept spend.
2. The concept's blended CPA is >= 25% above adset blended CPA (or blended
   ROAS >= 25% below adset blended ROAS for ROAS-primary) and >= 5 conversions.
3. Even the best variant's CPA is in the bottom 25% of adset peer concepts
   AND that variant has >= 5 conversions.
4. All variants are classified as "Loser", "Loser (Non-Contributing)", or
   "Fatigue / Algorithm Lag".

If the concept cannot be clearly classified, mark it as **INCONCLUSIVE**.

#### 9b. Multi-market consolidation

When the concept runs in **multiple markets**, classify each market
independently then consolidate:

- WIN in all markets -> overall WIN
- LOSE in all markets -> overall LOSE
- WIN in one market, LOSE in another -> **call out the split**:
  `🏆 Win in {market}, ❌ Lose in {other market}`
- WIN/INCONCLUSIVE or LOSE/INCONCLUSIVE -> classify per the stronger signal,
  note the inconclusive market in the Summary line

The market-split case is the most common with TouchNote (UK vs US). When you
see it, the recommendation should be to **scale the winning market and pause
or rework the losing market**, not to retire the whole concept.

#### 9c. Do NOT auto-update the Stage property

**IMPORTANT**: Do NOT automatically change the Stage property on the Notion
card. The win/lose/inconclusive recommendation from Step 9a is a suggestion
only. The team will review the analysis and decide.

Record the recommended outcome (WIN / LOSE / INCONCLUSIVE) in the output so it
can be included in the Slack review notification.

### Step 10: Send Slack review notification

After completing the analysis and writing it to Notion, send a single concise
review notification to `#team` (channel ID: `C087TGJERS5`).

#### 10a. Message format

One bullet per test, grouped under the client name in bold:

```
*{client_name}*
• {concept_name} - {Win/Lose/Inconclusive} - <notion_page_url|View>
```

For market-split results, include the split inline:

```
• {concept_name} - Win in US / Lose in UK - <url|View>
```

If reviewing tests for multiple clients in one session, combine everything
into one message, grouped by client.

No extra detail, no CPA figures, no "please review" boilerplate. The Notion
card has the full analysis.

#### 10b. Batching across multiple tests

When running creative-test-performance for multiple concepts in one session
(e.g. after a creative-test-scan), do NOT send a separate Slack message per
test. Collect all results and send one single consolidated message at the end.

#### 10c. Confirm with user before sending

Always confirm with the user before sending the Slack message. Show them the
proposed message and ask for approval.

## Classification Reference

| Classification | Trigger | What it means |
|---|---|---|
| **Best Performer** | >=5 conversions, conv rate >= peer median | Most efficient variant in this concept |
| **High Spend Performer** | >=20% spend share, has conversions | Algorithm trusts it - monitor closely |
| **Viable (Under-scaled)** | Low spend but good signals | Promising - needs more budget to prove |
| **Loser (Non-Contributing)** | >=£75 spend, 0 conversions | Spending but not converting - pause |
| **Loser (Low Post-Click)** | Low conversions, post-click rate < median | Clicks but no intent - creative or LP issue |
| **Loser (Low Mid-Funnel)** | Landing matches adset but landing -> ATC well below adset | Scroll-stop works, persuasion doesn't |
| **Fatigue / Algorithm Lag** | >=20% spend share, 0 recent conversions | Was working, now dead - rotate out |
| **Insufficient Data** | Below minimum thresholds | Too early to call - wait |

## Edge Cases

- **No conversions yet**: If the test is early and there are no conversions,
  report on the available funnel stages (landing rate, post-click rate) and
  note the test needs more time.
- **Single variant**: If only one ad matches, there's no A/B comparison to
  make. Report the absolute rates and note it's not a multi-variant test. The
  single-variant table just has `Concept | adset (total)` columns.
- **Single market**: Skip both market headers and only show one section. The
  toggle goes straight from heading to the variant + adset table.
- **Missing Notion page**: If no URL provided, ask the user for it. Don't
  guess.
- **Different conversion events**: Some clients track registrations, leads,
  app installs, initiate checkouts, or custom pixel events instead of
  purchases. Adapt the funnel column headers and calculations accordingly
  based on the client-specific tables in Step 8.
- **All variants fatigued**: If every variant has zero recent conversions but
  significant lifetime data, the entire concept may be fatigued. Flag this
  and suggest the concept needs rotation.
- **Algorithm lag**: If a variant has high recent spend but zero conversions,
  explicitly note that Meta's spend allocation is lagging behind reality.
  Do not interpret high spend as a positive signal when conversions are absent.
- **Market-split performance**: When a concept wins in one market and loses
  in another, this is a feature, not a bug. Call out the split prominently
  and recommend per-market actions (scale US, pause/rework UK, etc.).
- **Pagination misses**: If you find fewer ads than expected (e.g. the brief
  said 3 variants but you found 1), keep paginating `list_ads`. The most
  common audit failure mode is missing ads because they were on a later page.

---

## Changelog

- **2026-06-02**: Canonical output format rewrite. Per-market sections with
  single combined variant+adset-average table + per-market peer ranking.
  Removed cross-market "per-ad breakdown" tables and "Recent 7-day window"
  output sections (recent window is still used internally for winner
  determination). Strict format rules added. Multi-market consolidation
  logic in Step 9b. Pagination warning added to Step 2. Tracking artefact
  guidance for ATC -> IC > 100% in Step 4. "Loser (Low Mid-Funnel)"
  classification added.
- **2026-04-20**: Consolidated session fixes - variant comparison tables are
  now rates-only (volumes removed from funnel rows, kept only Impressions and
  Spend for context); W&B ROAS pull switched to `export_insights` at level
  ad; Ezra custom pixel events documented (`event_eatc` etc.); TouchNote
  optimisation event switched to Initiate Checkout; concept-slug parsing
  clarified to prevent merging `popup-reviews` with `popup-reviews-evergreen`.
