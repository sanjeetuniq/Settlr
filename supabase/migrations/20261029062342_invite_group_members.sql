create or replace function public.search_group_invite_candidates(
  p_group_id uuid,
  p_query text
)
returns table (id uuid, display_name text, email text, is_member boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'A signed-in user is required';
  end if;

  if char_length(v_query) < 2 or char_length(v_query) > 254 then
    raise exception 'Search with 2 to 254 characters';
  end if;

  if not exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.created_by = (select auth.uid())
      and g.archived_at is null
  ) then
    raise exception 'Only the creator can invite people to an active group';
  end if;

  return query
  select
    p.id,
    p.display_name,
    case when lower(u.email) = lower(v_query) then u.email::text else null end,
    exists (
      select 1
      from public.group_members gm
      where gm.group_id = p_group_id
        and gm.user_id = p.id
    )
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id <> (select auth.uid())
    and u.email is not null
    and (
      lower(u.email) = lower(v_query)
      or strpos(lower(p.display_name), lower(v_query)) > 0
    )
  order by
    case when lower(u.email) = lower(v_query) then 0 else 1 end,
    p.display_name
  limit 10;
end;
$$;

create or replace function public.invite_group_member(
  p_group_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_creator_id uuid;
  v_archived_at timestamptz;
  v_member_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'A signed-in user is required';
  end if;

  select g.created_by, g.archived_at
  into v_creator_id, v_archived_at
  from public.groups g
  where g.id = p_group_id
  for update;

  if not found
    or v_creator_id <> (select auth.uid())
    or v_archived_at is not null then
    raise exception 'Only the creator can invite people to an active group';
  end if;

  if p_user_id is null or p_user_id = (select auth.uid()) then
    raise exception 'Choose another signed-in user';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'The selected account is unavailable';
  end if;

  if exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_user_id
  ) then
    return p_user_id;
  end if;

  select count(*) into v_member_count
  from public.group_members gm
  where gm.group_id = p_group_id;

  if v_member_count >= 40 then
    raise exception 'This group is full';
  end if;

  insert into public.group_members (group_id, user_id)
  values (p_group_id, p_user_id);

  return p_user_id;
end;
$$;

revoke all on function public.search_group_invite_candidates(uuid, text) from public, anon;
revoke all on function public.invite_group_member(uuid, uuid) from public, anon;

grant execute on function public.search_group_invite_candidates(uuid, text) to authenticated;
grant execute on function public.invite_group_member(uuid, uuid) to authenticated;