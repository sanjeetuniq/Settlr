begin;

select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000201', 'notification-payer@example.test'),
  ('00000000-0000-4000-8000-000000000202', 'notification-payee@example.test'),
  ('00000000-0000-4000-8000-000000000203', 'notification-other@example.test');

insert into public.groups (id, name, created_by)
values (
  '00000000-0000-4000-8000-000000000211',
  'Notification filter test',
  '00000000-0000-4000-8000-000000000201'
);

insert into public.group_members (group_id, user_id)
values
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000201'),
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000202'),
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000203');

insert into public.expenses (
  group_id, description, amount_minor, payer_id, created_by, spent_at, created_at
)
select
  '00000000-0000-4000-8000-000000000211',
  'Shared filter expense ' || n,
  100,
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000201',
  date '2026-10-29',
  now() - (n || ' minutes')::interval
from generate_series(1, 53) as n;

insert into public.expense_shares (expense_id, user_id, amount_minor)
select e.id, participant.user_id, participant.amount_minor
from public.expenses e
cross join (values
  ('00000000-0000-4000-8000-000000000201'::uuid, 0::bigint),
  ('00000000-0000-4000-8000-000000000202'::uuid, 100::bigint)
) as participant(user_id, amount_minor)
where e.group_id = '00000000-0000-4000-8000-000000000211';

insert into public.settlements (
  id, group_id, from_user_id, to_user_id, amount_minor, created_by, created_at
)
values (
  '00000000-0000-4000-8000-000000000221',
  '00000000-0000-4000-8000-000000000211',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000202',
  500,
  '00000000-0000-4000-8000-000000000201',
  '2026-10-29 23:30:00+00'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000201',
  true
);

select is(
  (select recipient_id from public.settlement_notifications where settlement_id = '00000000-0000-4000-8000-000000000221'),
  '00000000-0000-4000-8000-000000000202'::uuid,
  'the settlement notification goes to the payee'
);
select is(
  (select amount_minor from public.settlement_notifications where settlement_id = '00000000-0000-4000-8000-000000000221'),
  500::bigint,
  'the settlement notification includes the amount'
);
insert into public.settlement_notifications (
  settlement_id, recipient_id, group_id, group_name, currency, from_user_id, amount_minor
)
values (
  '00000000-0000-4000-8000-000000000221',
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000211',
  'Duplicate attempt',
  'INR',
  '00000000-0000-4000-8000-000000000201',
  500
)
on conflict (settlement_id) do nothing;
select is(
  (select count(*) from public.settlement_notifications where settlement_id = '00000000-0000-4000-8000-000000000221'),
  1::bigint,
  'a settlement creates no duplicate inbox notification'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.settlement_notifications'::regclass),
  'settlement notifications enable row-level security'
);
select ok(
  has_table_privilege('authenticated', 'public.settlement_notifications', 'select')
  and has_column_privilege('authenticated', 'public.settlement_notifications', 'read_at', 'update')
  and not has_table_privilege('authenticated', 'public.settlement_notifications', 'insert')
  and not has_column_privilege('authenticated', 'public.settlement_notifications', 'amount_minor', 'update'),
  'clients can read notifications and update only the read state'
);
select is(
  (
    select count(*)
    from public.get_filtered_transactions(
      '00000000-0000-4000-8000-000000000202',
      date '2026-10-30',
      date '2026-10-31',
      'Asia/Kolkata'
    )
    where kind = 'settlement'
  ),
  1::bigint,
  'settlements use the requested timezone when filtering by local calendar day'
);
select is(
  (
    select count(*)
    from public.get_filtered_transactions(
      '00000000-0000-4000-8000-000000000202',
      date '2026-10-29',
      date '2026-10-30',
      'UTC'
    )
    where kind = 'expense'
  ),
  50::bigint,
  'expense split participants match and the latest result set is capped at 50'
);
select is(
  (
    select count(*)
    from public.get_filtered_transactions(
      '00000000-0000-4000-8000-000000000203',
      date '2026-10-29',
      date '2026-10-30',
      'UTC'
    )
  ),
  0::bigint,
  'people absent from a transaction do not match it'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.get_filtered_transactions(uuid,date,date,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.get_filtered_transactions(uuid,date,date,text)',
    'execute'
  ),
  'filtered transaction queries are only executable by authenticated users'
);
select ok(
  exists (
    select 1
    from pg_policy
    where polrelid = 'public.settlement_notifications'::regclass
      and polcmd = 'w'
      and pg_get_expr(polqual, polrelid) like '%recipient_id%'
      and pg_get_expr(polwithcheck, polrelid) like '%recipient_id%'
  ),
  'notification updates check recipient ownership before and after the update'
);

select * from finish();
rollback;
