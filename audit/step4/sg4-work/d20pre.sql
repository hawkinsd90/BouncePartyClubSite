select (select md5(prosrc) from pg_proc where proname='update_contact_booking_stats' and pronamespace='public'::regnamespace) f1,
 (select md5(prosrc) from pg_proc where proname='update_contact_stats' and pronamespace='public'::regnamespace) f2,
 (select string_agg(tgname,',' order by tgname) from pg_trigger where tgrelid='public.orders'::regclass and not tgisinternal and tgname like '%contact%') trg,
 (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('refresh_contact_booking_stats')) new_fn,
 (select count(*) from public.contacts) contacts, (select count(*) from public.orders) orders;
