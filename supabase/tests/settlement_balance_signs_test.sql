begin;

select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'settlement-a@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'settlement-b@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'settlement-c@example.test');

insert into public.groups (id, name, created_by) values
  (
    '00000000-0000-4000-8000-000000000011',
    'Settlement sign test',
    '00000000-0000-4000-8000-000000000001'
  ),
  (
    '00000000-0000-4000-8000-000000000012',
    'Settlement group isolation test',
    '00000000-0000-4000-8000-000000000001'
  );

insert into public.group_members (group_id, user_id)
select groups.id, users.id
from (values
  ('00000000-0000-4000-8000-000000000011'::uuid),
  ('00000000-0000-4000-8000-000000000012'::uuid)
) as groups(id)
cross join (values
  ('00000000-0000-4000-8000-000000000001'::uuid),
  ('00000000-0000-4000-8000-000000000002'::uuid),
  ('00000000-0000-4000-8000-000000000003'::uuid)
) as users(id)
on conflict do nothing;

insert into public.expenses (
  id, group_id, description, amount_minor, payer_id, created_by
)
values
  (
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000011',
    'First test expense',
    10000,
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  ),
  (
    '00000000-0000-4000-8000-000000000022',
    '00000000-0000-4000-8000-000000000012',
    'Second group expense',
    7000,
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001'
  );

insert into public.expense_shares (expense_id, user_id, amount_minor)
values
  (
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000001',
    0
  ),
  (
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000002',
    6000
  ),
  (
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000003',
    4000
  ),
  (
    '00000000-0000-4000-8000-000000000022',
    '00000000-0000-4000-8000-000000000001',
    7000
  );

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000001',
  true
);

select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000011') where user_id = '00000000-0000-4000-8000-000000000001'),
  10000::bigint,
  'the expense payer starts as a creditor'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000011') where user_id = '00000000-0000-4000-8000-000000000002'),
  -6000::bigint,
  'the first participant starts as a debtor'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000011') where user_id = '00000000-0000-4000-8000-000000000003'),
  -4000::bigint,
  'the second participant starts as a debtor'
);

select public.create_settlement(
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  3000
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000011') where user_id = '00000000-0000-4000-8000-000000000001'),
  7000::bigint,
  'a partial settlement reduces the creditor balance'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000011') where user_id = '00000000-0000-4000-8000-000000000002'),
  -3000::bigint,
  'a partial settlement reduces the debtor balance'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000011') where user_id = '00000000-0000-4000-8000-000000000003'),
  -4000::bigint,
  'a partial settlement leaves other debtors unchanged'
);

select public.create_settlement(
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  3000
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000011') where user_id = '00000000-0000-4000-8000-000000000001'),
  4000::bigint,
  'the second partial payment reduces the remaining creditor balance'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000011') where user_id = '00000000-0000-4000-8000-000000000002'),
  0::bigint,
  'the second partial payment clears the first debtor'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000012') where user_id = '00000000-0000-4000-8000-000000000001'),
  -7000::bigint,
  'settlements in one group do not affect another group'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000012') where user_id = '00000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a non-participant in the other group remains settled'
);

select public.create_settlement(
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000001',
  4000
);
select is(
  (select sum(balance_minor) from public.group_balances('00000000-0000-4000-8000-000000000011')),
  0::bigint,
  'fully settling multiple debtors preserves a zero-sum group balance'
);
select is(
  (select count(*) from public.group_balances('00000000-0000-4000-8000-000000000011') where balance_minor <> 0),
  0::bigint,
  'fully settled group balances are all zero'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000011') where user_id = '00000000-0000-4000-8000-000000000001'),
  0::bigint,
  'the creditor is cleared after all debtor payments'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000012') where user_id = '00000000-0000-4000-8000-000000000003'),
  7000::bigint,
  'the other group keeps its original creditor balance'
);

select public.create_settlement(
  '00000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  7500
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000012') where user_id = '00000000-0000-4000-8000-000000000001'),
  500::bigint,
  'an over-settlement makes the original debtor a creditor for the excess'
);
select is(
  (select balance_minor from public.group_balances('00000000-0000-4000-8000-000000000012') where user_id = '00000000-0000-4000-8000-000000000003'),
  -500::bigint,
  'an over-settlement makes the original creditor owe the excess'
);
select is(
  (select sum(balance_minor) from public.group_balances('00000000-0000-4000-8000-000000000012')),
  0::bigint,
  'an over-settlement preserves a zero-sum group balance'
);

select * from finish();
rollback;
