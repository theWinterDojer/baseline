-- Baseline DB verification script (comprehensive, fail-fast)
-- Run after applying supabase/schema.sql and supabase/rls.sql.
-- The script raises on first failed check.

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not condition then
    raise exception 'VERIFY FAILED: %', message;
  end if;
end;
$$;

do $verify$
declare
  rec record;
  policy_using text;
  policy_check text;
  normalized_using text;
  normalized_check text;
  bucket_public boolean;
  bucket_size bigint;
  bucket_mimes text[];
  progress_unit_constraint text;
  required_bucket_mimes text[] := array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ];
begin
  -- 1) Extension check
  perform pg_temp.assert_true(
    exists (select 1 from pg_extension where extname = 'pgcrypto'),
    'Extension "pgcrypto" must exist.'
  );

  -- 2) Enum checks
  for rec in
    select * from (
      values
        ('goal_privacy'::text, array['private', 'public']::text[]),
        ('goal_status'::text, array['active', 'completed', 'archived']::text[]),
        ('goal_model_type'::text, array['count', 'time', 'milestone']::text[]),
        ('goal_tracking_type'::text, array['count', 'duration']::text[]),
        ('goal_cadence'::text, array['daily', 'weekly', 'by_deadline']::text[]),
        ('pledge_status'::text, array['offered', 'accepted', 'settled', 'expired', 'cancelled']::text[])
    ) as enum_checks(type_name, expected_labels)
  loop
    perform pg_temp.assert_true(
      coalesce(
        (
          select array_agg(e.enumlabel::text order by e.enumsortorder)
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public'
            and t.typname = rec.type_name
        ),
        '{}'::text[]
      ) = rec.expected_labels,
      format('Enum public.%I has unexpected labels.', rec.type_name)
    );
  end loop;

  -- 3) Required tables
  for rec in
    select * from (
      values
        ('public'::text, 'profiles'::text),
        ('public', 'goals'),
        ('public', 'check_ins'),
        ('public', 'pledges'),
        ('public', 'sponsor_criteria'),
        ('public', 'comments'),
        ('public', 'events'),
        ('public', 'completion_nfts'),
        ('public', 'discovery_rankings'),
        ('storage', 'buckets'),
        ('storage', 'objects')
    ) as required_tables(schema_name, table_name)
  loop
    perform pg_temp.assert_true(
      to_regclass(format('%I.%I', rec.schema_name, rec.table_name)) is not null,
      format('Table %I.%I is missing.', rec.schema_name, rec.table_name)
    );
  end loop;

  -- 4) Required columns (presence)
  for rec in
    select * from (
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
        ('pledges', 'onchain_pledge_id'),
        ('pledges', 'escrow_chain_id'),
        ('pledges', 'escrow_token_address'),
        ('pledges', 'escrow_amount_raw'),
        ('pledges', 'settlement_tx'),
        ('events', 'event_type'),
        ('events', 'data'),
        ('events', 'read_at'),
        ('completion_nfts', 'tx_hash'),
        ('discovery_rankings', 'score')
    ) as required_columns(table_name, column_name)
  loop
    perform pg_temp.assert_true(
      exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = rec.table_name
          and c.column_name = rec.column_name
      ),
      format('Column public.%I.%I is missing.', rec.table_name, rec.column_name)
    );
  end loop;

  -- 5) Critical column type checks (standard types)
  for rec in
    select * from (
      values
        ('goals', 'completed_at', 'timestamp with time zone'),
        ('goals', 'cadence_target_value', 'integer'),
        ('goals', 'start_snapshot_value', 'double precision'),
        ('goals', 'total_target_value', 'integer'),
        ('goals', 'total_progress_value', 'integer'),
        ('goals', 'check_in_count', 'integer'),
        ('check_ins', 'progress_value', 'integer'),
        ('check_ins', 'progress_snapshot_value', 'double precision'),
        ('check_ins', 'progress_unit', 'text'),
        ('check_ins', 'onchain_chain_id', 'integer'),
        ('check_ins', 'onchain_submitted_at', 'timestamp with time zone'),
        ('pledges', 'escrow_chain_id', 'integer'),
        ('pledges', 'onchain_pledge_id', 'text'),
        ('pledges', 'escrow_token_address', 'text'),
        ('pledges', 'escrow_amount_raw', 'text'),
        ('pledges', 'settlement_tx', 'text'),
        ('events', 'data', 'jsonb'),
        ('events', 'read_at', 'timestamp with time zone'),
        ('discovery_rankings', 'score', 'numeric')
    ) as type_checks(table_name, column_name, expected_data_type)
  loop
    perform pg_temp.assert_true(
      exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = rec.table_name
          and c.column_name = rec.column_name
          and c.data_type = rec.expected_data_type
      ),
      format(
        'Column public.%I.%I must be %s.',
        rec.table_name,
        rec.column_name,
        rec.expected_data_type
      )
    );
  end loop;

  -- 6) Critical enum-backed column type checks
  for rec in
    select * from (
      values
        ('goals', 'privacy', 'goal_privacy'),
        ('goals', 'status', 'goal_status'),
        ('goals', 'model_type', 'goal_model_type'),
        ('goals', 'goal_type', 'goal_tracking_type'),
        ('goals', 'cadence', 'goal_cadence'),
        ('pledges', 'status', 'pledge_status')
    ) as enum_column_checks(table_name, column_name, expected_udt_name)
  loop
    perform pg_temp.assert_true(
      exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = rec.table_name
          and c.column_name = rec.column_name
          and c.udt_schema = 'public'
          and c.udt_name = rec.expected_udt_name
      ),
      format(
        'Column public.%I.%I must use enum public.%I.',
        rec.table_name,
        rec.column_name,
        rec.expected_udt_name
      )
    );
  end loop;

  -- 7) Constraint checks
  for rec in
    select * from (
      values
        ('public.goals'::text, 'goals_target_value_positive'::text),
        ('public.goals', 'goals_cadence_target_value_positive'),
        ('public.goals', 'goals_start_snapshot_value_positive'),
        ('public.goals', 'goals_total_target_value_positive'),
        ('public.goals', 'goals_total_progress_value_nonnegative'),
        ('public.goals', 'goals_goal_type_matches_model_type'),
        ('public.goals', 'goals_tracking_fields_consistent'),
        ('public.check_ins', 'check_ins_progress_value_positive'),
        ('public.check_ins', 'check_ins_progress_snapshot_value_nonnegative'),
        ('public.check_ins', 'check_ins_progress_unit_valid'),
        ('public.pledges', 'pledges_amount_min'),
        ('public.pledges', 'pledges_min_check_ins'),
        ('public.sponsor_criteria', 'sponsor_criteria_pledge_unique'),
        ('public.completion_nfts', 'completion_nfts_goal_unique')
    ) as required_constraints(table_name, constraint_name)
  loop
    perform pg_temp.assert_true(
      exists (
        select 1
        from pg_constraint c
        where c.conrelid = to_regclass(rec.table_name)
          and c.conname = rec.constraint_name
      ),
      format('Constraint %s is missing on %s.', rec.constraint_name, rec.table_name)
    );
  end loop;

  -- Specific check: hours must be allowed in check_ins.progress_unit constraint.
  select pg_get_constraintdef(c.oid)
  into progress_unit_constraint
  from pg_constraint c
  where c.conrelid = to_regclass('public.check_ins')
    and c.conname = 'check_ins_progress_unit_valid';

  perform pg_temp.assert_true(
    progress_unit_constraint is not null
      and position('hours' in lower(progress_unit_constraint)) > 0,
    'Constraint check_ins_progress_unit_valid must include ''hours''.'
  );

  -- 8) Required functions
  for rec in
    select * from (
      values
        ('set_updated_at'::text),
        ('enforce_goal_update_policy'),
        ('increment_goal_check_in_count'),
        ('decrement_goal_check_in_count'),
        ('adjust_goal_check_in_progress_value')
    ) as required_functions(function_name)
  loop
    perform pg_temp.assert_true(
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = rec.function_name
      ),
      format('Function public.%I is missing.', rec.function_name)
    );
  end loop;

  -- 9) Required triggers (and expected trigger function binding)
  for rec in
    select * from (
      values
        ('profiles'::text, 'set_profiles_updated_at'::text, 'set_updated_at'::text),
        ('goals', 'set_goals_updated_at', 'set_updated_at'),
        ('goals', 'enforce_goals_update_policy', 'enforce_goal_update_policy'),
        ('pledges', 'set_pledges_updated_at', 'set_updated_at'),
        ('check_ins', 'check_ins_increment_goal_count', 'increment_goal_check_in_count'),
        ('check_ins', 'check_ins_decrement_goal_count', 'decrement_goal_check_in_count'),
        ('check_ins', 'check_ins_adjust_goal_progress_value', 'adjust_goal_check_in_progress_value')
    ) as trigger_checks(table_name, trigger_name, function_name)
  loop
    perform pg_temp.assert_true(
      exists (
        select 1
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_proc p on p.oid = t.tgfoid
        join pg_namespace pn on pn.oid = p.pronamespace
        where n.nspname = 'public'
          and c.relname = rec.table_name
          and t.tgname = rec.trigger_name
          and not t.tgisinternal
          and pn.nspname = 'public'
          and p.proname = rec.function_name
      ),
      format(
        'Trigger public.%I on %I is missing or not bound to public.%I.',
        rec.trigger_name,
        rec.table_name,
        rec.function_name
      )
    );
  end loop;

  -- 10) Required indexes
  for rec in
    select * from (
      values
        ('public.goals_user_id_idx'::text),
        ('public.goals_privacy_idx'),
        ('public.goals_status_idx'),
        ('public.goals_deadline_at_idx'),
        ('public.goals_created_at_idx'),
        ('public.goals_commitment_id_idx'),
        ('public.check_ins_goal_id_idx'),
        ('public.check_ins_user_id_idx'),
        ('public.check_ins_check_in_at_idx'),
        ('public.check_ins_onchain_commitment_id_idx'),
        ('public.pledges_goal_id_idx'),
        ('public.pledges_sponsor_id_idx'),
        ('public.pledges_status_idx'),
        ('public.pledges_deadline_at_idx'),
        ('public.pledges_onchain_pledge_id_idx'),
        ('public.sponsor_criteria_pledge_id_idx'),
        ('public.comments_goal_id_idx'),
        ('public.comments_author_id_idx'),
        ('public.comments_created_at_idx'),
        ('public.completion_nfts_goal_id_idx'),
        ('public.completion_nfts_user_id_idx'),
        ('public.completion_nfts_created_at_idx'),
        ('public.events_recipient_id_idx'),
        ('public.events_actor_id_idx'),
        ('public.events_goal_id_idx'),
        ('public.events_pledge_id_idx'),
        ('public.events_created_at_idx'),
        ('public.discovery_rankings_score_idx')
    ) as required_indexes(index_name)
  loop
    perform pg_temp.assert_true(
      to_regclass(rec.index_name) is not null,
      format('Index %s is missing.', rec.index_name)
    );
  end loop;

  -- 11) RLS enabled checks
  for rec in
    select * from (
      values
        ('public'::text, 'profiles'::text),
        ('public', 'goals'),
        ('public', 'check_ins'),
        ('public', 'pledges'),
        ('public', 'sponsor_criteria'),
        ('public', 'comments'),
        ('public', 'events'),
        ('public', 'completion_nfts'),
        ('public', 'discovery_rankings'),
        ('storage', 'objects')
    ) as rls_tables(schema_name, table_name)
  loop
    perform pg_temp.assert_true(
      exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = rec.schema_name
          and c.relname = rec.table_name
          and c.relrowsecurity
      ),
      format('RLS is not enabled for %I.%I.', rec.schema_name, rec.table_name)
    );
  end loop;

  -- 12) Required policy presence
  for rec in
    select * from (
      values
        ('public'::text, 'profiles'::text, 'profiles_select_public'::text),
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
        ('public', 'pledges', 'pledges_select_public_goal'),
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
    ) as required_policies(schema_name, table_name, policy_name)
  loop
    perform pg_temp.assert_true(
      exists (
        select 1
        from pg_policies p
        where p.schemaname = rec.schema_name
          and p.tablename = rec.table_name
          and p.policyname = rec.policy_name
      ),
      format(
        'Policy %I on %I.%I is missing.',
        rec.policy_name,
        rec.schema_name,
        rec.table_name
      )
    );
  end loop;

  -- 13) Hardened behavior check: check_ins_update_owner must enforce owner-goal checks
  select coalesce(p.qual, ''), coalesce(p.with_check, '')
  into policy_using, policy_check
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'check_ins'
    and p.policyname = 'check_ins_update_owner';

  normalized_using := translate(lower(policy_using), E' \n\t\r"', '');
  normalized_check := translate(lower(policy_check), E' \n\t\r"', '');

  perform pg_temp.assert_true(
    strpos(normalized_using, 'auth.uid()=user_id') > 0,
    'check_ins_update_owner USING must enforce auth.uid() = user_id.'
  );
  perform pg_temp.assert_true(
    strpos(normalized_using, 'g.user_id=auth.uid()') > 0 and strpos(normalized_using, 'exists(') > 0,
    'check_ins_update_owner USING must enforce goal ownership via EXISTS.'
  );
  perform pg_temp.assert_true(
    strpos(normalized_check, 'auth.uid()=user_id') > 0,
    'check_ins_update_owner WITH CHECK must enforce auth.uid() = user_id.'
  );
  perform pg_temp.assert_true(
    strpos(normalized_check, 'g.user_id=auth.uid()') > 0 and strpos(normalized_check, 'exists(') > 0,
    'check_ins_update_owner WITH CHECK must enforce goal ownership via EXISTS.'
  );

  -- 14) Storage bucket checks
  select b.public, b.file_size_limit, b.allowed_mime_types
  into bucket_public, bucket_size, bucket_mimes
  from storage.buckets b
  where b.id = 'checkin-images';

  perform pg_temp.assert_true(
    found,
    'Storage bucket checkin-images is missing.'
  );
  perform pg_temp.assert_true(
    bucket_public = false,
    'Storage bucket checkin-images must be private (public = false).'
  );
  perform pg_temp.assert_true(
    bucket_size = 10485760,
    'Storage bucket checkin-images must have file_size_limit = 10485760 (10MB).'
  );
  perform pg_temp.assert_true(
    bucket_mimes is not null and bucket_mimes @> required_bucket_mimes,
    'Storage bucket checkin-images allowed_mime_types is missing one or more required image MIME types.'
  );

  -- 15) Storage policy semantics check (insert policy)
  select coalesce(p.qual, ''), coalesce(p.with_check, '')
  into policy_using, policy_check
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and p.policyname = 'checkin_images_insert_owner';

  normalized_check := translate(
    lower(coalesce(policy_check, '') || coalesce(policy_using, '')),
    E' \n\t\r"',
    ''
  );

  perform pg_temp.assert_true(
    strpos(normalized_check, 'bucket_id') > 0
      and strpos(normalized_check, 'checkin-images') > 0,
    'checkin_images_insert_owner must scope to bucket_id = checkin-images.'
  );
  perform pg_temp.assert_true(
    strpos(normalized_check, 'storage.foldername(name)') > 0
      and strpos(normalized_check, '[1]') > 0
      and strpos(normalized_check, 'auth.uid()') > 0,
    'checkin_images_insert_owner must enforce first storage path segment equals auth.uid().'
  );

  raise notice 'VERIFY OK: Baseline schema/RLS/storage parity checks passed.';
end
$verify$;

-- ---------------------------------------------------------------------------
-- Unified verification report (single result set)
-- ---------------------------------------------------------------------------
with
required_extensions(extname) as (
  values
    ('pgcrypto'::text)
),
enum_expected(type_name, expected_labels) as (
  values
    ('goal_privacy'::text, array['private', 'public']::text[]),
    ('goal_status'::text, array['active', 'completed', 'archived']::text[]),
    ('goal_model_type'::text, array['count', 'time', 'milestone']::text[]),
    ('goal_tracking_type'::text, array['count', 'duration']::text[]),
    ('goal_cadence'::text, array['daily', 'weekly', 'by_deadline']::text[]),
    ('pledge_status'::text, array['offered', 'accepted', 'settled', 'expired', 'cancelled']::text[])
),
enum_actual as (
  select
    t.typname as type_name,
    array_agg(e.enumlabel::text order by e.enumsortorder) as actual_labels
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname
),
required_tables(schema_name, table_name) as (
  values
    ('public'::text, 'profiles'::text),
    ('public', 'goals'),
    ('public', 'check_ins'),
    ('public', 'pledges'),
    ('public', 'sponsor_criteria'),
    ('public', 'comments'),
    ('public', 'events'),
    ('public', 'completion_nfts'),
    ('public', 'discovery_rankings'),
    ('storage', 'buckets'),
    ('storage', 'objects')
),
required_columns(table_name, column_name) as (
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
    ('pledges', 'onchain_pledge_id'),
    ('pledges', 'escrow_chain_id'),
    ('pledges', 'escrow_token_address'),
    ('pledges', 'escrow_amount_raw'),
    ('pledges', 'settlement_tx'),
    ('events', 'event_type'),
    ('events', 'data'),
    ('events', 'read_at'),
    ('completion_nfts', 'tx_hash'),
    ('discovery_rankings', 'score')
),
required_column_types(table_name, column_name, expected_data_type, expected_udt_name) as (
  values
    ('goals'::text, 'completed_at'::text, 'timestamp with time zone'::text, null::text),
    ('goals', 'cadence_target_value', 'integer', null),
    ('goals', 'start_snapshot_value', 'double precision', null),
    ('goals', 'total_target_value', 'integer', null),
    ('goals', 'total_progress_value', 'integer', null),
    ('goals', 'check_in_count', 'integer', null),
    ('check_ins', 'progress_value', 'integer', null),
    ('check_ins', 'progress_snapshot_value', 'double precision', null),
    ('check_ins', 'progress_unit', 'text', null),
    ('check_ins', 'onchain_chain_id', 'integer', null),
    ('check_ins', 'onchain_submitted_at', 'timestamp with time zone', null),
    ('pledges', 'escrow_chain_id', 'integer', null),
    ('pledges', 'onchain_pledge_id', 'text', null),
    ('pledges', 'escrow_token_address', 'text', null),
    ('pledges', 'escrow_amount_raw', 'text', null),
    ('pledges', 'settlement_tx', 'text', null),
    ('events', 'data', 'jsonb', null),
    ('events', 'read_at', 'timestamp with time zone', null),
    ('discovery_rankings', 'score', 'numeric', null),
    ('goals', 'privacy', null, 'goal_privacy'),
    ('goals', 'status', null, 'goal_status'),
    ('goals', 'model_type', null, 'goal_model_type'),
    ('goals', 'goal_type', null, 'goal_tracking_type'),
    ('goals', 'cadence', null, 'goal_cadence'),
    ('pledges', 'status', null, 'pledge_status')
),
required_constraints(table_name, constraint_name) as (
  values
    ('public.goals'::text, 'goals_target_value_positive'::text),
    ('public.goals', 'goals_cadence_target_value_positive'),
    ('public.goals', 'goals_start_snapshot_value_positive'),
    ('public.goals', 'goals_total_target_value_positive'),
    ('public.goals', 'goals_total_progress_value_nonnegative'),
    ('public.goals', 'goals_goal_type_matches_model_type'),
    ('public.goals', 'goals_tracking_fields_consistent'),
    ('public.check_ins', 'check_ins_progress_value_positive'),
    ('public.check_ins', 'check_ins_progress_snapshot_value_nonnegative'),
    ('public.check_ins', 'check_ins_progress_unit_valid'),
    ('public.pledges', 'pledges_amount_min'),
    ('public.pledges', 'pledges_min_check_ins'),
    ('public.sponsor_criteria', 'sponsor_criteria_pledge_unique'),
    ('public.completion_nfts', 'completion_nfts_goal_unique')
),
required_functions(function_name) as (
  values
    ('set_updated_at'::text),
    ('enforce_goal_update_policy'),
    ('increment_goal_check_in_count'),
    ('decrement_goal_check_in_count'),
    ('adjust_goal_check_in_progress_value')
),
required_triggers(table_name, trigger_name, function_name) as (
  values
    ('profiles'::text, 'set_profiles_updated_at'::text, 'set_updated_at'::text),
    ('goals', 'set_goals_updated_at', 'set_updated_at'),
    ('goals', 'enforce_goals_update_policy', 'enforce_goal_update_policy'),
    ('pledges', 'set_pledges_updated_at', 'set_updated_at'),
    ('check_ins', 'check_ins_increment_goal_count', 'increment_goal_check_in_count'),
    ('check_ins', 'check_ins_decrement_goal_count', 'decrement_goal_check_in_count'),
    ('check_ins', 'check_ins_adjust_goal_progress_value', 'adjust_goal_check_in_progress_value')
),
required_indexes(index_name) as (
  values
    ('public.goals_user_id_idx'::text),
    ('public.goals_privacy_idx'),
    ('public.goals_status_idx'),
    ('public.goals_deadline_at_idx'),
    ('public.goals_created_at_idx'),
    ('public.goals_commitment_id_idx'),
    ('public.check_ins_goal_id_idx'),
    ('public.check_ins_user_id_idx'),
    ('public.check_ins_check_in_at_idx'),
    ('public.check_ins_onchain_commitment_id_idx'),
    ('public.pledges_goal_id_idx'),
    ('public.pledges_sponsor_id_idx'),
    ('public.pledges_status_idx'),
    ('public.pledges_deadline_at_idx'),
    ('public.pledges_onchain_pledge_id_idx'),
    ('public.sponsor_criteria_pledge_id_idx'),
    ('public.comments_goal_id_idx'),
    ('public.comments_author_id_idx'),
    ('public.comments_created_at_idx'),
    ('public.completion_nfts_goal_id_idx'),
    ('public.completion_nfts_user_id_idx'),
    ('public.completion_nfts_created_at_idx'),
    ('public.events_recipient_id_idx'),
    ('public.events_actor_id_idx'),
    ('public.events_goal_id_idx'),
    ('public.events_pledge_id_idx'),
    ('public.events_created_at_idx'),
    ('public.discovery_rankings_score_idx')
),
required_rls(schema_name, table_name) as (
  values
    ('public'::text, 'profiles'::text),
    ('public', 'goals'),
    ('public', 'check_ins'),
    ('public', 'pledges'),
    ('public', 'sponsor_criteria'),
    ('public', 'comments'),
    ('public', 'events'),
    ('public', 'completion_nfts'),
    ('public', 'discovery_rankings'),
    ('storage', 'objects')
),
required_policies(schema_name, table_name, policy_name) as (
  values
    ('public'::text, 'profiles'::text, 'profiles_select_public'::text),
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
    ('public', 'pledges', 'pledges_select_public_goal'),
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
),
policy_checkins_update as (
  select
    coalesce(qual, '') as using_expr,
    coalesce(with_check, '') as with_check_expr
  from pg_policies
  where schemaname = 'public'
    and tablename = 'check_ins'
    and policyname = 'check_ins_update_owner'
),
policy_storage_insert as (
  select
    coalesce(qual, '') as using_expr,
    coalesce(with_check, '') as with_check_expr
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'checkin_images_insert_owner'
),
policy_storage_insert_normalized as (
  select
    psi.using_expr,
    psi.with_check_expr,
    concat_ws(' || ', nullif(psi.using_expr, ''), nullif(psi.with_check_expr, '')) as actual_expr,
    translate(
      lower(coalesce(psi.using_expr, '') || coalesce(psi.with_check_expr, '')),
      E' \n\t\r"',
      ''
    ) as normalized_expr
  from policy_storage_insert psi
),
progress_unit_constraint as (
  select pg_get_constraintdef(c.oid) as constraint_def
  from pg_constraint c
  where c.conrelid = to_regclass('public.check_ins')
    and c.conname = 'check_ins_progress_unit_valid'
),
bucket as (
  select
    b.id,
    b.public,
    b.file_size_limit,
    b.allowed_mime_types
  from storage.buckets b
  where b.id = 'checkin-images'
),
report_rows as (
  -- Extensions
  select
    '00_extension'::text as section,
    format('extension.%s', re.extname) as item,
    exists (
      select 1
      from pg_extension e
      where e.extname = re.extname
    ) as passed,
    'present'::text as expected,
    case
      when exists (
        select 1
        from pg_extension e
        where e.extname = re.extname
      ) then 'present'
      else 'missing'
    end as actual
  from required_extensions re

  union all

  -- Enums
  select
    '01_enum'::text as section,
    ee.type_name as item,
    coalesce(ea.actual_labels, '{}'::text[]) = ee.expected_labels as passed,
    array_to_string(ee.expected_labels, ', ') as expected,
    array_to_string(coalesce(ea.actual_labels, '{}'::text[]), ', ') as actual
  from enum_expected ee
  left join enum_actual ea on ea.type_name = ee.type_name

  union all

  -- Tables
  select
    '02_table'::text,
    format('%I.%I', rt.schema_name, rt.table_name),
    to_regclass(format('%I.%I', rt.schema_name, rt.table_name)) is not null,
    'present',
    case
      when to_regclass(format('%I.%I', rt.schema_name, rt.table_name)) is not null then 'present'
      else 'missing'
    end
  from required_tables rt

  union all

  -- Column presence
  select
    '03_column_presence'::text,
    format('public.%I.%I', rc.table_name, rc.column_name),
    c.column_name is not null,
    'present',
    coalesce(c.data_type || ' / ' || c.udt_name, 'missing')
  from required_columns rc
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = rc.table_name
   and c.column_name = rc.column_name

  union all

  -- Column type expectations
  select
    '04_column_type'::text,
    format('public.%I.%I', rct.table_name, rct.column_name),
    c.column_name is not null
      and (rct.expected_data_type is null or c.data_type = rct.expected_data_type)
      and (
        rct.expected_udt_name is null
        or (c.udt_schema = 'public' and c.udt_name = rct.expected_udt_name)
      ) as passed,
    coalesce(
      'data_type=' || rct.expected_data_type,
      'udt=public.' || rct.expected_udt_name
    ) as expected,
    coalesce(
      'data_type=' || c.data_type || ';udt=' || c.udt_schema || '.' || c.udt_name,
      'missing'
    ) as actual
  from required_column_types rct
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = rct.table_name
   and c.column_name = rct.column_name

  union all

  -- Constraints
  select
    '05_constraint'::text,
    format('%s.%s', rc.table_name, rc.constraint_name),
    exists (
      select 1
      from pg_constraint c
      where c.conrelid = to_regclass(rc.table_name)
        and c.conname = rc.constraint_name
    ) as passed,
    'present',
    case
      when exists (
        select 1
        from pg_constraint c
        where c.conrelid = to_regclass(rc.table_name)
          and c.conname = rc.constraint_name
      ) then 'present'
      else 'missing'
    end
  from required_constraints rc

  union all

  -- Constraint semantics
  select
    '05_constraint_semantic'::text,
    'public.check_ins.check_ins_progress_unit_valid.contains_hours',
    coalesce(position('hours' in lower((select constraint_def from progress_unit_constraint))), 0) > 0,
    'constraint definition includes ''hours''',
    coalesce((select constraint_def from progress_unit_constraint), 'missing')

  union all

  -- Functions
  select
    '06_function'::text,
    format('public.%I', rf.function_name),
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = rf.function_name
    ) as passed,
    'present',
    case
      when exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = rf.function_name
      ) then 'present'
      else 'missing'
    end
  from required_functions rf

  union all

  -- Triggers + binding
  select
    '07_trigger'::text,
    format('public.%I on %I', rt.trigger_name, rt.table_name),
    exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace pn on pn.oid = p.pronamespace
      where n.nspname = 'public'
        and c.relname = rt.table_name
        and t.tgname = rt.trigger_name
        and not t.tgisinternal
        and pn.nspname = 'public'
        and p.proname = rt.function_name
    ) as passed,
    'bound to public.' || rt.function_name,
    coalesce((
      select 'bound to public.' || p.proname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace pn on pn.oid = p.pronamespace
      where n.nspname = 'public'
        and c.relname = rt.table_name
        and t.tgname = rt.trigger_name
        and not t.tgisinternal
      limit 1
    ), 'missing')
  from required_triggers rt

  union all

  -- Indexes
  select
    '08_index'::text,
    ri.index_name,
    to_regclass(ri.index_name) is not null,
    'present',
    case
      when to_regclass(ri.index_name) is not null then 'present'
      else 'missing'
    end
  from required_indexes ri

  union all

  -- RLS enabled
  select
    '09_rls'::text,
    format('%I.%I', rr.schema_name, rr.table_name),
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = rr.schema_name
        and c.relname = rr.table_name
        and c.relrowsecurity
    ),
    'enabled',
    case
      when exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = rr.schema_name
          and c.relname = rr.table_name
          and c.relrowsecurity
      ) then 'enabled'
      else 'disabled'
    end
  from required_rls rr

  union all

  -- Policy presence
  select
    '10_policy'::text,
    format('%I.%I.%I', rp.schema_name, rp.table_name, rp.policy_name),
    p.policyname is not null,
    'present',
    case when p.policyname is not null then 'present' else 'missing' end
  from required_policies rp
  left join pg_policies p
    on p.schemaname = rp.schema_name
   and p.tablename = rp.table_name
   and p.policyname = rp.policy_name

  union all

  -- Hardened check_ins policy semantics
  select
    '11_policy_semantic'::text,
    'public.check_ins_update_owner.using_owner_guard',
    strpos(translate(lower(pcu.using_expr), E' \n\t\r"', ''), 'auth.uid()=user_id') > 0
      and strpos(translate(lower(pcu.using_expr), E' \n\t\r"', ''), 'g.user_id=auth.uid()') > 0
      and strpos(translate(lower(pcu.using_expr), E' \n\t\r"', ''), 'exists(') > 0,
    'USING enforces auth.uid() + goal ownership',
    pcu.using_expr
  from policy_checkins_update pcu

  union all

  select
    '11_policy_semantic'::text,
    'public.check_ins_update_owner.with_check_owner_guard',
    strpos(translate(lower(pcu.with_check_expr), E' \n\t\r"', ''), 'auth.uid()=user_id') > 0
      and strpos(translate(lower(pcu.with_check_expr), E' \n\t\r"', ''), 'g.user_id=auth.uid()') > 0
      and strpos(translate(lower(pcu.with_check_expr), E' \n\t\r"', ''), 'exists(') > 0,
    'WITH CHECK enforces auth.uid() + goal ownership',
    pcu.with_check_expr
  from policy_checkins_update pcu

  union all

  -- Storage bucket checks
  select
    '12_storage_bucket'::text,
    'storage.buckets.checkin-images.exists',
    exists (select 1 from bucket),
    'bucket exists',
    case when exists (select 1 from bucket) then 'exists' else 'missing' end

  union all

  select
    '12_storage_bucket'::text,
    'storage.buckets.checkin-images.private',
    coalesce((select not b.public from bucket b), false),
    'public = false',
    coalesce((select 'public=' || b.public::text from bucket b), 'missing')

  union all

  select
    '12_storage_bucket'::text,
    'storage.buckets.checkin-images.file_size_limit',
    coalesce((select b.file_size_limit = 10485760 from bucket b), false),
    '10485760',
    coalesce((select b.file_size_limit::text from bucket b), 'missing')

  union all

  select
    '12_storage_bucket'::text,
    'storage.buckets.checkin-images.allowed_mime_types',
    coalesce((
      select b.allowed_mime_types @> array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/heic',
        'image/heif'
      ]::text[]
      from bucket b
    ), false),
    'contains required image mime types',
    coalesce((select array_to_string(b.allowed_mime_types, ', ') from bucket b), 'missing')

  union all

  -- Storage insert policy semantics
  select
    '13_storage_policy_semantic'::text,
    'storage.objects.checkin_images_insert_owner.bucket_scope',
    strpos(psin.normalized_expr, 'bucket_id') > 0
      and strpos(psin.normalized_expr, 'checkin-images') > 0,
    'expression scopes to bucket_id/checkin-images',
    coalesce(psin.actual_expr, '')
  from policy_storage_insert_normalized psin

  union all

  select
    '13_storage_policy_semantic'::text,
    'storage.objects.checkin_images_insert_owner.owner_path_guard',
    strpos(psin.normalized_expr, 'storage.foldername(name)') > 0
      and strpos(psin.normalized_expr, '[1]') > 0
      and strpos(psin.normalized_expr, 'auth.uid()') > 0,
    'expression enforces first folder segment = auth.uid()',
    coalesce(psin.actual_expr, '')
  from policy_storage_insert_normalized psin
)
select
  section,
  item,
  passed,
  expected,
  actual
from (
  select
    '00_summary'::text as section,
    'overall'::text as item,
    bool_and(passed) as passed,
    count(*)::text || ' checks total' as expected,
    sum(case when passed then 1 else 0 end)::text || ' checks passed' as actual
  from report_rows

  union all

  select section, item, passed, expected, actual
  from report_rows
) final_report
order by section, item;
