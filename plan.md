# Campaign Outcome View — Implementation Plan

## Concept
Within the existing Performance view, individual campaigns can be assigned a specific "outcome" (e.g., app installs, mobile app registrations, purchases). When you drill into a campaign that has an outcome set, the funnel metrics, CPA chart, and scorecards adapt to focus on that outcome — rather than using the client-wide key action.

## Architecture

### 1. New DB table: `client_campaign_outcomes`
```sql
CREATE TABLE client_campaign_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  outcome_key TEXT NOT NULL,  -- e.g., 'mobile_app_registrations', 'app_installs', 'purchases'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, campaign_id)
);
```
- `outcome_key` is one of the existing `FunnelStepKey` values from `funnel-steps.ts`
- One outcome per campaign per client

### 2. New API route: `/api/campaign-outcomes/[clientId]`
- **GET**: Returns all campaign outcome mappings for a client
- **PUT**: Upsert a campaign's outcome (body: `{ campaign_id, outcome_key }`)
- **DELETE**: Remove a campaign's outcome override

### 3. Data fetching changes in `page.tsx`
- Fetch campaign outcomes alongside existing data in `Promise.all`
- Pass `campaignOutcomes` map to `ClientPerformanceView`

### 4. UI changes in `ClientPerformanceView`

#### 4a. Campaign outcome indicator in Performance Table
- Add a small outcome badge/icon next to campaign names in the table
- When a campaign has an outcome set, show a subtle tag (e.g., "App Regs" pill)
- Clicking the badge opens a small dropdown to change/set the outcome

#### 4b. Adaptive metrics on drill-down
- When the user drills into a campaign that has an outcome override:
  - The funnel metric scorecards highlight that outcome as primary
  - The CPA chart switches to cost-per-{outcome}
  - A subtle banner shows "Optimised for: {outcome label}" at the top
- When drilled into a campaign without an outcome, fall back to client-wide key_action

#### 4c. Campaign-level outcome selector
- In the drill-down breadcrumb area, add a small dropdown: "Outcome: {current}"
- Allows setting/changing the outcome for the current campaign inline
- Saves via the API route

### 5. Files to create/modify

| File | Action | Description |
|------|--------|-------------|
| `supabase-campaign-outcomes.sql` | **Create** | Migration SQL for the new table |
| `app/api/campaign-outcomes/[clientId]/route.ts` | **Create** | GET/PUT/DELETE API route |
| `app/(admin)/dashboard/clients/[id]/page.tsx` | **Modify** | Fetch campaign outcomes, pass as prop |
| `components/dashboard/client-performance-view.tsx` | **Modify** | Accept campaignOutcomes prop, adapt metrics on drill-down, add outcome selector |
| `components/tables/performance-table.tsx` | **Modify** | Show outcome badge next to campaign names |
| `lib/utils/types.ts` | **Modify** | Add `CampaignOutcome` type |

### 6. Implementation order
1. Create migration SQL + types
2. Build API route
3. Modify page.tsx to fetch + pass data
4. Add outcome badge to performance table
5. Add adaptive metrics logic on drill-down
6. Add inline outcome selector in drill-down view
