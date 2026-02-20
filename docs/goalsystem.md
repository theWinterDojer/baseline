# Baseline Goal System (Rebuild Plan)

> Local-only internal development doc. Do not track in git or force-add in commits.

## Purpose
Define a goal system that is simple to create, unambiguous to track, and logically consistent across UI, database, check-ins, discovery, and sponsorship.

This plan replaces the current open-ended goal setup with a guided flow and strict guardrails.

## Canonical Linkage
`docs/mvp.md` is the canonical product spec. `docs/goalsystem.md` is the detailed implementation spec for goal onboarding and tracking. `docs/progress.md` tracks rollout status and sequencing. When goal-system requirements change, update all three docs together.

## Locked Product Decisions (MVP)
1. Supported goal types: `count` and `duration` only.
2. Remove `milestone` from goal creation/editing.
3. Use a step-by-step goal wizard instead of a single dense form.
4. Count unit strategy is `preset-only` with category-first selection.
5. Duration minimum target is `5 minutes` (daily/weekly goals).
6. Count quantities are integers only (no decimals in MVP).
7. No max target cap in MVP (only required/integer/>0 validation).
8. Progress must be based on logged quantity, not raw check-in count.

## Design Principles
1. Plain language first: users should not need to understand "models."
2. Every field must directly affect tracking math.
3. No ambiguous combinations (for example, duration goal without minutes logged).
4. Keep interim steps minimal; final confirmation happens in Review.
5. Defaults should be useful but never hidden assumptions.

## Core Goal Structure

### Goal Type
1. `count`: track a numeric quantity (sessions, pages, miles, reps, etc.).
2. `duration`: track time in a selected unit (`minutes` or `hours`).

### Cadence
1. `daily`: user sets a per-day target; progress is tracked as one cumulative total across the date range.
2. `weekly`: user sets a per-week target; progress is tracked as one cumulative total across the date range.
3. `by_deadline`: single total target by end date.

### Date Window
1. `start_at` is required for all new goals (default to today).
2. `deadline_at` is required.
3. `start_at <= deadline_at` must always hold.

## New Goal Creation UX (Wizard)

### Core Pattern: Single-Card Progression
1. Show one active card at a time (no dense multi-section form).
2. Each `Continue` action replaces the current card with the next card.
3. Keep one compact progress header (`Step X of 5` + progress bar) instead of a persistent step rail.
4. Disable `Continue`/`Save` until current card is valid.

### Main Card Sequence
1. Intent
2. Measurement
3. Pace
4. Timeline
5. Review

### Card 1: Intent
Prompt: "What do you want to do?"
- Field: short goal statement.
- Helper: examples are optional and lightweight.

### Card 2: Measurement (Nested Mini-Card Flow)
Prompt: "How should we measure this?"

Nested levels:
1. `type`: choose `Count` or `Duration`
2. `category` (only if `Count`): choose one category
3. `unit` (only if `Count`): choose preset unit from the selected category

Rules:
1. If `duration`, user selects `minutes` or `hours` in Pace before entering target.
2. If `count`, category is required before finishing measurement.
3. No free-text custom units in MVP.
4. Count flow does not preselect a category on entry; user must choose one explicitly.

Nested back behavior:
1. If user is in `unit`, back returns to `category`.
2. If user is in `category`, back returns to `type`.
3. If user is in `type`, back returns to previous main card (`Intent`).

### Card 3: Pace
Prompt: "How often do you want to hit this?"
- `Daily`
- `Weekly`
- `By deadline only`

Fields shown by cadence:
1. `daily`: numeric target per day
2. `weekly`: numeric target per week
3. `by_deadline`: one total target
4. duration goals allow unit toggle (`minutes` | `hours`) and persist the selected unit in `target_unit`
5. `bodyweight_logged` uses snapshot setup: one row with `Current weight` and `Goal weight`; cadence is locked to `by_deadline`
6. Daily/weekly helper copy explicitly states cumulative tracking to deadline.

### Card 4: Timeline
Prompt: "What is your time window?"
- Start date (default today, editable)
- Deadline date (required)

### Card 5: Review
Show computed summary sentence and computed totals:
- Example count/daily: "Read 20 pages per day from Mar 1 to Mar 31 (620 pages total)."
- Example duration/daily: "Read 60 minutes per day from Jan 1 to Dec 31 (21,900 minutes total)."
- Example count/by-deadline: "Run 12 miles by Apr 30."

Save disabled until all validations pass.
Goal is created only from explicit `Save goal` click on Review.

## Tracking and Progress Math

### Stored tracking values
For all goals:
1. `goal_type`: `count | duration`
2. `cadence`: `daily | weekly | by_deadline`
3. `cadence_target_value`: integer > 0
4. `count_unit`: text nullable (required when goal_type = count)
5. `total_target_value`: integer > 0 (computed at create/update)
6. `total_progress_value`: integer >= 0 (derived from check-ins)
7. `target_unit`: `minutes | hours` for duration goals (legacy compatibility column retained)

For duration goals:
1. selected unit is stored in `target_unit` (`minutes` or `hours`)
2. check-in labels/chips and list rendering use the selected unit
3. daily/weekly validation enforces minimum 5 minutes equivalent

### Occurrence math
Let `days = calendar_day_diff(start_at, deadline_at) + 1` (inclusive).

1. `daily` occurrences = `days`
2. `weekly` occurrences = `ceil(days / 7)`
3. `by_deadline` occurrences = `1`

`total_target_value`:
1. daily: `cadence_target_value * days`
2. weekly: `cadence_target_value * ceil(days / 7)`
3. by_deadline: `cadence_target_value`

Daily/weekly goals use this computed `total_target_value` as the cumulative progress target shown in UI.

### Progress math
Each check-in stores `progress_value` integer > 0.

1. count goal check-in contributes count quantity
2. duration goal check-in contributes value in the goal's selected unit (`minutes` or `hours`)

`total_progress_value = sum(progress_value for goal)`

`progress_percent = min(100, floor((total_progress_value / total_target_value) * 100))`

This replaces check-in-count-based progress for count/duration goals.

Special handling for snapshot presets:
1. `bodyweight_logged` uses snapshot tracking.
2. Goal stores `start_snapshot_value` (baseline current weight captured during setup).
3. Check-in stores `progress_snapshot_value` as current weight (decimal allowed for weight logging).
4. Current progress uses `start_snapshot_value -> latest progress_snapshot_value -> target` (not cumulative sum).

## Check-In UX Rules
1. Count goal:
- default quick action: `+1`
- optional quantity input for larger entries (for example 5 pages)
2. Duration goal:
- input label matches selected unit (`Minutes logged` or `Hours logged`)
- quick chips match unit (minutes: `15/30/45/60`; hours: `1/2/3/4`)
3. Snapshot weight goal (`bodyweight_logged`):
- input is `Current weight`
- decimal values are allowed (up to 2 places)
4. Note and image remain optional.
5. Multiple check-ins per day allowed; totals aggregate.

## Guardrails and Validation
1. Goal title required, trimmed, max length defined.
2. Start date required and must not be after deadline.
3. Cadence target must be integer > 0.
4. Duration minimum is 5 minutes for daily/weekly goals.
5. Count unit required for count goals; forbidden for duration goals.
6. Count and duration check-in values must be integers > 0.
7. Snapshot weight check-ins accept decimal values > 0 (up to 2 places).
8. No max target cap in MVP.
9. On save, show exact interpretation before confirmation.
10. Duration target input can be entered as minutes or hours in UI; selected unit is persisted and reused in check-ins.

## Category and Preset Catalog (MVP)
Top-level categories are ordered by expected popularity. Presets in each category are also ordered from common to niche.

Naming standard:
1. `snake_case` keys
2. generic, reusable metric names over overly specific variants
3. category labels in UI include emojis for fast scanning

### 1) body (`🏋️ Body`)
- `activity_sessions`
- `activity_minutes`
- `distance`
- `strength_sessions`
- `mobility_sessions`
- `sleep_hours`
- `rest_days`
- `bodyweight_logged`

### 2) mind (`🧠 Mind`)
- `focus_sessions`
- `learning_sessions`
- `pages_read`
- `creative_sessions`
- `creative_outputs`
- `journal_entries`
- `meditation_sessions`
- `ideas_captured`

### 3) work (`💼 Work`)
- `deep_work_sessions`
- `tasks_completed`
- `applications_submitted`
- `outreach_sent`
- `hours_logged`
- `projects_completed`
- `certifications_earned`

### 4) money (`💰 Money`)
- `savings_events`
- `no_spend_days`
- `debt_payments`
- `investment_events`
- `budget_reviews`
- `net_worth_updates` (optional)

### 5) relationships (`❤️ Relationships`)
- `connection_sessions`
- `calls_made`
- `events_attended`
- `acts_of_kindness`
- `date_nights`

### 6) life (`🏠 Life`)
- `chores_completed`
- `habits_completed`
- `meal_prep_days`
- `declutter_sessions`
- `reduction_days`
- `streak_days`

Consolidation rules:
1. `walk_sessions`, `run_sessions`, and `sports_sessions` collapse into `activity_sessions`.
2. `stretch_sessions` collapses into `mobility_sessions`.
3. `miles` and `distance_tracked` collapse into `distance`.
4. `pounds_lost` / `pounds_gained` are replaced by `bodyweight_logged` snapshot tracking.
5. Learning/creative sub-metrics are consolidated under `mind` using `learning_sessions`, `creative_sessions`, and `creative_outputs`.
6. Habit-reduction specific presets collapse into `reduction_days` (user-labeled behavior).

## Suggested UX Copy (replace "Model")
1. "How do you want to track progress?"
2. "Track amount" / "Track time"
3. "How often?" (Daily, Weekly, By deadline)
4. "Your target summary" (single generated sentence)
5. Use plain-language unit labels in UI (for example, `Weigh-ins` instead of `bodyweight_logged`)

## Database and API Changes
1. Goals table:
- add `goal_type`, `cadence`, `goal_category`, `count_unit_preset`, `cadence_target_value`, `total_target_value`
- add `start_snapshot_value` for snapshot baseline goals
- keep `target_value`/`target_unit` temporarily for migration compatibility
2. Check-ins table:
- add `progress_value` integer not null default 1
- add `progress_snapshot_value` optional for snapshot-based presets (`bodyweight_logged`; legacy pounds presets remain readable); use double precision for decimal weight logging
- add `progress_unit` optional (`count`, `minutes`, or `hours`) for audit clarity
3. Add DB checks enforcing valid combinations by goal type.
4. Update all writes/reads to use new fields first, fallback only during migration window.

## Compatibility and Migration
1. Existing `count` goals:
- map to `goal_type = count`
- infer `cadence = by_deadline`
- map `target_value -> cadence_target_value -> total_target_value`
2. Existing `time` goals:
- map to `goal_type = duration`
- preserve stored `target_unit` where present; default to `minutes` when missing
3. Existing `milestone` goals:
- freeze as legacy read-only tracking mode
- no new milestone creation
4. Discovery near-completion should switch to new quantitative progress values.

## Acceptance Criteria (New)
1. User can create a goal without seeing technical model jargon.
2. "Read 60 minutes every day this year" is created in under 60 seconds with no ambiguity.
3. Review step shows exact computed total target before save.
4. Check-ins capture numeric progress that matches goal type.
5. Progress bar uses summed progress values, not number of check-ins.
6. Edit flow preserves same guardrails as create flow.
7. Invalid combinations are blocked both in UI and DB constraints.
8. Snapshot goals (`bodyweight_logged`, legacy pounds presets) use latest snapshot progress correctly.
9. Daily/weekly cadence wording is explicit about cumulative tracking to deadline in create, edit, owner/public detail, and discovery surfaces.

## Rollout Plan
1. Phase 1: Schema migration + compatibility reads.
2. Phase 2: Wizard UI + category-first preset selection + new create/edit validation.
3. Phase 3: Check-in quantity capture + snapshot logic for snapshot presets.
4. Phase 4: Discovery/sponsorship progress dependency updates.
5. Phase 5: Remove legacy milestone creation paths and old UI labels.

## Wizard Visual and UX Spec (Implementation Ready)

### Visual Goals
1. Sleek and inviting while remaining low-friction.
2. One clear decision per step to remove ambiguity.
3. High readability, high tap targets, no dense form blocks.
4. Preserve existing Baseline visual language (retro palette + subtle grain/glow).
5. One active card on screen at any time.

### Information Architecture
Wizard has 5 main cards:
1. Intent
2. Measurement
3. Pace
4. Timeline
5. Review

Each card has:
1. A single prompt headline
2. One supporting line
3. Primary input area
4. Inline validation area
5. Bottom actions (`Back` + `Continue`/`Save`)

### Card Replacement Behavior
1. On `Continue`, current card exits and next card enters.
2. Only one main card is mounted as active content.
3. Previous card values are preserved in wizard state.
4. `Back` moves to previous logical level (nested measurement level first, then previous main card).

### Desktop Layout
Single centered card shell:
1. Top header: `Step X of 5` + slim progress bar
2. Active card body
3. Sticky footer actions within card

Active card content order:
1. Prompt heading
2. Helper copy
3. Inputs/choices
4. Inline errors/warnings
5. Context summary chip (when useful)
6. Sticky footer actions

### Mobile Layout
Same single-card structure as desktop:
1. `Step X of 5` label
2. Progress bar
3. Active card content
4. Sticky action row

All choice controls must be touch-friendly (min 44px height).

### Component Specification

#### 1) `GoalWizardShell`
Purpose:
- Provides shared single-card frame, progress header, and sticky action region.

Props:
1. `currentStep`
2. `steps`
3. `canContinue`
4. `onBack`
5. `onContinue`
6. `onSave`

States:
1. `idle`
2. `valid`
3. `submitting`
4. `error`

#### 2) `WizardProgressHeader`
Purpose:
- Shows compact progress (`Step X of 5`) + progress bar.

#### 3) `OptionCard`
Used for:
- measurement type (`count` vs `duration`)
- cadence choices
- category choices

Spec:
1. full-card click target
2. icon slot
3. title + one-line description
4. selected state: stronger border, subtle glow, check icon
5. keyboard focus ring visible

#### 4) `MeasurementFlowCard`
Used for:
- nested flow inside main `Measurement` card

Internal levels:
1. `type`
2. `category` (count only)
3. `unit` (count only)

Behavior:
1. `Duration` selection completes measurement card immediately.
2. `Count` selection advances to category level.
3. Category selection advances to unit level.
4. Unit selection enables continue to next main card.
5. Back button moves up one measurement level before leaving the card.

#### 5) `PresetChipPicker`
Used for:
- count unit presets within the selected category

Spec:
1. chips ordered by popularity
2. no search field in MVP unless list size becomes problematic
3. selected chip uses filled style + check mark
4. wraps cleanly across lines

#### 6) `TimelineFieldGroup`
Spec:
1. start date input (default today)
2. deadline input (required)
3. inline hint: inclusive day counting
4. error state for invalid ordering

#### 7) `ReviewSummaryPanel`
Spec:
1. generated plain-English summary sentence
2. computed total target block
3. tracking mode note (`cumulative` or `snapshot` for `bodyweight_logged` and legacy pounds presets)
4. editable anchors ("Change pace", "Change timeline")

### Step-by-Step Screen Content

#### Step 1: Intent
Prompt:
- "What do you want to do?"

UI:
1. goal title input
2. optional example chips beneath input (tap to insert template text)

Validation:
1. required
2. trimmed
3. max length

#### Step 2: Measurement
Prompt:
- "How should we measure this?"

UI:
1. level `type`: two `OptionCard`s (`Track amount`, `Track time`)
2. level `category` (count path): category cards only
3. level `unit` (count path): preset chips for selected category only
4. duration path: continue to Pace, where duration unit is selected
5. level-aware back action inside the card (`unit -> category -> type`)
6. selected unit shows plain-language helper text explaining what will be logged

Validation:
1. type required
2. category required for count
3. preset unit required for count

#### Step 3: Pace
Prompt:
- "How often do you want to hit this?"

UI:
1. cadence `OptionCard`s (`Daily`, `Weekly`, `By deadline`)
2. duration goals show `minutes`/`hours` selector before target input
3. target input with dynamic label: Daily = "Target per day", Weekly = "Target per week", By deadline = "Total target" (includes selected duration unit in label for duration goals)
4. duration input unit is preserved (`minutes` or `hours`) for persistence and check-in UX

Validation:
1. integer > 0
2. duration daily/weekly minimum 5

#### Step 4: Timeline
Prompt:
- "What is your time window?"

UI:
1. start date
2. deadline
3. computed duration preview (`365 days`, `12 weeks`, etc.)

Validation:
1. both required
2. start <= deadline

#### Step 5: Review
Prompt:
- "Review your goal"

UI:
1. summary sentence
2. total target math
3. progress mode note: standard presets use cumulative quantity; `bodyweight_logged` (and legacy pounds presets) use latest snapshot
4. final save CTA (`Save goal`) with no implicit auto-submit

### Interaction and Motion
1. Card replacement transition: slide + fade (`180-220ms`, ease-out).
2. Option cards appear with small stagger (`30-50ms`) for perceived polish.
3. Selected card/chip gets a subtle scale pop (`~1.01`) and border glow.
4. Keep motion reduced when `prefers-reduced-motion` is enabled.

### Visual Flare Plan (Locked)
1. Progress header animation:
- animate progress bar width between steps (`~220ms`, ease-out)
- brief completion pulse when entering a new step
2. Card transition animation:
- forward navigation: slight slide-in from right + fade
- backward navigation: slight slide-in from left + fade
3. Nested measurement reveal:
- `type -> category -> unit` panels animate independently inside the measurement card
- each level uses short stagger for card/chip entrance
4. Selection feedback:
- selected option cards/chips use a subtle glow ring and micro scale pop
- maintain clear selected contrast in static state after animation settles
5. Motion safety:
- `prefers-reduced-motion` switches to minimal fade/no-slide behavior
- no animation should block interaction or delay form validity feedback

### Implementation Sequence
1. Step 1: state model
- add main wizard step state + measurement sub-level state (`type/category/unit`)
- enforce level-aware `Back` behavior
2. Step 2: single-card rendering
- ensure only one active card is displayed at a time
- route measurement UI through nested sub-level renderer
3. Step 3: motion layer
- add progress bar, card transitions, staggered reveals, and selection micro-interactions
4. Step 4: accessibility + QA
- verify focus movement, reduced-motion behavior, and keyboard flow

### Implementation Status
1. Step 1 (`state model`) is implemented in `web/src/app/page.tsx` with `goalWizardStep` + `measurementLevel` and level-aware Back/Continue behavior for measurement.
2. Step 2 (`single-card rendering`) is implemented in `web/src/app/page.tsx` and `web/src/app/page.module.css` by removing the persistent step rail and using a compact progress header (`Step X of 5` + progress bar) inside a single active wizard card.
3. Step 3 (`motion layer`) is implemented in `web/src/app/page.tsx` and `web/src/app/page.module.css` with directional step transitions (forward/back), staggered option reveals, selection micro-feedback, and `prefers-reduced-motion` fallbacks.
4. Step 4 (`accessibility`) is implemented in `web/src/app/page.tsx` and `web/src/app/page.module.css` with semantic step progress (`role="progressbar"`), Enter-to-continue/save keyboard submit flow, alert/status feedback announcements, heading/error focus handoff, stronger focus-visible styling, stricter `prefers-reduced-motion` handling, and 44px minimum action tap targets. Full manual accessibility/UX QA remains in progress.

### Visual Style Tokens (Use Existing Theme)
1. Continue current Baseline palette and panel treatment.
2. Strong heading style, readable body size, generous spacing.
3. Distinct selected/focus/error states with AA contrast.
4. Inputs and cards use consistent radii and control heights.

### Empty, Error, and Loading States
1. Inline field errors directly under the affected control.
2. Non-blocking warnings for unusual but valid setups.
3. Save button loading state with disabled duplicate submit.
4. Recoverable error banner in footer area when save fails.

### Accessibility Requirements
1. Full keyboard navigation for all steps and controls.
2. ARIA labels for icon-only controls.
3. Progress header exposes current step context (`Step X of Y`).
4. Focus moves to card heading on card change.
5. Screen-reader summary includes chosen type, cadence, target, and dates.

### Engineering Notes
1. Keep wizard state local until final submit, then map to DB payload.
2. Use a single validation schema shared by create and edit flows.
3. Keep measurement flow state separate from main step state (`wizardStep`: intent/measurement/pace/timeline/review; `measurementLevel`: type/category/unit).
4. Persist choices across back/forward transitions.
5. Keep components reusable for future edit wizard.
6. Feature-flag rollout is recommended to compare old form vs wizard during QA.
7. Form submit behavior is keyboard-safe: Enter advances via `Continue` before Review and only creates a goal on Review (`Save goal`), preventing early goal creation.
8. Keep summary generation concentrated in Review to avoid extra cognitive load during earlier steps.
