create table public.settlement_notifications (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null unique references public.settlements (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  group_name text not null,
  currency text not null,
  from_user_id uuid not null references auth.users (id),
  amount_minor bigint not null check (amount_minor > 0),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index settlement_notifications_recipient_created_idx
  on public.settlement_notifications (recipient_id, created_at desc);
create index settlement_notifications_unread_idx
  on public.settlement_notifications (recipient_id, created_at desc)
  where read_at is null;
create index expenses_group_spent_idx
  on public.expenses (group_id, spent_at desc);

alter table public.settlement_notifications enable row level security;

create policy "Recipients read their settlement notifications"
  on public.settlement_notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

create policy "Recipients update their notification read state"
  on public.settlement_notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

revoke all on public.settlement_notifications from anon, authenticated;
grant select on public.settlement_notifications to authenticated;
grant update (read_at) on public.settlement_notifications to authenticated;

create or replace function public.notify_settlement_recipient()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.settlement_notifications (
    settlement_id,
    recipient_id,
    group_id,
    group_name,
    currency,
    from_user_id,
    amount_minor
  )
  select
    new.id,
    new.to_user_id,
    g.id,
    g.name,
    g.currency,
    new.from_user_id,
    new.amount_minor
  from public.groups g
  where g.id = new.group_id
  on conflict (settlement_id) do nothing;
  return new;
end;
$$;

revoke all on function public.notify_settlement_recipient() from public, anon, authenticated;

create trigger settlements_notify_recipient
  after insert on public.settlements
  for each row execute function public.notify_settlement_recipient();

create or replace function public.get_filtered_transactions(
  p_person_id uuid default null,
  p_start_date date default null,
  p_end_date date default null,
  p_timezone text default 'UTC'
)
returns table (
  id uuid,
  group_id uuid,
  group_name text,
  currency text,
  kind text,
  description text,
  amount_minor bigint,
  created_at timestamptz,
  person_a_id uuid,
  person_b_id uuid,
  activity_date date
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_timezone is null or not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    raise exception 'Invalid timezone';
  end if;
  if (p_start_date is null) <> (p_end_date is null)
    or (p_start_date is not null and p_end_date <= p_start_date) then
    raise exception 'Invalid date range';
  end if;

  return query
  with transactions as (
    select
      e.id,
      e.group_id,
      g.name as group_name,
      g.currency,
      'expense'::text as kind,
      e.description,
      e.amount_minor,
      e.created_at,
      e.payer_id as person_a_id,
      null::uuid as person_b_id,
      e.spent_at as activity_date
    from public.expenses e
    join public.groups g on g.id = e.group_id
    where public.is_group_member(e.group_id)
      and (
        p_person_id is null
        or e.payer_id = p_person_id
        or exists (
          select 1
          from public.expense_shares es
          where es.expense_id = e.id and es.user_id = p_person_id
        )
      )
      and (
        p_start_date is null
        or (
          e.spent_at >= p_start_date
          and e.spent_at < p_end_date
        )
      )

    union all

    select
      s.id,
      s.group_id,
      g.name as group_name,
      g.currency,
      'settlement'::text as kind,
      'Settlement recorded'::text as description,
      s.amount_minor,
      s.created_at,
      s.from_user_id as person_a_id,
      s.to_user_id as person_b_id,
      (s.created_at at time zone p_timezone)::date as activity_date
    from public.settlements s
    join public.groups g on g.id = s.group_id
    where public.is_group_member(s.group_id)
      and (
        p_person_id is null
        or s.from_user_id = p_person_id
        or s.to_user_id = p_person_id
      )
      and (
        p_start_date is null
        or (
          s.created_at >= (p_start_date::timestamp at time zone p_timezone)
          and s.created_at < (p_end_date::timestamp at time zone p_timezone)
        )
      )
  )
  select
    t.id, t.group_id, t.group_name, t.currency, t.kind, t.description,
    t.amount_minor, t.created_at, t.person_a_id, t.person_b_id, t.activity_date
  from transactions t
  order by t.created_at desc, t.id desc
  limit 50;
end;
$$;

revoke all on function public.get_filtered_transactions(uuid, date, date, text)
  from public, anon;
grant execute on function public.get_filtered_transactions(uuid, date, date, text)
  to authenticated;
