-- Baseline DB verification script
-- Run after applying supabase/schema.sql and supabase/rls.sql

-- 1) Required tables exist
with required_tables(table_name) as (
  values
    ('profiles'),
    ('goals'),
    ('check_ins'),
    ('pledges'),
    ('sponsor_criteria'),
    ('comments'),
    ('events'),
    ('completion_nfts'),
    ('discovery_rankings')
)
select
  table_name,
  to_regclass('public.' || table_name) is not null as is_present
from required_tables
order by table_name;

-- 2) Required columns exist
with required_columns(table_name, column_name) as (
  values
    ('goals', 'completed_at'),
    ('goals', 'description'),
    ('goals', 'check_in_count'),
    ('goals', 'goal_type'),
    ('goals', 'cadence'),
    ('goals', 'goal_category'),
    ('goals', 'count_unit_preset'),
    ('goals', 'cadence_target_value'),
    ('goals', 'start_snapshot_value'),
    ('goals', 'total_target_value'),
    ('goals', 'total_progress_value'),
    ('goals', 'commitment_id'),
    ('goals', 'commitment_tx_hash'),
    ('goals', 'commitment_chain_id'),
    ('goals', 'commitment_created_at'),
    ('goals', 'tags'),
    ('check_ins', 'progress_value'),
    ('check_ins', 'progress_snapshot_value'),
    ('check_ins', 'progress_unit'),
    ('check_ins', 'proof_hash'),
    ('check_ins', 'image_path'),
    ('check_ins', 'onchain_commitment_id'),
    ('check_ins', 'onchain_tx_hash'),
    ('check_ins', 'onchain_chain_id'),
    ('check_ins', 'onchain_submitted_at'),
    ('pledges', 'amount_cents'),
    ('pledges', 'min_check_ins'),
    ('events', 'event_type'),
    ('completion_nfts', 'tx_hash')
)
select
  rc.table_name,
  rc.column_name,
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = rc.table_name
      and c.column_name = rc.column_name
  ) as is_present
from required_columns rc
order by rc.table_name, rc.column_name;

-- 2b) Required column types for weight snapshot support
with required_column_types(table_name, column_name, expected_data_type) as (
  values
    ('goals', 'start_snapshot_value', 'double precision'),
    ('check_ins', 'progress_snapshot_value', 'double precision')
)
select
  rct.table_name,
  rct.column_name,
  rct.expected_data_type,
  c.data_type as actual_data_type,
  c.data_type = rct.expected_data_type as type_matches
from required_column_types rct
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = rct.table_name
 and c.column_name = rct.column_name
order by rct.table_name, rct.column_name;

-- 3) RLS enabled on core tables
select
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles',
    'goals',
    'check_ins',
    'pledges',
    'sponsor_criteria',
    'comments',
    'events',
    'completion_nfts',
    'discovery_rankings'
  )
order by tablename;

-- 4) Required triggers present
with required_triggers(table_name, trigger_name) as (
  values
    ('profiles', 'set_profiles_updated_at'),
    ('goals', 'set_goals_updated_at'),
    ('goals', 'enforce_goals_update_policy'),
    ('pledges', 'set_pledges_updated_at'),
    ('check_ins', 'check_ins_increment_goal_count'),
    ('check_ins', 'check_ins_decrement_goal_count'),
    ('check_ins', 'check_ins_adjust_goal_progress_value')
)
select
  rt.table_name,
  rt.trigger_name,
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = rt.table_name
      and t.tgname = rt.trigger_name
      and not t.tgisinternal
  ) as is_present
from required_triggers rt
order by rt.table_name, rt.trigger_name;

-- 5) Storage bucket for check-in images
select
  id,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'checkin-images';

-- 6) Required policies present
with required_policies(schemaname, tablename, policyname) as (
  values
    ('public', 'profiles', 'profiles_select_public'),
    ('public', 'profiles', 'profiles_insert_owner'),
    ('public', 'profiles', 'profiles_update_owner'),
    ('public', 'goals', 'goals_select_public_or_owner'),
    ('public', 'goals', 'goals_insert_owner'),
    ('public', 'goals', 'goals_update_owner'),
    ('public', 'goals', 'goals_delete_owner'),
    ('public', 'check_ins', 'check_ins_select_owner'),
    ('public', 'check_ins', 'check_ins_insert_owner'),
    ('public', 'check_ins', 'check_ins_update_owner'),
    ('public', 'check_ins', 'check_ins_delete_owner'),
    ('public', 'pledges', 'pledges_select_owner_or_sponsor'),
    ('public', 'pledges', 'pledges_insert_sponsor'),
    ('public', 'pledges', 'pledges_update_owner_or_sponsor'),
    ('public', 'pledges', 'pledges_delete_sponsor'),
    ('public', 'sponsor_criteria', 'sponsor_criteria_select_visible'),
    ('public', 'sponsor_criteria', 'sponsor_criteria_insert_sponsor'),
    ('public', 'sponsor_criteria', 'sponsor_criteria_update_sponsor'),
    ('public', 'sponsor_criteria', 'sponsor_criteria_delete_sponsor'),
    ('public', 'comments', 'comments_select_public_goal'),
    ('public', 'comments', 'comments_insert_public_goal'),
    ('public', 'comments', 'comments_update_owner'),
    ('public', 'comments', 'comments_delete_owner'),
    ('public', 'events', 'events_select_recipient'),
    ('public', 'events', 'events_insert_actor'),
    ('public', 'events', 'events_update_recipient'),
    ('public', 'events', 'events_delete_recipient'),
    ('public', 'completion_nfts', 'completion_nfts_select_visible'),
    ('public', 'completion_nfts', 'completion_nfts_insert_owner'),
    ('public', 'completion_nfts', 'completion_nfts_update_owner'),
    ('public', 'completion_nfts', 'completion_nfts_delete_owner'),
    ('public', 'discovery_rankings', 'discovery_rankings_select_public'),
    ('storage', 'objects', 'checkin_images_select_owner'),
    ('storage', 'objects', 'checkin_images_insert_owner'),
    ('storage', 'objects', 'checkin_images_update_owner'),
    ('storage', 'objects', 'checkin_images_delete_owner')
)
select
  rp.schemaname,
  rp.tablename,
  rp.policyname,
  exists (
    select 1
    from pg_policies p
    where p.schemaname = rp.schemaname
      and p.tablename = rp.tablename
      and p.policyname = rp.policyname
  ) as is_present
from required_policies rp
order by rp.schemaname, rp.tablename, rp.policyname;
