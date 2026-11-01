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
  v_user_id uuid := (select auth.uid());
  v_is_phone boolean;
  v_attempts integer;
begin
  if v_user_id is null then
    raise exception 'A signed-in user is required';
  end if;

  if char_length(v_query) < 2 or char_length(v_query) > 254 then
    raise exception 'Search with 2 to 254 characters';
  end if;

  if not exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.created_by = v_user_id
      and g.archived_at is null
  ) then
    raise exception 'Only the creator can invite people to an active group';
  end if;

  insert into public.invite_search_rate_limits (
    user_id, group_id, window_started_at, attempts
  )
  values (v_user_id, p_group_id, now(), 1)
  on conflict (user_id, group_id) do update
  set
    window_started_at = case
      when public.invite_search_rate_limits.window_started_at <= now() - interval '10 minutes'
        then now()
      else public.invite_search_rate_limits.window_started_at
    end,
    attempts = case
      when public.invite_search_rate_limits.window_started_at <= now() - interval '10 minutes'
        then 1
      else public.invite_search_rate_limits.attempts + 1
    end
  returning attempts into v_attempts;

  if v_attempts > 30 then
    raise exception 'Search rate limit exceeded';
  end if;

  v_is_phone := v_query ~ '^\+[1-9][0-9]{7,14}$';

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
  where p.id <> v_user_id
    and u.email is not null
    and (
      lower(u.email) = lower(v_query)
      or strpos(lower(p.display_name), lower(v_query)) > 0
      or (
        v_is_phone
        and exists (
          select 1
          from public.whatsapp_preferences wp
          where wp.user_id = p.id
            and wp.phone_e164 = v_query
            and wp.phone_verified_at is not null
            and wp.phone_discoverable
        )
      )
    )
  order by
    case when lower(u.email) = lower(v_query) then 0 else 1 end,
    p.display_name
  limit 10;
end;
$$;

revoke all on function public.search_group_invite_candidates(uuid, text)
  from public, anon;
grant execute on function public.search_group_invite_candidates(uuid, text)
  to authenticated;