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
  changed_status boolean;
  changed_check_in_count boolean;
  other_changes boolean;
begin
  select exists (
    select 1 from public.pledges p where p.goal_id = old.id
  ) into has_pledges;

  changed_privacy := new.privacy is distinct from old.privacy;
  changed_status := new.status is distinct from old.status;
  changed_check_in_count := new.check_in_count is distinct from old.check_in_count;

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
  set check_in_count = check_in_count + 1
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
  set check_in_count = greatest(check_in_count - 1, 0)
  where id = old.goal_id;
  return old;
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
  target_value integer,
  target_unit text,
  milestones jsonb,
  privacy public.goal_privacy not null default 'private',
  status public.goal_status not null default 'active',
  check_in_count integer not null default 0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_target_value_positive check (target_value is null or target_value > 0)
);

alter table public.goals
  add column if not exists start_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists check_in_count integer not null default 0;

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  check_in_at timestamptz not null default now(),
  note text,
  proof_hash text,
  created_at timestamptz not null default now()
);

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

create index if not exists check_ins_goal_id_idx on public.check_ins(goal_id);
create index if not exists check_ins_user_id_idx on public.check_ins(user_id);
create index if not exists check_ins_check_in_at_idx on public.check_ins(check_in_at);

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

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_goals_updated_at
before update on public.goals
for each row execute function public.set_updated_at();

create trigger enforce_goals_update_policy
before update on public.goals
for each row execute function public.enforce_goal_update_policy();

create trigger set_pledges_updated_at
before update on public.pledges
for each row execute function public.set_updated_at();

create trigger check_ins_increment_goal_count
after insert on public.check_ins
for each row execute function public.increment_goal_check_in_count();

create trigger check_ins_decrement_goal_count
after delete on public.check_ins
for each row execute function public.decrement_goal_check_in_count();

update public.goals g
set check_in_count = coalesce((
  select count(*) from public.check_ins c where c.goal_id = g.id
), 0);
