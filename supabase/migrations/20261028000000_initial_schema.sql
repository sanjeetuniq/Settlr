create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  currency text not null default 'INR'
    check (currency in ('INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  description text not null check (char_length(description) between 1 and 120),
  category text not null default 'Other'
    check (category in ('Food', 'Transport', 'Stay', 'Utilities', 'Other')),
  amount_minor bigint not null check (amount_minor between 1 and 999999999999),
  payer_id uuid not null references auth.users (id),
  spent_at date not null default current_date,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.expense_shares (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  amount_minor bigint not null check (amount_minor >= 0),
  primary key (expense_id, user_id)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_user_id uuid not null references auth.users (id),
  to_user_id uuid not null references auth.users (id),
  amount_minor bigint not null check (amount_minor between 1 and 999999999999),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

create table public.expense_attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 180),
  content_type text not null check (content_type in ('image/png', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  message text not null check (char_length(message) between 1 and 280),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index group_members_user_idx on public.group_members (user_id);
create index expenses_group_created_idx on public.expenses (group_id, created_at desc);
create index expense_shares_user_idx on public.expense_shares (user_id);
create index settlements_group_created_idx on public.settlements (group_id, created_at desc);
create index reminders_recipient_created_idx on public.reminders (recipient_id, created_at desc);

create or replace function public.prevent_group_currency_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.currency <> old.currency and (
    exists (select 1 from public.expenses where group_id = old.id)
    or exists (select 1 from public.settlements where group_id = old.id)
  ) then
    raise exception 'Group currency cannot change after financial activity is recorded';
  end if;
  return new;
end;
$$;

create trigger group_currency_immutable_after_activity
  before update on public.groups
  for each row execute function public.prevent_group_currency_change();

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
  );
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Member'
    ), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create or replace function public.add_group_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.group_members (group_id, user_id)
  values (new.id, new.created_by);
  return new;
end;
$$;

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.add_group_creator_as_member();

create or replace function public.create_group(
  p_name text,
  p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_group_id uuid;
begin
  if v_user_id is null then
    raise exception 'A signed-in user is required to create a group';
  end if;

  if p_name is null
    or char_length(trim(p_name)) not between 1 and 80
    or p_currency not in ('INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD') then
    raise exception 'Group details are invalid';
  end if;

  insert into public.groups (name, currency, created_by)
  values (trim(p_name), p_currency, v_user_id)
  returning id into v_group_id;

  return v_group_id;
end;
$$;

create or replace function public.enforce_group_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_count integer;
begin
  perform 1 from public.groups where id = new.group_id for update;
  if not found then
    raise exception 'Group does not exist';
  end if;

  select count(*) into v_member_count
  from public.group_members
  where group_id = new.group_id;

  if v_member_count >= 40 then
    raise exception 'A group cannot have more than 40 members';
  end if;
  return new;
end;
$$;

create trigger group_member_limit_guard
  before insert on public.group_members
  for each row execute function public.enforce_group_member_limit();

create or replace function public.join_group_with_invite(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
  v_member_count integer;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid signed-in invite is required';
  end if;

  select gi.group_id into v_group_id
  from public.group_invites gi
  where gi.token_hash = p_token_hash
    and gi.revoked_at is null
    and gi.expires_at > now()
  for update;

  if v_group_id is null then
    raise exception 'Invite is invalid or expired';
  end if;

  perform 1 from public.groups where id = v_group_id for update;

  if exists (
    select 1 from public.group_members
    where group_id = v_group_id and user_id = v_user_id
  ) then
    return v_group_id;
  end if;

  select count(*) into v_member_count
  from public.group_members where group_id = v_group_id;
  if v_member_count >= 40 then
    raise exception 'This group is full';
  end if;

  insert into public.group_members (group_id, user_id)
  values (v_group_id, v_user_id);
  return v_group_id;
end;
$$;

create or replace function public.create_group_invite(
  p_group_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite_id uuid;
begin
  if not public.is_group_member(p_group_id)
    or not exists (
      select 1 from public.groups
      where id = p_group_id and created_by = (select auth.uid())
    ) then
    raise exception 'Only the group creator can issue invite links';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days' then
    raise exception 'Invite expiry must be within the next 30 days';
  end if;

  insert into public.group_invites (group_id, token_hash, created_by, expires_at)
  values (p_group_id, p_token_hash, (select auth.uid()), p_expires_at)
  returning id into v_invite_id;
  return v_invite_id;
end;
$$;

create or replace function public.revoke_group_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.group_invites
  set revoked_at = now()
  where id = p_invite_id
    and created_by = (select auth.uid())
    and revoked_at is null;
  if not found then
    raise exception 'Invite not found or already revoked';
  end if;
end;
$$;

create or replace function public.create_expense(
  p_group_id uuid,
  p_description text,
  p_category text,
  p_amount_minor bigint,
  p_payer_id uuid,
  p_spent_at date,
  p_shares jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expense_id uuid;
  v_share_count integer;
  v_share_total bigint;
  v_distinct_count integer;
begin
  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'Group does not exist';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;
  if p_description is null or char_length(trim(p_description)) not between 1 and 120
    or p_category not in ('Food', 'Transport', 'Stay', 'Utilities', 'Other')
    or p_amount_minor not between 1 and 999999999999
    or p_payer_id is null
    or p_spent_at is null
    or jsonb_typeof(p_shares) <> 'array'
    or jsonb_array_length(p_shares) not between 1 and 40 then
    raise exception 'Expense details are invalid';
  end if;
  if not public.is_group_member(p_group_id)
    or not exists (
      select 1 from public.group_members
      where group_id = p_group_id and user_id = p_payer_id
    ) then
    raise exception 'Payer must be a group member';
  end if;

  select count(*), coalesce(sum(s.amount_minor), 0), count(distinct s.user_id)
  into v_share_count, v_share_total, v_distinct_count
  from jsonb_to_recordset(p_shares) as s(user_id uuid, amount_minor bigint);

  if v_share_count <> v_distinct_count
    or v_share_total <> p_amount_minor
    or exists (
      select 1
      from jsonb_to_recordset(p_shares) as s(user_id uuid, amount_minor bigint)
      where s.amount_minor < 0
        or not exists (
          select 1 from public.group_members gm
          where gm.group_id = p_group_id and gm.user_id = s.user_id
        )
    ) then
    raise exception 'Shares must be non-negative, unique, and total the expense amount';
  end if;

  insert into public.expenses (
    group_id, description, category, amount_minor, payer_id, spent_at, created_by
  )
  values (
    p_group_id, trim(p_description), p_category, p_amount_minor,
    p_payer_id, p_spent_at, (select auth.uid())
  )
  returning id into v_expense_id;

  insert into public.expense_shares (expense_id, user_id, amount_minor)
  select v_expense_id, s.user_id, s.amount_minor
  from jsonb_to_recordset(p_shares) as s(user_id uuid, amount_minor bigint);

  return v_expense_id;
end;
$$;

create or replace function public.group_balances(p_group_id uuid)
returns table (user_id uuid, balance_minor bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;

  return query
  select gm.user_id, coalesce(sum(entries.amount_minor), 0)::bigint
  from public.group_members gm
  left join (
    select e.payer_id as user_id, e.group_id, e.amount_minor as amount_minor
    from public.expenses e
    union all
    select s.user_id, e.group_id, -s.amount_minor
    from public.expense_shares s
    join public.expenses e on e.id = s.expense_id
    union all
    select st.to_user_id, st.group_id, st.amount_minor
    from public.settlements st
    union all
    select st.from_user_id, st.group_id, -st.amount_minor
    from public.settlements st
  ) entries on entries.user_id = gm.user_id and entries.group_id = gm.group_id
  where gm.group_id = p_group_id
  group by gm.user_id;
end;
$$;

create or replace function public.create_settlement(
  p_group_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount_minor bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from_balance bigint;
  v_to_balance bigint;
  v_settlement_id uuid;
begin
  if not public.is_group_member(p_group_id)
    or p_from_user_id = p_to_user_id
    or p_amount_minor not between 1 and 999999999999
    or not exists (
      select 1 from public.group_members
      where group_id = p_group_id and user_id = p_from_user_id
    )
    or not exists (
      select 1 from public.group_members
      where group_id = p_group_id and user_id = p_to_user_id
    ) then
    raise exception 'Settlement details are invalid';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  select b.balance_minor into v_from_balance
  from public.group_balances(p_group_id) b
  where b.user_id = p_from_user_id;
  select b.balance_minor into v_to_balance
  from public.group_balances(p_group_id) b
  where b.user_id = p_to_user_id;

  if v_from_balance >= 0 or v_to_balance <= 0
    or p_amount_minor > least(-v_from_balance, v_to_balance) then
    raise exception 'Settlement exceeds the amount currently owed';
  end if;

  insert into public.settlements (
    group_id, from_user_id, to_user_id, amount_minor, created_by
  )
  values (
    p_group_id, p_from_user_id, p_to_user_id, p_amount_minor, (select auth.uid())
  )
  returning id into v_settlement_id;
  return v_settlement_id;
end;
$$;

create or replace function public.send_in_app_reminder(
  p_group_id uuid,
  p_recipient_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reminder_id uuid;
begin
  if not public.is_group_member(p_group_id)
    or p_recipient_id = (select auth.uid())
    or p_message is null
    or char_length(trim(p_message)) not between 1 and 280
    or not exists (
      select 1 from public.group_members
      where group_id = p_group_id and user_id = p_recipient_id
    ) then
    raise exception 'Reminder details are invalid';
  end if;

  insert into public.reminders (group_id, recipient_id, created_by, message)
  values (p_group_id, p_recipient_id, (select auth.uid()), trim(p_message))
  returning id into v_reminder_id;
  return v_reminder_id;
end;
$$;

create or replace function public.mark_reminder_read(p_reminder_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.reminders
  set read_at = coalesce(read_at, now())
  where id = p_reminder_id and recipient_id = (select auth.uid());
  if not found then
    raise exception 'Reminder not found';
  end if;
end;
$$;

create or replace function public.register_expense_attachment(
  p_expense_id uuid,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_size_bytes integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
  v_attachment_id uuid;
begin
  select e.group_id into v_group_id
  from public.expenses e
  where e.id = p_expense_id;

  if v_group_id is null
    or not public.is_group_member(v_group_id)
    or p_storage_path !~ ('^' || v_group_id::text || '/[0-9a-f-]+\.(png|pdf)$')
    or p_file_name is null
    or char_length(p_file_name) not between 1 and 180
    or p_content_type not in ('image/png', 'application/pdf')
    or p_size_bytes not between 1 and 5242880 then
    raise exception 'Attachment details are invalid';
  end if;

  insert into public.expense_attachments (
    expense_id, group_id, storage_path, file_name, content_type, size_bytes, uploaded_by
  )
  values (
    p_expense_id, v_group_id, p_storage_path, p_file_name,
    p_content_type, p_size_bytes, (select auth.uid())
  )
  returning id into v_attachment_id;
  return v_attachment_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements enable row level security;
alter table public.expense_attachments enable row level security;
alter table public.reminders enable row level security;

create policy "Profiles visible to self or group peers"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.group_members own
      join public.group_members peer on peer.group_id = own.group_id
      where own.user_id = (select auth.uid())
        and peer.user_id = profiles.id
    )
  );
create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Members read their groups"
  on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy "Authenticated users create groups"
  on public.groups for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "Members read group memberships"
  on public.group_members for select to authenticated
  using (public.is_group_member(group_id));

create policy "Creators read their invite hashes"
  on public.group_invites for select to authenticated
  using (created_by = (select auth.uid()));

create policy "Members read group expenses"
  on public.expenses for select to authenticated
  using (public.is_group_member(group_id));
create policy "Members read expense shares"
  on public.expense_shares for select to authenticated
  using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_shares.expense_id
        and public.is_group_member(e.group_id)
    )
  );
create policy "Members read settlements"
  on public.settlements for select to authenticated
  using (public.is_group_member(group_id));
create policy "Members read attachments"
  on public.expense_attachments for select to authenticated
  using (public.is_group_member(group_id));
create policy "Recipients read their reminders"
  on public.reminders for select to authenticated
  using (recipient_id = (select auth.uid()));

revoke all on function public.is_group_member(uuid) from public, anon;
revoke all on function public.create_group(text, text) from public, anon;
revoke all on function public.join_group_with_invite(text) from public, anon;
revoke all on function public.create_group_invite(uuid, text, timestamptz) from public, anon;
revoke all on function public.revoke_group_invite(uuid) from public, anon;
revoke all on function public.create_expense(uuid, text, text, bigint, uuid, date, jsonb) from public, anon;
revoke all on function public.group_balances(uuid) from public, anon;
revoke all on function public.create_settlement(uuid, uuid, uuid, bigint) from public, anon;
revoke all on function public.send_in_app_reminder(uuid, uuid, text) from public, anon;
revoke all on function public.mark_reminder_read(uuid) from public, anon;
revoke all on function public.register_expense_attachment(uuid, text, text, text, integer) from public, anon;

grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group_with_invite(text) to authenticated;
grant execute on function public.create_group_invite(uuid, text, timestamptz) to authenticated;
grant execute on function public.revoke_group_invite(uuid) to authenticated;
grant execute on function public.create_expense(uuid, text, text, bigint, uuid, date, jsonb) to authenticated;
grant execute on function public.group_balances(uuid) to authenticated;
grant execute on function public.create_settlement(uuid, uuid, uuid, bigint) to authenticated;
grant execute on function public.send_in_app_reminder(uuid, uuid, text) to authenticated;
grant execute on function public.mark_reminder_read(uuid) to authenticated;
grant execute on function public.register_expense_attachment(uuid, text, text, text, integer) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts',
  'expense-receipts',
  false,
  5242880,
  array['image/png', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'application/pdf'];

create policy "Group members view receipts"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'expense-receipts'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );
