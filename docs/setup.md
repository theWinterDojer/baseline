# Baseline Setup (Recommended Order)

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
- Toggle to public and verify public read access.
- Run `supabase/verify.sql` in the SQL editor to validate required tables, columns, triggers, policies, and storage bucket setup.
- For real-chain mode, also verify `goals.commitment_*` and `check_ins.onchain_*` fields are populated after public-goal actions.

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

## 7) Contract Interface + Mock
- Stub `HabitRegistry` ABI.
- Add a local mock for escrow/check-in calls so UI can proceed.
- Contract source is available at `contracts/HabitRegistry.sol`.
- Current deployed contract scope is commitment/check-in anchoring; pledge methods are intentionally disabled pending escrow-safe implementation.

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

## 11) Deploy HabitRegistry (Base Mainnet)
- Compile and deploy `contracts/HabitRegistry.sol`.
- Verify source on BaseScan.
- Set `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS` in `web/.env.local`.
- Restart/redeploy frontend.
- QA: make goal public and submit a public check-in; both should produce wallet tx prompts and BaseScan tx links in goal UI.
