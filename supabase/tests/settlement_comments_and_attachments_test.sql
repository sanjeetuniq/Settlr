begin;

select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000101', 'settlement-note-payer@example.test'),
  ('00000000-0000-4000-8000-000000000102', 'settlement-note-debtor@example.test');

insert into public.groups (id, name, created_by)
values (
  '00000000-0000-4000-8000-000000000111',
  'Settlement note test',
  '00000000-0000-4000-8000-000000000101'
);

insert into public.group_members (group_id, user_id)
values
  (
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000102'
  );

insert into public.expenses (
  id, group_id, description, amount_minor, payer_id, created_by
)
values (
  '00000000-0000-4000-8000-000000000121',
  '00000000-0000-4000-8000-000000000111',
  'Shared expense',
  1000,
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000101'
);

insert into public.expense_shares (expense_id, user_id, amount_minor)
values
  (
    '00000000-0000-4000-8000-000000000121',
    '00000000-0000-4000-8000-000000000101',
    0
  ),
  (
    '00000000-0000-4000-8000-000000000121',
    '00000000-0000-4000-8000-000000000102',
    1000
  );

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000101',
  true
);

select public.create_settlement_with_details(
  '00000000-0000-4000-8000-000000000111',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101',
  500,
  repeat('a', 50),
  '00000000-0000-4000-8000-000000000111/settlements/00000000-0000-4000-8000-000000000133.pdf',
  'receipt.pdf',
  'application/pdf',
  1024
);

select is(
  (select char_length(comment) from public.settlements where group_id = '00000000-0000-4000-8000-000000000111'),
  50,
  'a settlement stores a comment of exactly 50 characters'
);
select is(
  (select file_name from public.settlement_attachments a join public.settlements s on s.id = a.settlement_id where s.group_id = '00000000-0000-4000-8000-000000000111'),
  'receipt.pdf',
  'the attachment metadata is linked to its settlement'
);
select is(
  (select uploaded_by from public.settlement_attachments a join public.settlements s on s.id = a.settlement_id where s.group_id = '00000000-0000-4000-8000-000000000111'),
  '00000000-0000-4000-8000-000000000101'::uuid,
  'the uploader is recorded on the settlement attachment'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000111') where user_id = '00000000-0000-4000-8000-000000000102'),
  -500::bigint,
  'recording a note and attachment preserves the settlement balance'
);

select throws_ok(
  $$ select public.create_settlement_with_details(
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000101',
    100,
    repeat('a', 51),
    null,
    null,
    null,
    null
  ) $$,
  'P0001',
  'Settlement details are invalid',
  'comments over 50 characters are rejected'
);
select is(
  (select count(*) from public.settlements where group_id = '00000000-0000-4000-8000-000000000111'),
  1::bigint,
  'a rejected long comment does not create a settlement'
);

select throws_ok(
  $$ select public.create_settlement_with_details(
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000101',
    100,
    null,
    '00000000-0000-4000-8000-000000000112/settlements/00000000-0000-4000-8000-000000000134.pdf',
    'receipt.pdf',
    'application/pdf',
    1024
  ) $$,
  'P0001',
  'Settlement attachment details are invalid',
  'attachment paths must be scoped to the settlement group'
);
select is(
  (select count(*) from public.settlement_attachments),
  1::bigint,
  'a rejected attachment path does not create attachment metadata'
);

select public.create_settlement(
  '00000000-0000-4000-8000-000000000111',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101',
  500
);
select is(
  (select comment from public.settlements where amount_minor = 500 order by created_at desc limit 1),
  null,
  'the existing settlement RPC remains compatible and leaves comments optional'
);
select is(
  (select count(*) from public.settlement_attachments),
  1::bigint,
  'a settlement without an attachment creates no attachment record'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.settlement_attachments'::regclass)
  and has_table_privilege('authenticated', 'public.settlement_attachments', 'select')
  and not has_table_privilege('authenticated', 'public.settlement_attachments', 'insert'),
  'attachment metadata is readable to authenticated users but not directly writable'
);

select * from finish();
rollback;
