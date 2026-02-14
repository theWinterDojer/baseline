-- Baseline MVP RLS policies

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.check_ins enable row level security;
alter table public.pledges enable row level security;
alter table public.sponsor_criteria enable row level security;
alter table public.comments enable row level security;
alter table public.events enable row level security;
alter table public.discovery_rankings enable row level security;
alter table public.completion_nfts enable row level security;

-- Idempotency for re-runs
drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles_insert_owner" on public.profiles;
drop policy if exists "profiles_update_owner" on public.profiles;

drop policy if exists "goals_select_public_or_owner" on public.goals;
drop policy if exists "goals_insert_owner" on public.goals;
drop policy if exists "goals_update_owner" on public.goals;
drop policy if exists "goals_delete_owner" on public.goals;

drop policy if exists "check_ins_select_owner" on public.check_ins;
drop policy if exists "check_ins_insert_owner" on public.check_ins;
drop policy if exists "check_ins_update_owner" on public.check_ins;
drop policy if exists "check_ins_delete_owner" on public.check_ins;

drop policy if exists "pledges_select_owner_or_sponsor" on public.pledges;
drop policy if exists "pledges_select_public_goal" on public.pledges;
drop policy if exists "pledges_insert_sponsor" on public.pledges;
drop policy if exists "pledges_update_owner_or_sponsor" on public.pledges;
drop policy if exists "pledges_delete_sponsor" on public.pledges;

drop policy if exists "sponsor_criteria_select_visible" on public.sponsor_criteria;
drop policy if exists "sponsor_criteria_insert_sponsor" on public.sponsor_criteria;
drop policy if exists "sponsor_criteria_update_sponsor" on public.sponsor_criteria;
drop policy if exists "sponsor_criteria_delete_sponsor" on public.sponsor_criteria;

drop policy if exists "comments_select_public_goal" on public.comments;
drop policy if exists "comments_insert_public_goal" on public.comments;
drop policy if exists "comments_update_owner" on public.comments;
drop policy if exists "comments_delete_owner" on public.comments;

drop policy if exists "events_select_recipient" on public.events;
drop policy if exists "events_insert_actor" on public.events;
drop policy if exists "events_update_recipient" on public.events;
drop policy if exists "events_delete_recipient" on public.events;

drop policy if exists "completion_nfts_select_visible" on public.completion_nfts;
drop policy if exists "completion_nfts_insert_owner" on public.completion_nfts;
drop policy if exists "completion_nfts_update_owner" on public.completion_nfts;
drop policy if exists "completion_nfts_delete_owner" on public.completion_nfts;

drop policy if exists "discovery_rankings_select_public" on public.discovery_rankings;

drop policy if exists "checkin_images_select_owner" on storage.objects;
drop policy if exists "checkin_images_insert_owner" on storage.objects;
drop policy if exists "checkin_images_update_owner" on storage.objects;
drop policy if exists "checkin_images_delete_owner" on storage.objects;

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
using (
  auth.uid() = user_id
  and privacy = 'private'
  and not exists (
    select 1 from public.pledges p
    where p.goal_id = id
  )
);

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
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.user_id = auth.uid()
  )
);

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

create policy "pledges_select_public_goal"
on public.pledges
for select
using (
  exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.privacy = 'public'
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

-- Events
create policy "events_select_recipient"
on public.events
for select
using (auth.uid() = recipient_id);

create policy "events_insert_actor"
on public.events
for insert
with check (auth.uid() = actor_id);

create policy "events_update_recipient"
on public.events
for update
using (auth.uid() = recipient_id)
with check (auth.uid() = recipient_id);

create policy "events_delete_recipient"
on public.events
for delete
using (auth.uid() = recipient_id);

-- Completion NFTs
create policy "completion_nfts_select_visible"
on public.completion_nfts
for select
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.privacy = 'public'
  )
);

create policy "completion_nfts_insert_owner"
on public.completion_nfts
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.user_id = auth.uid()
      and g.status = 'completed'
  )
);

create policy "completion_nfts_update_owner"
on public.completion_nfts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "completion_nfts_delete_owner"
on public.completion_nfts
for delete
using (auth.uid() = user_id);

-- Discovery rankings
create policy "discovery_rankings_select_public"
on public.discovery_rankings
for select
using (
  exists (
    select 1 from public.goals g
    where g.id = goal_id
      and g.privacy = 'public'
  )
);

-- Storage (check-in images)
create policy "checkin_images_select_owner"
on storage.objects
for select
using (
  bucket_id = 'checkin-images'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "checkin_images_insert_owner"
on storage.objects
for insert
with check (
  bucket_id = 'checkin-images'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "checkin_images_update_owner"
on storage.objects
for update
using (
  bucket_id = 'checkin-images'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'checkin-images'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "checkin_images_delete_owner"
on storage.objects
for delete
using (
  bucket_id = 'checkin-images'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);
