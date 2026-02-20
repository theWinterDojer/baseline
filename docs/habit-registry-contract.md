# HabitRegistry Contract (Base USDC Escrow) - Comprehensive Reference

> Contract sources: `contracts/HabitRegistry.sol`, `contracts/ReentrancyGuard.sol`  
> Current design: hardened v2 lifecycle with role-gated no-response settlement

## 1) Contract Purpose
`HabitRegistry` anchors public-goal accountability and handles USDC sponsorship escrow on Base.

It does three things:
1. Stores lightweight goal commitments (`createCommitment`).
2. Logs proof-hash check-ins for commitment owners (`checkIn`).
3. Holds and settles sponsorship escrow (`createPledge`, settlement functions).

It intentionally keeps personal/context data off-chain. Rich goal/check-in metadata remains in Supabase.

## 2) Security / Trust Model
- Token scope: one ERC-20 token only (`usdcToken`, immutable in constructor).
- Owner role: contract administration (`owner`).
- Settlement operator role: trusted backend relayer(s) allowed to execute no-response settlement path.
- Sponsor path: only pledge sponsor can approve full payout.
- No-response path: only owner/operator can execute; enforces deadline + review window + min check-ins.
- Pause switch: owner can pause all state-mutating business flows.
- Reentrancy guard: OpenZeppelin `ReentrancyGuard` protects pledge/token transfer flows.

## 3) Core Constants and Policy Values
- `BPS_DENOMINATOR = 10_000`
- `NO_RESPONSE_BENEFICIARY_BPS = 8_000` (80% beneficiary / 20% sponsor refund)
- `reviewWindowSeconds` default `7 days`, owner-configurable.
- `MAX_REVIEW_WINDOW_SECONDS = 30 days`

## 4) Data Model
### `Commitment`
- `creator`: commitment owner.
- `habitHash`: hashed goal payload anchor.
- `cadence`, `startDate`: anchor metadata.
- `checkInCount`: on-chain count of valid owner check-ins.
- `completedAt`: on-chain completion marker timestamp.
- `createdAt`, `exists`.

### `Pledge`
- `commitmentId`, `sponsor`, `beneficiary`.
- `amount` (raw USDC units), `deadline`, `minCheckIns`.
- `createdAt`, `settledAt`, `status`, `exists`.

## 5) Function-by-Function Behavior
### Admin / Controls
- `transferOwnership(address newOwner)`
  - Only owner.
  - Rejects zero address.
  - Transfers owner, auto-enables new owner as settlement operator, and revokes previous owner's settlement-operator permission.

- `setSettlementOperator(address operator, bool enabled)`
  - Only owner.
  - Grants/revokes trusted no-response settlement execution.

- `setPaused(bool nextPaused)`
  - Only owner.
  - Emergency operational stop for state-changing flows.

- `setReviewWindowSeconds(uint256 nextReviewWindowSeconds)`
  - Only owner.
  - Must be > 0 and <= 30 days.

- `recoverUnsupportedToken(address token, address to, uint256 amount)`
  - Only owner, non-reentrant.
  - Rejects zero token/to and rejects recovering configured USDC token.
  - Used only for accidental non-USDC token transfers to contract.
  - Emits `UnsupportedTokenRecovered`.

### Goal Anchoring
- `createCommitment(bytes32 habitHash, uint256 cadence, uint256 startDate)`
  - Requires non-zero `habitHash` and `cadence`.
  - Creates commitment owned by caller.

- `checkIn(uint256 commitmentId, bytes32 proofHash, uint256 timestamp)`
  - Only commitment creator.
  - Requires non-zero `proofHash` and non-zero `timestamp`.
  - Increments `checkInCount`.

- `markCommitmentCompleted(uint256 commitmentId)`
  - Only commitment creator.
  - One-time action (`completedAt` must be unset).
  - Required for both sponsor and no-response settlement paths.

### Escrow Lifecycle
- `createPledge(uint256 commitmentId, uint256 amount, uint256 deadline, uint256 minCheckIns)`
  - Requires existing, not-yet-completed commitment.
  - Blocks self-sponsorship.
  - Requires `amount > 0`, future deadline.
  - Pulls USDC from sponsor into contract via `transferFrom`.
  - Stores pledge in `Active` state.

- `settlePledgeBySponsor(uint256 pledgeId)`
  - Only pledge sponsor.
  - Requires active pledge and completed commitment.
  - Pays 100% to beneficiary.

- `settlePledgeNoResponse(uint256 pledgeId)`
  - Only owner or settlement operator.
  - Requires active pledge and completed commitment.
  - Requires `now > deadline`.
  - Requires `now > completedAt + reviewWindowSeconds`.
  - Requires `checkInCount >= minCheckIns`.
  - Pays 80% beneficiary / 20% sponsor refund.

- `settlePledge(uint256 pledgeId)` (compatibility router)
  - If caller is sponsor: routes to sponsor settlement logic.
  - Else requires owner/operator and routes to no-response logic.
  - Kept for backwards compatibility with older integration code.

## 6) Why These Decisions
- Explicit sponsor vs no-response settlement paths reduce ambiguity and accidental privilege overlap.
- On-chain `completedAt` removes reliance on off-chain completion timestamps for escrow release eligibility.
- `checkInCount` + `minCheckIns` enforcement closes prior gap where minimum progress was stored but not enforced on-chain.
- Role-gated no-response settlement prevents permissionless third-party settlement.
- Pause + operator controls support production incident response without redeploying.
- Backward-compatible `settlePledge` wrapper reduces integration breakage risk during rollout.

## 7) App Integration Mapping
- Public goal completion now calls `markCommitmentCompleted` before DB completion update.
- Sponsor approval path calls `settlePledgeBySponsor`.
- Scheduled backend no-response job calls `settlePledgeNoResponse`.
- Backend reads `reviewWindowSeconds` from contract for timing alignment.

## 8) Deployment / Cutover Checklist (v2)
1. Deploy new `HabitRegistry` with Base USDC constructor arg:
   - `0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`
2. Verify contract on BaseScan.
3. Configure roles:
   - `setSettlementOperator(<settler_wallet>, true)`
   - Optional: `setReviewWindowSeconds(...)` if not 7 days.
4. Update `NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS` in Vercel.
5. Redeploy app.
6. Run end-to-end QA (sponsor escrow, completion, sponsor settle, no-response settle).

## 9) Remaining Hardening Steps (Still Recommended)
- Add a full automated Solidity test suite (happy paths + adversarial cases) and gate deployment on passing tests.
- Consider emitting more granular settlement reason/event metadata for analytics/forensics.
- Consider a timelock/multisig owner pattern before significant TVL.
- Consider explicit per-pledge token metadata if multi-token support is ever introduced (not needed now).
- Add operational runbooks for key compromise response (`pause`, operator rotation, ownership transfer).
- Add on-chain/off-chain reconciliation job that compares DB pledge state vs contract pledge state for drift detection.
