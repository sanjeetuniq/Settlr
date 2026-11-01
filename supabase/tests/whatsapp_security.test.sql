begin;

select plan(17);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.whatsapp_preferences'::regclass),
  'WhatsApp preferences enable row-level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.whatsapp_verification_codes'::regclass),
  'verification codes enable row-level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.whatsapp_verification_rate_limits'::regclass),
  'verification rate limits enable row-level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.whatsapp_phone_verification_rate_limits'::regclass),
  'per-phone verification rate limits enable row-level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.whatsapp_notification_outbox'::regclass),
  'notification outbox enables row-level security'
);
select ok(
  not has_table_privilege('anon', 'public.whatsapp_preferences', 'select'),
  'anonymous users cannot read WhatsApp preferences'
);
select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_preferences', 'select'),
  'authenticated clients cannot read WhatsApp preferences directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_verification_codes', 'select'),
  'authenticated clients cannot read verification codes'
);
select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_verification_rate_limits', 'select'),
  'authenticated clients cannot read verification rate limits'
);
select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_phone_verification_rate_limits', 'select'),
  'authenticated clients cannot read per-phone rate limits'
);
select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_notification_outbox', 'insert'),
  'authenticated clients cannot enqueue notifications'
);
select ok(
  has_table_privilege('service_role', 'public.whatsapp_notification_outbox', 'select'),
  'the server worker can access the notification outbox'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.request_whatsapp_verification(uuid,text,text)',
    'execute'
  ),
  'anonymous users cannot request verification codes'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.request_whatsapp_verification(uuid,text,text)',
    'execute'
  ),
  'browser-authenticated users cannot access verification internals'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.request_whatsapp_verification(uuid,text,text)',
    'execute'
  ),
  'only the server role can reserve a verification code'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.claim_whatsapp_notification_batch(integer)',
    'execute'
  ),
  'anonymous users cannot claim notification jobs'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_recent_transactions(timestamptz,uuid,integer)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.get_recent_transactions(timestamptz,uuid,integer)',
    'execute'
  ),
  'transaction history is available only to signed-in clients'
);

select * from finish();
rollback;
