begin;

select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000201', 'photo-owner@example.test'),
  ('00000000-0000-4000-8000-000000000202', 'discoverable@example.test'),
  ('00000000-0000-4000-8000-000000000203', 'private-phone@example.test');

insert into public.groups (id, name, created_by)
values (
  '00000000-0000-4000-8000-000000000211',
  'Phone search test',
  '00000000-0000-4000-8000-000000000201'
);

insert into public.group_members (group_id, user_id)
values
  (
    '00000000-0000-4000-8000-000000000211',
    '00000000-0000-4000-8000-000000000201'
  ),
  (
    '00000000-0000-4000-8000-000000000211',
    '00000000-0000-4000-8000-000000000202'
  ),
  (
    '00000000-0000-4000-8000-000000000211',
    '00000000-0000-4000-8000-000000000203'
  );

insert into public.whatsapp_preferences (
  user_id, phone_e164, phone_verified_at, phone_discoverable
)
values
  (
    '00000000-0000-4000-8000-000000000202',
    '+12025550122',
    now(),
    true
  );
insert into public.whatsapp_preferences (
  user_id, phone_e164, phone_verified_at
)
values
  (
    '00000000-0000-4000-8000-000000000203',
    '+12025550123',
    now()
  );

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000201',
  true
);

select is(
  (select public from storage.buckets where id = 'profile-avatars'),
  false,
  'profile photos are stored in a private bucket'
);
select is(
  (select file_size_limit from storage.buckets where id = 'profile-avatars'),
  2097152::bigint,
  'profile photos are limited to 2 MB'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'profile-avatars'),
  array['image/png', 'image/jpeg', 'image/webp']::text[],
  'the bucket accepts only the supported image MIME types'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users upload their own profile photos'
  ),
  'the storage bucket has an owner-scoped upload policy'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Owners and group peers view profile photos'
  ),
  'the storage bucket has an owner-and-peer read policy'
);
select ok(
  (
    select qual like '%avatar_path%'
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Owners and group peers view profile photos'
  ),
  'group peers can read only a profile photo currently referenced by its owner'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users delete their own profile photos'
  ),
  'the storage bucket has an owner-scoped delete policy'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.search_group_invite_candidates(uuid,text)',
    'execute'
  ),
  'anonymous users cannot search invitation candidates'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.search_group_invite_candidates(uuid,text)',
    'execute'
  ),
  'authenticated users can search invitation candidates'
);
select is(
  (
    select phone_discoverable
    from public.whatsapp_preferences
    where user_id = '00000000-0000-4000-8000-000000000203'
  ),
  false,
  'phone discoverability defaults to opt-out'
);
select is(
  (
    select id
    from public.search_group_invite_candidates(
      '00000000-0000-4000-8000-000000000211',
      '+12025550122'
    )
  ),
  '00000000-0000-4000-8000-000000000202'::uuid,
  'an exact verified phone search finds an opted-in account'
);
select is(
  (
    select email
    from public.search_group_invite_candidates(
      '00000000-0000-4000-8000-000000000211',
      '+12025550122'
    )
  ),
  null::text,
  'phone search does not reveal the matched email address'
);
select is(
  (
    select count(*)
    from public.search_group_invite_candidates(
      '00000000-0000-4000-8000-000000000211',
      '+12025550123'
    )
  ),
  0::bigint,
  'a verified number is not searchable without explicit opt-in'
);
select is(
  (
    select attempts
    from public.invite_search_rate_limits
    where user_id = '00000000-0000-4000-8000-000000000201'
      and group_id = '00000000-0000-4000-8000-000000000211'
  ),
  3,
  'search attempts are recorded in the rate-limit window'
);
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000202',
  true
);
select throws_ok(
  $$ select * from public.search_group_invite_candidates(
    '00000000-0000-4000-8000-000000000211',
    '+12025550122'
  ) $$,
  'P0001',
  'Only the creator can invite people to an active group',
  'only the active group creator can search for invite candidates'
);

update public.whatsapp_preferences
set phone_e164 = '+12025550124'
where user_id = '00000000-0000-4000-8000-000000000202';
select is(
  (
    select phone_discoverable
    from public.whatsapp_preferences
    where user_id = '00000000-0000-4000-8000-000000000202'
  ),
  false,
  'changing a verified number disables phone discoverability'
);

select * from finish();
rollback;
