-- Baseline MVP RLS policies

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.check_ins enable row level security;
alter table public.pledges enable row level security;
alter table public.sponsor_criteria enable row level security;
alter table public.comments enable row level security;

-- Profiles
create policy "profiles_select_public"
on public.profiles
for select
using (true);

create policy "profiles_insert_owner"
on public.profiles
for insert
with check (auth.uid() = id);

create policy "profiles_update_owner"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- Goals
create policy "goals_select_public_or_owner"
on public.goals
for select
using (privacy = 'public' or auth.uid() = user_id);

create policy "goals_insert_owner"
on public.goals
for insert
with check (auth.uid() = user_id);

create policy "goals_update_owner"
on public.goals
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "goals_delete_owner"
on public.goals
for delete
using (auth.uid() = user_id);

-- Check-ins
create policy "check_ins_select_owner"
on public.check_ins
for select
using (auth.uid() = user_id);

create policy "check_ins_insert_owner"
on public.check_ins
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.user_id = auth.uid()
  )
);

create policy "check_ins_update_owner"
on public.check_ins
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "check_ins_delete_owner"
on public.check_ins
for delete
using (auth.uid() = user_id);

-- Pledges
create policy "pledges_select_owner_or_sponsor"
on public.pledges
for select
using (
  auth.uid() = sponsor_id
  or auth.uid() = (
    select g.user_id from public.goals g
    where g.id = goal_id
  )
);

create policy "pledges_insert_sponsor"
on public.pledges
for insert
with check (
  auth.uid() = sponsor_id
  and exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.privacy = 'public'
  )
);

create policy "pledges_update_owner_or_sponsor"
on public.pledges
for update
using (
  auth.uid() = sponsor_id
  or auth.uid() = (
    select g.user_id from public.goals g
    where g.id = goal_id
  )
)
with check (
  auth.uid() = sponsor_id
  or auth.uid() = (
    select g.user_id from public.goals g
    where g.id = goal_id
  )
);

create policy "pledges_delete_sponsor"
on public.pledges
for delete
using (auth.uid() = sponsor_id);

-- Sponsor criteria
create policy "sponsor_criteria_select_visible"
on public.sponsor_criteria
for select
using (
  exists (
    select 1
    from public.pledges p
    join public.goals g on g.id = p.goal_id
    where p.id = pledge_id
      and (
        g.privacy = 'public'
        or p.sponsor_id = auth.uid()
        or g.user_id = auth.uid()
      )
  )
);

create policy "sponsor_criteria_insert_sponsor"
on public.sponsor_criteria
for insert
with check (
  exists (
    select 1 from public.pledges p
    where p.id = pledge_id
      and p.sponsor_id = auth.uid()
  )
);

create policy "sponsor_criteria_update_sponsor"
on public.sponsor_criteria
for update
using (
  exists (
    select 1 from public.pledges p
    where p.id = pledge_id
      and p.sponsor_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.pledges p
    where p.id = pledge_id
      and p.sponsor_id = auth.uid()
  )
);

create policy "sponsor_criteria_delete_sponsor"
on public.sponsor_criteria
for delete
using (
  exists (
    select 1 from public.pledges p
    where p.id = pledge_id
      and p.sponsor_id = auth.uid()
  )
);

-- Comments
create policy "comments_select_public_goal"
on public.comments
for select
using (
  exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.privacy = 'public'
  )
);

create policy "comments_insert_public_goal"
on public.comments
for insert
with check (
  auth.uid() = author_id
  and exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.privacy = 'public'
  )
);

create policy "comments_update_owner"
on public.comments
for update
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

create policy "comments_delete_owner"
on public.comments
for delete
using (auth.uid() = author_id);
