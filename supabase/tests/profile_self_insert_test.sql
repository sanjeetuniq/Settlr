BEGIN;
SELECT plan(3);

SELECT ok(
  has_column_privilege('authenticated', 'public.profiles', 'id', 'insert')
  and has_column_privilege('authenticated', 'public.profiles', 'display_name', 'insert')
  and not has_table_privilege('authenticated', 'public.profiles', 'insert'),
  'authenticated users can insert only profile IDs and display names'
);

SELECT ok(
  not has_table_privilege('anon', 'public.profiles', 'insert'),
  'anonymous users cannot insert profiles'
);

SELECT ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Users create their own profile'
      and cmd = 'INSERT'
      and 'authenticated' = any(roles)
      and position('auth.uid()' in with_check) > 0
      and position('id' in with_check) > 0
  ),
  'the insert policy limits profile creation to the signed-in user'
);

SELECT * FROM finish();
ROLLBACK;
