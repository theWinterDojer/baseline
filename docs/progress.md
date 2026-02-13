# Baseline Progress Log

## Canonical Spec
The source of truth for requirements is `docs/mvp.md`. Update it whenever scope changes.
Setup and onboarding steps live in `docs/setup.md`.
Goal system rebuild spec and wizard UX are defined in `docs/goalsystem.md`.
When goal-system requirements change, keep `docs/mvp.md`, `docs/goalsystem.md`, and `docs/progress.md` aligned in the same update.

## Status Snapshot
- Phase: Goal system rebuild Phases 1-4 complete; Phase 5 (goal-system completion + hardening) in progress
- Last updated: 2026-02-13

## Next Suggested Steps (Ordered Execution Plan)
### Phase 5: Goal-System Completion (Current Focus)
- [x] Priority 1: Weight-loss/snapshot-goal clarity pass end-to-end (wizard copy, review copy, goal detail helper text, and check-in input hints) completed with explicit `current weight` language, side-by-side setup fields (`Current weight` + `Goal weight`), and baseline storage in `goals.start_snapshot_value`.
- [ ] Refactor post-create goal detail/edit experience to the new goal system (remove legacy model/value/unit framing; align edit UI and rules with type/cadence/category/preset targets).
- [x] Align goal detail copy for snapshot goals (`bodyweight_logged`) so weight goals are explicit and non-ambiguous (current value vs target wording).
- [ ] Finalize daily/weekly semantics decision (cumulative target vs period-compliance) and update copy/validation/docs to match.
- [ ] Complete wizard Step 4 accessibility pass (focus management, reduced-motion behavior, keyboard flow, mobile tap-target QA).
- [ ] Execute combined goal-system QA + polish pass (create/edit/check-in/progress/discovery + copy/edge cases/loading/error states).

### Phase 6: Security, Data, and Environment Parity
- [ ] Apply latest Supabase schema/RLS updates in primary and non-primary environments (including hardened `check_ins` update policy, `check_ins.image_path`, `check_ins.onchain_*`, and `checkin-images` storage policies).
- [ ] Validate hosted schema parity in all environments (`goals.completed_at`, tracking columns, check-in progress columns, and policy presence).
- [ ] Extend `supabase/verify.sql` to assert hardened `check_ins_update_owner` policy behavior, then run verification in every environment.
- [ ] Optional data cleanup: backfill legacy `goal_category` / `count_unit_preset` values to the consolidated 6-domain taxonomy for cleaner analytics.
- [ ] Post-QA refactor: extract shared auth/session hooks and repeated data-loading helpers to reduce duplication/regression risk.
- [ ] QA auth settings flow: attach email -> confirm via inbox -> auto-finalize attached email; verify remove/replace flow.
- [ ] Re-run settings email attach QA after Supabase provider cooldown (currently rate-limited).

### Phase 7: Sponsorship and Discovery Completion
- [ ] Decide self-sponsorship policy (allow vs block) and enforce in UI/RLS.
- [ ] Terminology cleanup pass for sponsorship thresholds: standardize product/UI/spec language to `minimum progress`, while keeping compatibility adapters for existing `min_check_ins` / `minCheckIns` schema-contract fields.
- [ ] Add goal description + tags inputs (create/edit) and discovery filters (tags/time window/amount).
- [ ] Display sponsor criteria, sponsor list (anonymous), and Verified by Sponsor badge (update RLS where needed).
- [ ] Add sponsor activity summaries to public goal pages.
- [ ] Add event logging coverage for sponsorship flows (offer/accept/settle).
- [ ] Add goal delete UI aligned with lock rules/RLS.
- [ ] Automate discovery ranking rebuilds (cron/triggered job).

### Phase 8: Engagement and Backlog
- [ ] Minimal in-app notifications panel reading from events.
- [ ] Notification delivery: in-app inbox + email/push for event log.
- [ ] Add trend-line progress visualization (beyond percent bar).
- [ ] Add optional weekly reflection prompts.
- [ ] Add goal templates with suggested tags.
- [ ] Add sponsor profiles (post-MVP).

## Wizard UX Refactor Tracker (Single-Card Flow)
- [x] Step 1: state model wired (`wizardStep` + `measurementLevel`) with level-aware measurement navigation (`type -> category -> unit`)
- [x] Step 2: single-card rendering cleanup (remove persistent rail; keep compact progress header only)
- [x] Step 3: motion layer (directional card transitions, progress bar animation, staggered choice reveal, selection micro-feedback)
- Step 4 (accessibility + QA) is tracked in `Next Suggested Steps -> Phase 5` to avoid duplicate open tasks.

## Day 1-3 Vertical Slice Plan
- Day 1: Acceptance checklist + Supabase schema/RLS + contract mock
- Day 2: Auth + goal create + goal detail UI
- Day 3: Check-in flow + progress summary UI

## Completed Steps
- [x] MVP spec documented in `docs/mvp.md`
- [x] Draft MVP acceptance checklist in `docs/acceptance-checklist.md`
- [x] Goal system rebuild spec documented in `docs/goalsystem.md` (wizard UX, preset catalog, and tracking rules)
- [x] Wizard UX spec revised to single-card progression with nested measurement mini-flow (`type -> category -> unit`) and level-aware back behavior
- [x] Preset catalog consolidated to 6 emoji domains (`🏋️ Body`, `🧠 Mind`, `💼 Work`, `💰 Money`, `❤️ Relationships`, `🏠 Life`) with simplified unit set and legacy label compatibility
- [x] Pace step updated for duration unit input toggle (`minutes` / `hours`) with minute-normalized storage and explicit `Save goal` click requirement on Review
- [x] Goal onboarding plain-language copy pass: simplified measurement wording and friendlier unit labels
- [x] Goal system rebuild Phase 1 implemented: new goal/check-in tracking schema fields + compatibility fallback writes/reads + verify script updates
- [x] Goal system rebuild Phase 2 implemented: dashboard create flow replaced with 5-step wizard and milestone removed from new-goal selection paths
- [x] Goal system rebuild Phase 3 implemented: goal detail check-ins now capture quantitative values + weight snapshot mode and goal/public progress displays now use quantitative fields
- [x] Goal system rebuild Phase 4 implemented: discovery now ranks near-completion by quantitative progress with tracking-column fallback; sponsorship UI now uses minimum-progress wording/units
- [x] Post-Phase 1-4 fix pass: resolved public-goal check-in lock conflict, prevented edit-time progress resets, and tightened tracking-shape DB guardrails
- [x] Discovery cleanup pass: removed duplicate weight-snapshot queries and centralized near-completion sorting on a single snapshot map fetch
- [x] Type-safety cleanup: fixed Supabase fallback query typing in discovery/dashboard loaders to prevent production `next build` TypeScript failures
- [x] RLS hardening: `check_ins` update policy now enforces goal ownership in both `USING` and `WITH CHECK`
- [x] Supabase project configured (hosted) + schema/RLS applied
- [x] Next.js app scaffolded in `web`
- [x] Wallet-first auth UI + settings email attach flow
- [x] Retro UI styling pass + tiered background motif
- [x] Event log table + basic goal/check-in event inserts (notifications-ready)
- [x] Optional start date + onboarding copy/tooltips updated
- [x] Public edit lock rules + pledge lock enforcement + UI messaging/badge
- [x] Goal lock trigger + delete policy verified in Supabase
- [x] Sponsorship offer flow UI + insert wiring
- [x] Sponsorship offer acceptance + mock escrow + offers page
- [x] Settlement + sponsor approval window (UI + lazy auto-settle)
- [x] Private goal edit UI (only while private, lock when public/pledged)
- [x] PWA skeleton (manifest, icons, service worker registration)
- [x] Completion NFT minting flow (mocked)
- [x] Discovery views (Trending, Top Sponsored, Near Completion, Newest)
- [x] Discovery relation typing normalized for Next.js build/TypeScript compatibility
- [x] Wallet session persistence fix: removed refresh-time auto sign-out race
- [x] Settings email flow upgraded to verify-before-attach (`pending_email` -> `attached_email`) with remove/replace support
- [x] SIWE verify route hardened to resolve users by `wallet_address` metadata so auth email changes do not break wallet sign-in
- [x] Goal page schema compatibility guard for environments missing `goals.completed_at`
- [x] Next.js metadata cleanup: keep `themeColor` in `viewport` export (not metadata export)
- [x] Check-in image attachments: upload/preview/persist/render flow wired in goal detail UI (with schema-compat fallback)
- [x] Supabase SQL hardening: schema/RLS scripts are re-runnable; added `supabase/verify.sql` parity checks
- [x] Added on-chain commitment reference columns on `goals` (`commitment_id`, `commitment_tx_hash`, `commitment_chain_id`, `commitment_created_at`)
- [x] Goal visibility toggle now creates/stores commitment anchor references when making public (mock HabitRegistry flow)
- [x] Public goal check-ins now auto-generate and submit/store mock on-chain proof anchors
- [x] Check-in UX improvement: public goal proof hashes are auto-generated (manual proof-hash input removed)
- [x] Real-chain write path added for commitment/check-in anchoring when `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS` is configured (otherwise mock fallback remains)
- [x] Goal detail UI now clearly labels mock anchor mode vs real Base tx links to reduce QA confusion
- [x] HabitRegistry deployed and verified on Base mainnet; `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS` configured
- [x] Real-chain QA completed: public-goal commitment + check-in txs confirmed and DB on-chain fields validated
- [x] Snapshot weight-flow update: bodyweight wizard now captures `Current weight` + `Goal weight`; baseline is saved in `goals.start_snapshot_value`; snapshot check-ins accept decimals; owner/public progress now computes from `start -> current -> goal`

## Suggested Improvements (Backlog)
- Backlog items are now tracked in `Next Suggested Steps -> Phase 8`.

## Handoff Notes
- Goals are private by default; public opt-in enables sponsorship
- Goal creation now uses a guided wizard; do not add new features on top of legacy create form assumptions
- Goal model direction is now locked to `count` + `duration` for new goals; milestone creation is removed for new-goal flow
- Count unit selection is preset-only via category-first flow; count starts with no preselected category, and unit step shows presets from the selected category only (no custom free-text units in MVP rebuild)
- Snapshot presets (`bodyweight_logged`, plus legacy pounds presets) use latest check-in snapshot progress rather than cumulative sum
- Snapshot setup for `bodyweight_logged` now captures both `Current weight` and `Goal weight` in wizard Step 3; baseline is stored in `goals.start_snapshot_value`
- Sponsor criteria is non-binding at MVP
- Sponsor approval window: 7 days
- No response: 80% to user, 20% refunded to sponsor
- Pledge tiers: $5/$10/$20/$50/$100 + custom >= $5
- Wallet sign-in required for comments and sponsorship
- Multiple sponsors allowed per goal
- Verified by Sponsor badge appears after any sponsor approval
- Settings now displays connected wallet separately from attached email
- Attached email is single-value and verification-gated; pending email is shown until confirmed
- Public goals are commitment-anchored on-chain; private goals remain off-chain
- Planned UX expansion: check-ins should support optional image attachments stored in Supabase Storage
- Current HabitRegistry deployment intentionally disables `createPledge`/`settlePledge`; sponsorship value transfer remains a follow-up contract phase

## Session Handoff (2026-02-10)
- Current state: wallet-first SIWE auth, goal creation, and check-ins working in UI
- HabitRegistry ABI stub + local mock added in `web/src/lib/contracts`
- Deployed HabitRegistry source now tracked in `contracts/HabitRegistry.sol`
- Public goals and comments live; optional start date in onboarding
- Public edit lock + pledge lock rules enforced in DB; UI messaging and badge in goal detail
- Completion NFT flow (mocked) available after goal completion
- Discovery views live at `/discover` with four tabs (Trending, Top Sponsored, Near Completion, Newest)
- Discovery cache rebuild endpoint: `POST /api/discovery/rebuild` (requires `DISCOVERY_REBUILD_KEY`)
- QA pass pending (see risks)
- Base mainnet only for wallet connections
- Supabase schema + RLS applied; Supabase Admin magiclink used for SIWE session
- Env vars required in `web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- Next.js 16 route handlers require `await cookies()` before `.set()` or `.get()`
- `generateLink` must use `magiclink`; `verifyOtp` must use `"magiclink"`
- Design: retro palette, tiered concentric circle anchored bottom-left, amber glow top-right, mint glow bottom-left, subtle grain
- Next steps: QA + polish; tackle backlog items as needed (notifications, sponsor summaries)
- Real-chain anchor mode is active when `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS` is set; goal page shows BaseScan links for real tx hashes
- Settings attach/update requests trigger Supabase email confirmation
- Settings pending value is stored as `pending_email`; on verified session it auto-finalizes to `attached_email`
- Settings remove action clears both `attached_email` and `pending_email`
- SIWE verify now finds users by `user_metadata.wallet_address` and preserves existing metadata on login
- If goal page errors on `completed_at` in any environment, run `alter table public.goals add column if not exists completed_at timestamptz;`

## Important Context
- Minimal on-chain footprint; all PII off-chain
- Single contract (no per-goal contracts)
- Optional completion NFT from a single collection contract on Base
- Weighted discovery ranking formula used for sponsor discovery
- Base mainnet only for wallet connections
- SIWE auth uses Supabase Admin magiclink + OTP verification

## Lessons Learned / Risks
- Avoid chance-based payouts (legal risk)
- Keep payouts deterministic to reduce disputes
- Optional check-ins reduce pressure/anxiety
- Next.js route handlers require `await cookies()` before calling `.set()`
- Supabase `generateLink` with `signup` requires a password; use `magiclink` for SIWE
- `verifyOtp` type must be `"magiclink"` when using magiclink OTPs
- QA pass pending; acceptance checklist not yet fully executed
- Self-sponsorship is currently allowed (decide if this should be blocked)
- Discovery rankings require manual rebuilds via `/api/discovery/rebuild`
- Goal progress logic has been migrated to quantitative progress fields; continue watching schema parity across environments
- Offer expiration and no-response settlement are lazy (page-load only) in MVP
- Hosted schema drift (missing `goals.completed_at`) can break goal page/settlement reads; verify schema parity before release
- Auth email changes can break email-keyed SIWE lookup patterns; wallet-address-keyed resolution is safer

## Visual Decisions
- Retro palette: `#75c8ae`, `#5a3d2b`, `#ffecb4`, `#e5771e`, `#f4a127`
- Tiered concentric circle anchored bottom-left so the top-right quadrant is visible
- Subtle top-right amber glow and bottom-left mint glow via `.page::before`/`.page::after`
- Light cross-grain texture using repeating linear gradients
- Button style: 38px height, rounded pill, consistent typography (weight 500)

## Open Questions
- Should completion NFTs be free to mint or gas-only?
- Do we want sponsor profiles in a later phase?
- Add dispute flow later, or keep binary approve/no-response?
