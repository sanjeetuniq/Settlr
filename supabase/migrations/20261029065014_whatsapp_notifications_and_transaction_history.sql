create table public.invite_search_rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  primary key (user_id, group_id)
);

alter table public.invite_search_rate_limits enable row level security;
revoke all on table public.invite_search_rate_limits from public, anon, authenticated;
grant all on table public.invite_search_rate_limits to service_role;

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

  insert into public.invite_search_rate_limits (user_id, group_id)
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
    )
  order by
    case when lower(u.email) = lower(v_query) then 0 else 1 end,
    p.display_name
  limit 10;
end;
$$;

revoke all on function public.search_group_invite_candidates(uuid, text) from public, anon;
grant execute on function public.search_group_invite_candidates(uuid, text) to authenticated;

create table public.whatsapp_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone_e164 text check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  phone_verified_at timestamptz,
  opted_in_at timestamptz,
  expense_alerts boolean not null default true,
  invitation_alerts boolean not null default true,
  reminder_alerts boolean not null default true,
  settlement_alerts boolean not null default true,
  updated_at timestamptz not null default now(),
  check (
    (phone_e164 is null and phone_verified_at is null)
    or (phone_e164 is not null and phone_verified_at is not null)
  ),
  check (opted_in_at is null or phone_verified_at is not null)
);

create table public.whatsapp_verification_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5)
);

create table public.whatsapp_verification_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  sends_in_window integer not null default 0 check (sends_in_window between 0 and 5),
  last_sent_at timestamptz not null default now()
);

create table public.whatsapp_phone_verification_rate_limits (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  sends_in_window integer not null default 0 check (sends_in_window between 0 and 5),
  last_sent_at timestamptz not null default now()
);

create index whatsapp_verification_rate_window_idx
  on public.whatsapp_verification_rate_limits (window_started_at);
create index whatsapp_phone_rate_window_idx
  on public.whatsapp_phone_verification_rate_limits (window_started_at);

create table public.whatsapp_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (
    event_type in ('expense', 'invitation', 'reminder', 'settlement')
  ),
  event_id uuid not null,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  discarded_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (event_type, group_id, event_id, recipient_id)
);

create index whatsapp_outbox_available_idx
  on public.whatsapp_notification_outbox (available_at, created_at)
  where sent_at is null and discarded_at is null;

alter table public.whatsapp_preferences enable row level security;
alter table public.whatsapp_verification_codes enable row level security;
alter table public.whatsapp_verification_rate_limits enable row level security;
alter table public.whatsapp_phone_verification_rate_limits enable row level security;
alter table public.whatsapp_notification_outbox enable row level security;

revoke all on table public.whatsapp_preferences,
  public.whatsapp_verification_codes,
  public.whatsapp_verification_rate_limits,
  public.whatsapp_phone_verification_rate_limits,
  public.whatsapp_notification_outbox
from public, anon, authenticated;
grant all on table public.whatsapp_preferences,
  public.whatsapp_verification_codes,
  public.whatsapp_verification_rate_limits,
  public.whatsapp_phone_verification_rate_limits,
  public.whatsapp_notification_outbox
to service_role;

create or replace function public.request_whatsapp_verification(
  p_user_id uuid,
  p_phone_e164 text,
  p_code_hash text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate public.whatsapp_verification_rate_limits%rowtype;
  v_rate_exists boolean;
  v_phone_rate public.whatsapp_phone_verification_rate_limits%rowtype;
  v_phone_rate_exists boolean;
  v_phone_hash text;
begin
  if p_user_id is null
    or p_phone_e164 is null
    or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
    or p_code_hash is null
    or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Verification details are invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('phone:' || p_phone_e164, 0));
  v_phone_hash := encode(extensions.digest(p_phone_e164, 'sha256'), 'hex');
  delete from public.whatsapp_verification_rate_limits
  where window_started_at <= now() - interval '24 hours';
  delete from public.whatsapp_phone_verification_rate_limits
  where window_started_at <= now() - interval '24 hours';

  select * into v_rate
  from public.whatsapp_verification_rate_limits
  where user_id = p_user_id
  for update;

  v_rate_exists := found;

  if v_rate_exists and v_rate.last_sent_at > now() - interval '60 seconds' then
    raise exception 'Wait before requesting another verification code';
  end if;
  if v_rate_exists and v_rate.window_started_at > now() - interval '1 hour'
    and v_rate.sends_in_window >= 5 then
    raise exception 'Verification code request limit reached';
  end if;

  select * into v_phone_rate
  from public.whatsapp_phone_verification_rate_limits
  where phone_hash = v_phone_hash
  for update;
  v_phone_rate_exists := found;

  if v_phone_rate_exists
    and v_phone_rate.last_sent_at > now() - interval '60 seconds' then
    raise exception 'Wait before requesting another verification code';
  end if;
  if v_phone_rate_exists
    and v_phone_rate.window_started_at > now() - interval '1 hour'
    and v_phone_rate.sends_in_window >= 5 then
    raise exception 'Verification code request limit reached';
  end if;

  if v_rate_exists then
    update public.whatsapp_verification_rate_limits
    set
      window_started_at = case
        when window_started_at <= now() - interval '1 hour' then now()
        else window_started_at
      end,
      sends_in_window = case
        when window_started_at <= now() - interval '1 hour' then 1
        else sends_in_window + 1
      end,
      last_sent_at = now()
    where user_id = p_user_id;
  else
    insert into public.whatsapp_verification_rate_limits (
      user_id, window_started_at, sends_in_window, last_sent_at
    )
    values (p_user_id, now(), 1, now());
  end if;

  if v_phone_rate_exists then
    update public.whatsapp_phone_verification_rate_limits
    set
      window_started_at = case
        when window_started_at <= now() - interval '1 hour' then now()
        else window_started_at
      end,
      sends_in_window = case
        when window_started_at <= now() - interval '1 hour' then 1
        else sends_in_window + 1
      end,
      last_sent_at = now()
    where phone_hash = v_phone_hash;
  else
    insert into public.whatsapp_phone_verification_rate_limits (
      phone_hash, window_started_at, sends_in_window, last_sent_at
    )
    values (v_phone_hash, now(), 1, now());
  end if;

  insert into public.whatsapp_verification_codes (
    user_id, phone_e164, code_hash, expires_at, attempts
  )
  values (
    p_user_id, p_phone_e164, p_code_hash, now() + interval '10 minutes', 0
  )
  on conflict (user_id) do update
  set
    phone_e164 = excluded.phone_e164,
    code_hash = excluded.code_hash,
    expires_at = excluded.expires_at,
    attempts = 0;
end;
$$;

create or replace function public.verify_whatsapp_code(
  p_user_id uuid,
  p_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.whatsapp_verification_codes%rowtype;
begin
  if p_user_id is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select * into v_code
  from public.whatsapp_verification_codes
  where user_id = p_user_id
  for update;

  if not found or v_code.expires_at <= now() or v_code.attempts >= 5 then
    delete from public.whatsapp_verification_codes where user_id = p_user_id;
    return false;
  end if;

  if v_code.code_hash <> p_code_hash then
    update public.whatsapp_verification_codes
    set attempts = attempts + 1
    where user_id = p_user_id;
    return false;
  end if;

  insert into public.whatsapp_preferences (
    user_id, phone_e164, phone_verified_at, opted_in_at, updated_at
  )
  values (p_user_id, v_code.phone_e164, now(), null, now())
  on conflict (user_id) do update
  set
    phone_e164 = excluded.phone_e164,
    phone_verified_at = excluded.phone_verified_at,
    opted_in_at = case
      when public.whatsapp_preferences.phone_e164 = excluded.phone_e164
        then public.whatsapp_preferences.opted_in_at
      else null
    end,
    updated_at = now();

  delete from public.whatsapp_verification_codes where user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.enqueue_whatsapp_group_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
  v_event_id uuid;
  v_actor_id uuid;
  v_joined_user_id uuid;
  v_event_type text;
  v_target_id uuid;
begin
  v_group_id := new.group_id;

  if tg_table_name = 'expenses' then
    v_event_id := new.id;
    v_event_type := 'expense';
    v_actor_id := new.created_by;
  elsif tg_table_name = 'settlements' then
    v_event_id := new.id;
    v_event_type := 'settlement';
    v_actor_id := new.created_by;
  elsif tg_table_name = 'reminders' then
    v_event_id := new.id;
    v_event_type := 'reminder';
    v_actor_id := new.created_by;
  elsif tg_table_name = 'group_members' then
    v_event_type := 'invitation';
    v_event_id := new.user_id;
    v_joined_user_id := new.user_id;
    v_actor_id := coalesce((select auth.uid()), new.user_id);
  elsif tg_table_name = 'group_invites' then
    v_event_type := 'invitation';
    v_event_id := new.id;
    v_actor_id := new.created_by;
  else
    return new;
  end if;

  if v_event_type = 'reminder' then
    v_target_id := new.recipient_id;
    insert into public.whatsapp_notification_outbox (
      group_id, recipient_id, event_type, event_id
    )
    select v_group_id, v_target_id, v_event_type, v_event_id
    from public.whatsapp_preferences p
    where p.user_id = v_target_id
      and p.phone_e164 is not null
      and p.phone_verified_at is not null
      and p.opted_in_at is not null
      and p.reminder_alerts
    on conflict do nothing;
  else
    insert into public.whatsapp_notification_outbox (
      group_id, recipient_id, event_type, event_id
    )
    select v_group_id, gm.user_id, v_event_type, v_event_id
    from public.group_members gm
    join public.whatsapp_preferences p on p.user_id = gm.user_id
    where gm.group_id = v_group_id
      and gm.user_id <> v_actor_id
      and (v_joined_user_id is null or gm.user_id <> v_joined_user_id)
      and p.phone_e164 is not null
      and p.phone_verified_at is not null
      and p.opted_in_at is not null
      and case v_event_type
        when 'expense' then p.expense_alerts
        when 'invitation' then p.invitation_alerts
        when 'settlement' then p.settlement_alerts
        else false
      end
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger whatsapp_expense_event
  after insert on public.expenses
  for each row execute function public.enqueue_whatsapp_group_event();
create trigger whatsapp_settlement_event
  after insert on public.settlements
  for each row execute function public.enqueue_whatsapp_group_event();
create trigger whatsapp_reminder_event
  after insert on public.reminders
  for each row execute function public.enqueue_whatsapp_group_event();
create trigger whatsapp_group_invitation_event
  after insert on public.group_members
  for each row execute function public.enqueue_whatsapp_group_event();
create trigger whatsapp_group_invite_created_event
  after insert on public.group_invites
  for each row execute function public.enqueue_whatsapp_group_event();

create or replace function public.claim_whatsapp_notification_batch(p_limit integer default 10)
returns table (
  id uuid,
  group_id uuid,
  recipient_id uuid,
  event_type text,
  phone_e164 text,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.whatsapp_notification_outbox o
  set discarded_at = now(), last_error = 'recipient_not_currently_eligible'
  where o.sent_at is null
    and o.discarded_at is null
    and not exists (
      select 1
      from public.whatsapp_preferences p
      join public.group_members gm
        on gm.user_id = p.user_id and gm.group_id = o.group_id
      where p.user_id = o.recipient_id
        and p.phone_e164 is not null
        and p.phone_verified_at is not null
        and p.opted_in_at is not null
        and case o.event_type
          when 'expense' then p.expense_alerts
          when 'invitation' then p.invitation_alerts
          when 'reminder' then p.reminder_alerts
          when 'settlement' then p.settlement_alerts
          else false
        end
    );

  return query
  with candidates as (
    select o.id
    from public.whatsapp_notification_outbox o
    where o.sent_at is null
      and o.discarded_at is null
      and o.available_at <= now()
      and (o.locked_until is null or o.locked_until <= now())
    order by o.available_at, o.created_at, o.id
    limit greatest(1, least(coalesce(p_limit, 10), 25))
    for update skip locked
  ),
  claimed as (
    update public.whatsapp_notification_outbox o
    set locked_until = now() + interval '5 minutes',
        attempts = o.attempts + 1
    from candidates c
    where o.id = c.id
    returning o.id, o.group_id, o.recipient_id, o.event_type, o.attempts
  )
  select c.id, c.group_id, c.recipient_id, c.event_type, p.phone_e164, c.attempts
  from claimed c
  join public.whatsapp_preferences p on p.user_id = c.recipient_id;
end;
$$;

create or replace function public.get_recent_transactions(
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 21
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
  person_b_id uuid
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
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
      null::uuid as person_b_id
    from public.expenses e
    join public.groups g on g.id = e.group_id
    join public.group_members gm on gm.group_id = e.group_id
    where gm.user_id = (select auth.uid())

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
      s.to_user_id as person_b_id
    from public.settlements s
    join public.groups g on g.id = s.group_id
    join public.group_members gm on gm.group_id = s.group_id
    where gm.user_id = (select auth.uid())
  )
  select
    t.id, t.group_id, t.group_name, t.currency, t.kind, t.description,
    t.amount_minor, t.created_at, t.person_a_id, t.person_b_id
  from transactions t
  where p_before_created_at is null
    or (t.created_at, t.id) < (p_before_created_at, p_before_id)
  order by t.created_at desc, t.id desc
  limit greatest(1, least(coalesce(p_limit, 21), 21));
$$;

revoke all on function public.request_whatsapp_verification(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.verify_whatsapp_code(uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_whatsapp_notification_batch(integer)
  from public, anon, authenticated;
grant execute on function public.request_whatsapp_verification(uuid, text, text)
  to service_role;
grant execute on function public.verify_whatsapp_code(uuid, text)
  to service_role;
grant execute on function public.claim_whatsapp_notification_batch(integer)
  to service_role;

revoke all on function public.get_recent_transactions(timestamptz, uuid, integer)
  from public, anon;
grant execute on function public.get_recent_transactions(timestamptz, uuid, integer)
  to authenticated;