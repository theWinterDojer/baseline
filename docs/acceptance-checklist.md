# Baseline MVP Acceptance Checklist

> Local-only internal development doc. Do not track in git or force-add in commits.

## Create Goal
- [ ] Signed-in user can create a goal through the 5-step wizard (intent, measurement, pace, timeline, review)
- [ ] New goal creation supports `count` and `duration` only (no new milestone goals)
- [ ] Count goals require category + preset unit selection; duration goals support minutes/hours input and persist selected duration unit
- [ ] Daily/weekly cadence copy is explicit that progress is cumulative to deadline (wizard pace/review and goal detail/public/discovery surfaces)
- [ ] `bodyweight_logged` setup asks for both `Current weight` and `Goal weight` in the pace step and stores baseline start weight
- [ ] Goals are private by default
- [ ] Goal is persisted in Supabase with the correct userId
- [ ] Goal detail page renders goal type, cadence, and target accurately
- [ ] Missing required fields show inline validation errors

## Check-In
- [ ] Signed-in user can add a check-in to their own goal
- [ ] Check-in note is optional
- [ ] Check-in is stored with timestamp (proofHash is auto-generated for public-goal anchors)
- [ ] Check-in image attachment is optional and renders in recent check-ins when present
- [ ] Public goals auto-anchor check-ins on-chain and store anchor metadata
- [ ] Progress summary updates from quantitative progress values (not raw check-in count)
- [ ] Snapshot goals (`bodyweight_logged`, plus legacy pounds presets) use latest snapshot progress from check-ins
- [ ] Snapshot weight check-ins accept decimal current-weight entries
- [ ] Duration check-ins use the goal's duration unit (`minutes` or `hours`) for label, quick chips, and saved `progress_unit`
- [ ] No penalties or lockouts for missed days

## Auth (Wallet-First)
- [ ] Wallet connection is the primary sign-in method
- [ ] SIWE flow creates a Supabase session for the connected wallet
- [ ] Signed-out users cannot create goals or check-ins
- [ ] Users can attach an email in settings for recovery
- [ ] Wallet connections are restricted to Base mainnet

## Make Goal Public
- [ ] Goal owner can toggle privacy from private to public
- [ ] Public toggle creates/attaches on-chain commitment reference for the goal
- [ ] Public goal page is viewable without authentication
- [ ] Public goal page shows progress summary, comments list, and sponsor list (anonymous)
- [ ] Verified by Sponsor badge displays after any sponsor approval
- [ ] Public goals cannot be edited; if no pledges exist, owner can make private to edit/delete
- [ ] Once a pledge exists, only completion status updates are allowed

## Comments (Public Goals)
- [ ] Wallet sign-in is required to comment
- [ ] Comments are visible to all visitors on public goals
- [ ] Comment is stored with authorId, goalId, and createdAt

## Sponsorship Offer
- [ ] Sponsorship offers are only available for public goals
- [ ] Wallet sign-in is required to sponsor
- [ ] Goal owners cannot sponsor their own goals (blocked in UI and RLS)
- [ ] Pledge amount supports presets and custom values >= $5
- [ ] Sponsorship path enforces Base mainnet + Base USDC token flow
- [ ] Sponsor criteria text is stored and visible (non-binding)
- [ ] Pledge includes deadline and minimum progress fields

## Accept Sponsorship
- [ ] New sponsorship submissions create escrow on-chain (`approve` + `createPledge`) and persist on-chain pledge refs
- [ ] Escrow-backed pledges persist `escrow_contract_address` for mixed-version operations/reconciliation
- [ ] Goal owner can still accept legacy `offered` rows where needed
- [ ] Pledge status updates to `accepted` for active escrow-backed rows

## Settlement
- [ ] Goal owner can mark goal complete and record on-chain completion (`markCommitmentCompleted`)
- [ ] Sponsor can approve within a 7-day window
- [ ] Sponsor approval (`settlePledgeBySponsor`) releases 100% of escrow to the user
- [ ] No response settlement (`settlePledgeNoResponse`) after review window releases 80% to user, 20% refund to sponsor
- [ ] Settlement status and timestamps are recorded
- [ ] Scheduled endpoint (`/api/pledges/expire-overdue`) expires overdue offered pledges without page visits
- [ ] Scheduled endpoint (`/api/pledges/settle-overdue`) settles overdue no-response cases without page visits
- [ ] Manual key-authenticated triggers work as fallback for both expiration and settlement endpoints
- [ ] Reconciliation job endpoint (`/api/pledges/reconcile`) reports contract/DB drift and settlement metadata mismatches

## Discovery (Sponsor-Focused)
- [ ] Trending, Top Sponsored, Near Completion, and Newest views render
- [ ] Filters include deadline window and sponsorship amount range
- [ ] Ranking cache is generated from the weighted formula
- [ ] Near Completion uses quantitative progress fields (`total_progress_value` vs `total_target_value`)
- [ ] Daily rebuild automation runs via Vercel cron (`GET /api/discovery/rebuild` + `CRON_SECRET`)
- [ ] Manual rebuild still works (`POST /api/discovery/rebuild` + `DISCOVERY_REBUILD_KEY`)

## Completion NFT (Optional)
- [ ] Completed goals can mint a completion NFT (mocked)
- [ ] Minted NFT metadata (token id + tx hash) is stored and visible

## Notifications (Event Log)
- [ ] Goal creation writes a `goal.created` event for the owner
- [ ] Check-in writes a `check_in.created` event for the owner
- [ ] Sponsorship lifecycle writes `pledge.offered`, `pledge.accepted`, `pledge.approved`, and `pledge.settled_no_response`
