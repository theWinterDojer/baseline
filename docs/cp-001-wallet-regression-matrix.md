# CP-001 Wallet Regression Matrix (Owner / Sponsor / Visitor)

> Purpose: execute `CP-001` from `docs/progress.md` with reproducible steps and evidence.
> Run on production URL: `https://baseline-jet.vercel.app/`.

## Test Actors
- `Owner`: wallet that creates and owns goals.
- `Sponsor`: separate wallet that sponsors Owner goals.
- `Visitor`: signed-out browser session with no wallet connected.

## Shared Preconditions
- Contract/env gates already passed (`CP-007`, `CP-024`, `CP-012`).
- Use clean browser profiles or separate browsers for each actor.
- Keep DevTools console/network open and capture tx hashes + API errors.

## Matrix
| ID | Role | Flow | Steps | Expected | Evidence |
|---|---|---|---|---|---|
| WR-01 | Owner | Wallet connect + SIWE sign-in | Connect wallet, click `Sign in with wallet`, complete signature | Dashboard loads, owner identity matches connected wallet | Screenshot of signed-in header + wallet address |
| WR-02 | Owner | Sign out | Click `Sign out` in header | Session clears, routed home, owner-only views no longer accessible | Screenshot before/after sign-out |
| WR-03 | Owner | Wallet switch mismatch handling | While signed in as Owner, switch wallet in provider to non-owner wallet | App signs out stale session and routes home; no auto SIWE prompt | Screen recording or sequential screenshots |
| WR-04 | Owner | Manual re-auth after switch | After WR-03, click `Sign in with wallet` and sign with active wallet | New session binds to active wallet; owner reads/writes only for that identity | Screenshot + visible wallet address |
| WR-05 | Owner | Create private goal | Create a valid goal in wizard and save | Goal created private by default and appears in owner dashboard | Goal URL + screenshot |
| WR-06 | Owner | Make goal public (anchor) | Toggle goal privacy to public from goal detail | Wallet tx requested; goal stores commitment refs and public page loads | Base tx hash + goal row evidence (`commitment_*`) |
| WR-07 | Owner | Public check-in (anchor) | Add check-in on public goal | Wallet tx requested for anchor; check-in saved with `onchain_*` metadata | Base tx hash + check-in row evidence |
| WR-08 | Sponsor | Sponsor offer creation | Open owner public goal, create pledge (`$5+`, deadline, minimum progress) | Wallet txs (`approve` + `createPledge`) complete; pledge persists accepted with on-chain refs | 2 tx hashes + pledge row evidence |
| WR-09 | Owner + Sponsor | Sponsor settlement path | Owner marks complete after 100%; Sponsor approves settlement | `markCommitmentCompleted` and `settlePledgeBySponsor` txs succeed; pledge status/timestamps update | tx hashes + DB/event evidence |
| WR-10 | Visitor | Write-path protection | As signed-out visitor attempt comment/sponsor/check-in/create | Blocked and prompted to sign in; no unauthorized writes | Screenshot of blocked action and prompt |

## Evidence Capture (Required)
For each row:
1. Mark `Pass` / `Fail`.
2. Save tx hash(es) when applicable.
3. Save one screenshot.
4. If fail, capture exact repro steps + raw error text.

Use this template:

```text
[WR-XX] Pass|Fail
Date/time (ET):
Actor:
Goal URL:
Tx hashes:
Observed result:
Notes/errors:
```

## SQL Verification Snippets
Run after test pass to support ledger evidence:

```sql
-- Recent public-goal commitment + completion refs
select id, user_id, privacy, commitment_id, commitment_contract_address, completed_at, updated_at
from public.goals
order by updated_at desc
limit 20;

-- Recent check-ins with on-chain metadata
select id, goal_id, user_id, progress_value, onchain_commitment_id, onchain_tx_hash, onchain_submitted_at, created_at
from public.check_ins
order by created_at desc
limit 20;

-- Recent pledges with escrow + settlement metadata
select id, goal_id, sponsor_id, status, amount_cents, onchain_pledge_id, escrow_chain_id, escrow_token_address, escrow_amount_raw, settlement_tx, accepted_at, settled_at, updated_at
from public.pledges
order by updated_at desc
limit 20;

-- Self-sponsorship guard check
select p.id, p.goal_id, p.sponsor_id, g.user_id as goal_owner_id
from public.pledges p
join public.goals g on g.id = p.goal_id
where p.sponsor_id = g.user_id
order by p.created_at desc
limit 20;
```

## Exit Rule For CP-001
- `CP-001` can be checked complete only when all WR rows pass, or all failed rows are triaged with reproducible evidence and owners.
