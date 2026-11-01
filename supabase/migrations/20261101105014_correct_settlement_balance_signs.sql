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
    select st.to_user_id, st.group_id, -st.amount_minor
    from public.settlements st
    union all
    select st.from_user_id, st.group_id, st.amount_minor
    from public.settlements st
  ) entries on entries.user_id = gm.user_id and entries.group_id = gm.group_id
  where gm.group_id = p_group_id
  group by gm.user_id;
end;
$$;