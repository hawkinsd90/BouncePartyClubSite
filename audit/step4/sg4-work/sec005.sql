select lower(u.email) like 'admin@%' as is_demo, u.id::text like 'baa7b068%' as demo_id, u.banned_until is not null and u.banned_until > now() as banned, u.banned_until,
 (select count(*) from auth.refresh_tokens r where r.user_id = u.id::text and not r.revoked) as active_refresh_tokens,
 (select count(*) from public.user_roles r where r.user_id = u.id) as role_rows, u.last_sign_in_at
from auth.users u where lower(u.email) = 'admin@bouncepartyclub.com' or u.email ilike 'ad%@offline4ever.com';
