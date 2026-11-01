alter table public.groups
  add column if not exists is_public boolean not null default false;

create index if not exists groups_public_created_idx
  on public.groups (created_at desc)
  where is_public;

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
  where g.is_public
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
    and created_by = (select auth.uid());

  if not found then
    raise exception 'Only the group creator can change group visibility';
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
  where id = p_group_id and is_public
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

revoke all on function public.set_group_public(uuid, boolean) from public, anon;
revoke all on function public.join_open_group(uuid) from public, anon;
revoke all on function public.list_open_groups() from public, anon;

grant execute on function public.set_group_public(uuid, boolean) to authenticated;
grant execute on function public.join_open_group(uuid) to authenticated;
grant execute on function public.list_open_groups() to authenticated;