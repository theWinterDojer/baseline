# Phase 5-8 QA Pass (Manual)

> Internal development doc (tracked in git). Do not store secrets or private keys in this file.

## Scope
This QA pass validates the completed goal-system and sponsorship/discovery work:
- Wizard create flow and edit flow alignment
- Check-in/progress behavior (including weight snapshot + duration units)
- Sponsorship lifecycle and policy guards
- Discovery filters and ranking refresh automation
- Dashboard notifications feed from `events`

## Test Setup
1. Environment
- Run against deployed Vercel production domain.
- Current production URL: `https://baseline-jet.vercel.app/`
- Confirm latest Supabase `schema.sql` and `rls.sql` are applied.

2. Accounts
- `Owner` wallet account (creates goals)
- `Sponsor` wallet account (sponsors goals)
- `Visitor` signed-out browser session

3. Required env vars on Vercel
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS`
- `DISCOVERY_REBUILD_KEY`
- `PLEDGE_SETTLEMENT_KEY`
- `CRON_SECRET`
- `PLEDGE_SETTLER_PRIVATE_KEY`
- `BASE_RPC_URL`

4. Optional env vars (email notifications)
- `RESEND_API_KEY`
- `NOTIFICATIONS_FROM_EMAIL`
- `NEXT_PUBLIC_APP_URL`

## QA Checklist
### A) Wizard Create Flow
- [ ] Create `count` goal with daily cadence and verify review summary says cumulative-to-deadline.
- [ ] Create `duration` goal with `hours` and verify target/check-ins stay in `hours`.
- [ ] Create weight snapshot goal and verify pace step asks `Current weight` + `Goal weight` on same row.
- [ ] Verify wizard Step 1 only asks for Goal title (no optional description/tag fields).
- [ ] Confirm Enter key continues wizard and only saves goal on Review step.

### B) Edit Goal Flow
- [ ] For duration goal, edit screen shows goal-specific fields only (no weight fields).
- [ ] Start date appears before deadline in edit row.
- [ ] If goal has pledges or is public, edit controls are blocked with clear messaging.
- [ ] Delete goal button is only enabled for private goals with zero pledges.

### C) Check-Ins and Progress
- [ ] Duration goal check-in label/chips match unit (`minutes` or `hours`).
- [ ] Hour check-in inserts succeed (no `check_ins_progress_unit_valid` errors).
- [ ] Weight check-ins accept decimals and update progress from start -> latest -> goal.
- [ ] Progress bars and helper text reflect saved cadence/unit math.

### D) Sponsorship Policy + Lifecycle
- [ ] On public goal, owner cannot sponsor own goal (UI blocked + insert rejected by RLS).
- [ ] Sponsor can create offer with amount, deadline, minimum progress, and optional criteria.
- [ ] New sponsorship submit path performs on-chain escrow (`approve` + `createPledge`).
- [ ] Escrow-backed pledge rows persist `escrow_contract_address` and match the active settlement contract.
- [ ] Owner marks goal complete and records on-chain completion (`markCommitmentCompleted`).
- [ ] Sponsor can approve completion; on-chain settlement (`settlePledgeBySponsor`) and DB status/timestamps update.
- [ ] No-response settlement path (`settlePledgeNoResponse`) executes via scheduled endpoint and updates DB status/timestamps.
- [ ] No-response settle path works through scheduled endpoint (`/api/pledges/settle-overdue`).

### E) Sponsorship Visibility and Language
- [ ] Public goal shows anonymous sponsor activity summary.
- [ ] Public goal shows sponsor criteria notes.
- [ ] `Verified by sponsor` badge appears after any sponsor approval.
- [ ] UI language uses `minimum progress` (not `min check-ins` wording).

### F) Discovery and Rebuild Automation
- [ ] Discovery tabs load: Trending, Top Sponsored, Near Completion, Newest.
- [ ] Discovery filters work: `Deadline window`, `Sponsored amount`.
- [ ] Manual rebuild endpoint works:
  - `POST /api/discovery/rebuild` with `x-discovery-key`.
- [ ] Cron endpoint auth works:
  - `GET /api/discovery/rebuild` with `Authorization: Bearer CRON_SECRET`.
- [ ] Confirm ranking data updates after rebuild.

### G) Event Log Coverage
- [ ] `goal.created` event exists after goal creation.
- [ ] `check_in.created` event exists after check-in.
- [ ] Sponsorship events exist:
  - `pledge.offered`
  - `pledge.accepted`
  - `pledge.approved`
  - `pledge.settled_no_response`

### H) Dashboard Notifications
- [ ] Signed-in dashboard shows `Recent activity` with latest event entries.
- [ ] Sponsorship notifications link to `/public/goals/:id`.
- [ ] Goal/check-in notifications link to `/goals/:id`.
- [ ] Timestamps render for each notification row.

### I) Sponsorship Email Notifications
- [ ] Owner account has attached email in Settings and shows `Email notifications: enabled`.
- [ ] `pledge.offered` sends an email to goal owner attached email.
- [ ] `pledge.accepted` sends an email to sponsor attached email.
- [ ] `pledge.approved` and `pledge.settled_no_response` send emails to recipient attached email.
- [ ] Email links open the expected goal page in production.
- [ ] If optional email env vars are intentionally unset, document this section as deferred.

### J) Scheduled Job Validation (Vercel Hobby)
- [ ] Confirm cron routes are present in `web/vercel.json` and deployed:
  - `0 6 * * *` -> `/api/discovery/rebuild`
  - `10 6 * * *` -> `/api/pledges/expire-overdue`
  - `20 6 * * *` -> `/api/pledges/settle-overdue`
- [ ] Reconciliation endpoint works with key auth:
  - `POST /api/pledges/reconcile` with `x-settlement-key` (or `x-discovery-key` fallback).
- [ ] Confirm Vercel logs show successful daily invocations.
- [ ] Note: hourly cadence requires Vercel Pro or external scheduler.

## SQL Spot Checks
Run in Supabase SQL editor after test run:

```sql
-- Latest sponsorship lifecycle events
select event_type, actor_id, recipient_id, goal_id, pledge_id, created_at
from public.events
where event_type in (
  'pledge.offered',
  'pledge.accepted',
  'pledge.approved',
  'pledge.settled_no_response'
)
order by created_at desc
limit 50;

-- Confirm self-sponsorship does not exist
select p.id, p.goal_id, p.sponsor_id, g.user_id as goal_owner_id
from public.pledges p
join public.goals g on g.id = p.goal_id
where p.sponsor_id = g.user_id
order by p.created_at desc
limit 20;

-- Confirm recent goals still create and load without description/tag inputs
select id, title, created_at
from public.goals
order by created_at desc
limit 20;
```

## Exit Criteria
- All checklist items pass or have a documented issue/ticket with owner and next action.
- No P0/P1 defects remain open for production rollout.
