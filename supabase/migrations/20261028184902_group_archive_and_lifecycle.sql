alter table public.groups
  add column if not exists archived_at timestamptz;

create index if not exists groups_archived_created_idx
  on public.groups (created_by, archived_at desc)
  where archived_at is not null;

create or replace function public.list_open_groups()
returns table (id uuid, name text, currency text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'A signed-in user is required';
  end if;

  return query
  select g.id, g.name, g.currency
  from public.groups g
  where g.is_public and g.archived_at is null
  order by g.created_at desc
  limit 20;
end;
$$;

create or replace function public.set_group_public(
  p_group_id uuid,
  p_is_public boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'A signed-in user is required';
  end if;

  update public.groups
  set is_public = p_is_public
  where id = p_group_id
    and created_by = (select auth.uid())
    and archived_at is null;

  if not found then
    raise exception 'Only the creator can change visibility for an active group';
  end if;
end;
$$;

create or replace function public.join_open_group(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_member_count integer;
begin
  if v_user_id is null then
    raise exception 'A signed-in user is required';
  end if;

  perform 1
  from public.groups
  where id = p_group_id and is_public and archived_at is null
  for update;

  if not found then
    raise exception 'This group is not open to join';
  end if;

  if exists (
    select 1
    from public.group_members
    where group_id = p_group_id and user_id = v_user_id
  ) then
    return p_group_id;
  end if;

  select count(*) into v_member_count
  from public.group_members
  where group_id = p_group_id;

  if v_member_count >= 40 then
    raise exception 'This group is full';
  end if;

  insert into public.group_members (group_id, user_id)
  values (p_group_id, v_user_id);

  return p_group_id;
end;
$$;

create or replace function public.guard_active_group_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid := new.group_id;
  v_archived_at timestamptz;
begin
  select g.archived_at into v_archived_at
  from public.groups g
  where g.id = v_group_id
  for update;

  if not found then
    raise exception 'Group does not exist';
  end if;
  if v_archived_at is not null then
    raise exception 'Archived groups are read-only';
  end if;

  return new;
end;
$$;

create trigger active_group_membership_guard
  before insert on public.group_members
  for each row execute function public.guard_active_group_insert();
create trigger active_group_invite_guard
  before insert on public.group_invites
  for each row execute function public.guard_active_group_insert();
create trigger active_group_expense_guard
  before insert on public.expenses
  for each row execute function public.guard_active_group_insert();
create trigger active_group_settlement_guard
  before insert on public.settlements
  for each row execute function public.guard_active_group_insert();
create trigger active_group_attachment_guard
  before insert on public.expense_attachments
  for each row execute function public.guard_active_group_insert();
create trigger active_group_reminder_guard
  before insert on public.reminders
  for each row execute function public.guard_active_group_insert();

create or replace function public.archive_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'A signed-in user is required';
  end if;

  perform 1
  from public.groups
  where id = p_group_id
    and created_by = (select auth.uid())
    and archived_at is null
  for update;

  if not found then
    raise exception 'Only the creator can archive an active group';
  end if;

  if exists (
    select 1
    from public.group_balances(p_group_id) balances
    where balances.balance_minor <> 0
  ) then
    raise exception 'A group can only be archived after all balances are settled';
  end if;

  update public.groups
  set archived_at = now(), is_public = false
  where id = p_group_id;
end;
$$;

revoke all on function public.list_open_groups() from public, anon;
revoke all on function public.set_group_public(uuid, boolean) from public, anon;
revoke all on function public.join_open_group(uuid) from public, anon;
revoke all on function public.guard_active_group_insert() from public, anon;
revoke all on function public.archive_group(uuid) from public, anon;

grant execute on function public.list_open_groups() to authenticated;
grant execute on function public.set_group_public(uuid, boolean) to authenticated;
grant execute on function public.join_open_group(uuid) to authenticated;
grant execute on function public.archive_group(uuid) to authenticated;