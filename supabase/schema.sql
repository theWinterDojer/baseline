-- Baseline MVP schema (Supabase/Postgres)

create extension if not exists "pgcrypto";

do $$ begin
  create type public.goal_privacy as enum ('private', 'public');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.goal_status as enum ('active', 'completed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.goal_model_type as enum ('count', 'time', 'milestone');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.goal_tracking_type as enum ('count', 'duration');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.goal_cadence as enum ('daily', 'weekly', 'by_deadline');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pledge_status as enum ('offered', 'accepted', 'settled', 'expired', 'cancelled');
exception when duplicate_object then null; end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.enforce_goal_update_policy()
returns trigger
language plpgsql
as $$
declare
  has_pledges boolean;
  changed_privacy boolean;
  changed_progress_rollups boolean;
  other_changes boolean;
begin
  select exists (
    select 1 from public.pledges p where p.goal_id = old.id
  ) into has_pledges;

  changed_privacy := new.privacy is distinct from old.privacy;
  changed_progress_rollups := (
    new.check_in_count is distinct from old.check_in_count
    or new.total_progress_value is distinct from old.total_progress_value
  );

  if changed_progress_rollups
    and pg_trigger_depth() = 0
    and coalesce(current_setting('baseline.allow_rollup_write', true), 'off') <> 'on'
  then
    raise exception 'Goal progress rollups are managed by check-ins.';
  end if;

  other_changes := (
    new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.start_at is distinct from old.start_at
    or new.deadline_at is distinct from old.deadline_at
    or new.model_type is distinct from old.model_type
    or new.target_value is distinct from old.target_value
    or new.target_unit is distinct from old.target_unit
    or new.goal_type is distinct from old.goal_type
    or new.cadence is distinct from old.cadence
    or new.goal_category is distinct from old.goal_category
    or new.count_unit_preset is distinct from old.count_unit_preset
    or new.cadence_target_value is distinct from old.cadence_target_value
    or new.start_snapshot_value is distinct from old.start_snapshot_value
    or new.total_target_value is distinct from old.total_target_value
    or new.milestones is distinct from old.milestones
    or new.tags is distinct from old.tags
  );

  if has_pledges then
    if changed_privacy or other_changes then
      raise exception 'Goal is locked because it has sponsorship pledges.';
    end if;
    return new;
  end if;

  if old.privacy = 'public' and new.privacy = 'public' then
    if other_changes then
      raise exception 'Public goals cannot be edited. Make it private first.';
    end if;
    return new;
  end if;

  if old.privacy = 'public' and new.privacy = 'private' then
    if other_changes then
      raise exception 'Public goals cannot be edited while making private.';
    end if;
    return new;
  end if;

  return new;
end;
$$;

create or replace function public.increment_goal_check_in_count()
returns trigger
language plpgsql
as $$
begin
  update public.goals
  set
    check_in_count = check_in_count + 1,
    total_progress_value = total_progress_value + greatest(coalesce(new.progress_value, 1), 0)
  where id = new.goal_id;
  return new;
end;
$$;

create or replace function public.decrement_goal_check_in_count()
returns trigger
language plpgsql
as $$
begin
  update public.goals
  set
    check_in_count = greatest(check_in_count - 1, 0),
    total_progress_value = greatest(
      total_progress_value - greatest(coalesce(old.progress_value, 1), 0),
      0
    )
  where id = old.goal_id;
  return old;
end;
$$;

create or replace function public.adjust_goal_check_in_progress_value()
returns trigger
language plpgsql
as $$
begin
  if new.goal_id is distinct from old.goal_id then
    return new;
  end if;

  if new.progress_value is distinct from old.progress_value then
    update public.goals
    set total_progress_value = greatest(
      total_progress_value
      + greatest(coalesce(new.progress_value, 1), 0)
      - greatest(coalesce(old.progress_value, 1), 0),
      0
    )
    where id = new.goal_id;
  end if;

  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  start_at timestamptz,
  completed_at timestamptz,
  deadline_at timestamptz not null,
  model_type public.goal_model_type not null default 'count',
  goal_type public.goal_tracking_type,
  cadence public.goal_cadence,
  goal_category text,
  count_unit_preset text,
  cadence_target_value integer,
  start_snapshot_value double precision,
  total_target_value integer,
  total_progress_value integer not null default 0,
  target_value integer,
  target_unit text,
  milestones jsonb,
  privacy public.goal_privacy not null default 'private',
  status public.goal_status not null default 'active',
  commitment_id text,
  commitment_tx_hash text,
  commitment_chain_id integer,
  commitment_created_at timestamptz,
  check_in_count integer not null default 0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_target_value_positive check (target_value is null or target_value > 0),
  constraint goals_cadence_target_value_positive check (cadence_target_value is null or cadence_target_value > 0),
  constraint goals_start_snapshot_value_positive check (start_snapshot_value is null or start_snapshot_value > 0),
  constraint goals_total_target_value_positive check (total_target_value is null or total_target_value > 0),
  constraint goals_total_progress_value_nonnegative check (total_progress_value >= 0),
  constraint goals_goal_type_matches_model_type check (
    goal_type is null
    or (goal_type = 'count' and model_type = 'count')
    or (goal_type = 'duration' and model_type = 'time')
  ),
  constraint goals_tracking_fields_consistent check (
    (
      goal_type is null
      and cadence is null
      and goal_category is null
      and count_unit_preset is null
      and cadence_target_value is null
      and total_target_value is null
    )
    or (
      goal_type is not null
      and cadence is not null
      and cadence_target_value is not null
      and total_target_value is not null
      and (
        (goal_type = 'count' and goal_category is not null and count_unit_preset is not null)
        or (goal_type = 'duration' and goal_category is null and count_unit_preset is null)
      )
    )
  )
);

alter table public.goals
  add column if not exists start_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists goal_type public.goal_tracking_type,
  add column if not exists cadence public.goal_cadence,
  add column if not exists goal_category text,
  add column if not exists count_unit_preset text,
  add column if not exists cadence_target_value integer,
  add column if not exists start_snapshot_value double precision,
  add column if not exists total_target_value integer,
  add column if not exists total_progress_value integer not null default 0,
  add column if not exists commitment_id text,
  add column if not exists commitment_tx_hash text,
  add column if not exists commitment_chain_id integer,
  add column if not exists commitment_created_at timestamptz,
  add column if not exists check_in_count integer not null default 0,
  add column if not exists tags text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_cadence_target_value_positive'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_cadence_target_value_positive
      check (cadence_target_value is null or cadence_target_value > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_goal_type_matches_model_type'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_goal_type_matches_model_type
      check (
        goal_type is null
        or (goal_type = 'count' and model_type = 'count')
        or (goal_type = 'duration' and model_type = 'time')
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_tracking_fields_consistent'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_tracking_fields_consistent
      check (
        (
          goal_type is null
          and cadence is null
          and goal_category is null
          and count_unit_preset is null
          and cadence_target_value is null
          and total_target_value is null
        )
        or (
          goal_type is not null
          and cadence is not null
          and cadence_target_value is not null
          and total_target_value is not null
          and (
            (goal_type = 'count' and goal_category is not null and count_unit_preset is not null)
            or (goal_type = 'duration' and goal_category is null and count_unit_preset is null)
          )
        )
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_start_snapshot_value_positive'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_start_snapshot_value_positive
      check (start_snapshot_value is null or start_snapshot_value > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_total_target_value_positive'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_total_target_value_positive
      check (total_target_value is null or total_target_value > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_total_progress_value_nonnegative'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_total_progress_value_nonnegative
      check (total_progress_value >= 0);
  end if;
end
$$;

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  check_in_at timestamptz not null default now(),
  note text,
  progress_value integer not null default 1,
  progress_snapshot_value double precision,
  progress_unit text,
  proof_hash text,
  image_path text,
  onchain_commitment_id text,
  onchain_tx_hash text,
  onchain_chain_id integer,
  onchain_submitted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.check_ins
  add column if not exists progress_value integer not null default 1,
  add column if not exists progress_snapshot_value double precision,
  add column if not exists progress_unit text,
  add column if not exists image_path text,
  add column if not exists onchain_commitment_id text,
  add column if not exists onchain_tx_hash text,
  add column if not exists onchain_chain_id integer,
  add column if not exists onchain_submitted_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'check_ins'
      and column_name = 'progress_snapshot_value'
      and data_type <> 'double precision'
  ) then
    alter table public.check_ins
      alter column progress_snapshot_value type double precision
      using progress_snapshot_value::double precision;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'check_ins_progress_value_positive'
      and conrelid = 'public.check_ins'::regclass
  ) then
    alter table public.check_ins
      add constraint check_ins_progress_value_positive
      check (progress_value > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'check_ins_progress_snapshot_value_nonnegative'
      and conrelid = 'public.check_ins'::regclass
  ) then
    alter table public.check_ins
      add constraint check_ins_progress_snapshot_value_nonnegative
      check (progress_snapshot_value is null or progress_snapshot_value >= 0);
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'check_ins_progress_unit_valid'
      and conrelid = 'public.check_ins'::regclass
  ) then
    alter table public.check_ins
      drop constraint check_ins_progress_unit_valid;
  end if;

  alter table public.check_ins
    add constraint check_ins_progress_unit_valid
    check (progress_unit is null or progress_unit in ('count', 'minutes', 'hours'));
end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checkin-images',
  'checkin-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.pledges (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  sponsor_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null,
  currency text not null default 'USD',
  deadline_at timestamptz not null,
  min_check_ins integer,
  status public.pledge_status not null default 'offered',
  accepted_at timestamptz,
  approval_at timestamptz,
  settled_at timestamptz,
  escrow_tx text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pledges_amount_min check (amount_cents >= 500),
  constraint pledges_min_check_ins check (min_check_ins is null or min_check_ins >= 0)
);

create table if not exists public.sponsor_criteria (
  id uuid primary key default gen_random_uuid(),
  pledge_id uuid not null references public.pledges(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  constraint sponsor_criteria_pledge_unique unique (pledge_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete cascade,
  pledge_id uuid references public.pledges(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.completion_nfts (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_id text,
  tx_hash text,
  status text not null default 'minted',
  created_at timestamptz not null default now(),
  constraint completion_nfts_goal_unique unique (goal_id)
);

create table if not exists public.discovery_rankings (
  goal_id uuid primary key references public.goals(id) on delete cascade,
  score numeric not null default 0,
  total_sponsored_cents integer not null default 0,
  recent_sponsored_cents_7d integer not null default 0,
  comment_count_7d integer not null default 0,
  verified_sponsor_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists goals_user_id_idx on public.goals(user_id);
create index if not exists goals_privacy_idx on public.goals(privacy);
create index if not exists goals_status_idx on public.goals(status);
create index if not exists goals_deadline_at_idx on public.goals(deadline_at);
create index if not exists goals_created_at_idx on public.goals(created_at);
create index if not exists goals_commitment_id_idx on public.goals(commitment_id);

create index if not exists check_ins_goal_id_idx on public.check_ins(goal_id);
create index if not exists check_ins_user_id_idx on public.check_ins(user_id);
create index if not exists check_ins_check_in_at_idx on public.check_ins(check_in_at);
create index if not exists check_ins_onchain_commitment_id_idx on public.check_ins(onchain_commitment_id);

create index if not exists pledges_goal_id_idx on public.pledges(goal_id);
create index if not exists pledges_sponsor_id_idx on public.pledges(sponsor_id);
create index if not exists pledges_status_idx on public.pledges(status);
create index if not exists pledges_deadline_at_idx on public.pledges(deadline_at);

create index if not exists sponsor_criteria_pledge_id_idx on public.sponsor_criteria(pledge_id);

create index if not exists comments_goal_id_idx on public.comments(goal_id);
create index if not exists comments_author_id_idx on public.comments(author_id);
create index if not exists comments_created_at_idx on public.comments(created_at);

create index if not exists completion_nfts_goal_id_idx on public.completion_nfts(goal_id);
create index if not exists completion_nfts_user_id_idx on public.completion_nfts(user_id);
create index if not exists completion_nfts_created_at_idx on public.completion_nfts(created_at);

create index if not exists events_recipient_id_idx on public.events(recipient_id);
create index if not exists events_actor_id_idx on public.events(actor_id);
create index if not exists events_goal_id_idx on public.events(goal_id);
create index if not exists events_pledge_id_idx on public.events(pledge_id);
create index if not exists events_created_at_idx on public.events(created_at);

create index if not exists discovery_rankings_score_idx on public.discovery_rankings(score);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_goals_updated_at on public.goals;
create trigger set_goals_updated_at
before update on public.goals
for each row execute function public.set_updated_at();

drop trigger if exists enforce_goals_update_policy on public.goals;
create trigger enforce_goals_update_policy
before update on public.goals
for each row execute function public.enforce_goal_update_policy();

drop trigger if exists set_pledges_updated_at on public.pledges;
create trigger set_pledges_updated_at
before update on public.pledges
for each row execute function public.set_updated_at();

drop trigger if exists check_ins_increment_goal_count on public.check_ins;
create trigger check_ins_increment_goal_count
after insert on public.check_ins
for each row execute function public.increment_goal_check_in_count();

drop trigger if exists check_ins_decrement_goal_count on public.check_ins;
create trigger check_ins_decrement_goal_count
after delete on public.check_ins
for each row execute function public.decrement_goal_check_in_count();

drop trigger if exists check_ins_adjust_goal_progress_value on public.check_ins;
create trigger check_ins_adjust_goal_progress_value
after update of progress_value on public.check_ins
for each row execute function public.adjust_goal_check_in_progress_value();

do $$
begin
  perform set_config('baseline.allow_rollup_write', 'on', true);

  update public.goals g
  set
    check_in_count = coalesce((
      select count(*) from public.check_ins c where c.goal_id = g.id
    ), 0),
    total_progress_value = coalesce((
      select sum(greatest(c.progress_value, 0)) from public.check_ins c where c.goal_id = g.id
    ), 0);
end
$$;
