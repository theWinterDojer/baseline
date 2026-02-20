# Baseline Setup (Recommended Order)

> Local-only internal development doc. Do not track in git or force-add in commits.

This guide is the recommended order to get the MVP vertical slice running.

## 1) Supabase Project (Hosted Default)
- Create a new Supabase project in the dashboard.
- Record `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- Store as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (frontend app root).
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only (never expose in the client).
- Note: set Auth Site URL and Redirect URLs later once the local dev URL is known.

## 2) (Optional) Supabase CLI for Local Dev
- Install the Supabase CLI if you want local Postgres + migrations.
- Otherwise, use the hosted SQL editor for schema + RLS.

## 3) Database Schema + RLS
- Apply `supabase/schema.sql` first.
- Apply `supabase/rls.sql` second.
- This provisions `check_ins.image_path` and the private `checkin-images` storage bucket/policies used by check-in photo uploads.
- This also provisions goal commitment reference columns for upcoming public-goal on-chain anchoring.
- This also provisions check-in on-chain metadata fields (`onchain_commitment_id`, `onchain_tx_hash`, `onchain_chain_id`, `onchain_submitted_at`).
- This also provisions snapshot baseline + precision fields for weight goals (`goals.start_snapshot_value`, `check_ins.progress_snapshot_value` as double precision).
- Both scripts are re-runnable in-place (policy/trigger idempotency added for repeat applies).

## 4) Quick DB Verification
- Create a test user.
- Create a goal (private by default).
- Add a check-in for that goal (with and without an image attachment).
- For `bodyweight_logged`, verify setup captures `Current weight` + `Goal weight`, and check-ins accept decimal current-weight values.
- For duration goals, verify check-in labels/quick chips match the selected unit (`minutes` or `hours`) and that hour-based check-ins save without `check_ins_progress_unit_valid` errors.
- For daily/weekly cadence goals, verify UI copy calls out cumulative tracking to deadline (wizard review + owner/public progress surfaces).
- Toggle to public and verify public read access.
- Run `supabase/verify.sql` in the SQL editor to validate required tables, columns, triggers, policies, and storage bucket setup.
- For real-chain mode, also verify `goals.commitment_*`, `goals.commitment_contract_address`, and `check_ins.onchain_*` fields are populated after public-goal actions.
- For sponsorship escrow mode, verify `pledges.onchain_pledge_id`, `pledges.escrow_chain_id`, `pledges.escrow_token_address`, `pledges.escrow_amount_raw`, and `pledges.settlement_tx` populate as expected.
- For sponsorship escrow mode, verify `pledges.onchain_pledge_id`, `pledges.escrow_chain_id`, `pledges.escrow_contract_address`, `pledges.escrow_token_address`, `pledges.escrow_amount_raw`, and `pledges.settlement_tx` populate as expected.

## 5) Frontend Scaffold
- Create a Next.js app in `web` (PWA setup can be added after core flows).
- Wire environment variables for Supabase.
- Add `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for wallet connections (WalletConnect Cloud).
- Add `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS` from deployed `HabitRegistry` (enables real on-chain anchoring for public goals/check-ins).
- Wallet auth uses Base mainnet only.

## 6) Supabase Client
- Initialize the Supabase client in the app.
- Implement auth session handling.
- SIWE wallet auth routes rely on `SUPABASE_SERVICE_ROLE_KEY` server-side.
- Add SIWE routes: `/api/auth/siwe/nonce` and `/api/auth/siwe/verify`.
- Use Supabase Admin `generateLink` with `magiclink` for SIWE session creation.
- `verifyOtp` should use type `"magiclink"`.
- Next.js route handlers require `await cookies()` before `.set()` or `.get()`.

## 7) Contract Interface + Escrow
- Stub `HabitRegistry` ABI.
- Add a local mock for escrow/check-in calls so UI can proceed.
- Contract source is available at `contracts/HabitRegistry.sol`.
- Contract now supports Base USDC escrow with hardened v2 settlement controls:
  - `markCommitmentCompleted`
  - `settlePledgeBySponsor`
  - `settlePledgeNoResponse`
  - role-gated no-response settlement operators
  - configurable review window + pause controls
- See `docs/habit-registry-contract.md` for full contract behavior and security rationale.
- Keep mock fallback only for local/dev environments where `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS` is intentionally unset.

## 8) Vertical Slice UI
- Wallet sign-in -> create goal -> view goal -> check-in.
- Settings: attach email for recovery (wallet remains primary).

## 9) Extend to Public + Social
- Public goal page + comments.
- Sponsorship offer + acceptance.
- Settlement flow + approval window.

## 10) Discovery + Optional NFT
- Ranking cache + sponsor discovery views.
- Optional completion NFT flow.
- Daily rebuild automation on Vercel Hobby is configured in `web/vercel.json` (`0 6 * * *`).
- Discovery rebuild auth options:
  - Manual/admin: `POST /api/discovery/rebuild` with header `x-discovery-key: DISCOVERY_REBUILD_KEY`
  - Vercel cron: `GET /api/discovery/rebuild` with header `Authorization: Bearer CRON_SECRET`

## 11) Deploy HabitRegistry (Base Mainnet)
- Run contract tests covering escrow guardrails and split behavior before deployment (`self-sponsorship` blocked, on-chain completion required, sponsor-approved full payout, no-response 80/20 split, min-check-ins enforcement, operator gating).
- Compile and deploy `contracts/HabitRegistry.sol`.
- Constructor argument must be canonical Base USDC: `0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913` (unless explicitly overridden).
- Verify source on BaseScan.
- Call `setSettlementOperator(<relayer_wallet>, true)` after deployment.
- Optional: call `setReviewWindowSeconds(...)` if you need a non-default window.
- Set `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS` in `web/.env.local`.
- Set/confirm `NEXT_PUBLIC_BASE_USDC_ADDRESS` (optional override; defaults to canonical Base USDC in app).
- Restart/redeploy frontend.
- QA: make goal public and submit a public check-in; both should produce wallet tx prompts and BaseScan tx links in goal UI.
- QA: mark goal complete and confirm `markCommitmentCompleted` tx.
- QA: submit sponsorship offer and confirm `approve` + `createPledge` tx prompts, then approve settlement and confirm `settlePledgeBySponsor` tx + DB updates.
- QA: validate no-response path through scheduler/manual endpoint and confirm `settlePledgeNoResponse` tx + DB updates.

## 12) Hosting Plan (Free Now, Upgrade Later)
Current plan:
- `Vercel Hobby` for Next.js hosting
- `Supabase` free tier for Postgres/Auth/Storage
- `WalletConnect` free project for wallet sessions
- `Base` mainnet RPC via current default client configuration

Likely upgrade points (what and why):
1. Vercel (`Hobby` -> paid)
- Why: more frequent/smarter cron scheduling for discovery rebuilds, higher serverless/runtime limits, and safer production headroom.
- Trigger: discovery freshness needs more than low-frequency scheduled rebuilds, or function/runtime limits start causing failures.

2. Supabase (`Free` -> paid)
- Why: higher DB/storage/egress limits, better auth throughput, and stronger production reliability.
- Trigger: email auth rate limits/delays, storage growth from check-in images, or DB/egress limits affecting reliability.

3. Notification Email Provider (Resend/Postmark/etc)
- Why: better deliverability and control for sponsorship and lifecycle notification emails.
- Trigger: notification emails arrive late, land in spam, or provider limits block delivery.

4. WalletConnect (free quota -> paid quota)
- Why: ensure wallet connection reliability as usage grows.
- Trigger: session/connect traffic approaches free limits or users see connection failures tied to quota.

5. RPC Provider (public/default -> dedicated provider)
- Why: improve on-chain read/write reliability and latency under load.
- Trigger: intermittent RPC errors, rate limiting, or latency during commitment/check-in anchoring.

6. Scheduled Jobs (single Vercel cron -> external scheduler/worker)
- Why: more robust retries/visibility for discovery rebuild and future background jobs.
- Trigger: you need finer scheduling control, retries, or multiple recurring jobs beyond simple cron.

## 13) Vercel Deployment Guide (Hobby)
1. Create/import project
- In Vercel, import the GitHub repo.
- Set project root to `web`.
- Keep framework as Next.js (auto-detected).

2. Add production environment variables
- Required now (current production path):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
  - `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS` (required for real on-chain sponsorship path)
  - `DISCOVERY_REBUILD_KEY` (manual rebuild endpoint auth)
  - `PLEDGE_SETTLEMENT_KEY` (manual pledge job endpoint auth; fallback to `DISCOVERY_REBUILD_KEY` if omitted)
  - `CRON_SECRET` (Vercel cron auth)
  - `PLEDGE_SETTLER_PRIVATE_KEY` (server-side relayer key used by `/api/pledges/settle-overdue`)
  - `BASE_RPC_URL` (Base mainnet RPC used by settlement relayer)
- Optional now, can be set later:
  - `NEXT_PUBLIC_BASE_USDC_ADDRESS` (defaults to canonical Base USDC if omitted)
  - `RESEND_API_KEY` (notification email provider API key)
  - `NOTIFICATIONS_FROM_EMAIL` (sender identity, e.g. `Baseline <updates@yourdomain.com>`)
  - `NEXT_PUBLIC_APP_URL` (canonical app URL used in notification links; falls back to request host when omitted)

2b. Optional env vars currently deferred
- If `RESEND_API_KEY` and `NOTIFICATIONS_FROM_EMAIL` are not set, sponsorship notification emails are skipped (app behavior is otherwise unaffected).
- If `NEXT_PUBLIC_APP_URL` is not set, notification links use the request domain.
- `NEXT_PUBLIC_BASE_USDC_ADDRESS` can remain unset unless you intentionally need to override canonical Base USDC.

2a. Configure Resend sender identity
- In Resend, add and verify your sending domain (recommended) or single sender address.
- Set `NOTIFICATIONS_FROM_EMAIL` to the verified sender identity.
- If sender is not verified, sponsorship notification emails will be rejected by provider.

3. Deploy
- Trigger first production deploy from `main`.
- Confirm homepage, sign-in, and dashboard load.

4. Configure custom domain
- Add domain in Vercel project settings.
- Use the DNS records Vercel provides for apex (`@`) and `www`.
- Verify SSL is issued and active.

5. Configure Supabase Auth URLs for production
- In Supabase Auth settings, set:
  - Site URL = your production domain
  - Redirect URLs = production domain (+ preview/local as needed)
- Re-test wallet sign-in and email attach verification.

6. Validate discovery cron
- Confirm `web/vercel.json` is present in deployed branch.
- Cron route target: `GET /api/discovery/rebuild` once daily (`0 6 * * *`).
- Cron route target: `GET /api/pledges/expire-overdue` once daily (`10 6 * * *`) for offered-pledge expiration.
- Cron route target: `GET /api/pledges/settle-overdue` once daily (`20 6 * * *`) for no-response settlement processing.
- Reconciliation job endpoint is available for manual/cron validation as needed: `GET /api/pledges/reconcile` (same auth pattern as settlement endpoints).
- Vercel Hobby limitation: cron jobs are limited to daily schedules (no hourly/minutely cron on Hobby).
- If hourly pledge automation is required before upgrading to Vercel Pro, use an external scheduler to call the same authenticated endpoints.
- Ensure relayer wallet used by `PLEDGE_SETTLER_PRIVATE_KEY` has Base ETH for gas.
- If needed, trigger manual rebuild:
  - `POST /api/discovery/rebuild`
  - Header: `x-discovery-key: DISCOVERY_REBUILD_KEY`
  - `POST /api/pledges/expire-overdue`
  - Header: `x-settlement-key: PLEDGE_SETTLEMENT_KEY` (or `x-discovery-key: DISCOVERY_REBUILD_KEY` fallback)
  - `POST /api/pledges/settle-overdue`
  - Header: `x-settlement-key: PLEDGE_SETTLEMENT_KEY` (or `x-discovery-key: DISCOVERY_REBUILD_KEY` fallback)
  - `POST /api/pledges/reconcile`
  - Header: `x-settlement-key: PLEDGE_SETTLEMENT_KEY` (or `x-discovery-key: DISCOVERY_REBUILD_KEY` fallback)

7. Validate sponsorship notification emails
- Ensure recipient has an attached email in Settings.
- Trigger sponsorship events (`offered`, `accepted`, `approved`, `settled_no_response`).
- Confirm notification emails are delivered and links resolve to the deployed domain.

## 14) QA Pass Guide
- Use `docs/qa-phase5-7.md` for the full manual QA pass of the completed goal-system/sponsorship/discovery phase.
