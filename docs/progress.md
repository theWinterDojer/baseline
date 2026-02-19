# Baseline Running Progress + Handoff

> Internal execution doc (`docs/progress.md` is tracked in git for persistence).
> Other `docs/*` files remain local-only by default unless explicitly unignored.
> Purpose: persistent execution board + handoff log (not session-only notes).
> Task status notation for handoffs: `[ ]` = incomplete, `[x]` = complete.

## Document Metadata
- Last updated: 2026-02-19 15:43 EST
- Owner: Baseline core team
- Current phase: Pre-P0 polish + production hardening
- Overall status: At risk until P0 release gates pass
- Canonical refs: `docs/mvp.md`, `docs/goalsystem.md`, `docs/habit-registry-contract.md`, `docs/acceptance-checklist.md`, `docs/qa-phase5-7.md`, `docs/setup.md`

## Execution Queue (P0 Critical Path, Ordered)
- [x] `CP-007` (P0): Supabase parity verification in active environments. Done when required schema/policies are verified (`completed_at`, `start_snapshot_value`, `commitment_contract_address`, check-in/progress columns, RLS) and `supabase/verify.sql` is captured.
- [x] `CP-024` (P0): Contract-ops alignment verification. Done when production contract/operator settings are verified (`setSettlementOperator`, review window, pause state expectations) and recorded with evidence.
- [x] `CP-012` (P0): Deployment/env readiness audit. Depends on: `CP-024`. Done when required env vars are verified (`CRON_SECRET`, settlement keys, relayer key, RPC), relayer gas balance is confirmed, and RPC connectivity is validated.
- [ ] `CP-001` (P0): Run wallet regression matrix (connect/sign-in/sign-out/switch, make-public, check-in anchor, sponsor offer, settlement). Depends on: none. Done when Owner/Sponsor/Visitor write paths pass or all failures are triaged with repro.
- [ ] `CP-002` (P0): Normalize wallet/tx error UX (cancel/reject/provider failures). Depends on: `CP-001` findings. Done when user-facing errors are concise, no raw provider/signature dumps leak, and layout stays stable on long errors.
- [ ] `CP-003` (P0): Mobile optimization pass (dashboard/public goal/wizard) with desktop parity checks. Depends on: none. Done when mobile spacing/tap targets/scroll ergonomics improve and desktop regression screenshots are clean.
- [ ] `CP-009` (P0): Escrow hardening queue implementation. Depends on: `CP-007`. Done when `escrow_contract_address` support, server-side completion-threshold enforcement, and on-chain/off-chain reconciliation job are landed.
- [ ] `CP-010` (P0): Scheduled automation reliability validation. Depends on: `CP-009`. Done when deployed cron routes (`discovery rebuild`, `expire overdue`, `settle overdue`) are verified with successful logs.
- [ ] `CP-011` (P0): Manual fallback endpoint/auth validation. Depends on: `CP-010`. Done when manual key-auth calls succeed for rebuild/expire/settle endpoints.
- [ ] `CP-008` (P0): Mixed-version legacy-goal reconciliation sanity check. Depends on: `CP-007`, `CP-009`. Done when legacy pre-v2 anchor behavior and safe fallback handling are validated and documented.
- [ ] `CP-004` (P0): Execute `docs/acceptance-checklist.md` end-to-end with evidence. Depends on: `CP-001`, `CP-002`, `CP-003`, `CP-007`, `CP-009`. Done when checklist is fully annotated with pass/fail evidence and unresolved defects are ticketed.
- [ ] `CP-006` (P0): Execute QA master pass (`docs/qa-phase5-7.md`) end-to-end with evidence. Depends on: `CP-004`, `CP-010`, `CP-011`, `CP-012`. Done when checklist is fully annotated with pass/fail evidence, SQL spot checks are captured, and no unowned P0/P1 defects remain.

## Required Coverage Inside CP-004 and CP-006
- [ ] Self-sponsorship is blocked in both UI and RLS.
- [ ] Goal lock rules pass (public/no-pledge/has-pledge transitions).
- [ ] Legacy off-chain `offered` acceptance path is validated where required.
- [ ] Event log coverage is validated (`goal.created`, `check_in.created`, pledge lifecycle events).
- [ ] Dashboard notification links route correctly (`/goals/:id` vs `/public/goals/:id`).

## Release Gates (Must Pass)
- [x] `RG-01`: `CP-007` complete (Supabase schema/policy parity + `verify.sql` evidence).
- [x] `RG-02`: `CP-024` + `CP-012` complete (contract-ops + env/relayer readiness verified).
- [ ] `RG-03`: `CP-001` complete (wallet/tx regression matrix with no unresolved blockers).
- [ ] `RG-04`: `CP-002` complete (wallet/tx error UX hardened).
- [ ] `RG-05`: `CP-003` complete (mobile pass complete, desktop parity verified).
- [ ] `RG-06`: `CP-009` complete (escrow hardening queue landed).
- [ ] `RG-07`: `CP-010` + `CP-011` complete (cron and manual fallback automation validated with logs/auth).
- [ ] `RG-08`: `CP-008` complete (mixed-version legacy compatibility validated).
- [ ] `RG-09`: `CP-004` complete (acceptance checklist pass with evidence).
- [ ] `RG-10`: `CP-006` complete (QA master pass with evidence and SQL spot checks).

## Blocked
- None currently.
- Rule: if blocked > 1 business day, add owner + unblock action + ETA.

## Decisions Log
| Date | Decision | Why | Impact |
|---|---|---|---|
| 2026-02-18 | Discovery default stays `Trending` | Avoid discovery-sorting churn pre-P0 | No refactor for "newest-first" now |
| 2026-02-18 | Header order is `Discover`, `Settings`, `Sign out` (wallet connected) | Clear primary nav and sponsor discovery path | Dashboard nav stabilized |
| 2026-02-18 | Strict wallet-switch behavior | Prevent stale session identity mix-ups | Wallet switch signs out stale session + routes home |
| 2026-02-18 | No auto sign-in prompt after wallet switch | Reduce confusing forced prompts | Manual SIWE from button only |
| 2026-02-18 | `Your goals` must remain owner-only | Prevent cross-context confusion | Public preview removed from owner card |
| 2026-02-18 | `Your goals` overflow uses scroll sections, not view-more expansion | Better density and predictable card height | Two compact subsections (`Recent activity`, `Goals`) |
| 2026-02-18 | Sponsorship custom amount must show minimum guidance (`$5+`) | Reduce invalid offers and ambiguity | Sponsor card UX/copy adjusted |
| 2026-02-18 | Contract upgrade compatibility handling required | Legacy anchor failures observed | Mixed-version safeguards and messaging required |

## Validation / QA Ledger
| Date | Area | Result | Evidence / note |
|---|---|---|---|
| 2026-02-19 | Deployment/env readiness audit (`CP-012`) | Pass | Ran `npm run audit:env-readiness` (`web/scripts/audit-env-readiness.mjs`) on Base mainnet: all required env vars present (`CRON_SECRET`, `DISCOVERY_REBUILD_KEY`, `PLEDGE_SETTLEMENT_KEY`, `PLEDGE_SETTLER_PRIVATE_KEY`, `BASE_RPC_URL`), RPC connectivity confirmed (`chainId=8453`, latest block `42372225`), relayer `0xea5506c310f3b4931f77c936Bc315bd117B34c37` gas balance confirmed (`0.000158128513320182 ETH`). |
| 2026-02-19 | Contract-ops alignment verification (`CP-024`) | Pass | Ran `npm run verify:contract-ops` (`web/scripts/verify-contract-ops.mjs`) against Base mainnet (chainId `8453`) for contract `0x6924DD7eeC97d2E330e6D753C63778E04a62Aa4C`: `paused=false`, `reviewWindowSeconds=604800`, relayer/operator `0xea5506c310f3b4931f77c936Bc315bd117B34c37` enabled (`settlementOperators=true`); all checks passed. |
| 2026-02-19 | Supabase schema/RLS parity verification (`CP-007`) | Pass | User-provided `supabase/verify.sql` report: `00_summary.overall = true`, `193 checks total / 193 checks passed`; required columns (`goals.completed_at`, `goals.start_snapshot_value`, `goals.commitment_contract_address`), RLS, policies, and storage checks all passed. |
| 2026-02-18 | Wallet switching strict flow | Pass | User confirmed switch flow works; manual SIWE preserved |
| 2026-02-18 | New goal contract address persistence | Pass | User confirmed `goals.commitment_contract_address` populated on new goals |
| 2026-02-18 | Legacy goal check-in on pre-v2 anchor | Known compatibility issue | Revert signature mismatch surfaced; treated as legacy compatibility scenario |
| 2026-02-18 | Dashboard owner-only data | Pass (after fix) | User confirmed public previews removed from `Your goals` |
| 2026-02-18 | Sponsor card UX cohesion | Improved | Follow-up mobile + copy QA still pending |

## Risks / Watchlist
- Wallet provider behavior can regress silently (connector persistence, cancellation surfaces).
- Legacy commitments from older contract versions can fail without compatibility-aware handling.
- Scheduler reliability and key-auth drift can break automation if not continuously validated.
- Contract/operator setting drift can silently break no-response settlement behavior.
- Supporting `docs/*` files are local-only; drift/loss risk remains unless key changes are mirrored into `docs/progress.md`.

## Post-P0 Backlog
- [ ] `CP-015` (P1): Global copy/content pass for cards/states (`minimum progress` terminology).
- [ ] `CP-016` (P1): Public goal sponsor-facing polish pass.
- [ ] `CP-017` (P1): Sponsor activity summary improvements.
- [ ] `CP-018` (P1): Description/tags scope decision + implementation (product decision).
- [ ] `CP-019` (P1): Email notification provider activation + delivery QA.
- [ ] `CP-020` (P2): Notifications UX enhancements over event log.
- [ ] `CP-021` (P2): Trend/progress visualization enhancements.
- [ ] `CP-022` (P2): Weekly reflections + templates.
- [ ] `CP-023` (P2): Completion NFT launch-scope decision (`ship` or `defer`).
- [ ] `CP-025` (P1 hardening): Add and enforce Solidity contract test gate for deployment/cutover confidence.

## Historically Completed (Newest First)
- [x] `CP-012` Deployment/env readiness audit completed (required env vars, Base RPC connectivity, relayer gas balance verified).
- [x] `CP-024` Contract-ops alignment verification completed (operator/review window/pause state verified on Base mainnet).
- [x] `CP-007` Supabase parity verification completed with `supabase/verify.sql` evidence (`193/193` checks passed).
- [x] Strict wallet/session mismatch handling implemented and validated.
- [x] Auto sign-in on wallet switch removed; SIWE is manual-only after mismatch reset.
- [x] Sign-out connector-noise path fixed; remembered-wallet reset UX removed.
- [x] Header nav finalized to `Discover`, `Settings`, `Sign out`.
- [x] `Browse public goals` removed from `Your goals` card.
- [x] `Your goals` card constrained to owner-only activity/goals.
- [x] `Your goals` overflow redesigned to two compact scrollable subsections.
- [x] Wizard category selected state aligned to tan highlight.
- [x] Public sponsor card controls/custom amount cohesion improved with `$5+` guidance.
- [x] Legacy contract compatibility path hardened for safer failure handling.
- [x] New goal `goals.commitment_contract_address` persistence verified.

## Change Log
- 2026-02-19 15:43 EST: Added env/readiness audit runner (`web/scripts/audit-env-readiness.mjs`, `npm run audit:env-readiness`) and marked `CP-012` + `RG-02` complete with RPC/relayer evidence in QA ledger.
- 2026-02-19 15:41 EST: Added contract-ops verification runner (`web/scripts/verify-contract-ops.mjs`, `npm run verify:contract-ops`) and marked `CP-024` complete with Base mainnet evidence in QA ledger.
- 2026-02-19 01:38 EST: Marked `CP-007` and `RG-01` complete; added Supabase verification evidence (`supabase/verify.sql` 193/193 pass) to QA ledger and historical completions.
- 2026-02-18 15:29 EST: Rebuilt as long-lived handoff/execution board with IDs, queue, release gates, QA ledger, decisions log, and historical completion section.
- 2026-02-19 00:56 EST: Aligned metadata/references and Phase 5-8 QA naming with current MVP cross-doc dependencies.
- 2026-02-19 00:58 EST: Simplified tracking format to checkbox tasks (`[ ]` open, `[x]` complete) and removed owner/due/success table fields.
- 2026-02-19 01:06 EST: Reprioritized into a single P0 critical path, removed duplicate priority tracking, added contract-ops alignment + required coverage checks, and split post-P0 backlog.
- 2026-02-19 01:29 EST: Updated tracking policy language to reflect git-tracked `docs/progress.md` with other docs local-only by default.

## Maintenance Rules
1. Use `Execution Queue (P0 Critical Path)` as the single source of active release work.
2. Track status with checkboxes (`[ ]` open, `[x]` complete); only mark complete after evidence is logged.
3. Never delete unfinished tasks; move them between queue, blocked, and backlog with reason.
4. Keep `Release Gates` mapped to concrete `CP-*` tasks.
5. For every completion, add at least one evidence entry in `Validation / QA Ledger`.
6. If scope/requirements change, update `docs/mvp.md`, `docs/acceptance-checklist.md`, `docs/qa-phase5-7.md`, and this file in the same pass.
7. Update `Last updated` and `Change Log` on every meaningful change.
8. Create periodic backups: `docs/currentprogress.backup-YYYY-MM-DD.md`.
