# Baseline MVP Spec

## Project Tracking
Project tracking lives in `docs/progress.md`. Whenever this spec changes, update `docs/progress.md` so both stay in sync.
Goal onboarding/tracking implementation details live in `docs/goalsystem.md`. If goal-system requirements change, update both `docs/mvp.md` and `docs/goalsystem.md` in the same change.

## Overview
Baseline is a habit and goal-oriented health app on Base that prioritizes self-betterment with optional sponsorship. Goals are private by default, and users can opt into public visibility to receive support. On-chain data is minimal (proof hashes + escrow), while all personal details remain off-chain.

Branding motto: "Invest in each other's success."

## Product Principles
- Private by default; public is opt-in
- Low pressure: check-ins are supportive, not mandatory
- Deterministic outcomes (no chance-based payouts)
- Minimal on-chain footprint; no PII on-chain
- Sponsorship is support, not betting

## Core User Flows
1. Create goal
   - User completes a guided 5-step wizard (intent -> measurement -> pace -> timeline -> review)
   - Goal types for new goals are `count` and `duration` only
   - Count goals use category-first preset unit selection (no free-text units in MVP)
   - Goal is created only from explicit `Save goal` click on the Review step
   - Goal details are editable while private
2. Check-in
   - Optional check-ins to log progress (notes optional)
   - Check-ins capture quantitative progress values (not just raw check-in count)
   - Optional image attachment stored off-chain for progress context
   - Progress shown as trend + completion percentage, not streak pressure
3. Make goal public
   - Toggle to public to receive sponsorship and comments
   - Create/attach on-chain commitment anchor for public tracking
4. Sponsorship offer
   - Sponsor proposes pledge amount + deadline + minimum progress
   - Optional criteria text (non-binding at MVP)
5. Accept sponsorship
   - User accepts offer; escrow created
6. Settlement
   - User marks goal complete; sponsor has 7 days to approve
   - Approve: 100% released to user
   - No response: 80% released to user, 20% refunded to sponsor

## Goal Onboarding and Progress System (MVP)
- User completes the wizard steps: intent, measurement, pace, timeline, review
- Supported goal types: `count` and `duration`
- Milestone creation is deprecated for new goals
- Count goals:
  - Use 6 ordered preset categories/domains (`🏋️ Body`, `🧠 Mind`, `💼 Work`, `💰 Money`, `❤️ Relationships`, `🏠 Life`) and preset unit keys from `docs/goalsystem.md`
  - Use integer quantities in MVP for standard count presets; snapshot weight check-ins allow decimals (up to 2 places)
- Duration goals:
  - Canonical unit is minutes in storage
  - Pace input supports `minutes` or `hours` in UI; values are normalized to minutes
  - Daily/weekly minimum target is 5 minutes
- Cadence options: `daily`, `weekly`, `by_deadline`
- Start date and deadline are required for new goals
- Progress for standard goals uses quantitative totals (`sum(progress_value) / total_target_value`)
- Snapshot presets (`bodyweight_logged`; legacy pounds presets) use snapshot progress:
  - Wizard captures both `Current weight` and `Goal weight` for `bodyweight_logged`
  - Current weight baseline is stored in `goals.start_snapshot_value`
  - Progress uses `start_snapshot_value -> latest progress_snapshot_value -> target`

## Sponsorship Rules (MVP)
- Public goals can receive multiple sponsors
- Pledge tiers: $5 / $10 / $20 / $50 / $100 or custom >= $5
- Sponsor criteria text is visible but non-binding
- Sponsor approval required for full payout
- 7-day sponsor review window
- If no response: 80% to user, 20% refund to sponsor
- Verified by Sponsor badge appears after any sponsor approval
- Self-sponsorship policy is TBD (currently not blocked in MVP)

## Goal Lock Rules (MVP)
- Public goals are locked: no edits or deletes while public
- If no pledges exist, the owner can make the goal private to edit or delete
- If any pledges exist, the goal cannot be made private and only completion status updates are allowed
- If all pledges are removed, the goal can be made private again and edited/deleted

## Social Features (MVP)
- Public goal page includes:
  - Progress summary
  - Comments visible to all
  - Sponsor list (anonymous at MVP)
  - Verified by Sponsor badge
- Wallet sign-in required to comment or sponsor

## Notifications (MVP Event Log)
- MVP includes a lightweight event log to support future notifications.
- Events record actor, recipient, goal/pledge references, and metadata.
- Initial event types: goal created, check-in created, sponsorship events (as those flows are added).
- Notification delivery (email/push) is deferred until after core flows stabilize.

## Auth (MVP)
- Wallet connection is the primary sign-in method (SIWE)
- Users can attach one email in settings for recovery/secondary auth
- Attached email requires verification before it becomes active
- Users can replace or remove the attached email in settings
- Wallet sign-in required for write actions (create goal, check-in, comment, sponsor)
- Base mainnet only for wallet connections
- SIWE user resolution is keyed by `wallet_address` metadata (not auth email) so auth email changes do not break wallet sign-in
- SIWE bootstrap accounts may use a wallet-derived placeholder auth email internally before a real email is attached/verified

## Discovery (Sponsor-Focused)
### Views
- Trending goals (weighted ranking)
- Top sponsored
- Near completion
- Newest public goals

### Implementation Notes (MVP)
- Trending/Top Sponsored use the cached `discovery_rankings` table and require rebuilds.
- Near completion uses quantitative progress fields (`total_progress_value` vs `total_target_value`) with snapshot support (`bodyweight_logged` and legacy pounds presets).

### Filters
- Tags (user-defined + suggested presets)
- Time window (7/30 days)
- Sponsorship amount range

### Weighted Ranking (Initial Formula)
score =
  (totalSponsored * 0.5) +
  (recentSponsoredLast7d * 0.3) +
  (commentCountLast7d * 0.15) +
  (verifiedSponsorCount * 0.05)

Weights are tunable.

## On-Chain Architecture (Base)
Single core contract (no per-goal contracts):
- HabitRegistry
  - createCommitment(habitHash, cadence, startDate)
  - checkIn(commitmentId, proofHash, timestamp)
  - createPledge(commitmentId, amount, deadline, minCheckIns)
  - settlePledge(pledgeId)

Only hashes, escrow, and timestamps are on-chain.

## On-Chain Trigger Rules (MVP)
- Private goals remain fully off-chain.
- When a goal is made public, create/attach a HabitRegistry commitment and store commitment reference data off-chain.
- Public goal check-ins auto-generate on-chain `proofHash` anchors from check-in payload; check-in note/image content remains off-chain.
- Pledge acceptance and settlement are planned on-chain value-transfer actions, but are not active in the current deployed scaffold.

## Deployment Status (2026-02-11)
- HabitRegistry is deployed and verified on Base mainnet for `createCommitment` and `checkIn`.
- Current deployed `createPledge` and `settlePledge` are intentionally disabled until escrow-safe logic is implemented and audited.

## NFT Completion (Optional)
- Users can mint a completion NFT after a goal is completed.
- All goal-completion NFTs are minted from a single collection contract on Base.
- NFT metadata includes goal title, completion window, and verification status.
- Minting is optional and user-initiated.

## Off-Chain Architecture
Supabase (Postgres + Auth + Storage):
- Goal metadata (title, description, tags, start/deadline)
- Goal tracking configuration (`goal_type`, `cadence`, category, preset unit, cadence target, snapshot baseline, total target)
- Check-in notes, comments, sponsor criteria text
- Check-in quantitative progress fields (including snapshot field for snapshot presets)
- Check-in image attachments (Supabase Storage, linked by check-in record)
- Public profile data
- Discovery rankings and caching
- Media storage for goal/check-in assets
- Auth metadata fields include `wallet_address`, `chain_id`, `attached_email`, and `pending_email`

## Schema Requirements
- `goals.completed_at` must exist in hosted Supabase environments for completion/settlement flows.
- `goals.start_snapshot_value` should exist for snapshot baseline tracking (`bodyweight_logged`).

## Data Model (Conceptual)
- Goal
  - id, userId, title, description, startAt, completedAt, deadline, goalType, cadence, goalCategory, countUnitPreset, cadenceTargetValue, startSnapshotValue, totalTargetValue, privacy, status, tags, commitmentId, commitmentTxHash, commitmentChainId, commitmentCreatedAt
- CheckIn
  - id, goalId, timestamp, note, progressValue, progressSnapshotValue, proofHash, imagePath, imageUrl, onchainCommitmentId, onchainTxHash, onchainChainId, onchainSubmittedAt
- Pledge
  - id, goalId, sponsorId, amount, deadline, minCheckIns, status, approvalTimestamp
- SponsorCriteria
  - pledgeId, text
- Comment
  - id, goalId (or checkInId), authorId, text, createdAt
- Event
  - id, eventType, actorId, recipientId, goalId, pledgeId, data, readAt, createdAt
- DiscoveryRanking
  - goalId, score, totalSponsoredCents, recentSponsoredCents7d, commentCount7d, verifiedSponsorCount, updatedAt
- CompletionNft
  - id, goalId, userId, tokenId, txHash, status, createdAt

## UX Notes
- Emphasize on-track vs missed day
- Trend line instead of strict streaks
- Optional weekly reflection prompt
- Simple, encouraging tone

## MVP Assumptions (Sponsorship)
- Sponsor approval is discretionary; criteria text is non-binding at MVP
- Minimum progress is expressed as quantitative progress/percent-to-target in the UI
- Sponsor anonymity is default (optional reveal deferred)
- Offer expiration and no-response settlement are applied lazily on page load in MVP

## Tech Stack (Defaults)
- Frontend: Next.js + PWA
- Web3: viem
- Backend: Supabase
- Chain: Base (mainnet)

## MVP Milestones (4-6 Weeks)
1. Week 1: UX flows + data model + contract interface
2. Week 2: Goal creation + progress models + check-ins
3. Week 3: Public goal page + comments + private goal edit UI
4. Week 4: Sponsorship offers + escrow logic
5. Week 5: Settlement flows + verified badge + discovery rankings
6. Week 6: NFT minting + polish + launch checklist

## Out of Scope (MVP)
- Token launch
- Advanced verification (HealthKit/Google Fit)
- Arbitration/disputes beyond approval window
