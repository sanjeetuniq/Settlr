revoke insert on table public.profiles from anon, authenticated;
grant insert (id, display_name) on table public.profiles to authenticated;

create policy "Users create their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));