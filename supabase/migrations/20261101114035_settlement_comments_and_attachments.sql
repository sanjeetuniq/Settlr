alter table public.settlements
  add column if not exists comment text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'settlements_comment_length'
      and conrelid = 'public.settlements'::regclass
  ) then
    alter table public.settlements
      add constraint settlements_comment_length
      check (comment is null or char_length(comment) <= 50);
  end if;
end;
$$;

create table public.settlement_attachments (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null unique
    references public.settlements (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 180),
  content_type text not null check (content_type in ('image/png', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.settlement_attachments enable row level security;

create policy "Group members read settlement attachments"
  on public.settlement_attachments for select to authenticated
  using (
    exists (
      select 1
      from public.settlements s
      where s.id = settlement_attachments.settlement_id
        and public.is_group_member(s.group_id)
    )
  );

revoke all on public.settlement_attachments from public, anon, authenticated;
grant select on public.settlement_attachments to authenticated;

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

  if v_from_balance >= 0 or v_to_balance <= 0
    or p_amount_minor > least(-v_from_balance, v_to_balance) then
    raise exception 'Settlement exceeds the amount currently owed';
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