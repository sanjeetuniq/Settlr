alter table public.profiles
  add column if not exists avatar_path text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_avatar_path_owner'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_path_owner
      check (
        avatar_path is null
        or avatar_path ~ (
          '^' || id::text ||
          '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$'
        )
      );
  end if;
end;
$$;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 2097152,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

create policy "Users upload their own profile photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users replace their own profile photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Owners and group peers view profile photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1
        from public.group_members own
        join public.group_members peer on peer.group_id = own.group_id
        where own.user_id = (select auth.uid())
          and peer.user_id::text = (storage.foldername(name))[1]
          and exists (
            select 1
            from public.profiles p
            where p.id = peer.user_id
              and p.avatar_path = storage.objects.name
          )
      )
    )
  );

create policy "Users delete their own profile photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

alter table public.whatsapp_preferences
  add column if not exists phone_discoverable boolean not null default false;

create index if not exists whatsapp_preferences_discoverable_phone_idx
  on public.whatsapp_preferences (phone_e164)
  where phone_discoverable and phone_verified_at is not null;

create or replace function public.reset_phone_discoverability_on_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.phone_e164 is distinct from old.phone_e164 then
    new.phone_discoverable := false;
  end if;
  return new;
end;
$$;

create trigger reset_phone_discoverability_on_phone_change
  before update of phone_e164 on public.whatsapp_preferences
  for each row execute function public.reset_phone_discoverability_on_change();

revoke all on function public.reset_phone_discoverability_on_change()
  from public, anon, authenticated;

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

create or replace function public.create_settlement_with_details(
  p_group_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount_minor bigint,
  p_comment text,
  p_attachment_path text,
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
  v_from_balance bigint;
  v_to_balance bigint;
  v_settlement_id uuid;
  v_comment text := nullif(trim(p_comment), '');
  v_has_attachment boolean := p_attachment_path is not null;
begin
  if not public.is_group_member(p_group_id)
    or p_from_user_id = p_to_user_id
    or p_amount_minor is null
    or p_amount_minor is null
    or p_amount_minor not between 1 and 999999999999
    or not exists (
      select 1 from public.group_members
      where group_id = p_group_id and user_id = p_from_user_id
    )
    or not exists (
      select 1 from public.group_members
      where group_id = p_group_id and user_id = p_to_user_id
    )
    or (p_comment is not null and char_length(p_comment) > 50) then
    raise exception 'Settlement details are invalid';
  end if;

  if (
      v_has_attachment
      and (
        p_attachment_path !~ (
          '^' || p_group_id::text ||
          '/settlements/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|pdf)$'
        )
        or p_file_name is null
        or char_length(p_file_name) not between 1 and 180
        or p_content_type is null
        or p_content_type not in ('image/png', 'application/pdf')
        or p_size_bytes is null
        or p_size_bytes not between 1 and 5242880
      )
    )
    or (
      not v_has_attachment
      and (
        p_file_name is not null
        or p_content_type is not null
        or p_size_bytes is not null
      )
    ) then
    raise exception 'Settlement attachment details are invalid';
  end if;

  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'Group does not exist';
  end if;

  select b.balance_minor into v_from_balance
  from public.group_balances(p_group_id) b
  where b.user_id = p_from_user_id;
  select b.balance_minor into v_to_balance
  from public.group_balances(p_group_id) b
  where b.user_id = p_to_user_id;

  if v_from_balance >= 0 or v_to_balance <= 0 then
    raise exception 'Settlement parties do not match a current group debt';
  end if;

  insert into public.settlements (
    group_id, from_user_id, to_user_id, amount_minor, created_by, comment
  )
  values (
    p_group_id, p_from_user_id, p_to_user_id, p_amount_minor,
    (select auth.uid()), v_comment
  )
  returning id into v_settlement_id;

  if v_has_attachment then
    insert into public.settlement_attachments (
      settlement_id, storage_path, file_name, content_type, size_bytes, uploaded_by
    )
    values (
      v_settlement_id, p_attachment_path, p_file_name, p_content_type,
      p_size_bytes, (select auth.uid())
    );
  end if;

  return v_settlement_id;
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
begin
  return public.create_settlement_with_details(
    p_group_id, p_from_user_id, p_to_user_id, p_amount_minor,
    null, null, null, null, null
  );
end;
$$;

revoke all on function public.create_settlement_with_details(
  uuid, uuid, uuid, bigint, text, text, text, text, integer
) from public, anon;
grant execute on function public.create_settlement_with_details(
  uuid, uuid, uuid, bigint, text, text, text, text, integer
) to authenticated;