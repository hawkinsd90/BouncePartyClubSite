// Executed scenarios for the role assignment / signup provisioning repair.
//
// A scratch PostgreSQL database holds the repository migrations. Each script starts a transaction, optionally recreates a
// pre-state (for example the live Dev constraint state), applies the migration text, seeds a small fixture of auth users and
// roles, then runs every scenario in its own rolled-back subtransaction as the real database role (anon / authenticated /
// service_role / postgres) with the JWT subject set. A scenario returns the call's result (or ERR:<sqlstate>:<message>) and,
// optionally, a state query run afterwards as the owner, joined as "result || state". Nothing is committed and no Supabase
// project is touched.

export const MASTER = '00000000-0000-4000-8000-0000000000e1';
export const ADMIN = '00000000-0000-4000-8000-0000000000e2';
export const ADMIN2 = '00000000-0000-4000-8000-0000000000e3';
export const CREW = '00000000-0000-4000-8000-0000000000e4';
export const CUSTOMER = '00000000-0000-4000-8000-0000000000e5';
export const NOROLE = '00000000-0000-4000-8000-0000000000e6';
export const TARGET = '00000000-0000-4000-8000-0000000000f1'; // a customer
export const TARGET_NOROLE = '00000000-0000-4000-8000-0000000000f2';
export const TARGET_CREW = '00000000-0000-4000-8000-0000000000f3';
export const TARGET_ADMIN = '00000000-0000-4000-8000-0000000000f4';
export const TARGET_MASTER = '00000000-0000-4000-8000-0000000000f5';
export const TARGET_MULTI = '00000000-0000-4000-8000-0000000000f6'; // legacy: customer + crew + admin rows
export const TARGET_MULTI_LOW = '00000000-0000-4000-8000-0000000000f7'; // legacy: customer + crew rows
export const CALLER_MULTI = '00000000-0000-4000-8000-0000000000f8'; // customer + admin rows
export const CALLER_MULTI_TOP = '00000000-0000-4000-8000-0000000000f9'; // admin + master rows

export const TOTAL_ROLE_ROWS = 18;
export const email = (id: string) => `u-${id.slice(-2)}@example.test`;

const USERS: Array<[string, string[]]> = [
  [MASTER, ['master']], [ADMIN, ['admin']], [ADMIN2, ['admin']], [CREW, ['crew']], [CUSTOMER, ['customer']], [NOROLE, []],
  [TARGET, ['customer']], [TARGET_NOROLE, []], [TARGET_CREW, ['crew']], [TARGET_ADMIN, ['admin']], [TARGET_MASTER, ['master']],
  [TARGET_MULTI, ['customer', 'crew', 'admin']], [TARGET_MULTI_LOW, ['customer', 'crew']],
  [CALLER_MULTI, ['customer', 'admin']], [CALLER_MULTI_TOP, ['admin', 'master']],
];

// Auth users and role rows. The signup trigger is switched off for the fixture (and switched on by the signup scenarios).
export const FIXTURE_SQL = `
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email) VALUES ${USERS.map(([id]) => `('${id}', '${email(id)}')`).join(', ')};
INSERT INTO public.user_roles (user_id, role, created_at) VALUES ${USERS.flatMap(([id, roles]) => roles.map((r, i) => `('${id}', '${r}', now() - interval '${10 - i} minutes')`)).join(', ')};
`;

export interface RoleScenario {
  name: string;
  setup?: string;
  role: 'anon' | 'authenticated' | 'service_role' | 'postgres';
  uid: string | null;
  call: string;
  after?: string;
  expect: string | ((v: string) => boolean);
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
export const roleOf = (id: string) => `SELECT coalesce(string_agg(role, ',' ORDER BY role), 'none') FROM public.user_roles WHERE user_id = '${id}'`;
export const assign = (mail: string, role: string | null) => `SELECT public.assign_role_by_email(${q(mail)}, ${role === null ? 'NULL' : q(role)})::text`;
const ERR = (state: string, message: string) => (v: string) => v.startsWith(`ERR:${state}:`) && v.includes(message);

export function buildRoleScript(opts: { preMigrationSql?: string; migrationSql?: string; fixtureSql?: string; scenarios: RoleScenario[] }): string {
  const calls = opts.scenarios.map((sc, i) => {
    const uid = sc.uid ? `'${sc.uid}'::uuid` : 'NULL::uuid';
    return `  RAISE NOTICE 'R|${i}|%', pg_temp.probe(${q(sc.setup ?? '')}, '${sc.role}', ${uid}, ${q(sc.call)}, ${q(sc.after ?? '')});`;
  });
  return `
BEGIN;
${opts.preMigrationSql ?? ''}
${opts.migrationSql ?? ''}
${opts.fixtureSql ?? FIXTURE_SQL}
CREATE FUNCTION pg_temp.probe(setup text, r text, uid uuid, qry text, after_qry text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE res text; st text;
BEGIN
  BEGIN
    IF setup <> '' THEN EXECUTE setup; END IF;
    PERFORM set_config('request.jwt.claim.sub', COALESCE(uid::text, ''), true);
    PERFORM set_config('request.jwt.claim.role', r, true);
    IF r <> 'postgres' THEN EXECUTE 'SET LOCAL ROLE ' || quote_ident(r); END IF;
    BEGIN
      EXECUTE qry INTO res;
    EXCEPTION WHEN OTHERS THEN
      res := 'ERR:' || SQLSTATE || ':' || SQLERRM;
    END;
    RESET ROLE;
    IF after_qry <> '' THEN EXECUTE after_qry INTO st; END IF;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  RETURN COALESCE(res, 'NULL') || CASE WHEN after_qry <> '' THEN ' || ' || COALESCE(st, 'NULL') ELSE '' END;
END $f$;
DO $run$
BEGIN
${calls.join('\n')}
END $run$;
ROLLBACK;
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// assign_role_by_email
// ---------------------------------------------------------------------------------------------------------------------
export function assignmentScenarios(): RoleScenario[] {
  const s: RoleScenario[] = [];
  const add = (name: string, role: RoleScenario['role'], uid: string | null, call: string, expect: RoleScenario['expect'], after?: string, setup?: string) =>
    s.push({ name, role, uid, call, expect, after, setup });
  const T = email(TARGET);

  // ---- who may call it ----
  add('anonymous visitor cannot execute it', 'anon', null, assign(T, 'crew'), (v) => v.startsWith('ERR:42501'));
  add('a signed-in user who is not staff is refused (customer)', 'authenticated', CUSTOMER, assign(T, 'crew'), ERR('P0001', 'Only admin or master users can assign roles'), roleOf(TARGET));
  add('crew is refused', 'authenticated', CREW, assign(T, 'crew'), ERR('P0001', 'Only admin or master users can assign roles'), roleOf(TARGET));
  add('a user with no role row is refused', 'authenticated', NOROLE, assign(T, 'crew'), ERR('P0001', 'Only admin or master users can assign roles'), roleOf(TARGET));
  add('a signed-in caller without a subject is refused', 'authenticated', null, assign(T, 'crew'), ERR('P0001', 'Only admin or master users can assign roles'));
  add('a customer cannot assign any role, whatever the casing', 'authenticated', CUSTOMER, assign(T, 'MASTER'), ERR('P0001', 'Only admin or master users can assign roles'), roleOf(TARGET));
  add('the customer attempt left the target unchanged', 'authenticated', CUSTOMER, assign(T, 'crew'), (v) => v.endsWith('|| customer'), roleOf(TARGET));
  add('the backend (service role, no subject) is refused: the function is for signed-in Admin / Master', 'service_role', null, assign(T, 'crew'), ERR('P0001', 'Only admin or master users can assign roles'));

  // ---- Admin: crew only ----
  add('Admin assigns crew to a signed-up customer through Add User: true, the customer role is replaced by crew (the form is the only way to promote a customer)', 'authenticated', ADMIN, assign(T, 'crew'), 'true || crew', roleOf(TARGET));
  add('Admin assigns crew to a user with no role: true', 'authenticated', ADMIN, assign(email(TARGET_NOROLE), 'crew'), 'true || crew', roleOf(TARGET_NOROLE));
  add('Admin re-assigns the same role: true, still exactly one row', 'authenticated', ADMIN, assign(email(TARGET_CREW), 'crew'), 'true || crew', roleOf(TARGET_CREW));
  add('re-assigning the same role keeps the same row (no churn)', 'authenticated', ADMIN, assign(email(TARGET_CREW), 'crew'), (v) => v === 'true || 1', `SELECT count(*)::text FROM public.user_roles WHERE user_id = '${TARGET_CREW}'`);
  add('mixed case with spaces is one request: " CrEw " -> crew', 'authenticated', ADMIN, assign(T, ' CrEw '), 'true || crew', roleOf(TARGET));
  add('the stored value is always the lowercase canonical form', 'authenticated', ADMIN, assign(T, 'CREW'), (v) => v === 'true || 0', `SELECT count(*)::text FROM public.user_roles WHERE role <> lower(role)`);
  add('email lookup ignores case and surrounding whitespace', 'authenticated', ADMIN, assign(` ${T.toUpperCase()} `, 'crew'), 'true || crew', roleOf(TARGET));

  // ---- policy matrix (Permissions screen: Add User offers Admins crew only; staff targets are Master-only) ----
  add('policy: Admin + no-role target -> crew allowed', 'authenticated', ADMIN, assign(email(TARGET_NOROLE), 'crew'), 'true || crew', roleOf(TARGET_NOROLE));
  add('policy: Admin + customer target -> crew allowed (promotion), and no customer row remains', 'authenticated', ADMIN, assign(email(TARGET), 'crew'), 'true || crew', roleOf(TARGET));
  add('policy: Admin + customer target -> admin denied, customer unchanged', 'authenticated', ADMIN, assign(email(TARGET), 'admin'), ERR('P0001', 'Only master users can assign the admin role'), roleOf(TARGET));
  add('policy: Admin + customer target -> master denied, customer unchanged', 'authenticated', ADMIN, assign(email(TARGET), 'Master'), ERR('P0001', 'Only master users can assign the master role'), roleOf(TARGET));
  add('policy: Admin + crew target -> crew allowed (retained)', 'authenticated', ADMIN, assign(email(TARGET_CREW), 'crew'), 'true || crew', roleOf(TARGET_CREW));
  add('policy: Admin + admin target -> crew denied', 'authenticated', ADMIN, assign(email(TARGET_ADMIN), 'crew'), ERR('P0001', 'Only master users can change an admin or master'), roleOf(TARGET_ADMIN));
  add('policy: Admin + master target -> crew denied', 'authenticated', ADMIN, assign(email(TARGET_MASTER), 'crew'), ERR('P0001', 'Only master users can change an admin or master'), roleOf(TARGET_MASTER));
  add('policy: Admin -> admin denied', 'authenticated', ADMIN, assign(email(TARGET_NOROLE), 'admin'), ERR('P0001', 'Only master users can assign the admin role'), roleOf(TARGET_NOROLE));
  add('policy: Admin -> master denied', 'authenticated', ADMIN, assign(email(TARGET_NOROLE), 'master'), ERR('P0001', 'Only master users can assign the master role'), roleOf(TARGET_NOROLE));
  add('policy: Master + customer target -> crew allowed', 'authenticated', MASTER, assign(email(TARGET), 'crew'), 'true || crew', roleOf(TARGET));
  add('policy: Master + customer target -> admin allowed', 'authenticated', MASTER, assign(email(TARGET), 'admin'), 'true || admin', roleOf(TARGET));
  add('policy: Master + customer target -> master allowed', 'authenticated', MASTER, assign(email(TARGET), 'master'), 'true || master', roleOf(TARGET));
  add('policy: Master + admin target -> crew allowed', 'authenticated', MASTER, assign(email(TARGET_ADMIN), 'crew'), 'true || crew', roleOf(TARGET_ADMIN));
  add('policy: Master + master target -> admin allowed', 'authenticated', MASTER, assign(email(TARGET_MASTER), 'admin'), 'true || admin', roleOf(TARGET_MASTER));

  // ---- Admin may not grant master or admin: no case bypass ----
  for (const attempt of ['master', 'MASTER', 'Master', 'mAsTeR', ' master ', 'master ', ' MASTER', '\tMASTER\n', 'MaStEr']) {
    add(`Admin cannot assign master as ${JSON.stringify(attempt)}`, 'authenticated', ADMIN, assign(T, attempt), ERR('P0001', 'Only master users can assign the master role'), roleOf(TARGET));
    add(`... and the target is unchanged after ${JSON.stringify(attempt)}`, 'authenticated', ADMIN, assign(T, attempt), (v) => v.endsWith('|| customer'), roleOf(TARGET));
  }
  for (const attempt of ['admin', 'ADMIN', 'Admin', ' aDmIn ']) {
    add(`Admin cannot assign admin as ${JSON.stringify(attempt)}`, 'authenticated', ADMIN, assign(T, attempt), ERR('P0001', 'Only master users can assign the admin role'), roleOf(TARGET));
  }
  add('Admin cannot make themselves master', 'authenticated', ADMIN, assign(email(ADMIN), 'MASTER'), ERR('P0001', 'Only master users can assign the master role'), roleOf(ADMIN));
  add('Admin cannot change an existing admin', 'authenticated', ADMIN, assign(email(TARGET_ADMIN), 'crew'), ERR('P0001', 'Only master users can change an admin or master'), roleOf(TARGET_ADMIN));
  add('Admin cannot change another admin even to crew (unchanged)', 'authenticated', ADMIN, assign(email(ADMIN2), 'crew'), (v) => v.startsWith('ERR:P0001:'), roleOf(ADMIN2));
  add('Admin cannot demote a master', 'authenticated', ADMIN, assign(email(TARGET_MASTER), 'crew'), ERR('P0001', 'Only master users can change an admin or master'), roleOf(TARGET_MASTER));
  add('Admin cannot demote themselves through this function', 'authenticated', ADMIN, assign(email(ADMIN), 'crew'), ERR('P0001', 'Only master users can change an admin or master'), roleOf(ADMIN));
  add('Admin cannot reach an admin hidden among a legacy multi-role target', 'authenticated', ADMIN, assign(email(TARGET_MULTI), 'crew'), ERR('P0001', 'Only master users can change an admin or master'), roleOf(TARGET_MULTI));

  // ---- Master ----
  add('Master assigns master: true', 'authenticated', MASTER, assign(T, 'master'), 'true || master', roleOf(TARGET));
  add('Master assigns MASTER: stored as master', 'authenticated', MASTER, assign(T, 'MASTER'), 'true || master', roleOf(TARGET));
  add('Master assigns admin: true', 'authenticated', MASTER, assign(T, 'admin'), 'true || admin', roleOf(TARGET));
  add('Master assigns crew: true', 'authenticated', MASTER, assign(T, 'crew'), 'true || crew', roleOf(TARGET));
  add('Master replaces a crew role with admin', 'authenticated', MASTER, assign(email(TARGET_CREW), 'admin'), 'true || admin', roleOf(TARGET_CREW));
  add('Master changes an admin', 'authenticated', MASTER, assign(email(TARGET_ADMIN), 'crew'), 'true || crew', roleOf(TARGET_ADMIN));
  add('Master changes another master', 'authenticated', MASTER, assign(email(TARGET_MASTER), 'admin'), 'true || admin', roleOf(TARGET_MASTER));

  // ---- invalid input ----
  for (const bad of ['owner', '', '   ', 'customer', 'Customer', 'dispatcher', 'crew,admin', "crew'; DROP TABLE public.user_roles; --", 'ma ster', 'masters', 'crew\u0000x'.replace('\u0000', '')]) {
    for (const [label, uid] of [['Admin', ADMIN], ['Master', MASTER]] as Array<[string, string]>) {
      add(`${label} is refused an invalid role ${JSON.stringify(bad)}`, 'authenticated', uid, assign(T, bad), ERR('P0001', 'Invalid role'), roleOf(TARGET));
    }
  }
  add('a NULL role is refused', 'authenticated', MASTER, assign(T, null), ERR('P0001', 'Invalid role'), roleOf(TARGET));
  add('an invalid role does not touch the target', 'authenticated', MASTER, assign(T, 'owner'), (v) => v.endsWith('|| customer'), roleOf(TARGET));
  add('an invalid role is checked before the email is looked up', 'authenticated', MASTER, assign('nobody@example.test', 'owner'), ERR('P0001', 'Invalid role'));

  // ---- unknown email keeps its contract ----
  add('unknown email: false (not an exception) for Master', 'authenticated', MASTER, assign('nobody@example.test', 'crew'), 'false');
  add('unknown email: false (not an exception) for Admin', 'authenticated', ADMIN, assign('nobody@example.test', 'crew'), 'false');
  add('unknown email changes no role', 'authenticated', ADMIN, assign('nobody@example.test', 'crew'), 'false || ' + TOTAL_ROLE_ROWS, 'SELECT count(*)::text FROM public.user_roles');
  add('a blank email is the unknown-email case', 'authenticated', MASTER, assign('   ', 'crew'), 'false');

  // ---- legacy: more than one row ----
  add('legacy multi-row target: Master assigns crew -> exactly one crew row', 'authenticated', MASTER, assign(email(TARGET_MULTI), 'crew'), 'true || crew', roleOf(TARGET_MULTI));
  add('legacy multi-row target: Master assigns master -> exactly one master row', 'authenticated', MASTER, assign(email(TARGET_MULTI), 'master'), 'true || master', roleOf(TARGET_MULTI));
  add('legacy multi-row target: Master assigns admin -> exactly one admin row', 'authenticated', MASTER, assign(email(TARGET_MULTI), 'admin'), 'true || admin', roleOf(TARGET_MULTI));
  add('legacy multi-row target without an admin row: Admin assigns crew -> exactly one crew row', 'authenticated', ADMIN, assign(email(TARGET_MULTI_LOW), 'crew'), 'true || crew', roleOf(TARGET_MULTI_LOW));
  add('the surviving row is the one that already held the requested role', 'authenticated', MASTER, assign(email(TARGET_MULTI), 'crew'), 'true || true',
    `SELECT ((SELECT id::text FROM public.user_roles WHERE user_id = '${TARGET_MULTI}') = current_setting('t.keep'))::text`,
    `SELECT set_config('t.keep', (SELECT id::text FROM public.user_roles WHERE user_id = '${TARGET_MULTI}' AND role = 'crew'), true)`);
  add('running the same assignment twice leaves the same single row', 'authenticated', MASTER,
    `SELECT public.assign_role_by_email(${q(email(TARGET_MULTI))}, 'crew')::text || public.assign_role_by_email(${q(email(TARGET_MULTI))}, 'crew')::text`, 'truetrue || crew', roleOf(TARGET_MULTI));
  add('a caller with customer + admin rows is an admin (crew allowed)', 'authenticated', CALLER_MULTI, assign(T, 'crew'), 'true || crew', roleOf(TARGET));
  add('a caller with customer + admin rows cannot assign master', 'authenticated', CALLER_MULTI, assign(T, 'MASTER'), ERR('P0001', 'Only master users can assign the master role'), roleOf(TARGET));
  add('a caller with admin + master rows is a master (can assign master), whatever order the rows come back', 'authenticated', CALLER_MULTI_TOP, assign(T, 'master'), 'true || master', roleOf(TARGET));

  // ---- concurrency-free invariants and grants ----
  add('anon holds no EXECUTE on the function', 'postgres', null, `SELECT has_function_privilege('anon', 'public.assign_role_by_email(text,text)', 'EXECUTE')::text`, 'false');
  add('authenticated holds EXECUTE (the Permissions screen calls it with the signed-in session)', 'postgres', null, `SELECT has_function_privilege('authenticated', 'public.assign_role_by_email(text,text)', 'EXECUTE')::text`, 'true');
  add('PUBLIC holds no EXECUTE', 'postgres', null, `SELECT (SELECT coalesce(proacl::text, '') ~ '(^|[{,])=X' FROM pg_proc WHERE oid = 'public.assign_role_by_email(text,text)'::regprocedure)::text`, 'false');
  add('the function is SECURITY DEFINER with a fixed search_path', 'postgres', null, `SELECT (prosecdef AND proconfig::text ~ 'search_path=public')::text FROM pg_proc WHERE oid = 'public.assign_role_by_email(text,text)'::regprocedure`, 'true');
  add('the function never relies on ON CONFLICT (user_id)', 'postgres', null, `SELECT (pg_get_functiondef('public.assign_role_by_email(text,text)'::regprocedure) ~* 'ON CONFLICT \\(user_id\\)')::text`, 'false');

  // ---- the CHECK ----
  for (const role of ['master', 'admin', 'crew', 'customer']) {
    add(`CHECK accepts the canonical role ${role}`, 'postgres', null, `INSERT INTO public.user_roles (user_id, role) VALUES ('${NOROLE}', '${role}') RETURNING 'ok'`, 'ok');
  }
  for (const role of ['MASTER', 'ADMIN', 'CREW', 'CUSTOMER', 'Master', 'Customer', ' crew', 'crew ', 'owner', 'dispatcher', '']) {
    add(`CHECK rejects the stored value ${JSON.stringify(role)}`, 'postgres', null, `INSERT INTO public.user_roles (user_id, role) VALUES ('${NOROLE}', ${q(role)}) RETURNING 'ok'`, (v) => v.startsWith('ERR:23514'));
  }
  add('UNIQUE (user_id, role) is kept: the same role twice is rejected', 'postgres', null, `INSERT INTO public.user_roles (user_id, role) VALUES ('${CUSTOMER}', 'customer') RETURNING 'ok'`, (v) => v.startsWith('ERR:23505'));
  add('no UNIQUE (user_id) was added: a second, different role row is still allowed by the table', 'postgres', null, `INSERT INTO public.user_roles (user_id, role) VALUES ('${CUSTOMER}', 'crew') RETURNING 'ok'`, 'ok');
  add('the foreign key to auth.users is in place', 'postgres', null, `INSERT INTO public.user_roles (user_id, role) VALUES ('99999999-0000-4000-8000-000000000001', 'crew') RETURNING 'ok'`, (v) => v.startsWith('ERR:23503'));
  add('deleting an auth user removes their role rows (ON DELETE CASCADE)', 'postgres', null, `DELETE FROM auth.users WHERE id = '${TARGET_CREW}' RETURNING 'deleted'`, 'deleted || 0', `SELECT count(*)::text FROM public.user_roles WHERE user_id = '${TARGET_CREW}'`);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Signup provisioning (the real trigger on auth.users)
// ---------------------------------------------------------------------------------------------------------------------
const NEW = '22222222-0000-4000-8000-000000000001';
const signupMeta = `'{"first_name":"Nia","last_name":"Signup","phone":"5551230001"}'`;
const enableTrigger = `ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;`;
// A test-only second trigger that runs the SAME function again for an existing user (a retry), removed by the rollback.
const retryTrigger = `CREATE TRIGGER zz_retry AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.auto_assign_customer_role();`;
const signUp = (id: string, mail: string) => `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${id}', '${mail}', ${signupMeta}) RETURNING 'signed up'`;
const retry = (id: string) => `UPDATE auth.users SET email = email WHERE id = '${id}' RETURNING 'retried'`;
const provisioned = (id: string, mail: string) => `SELECT concat_ws('/',
  (SELECT coalesce(string_agg(role, ','), 'none') FROM public.user_roles WHERE user_id = '${id}'),
  (SELECT count(*) FROM public.customers WHERE email = '${mail}'),
  (SELECT count(*) FROM public.contacts WHERE email = '${mail}'),
  (SELECT count(*) FROM public.customer_profiles WHERE user_id = '${id}'))`;

export function signupScenarios(): RoleScenario[] {
  const s: RoleScenario[] = [];
  const add = (name: string, setup: string, call: string, expect: RoleScenario['expect'], after?: string) =>
    s.push({ name, setup, role: 'postgres', uid: null, call, expect, after });
  const mail = 'new.signup@example.test';

  add('exactly one trigger runs the signup function: on_auth_user_created, AFTER INSERT, FOR EACH ROW', '', `SELECT string_agg(tgname || ':' || (tgtype & 1)::text || ':' || (tgtype & 2)::text || ':' || (tgtype & 4)::text || ':' || (tgtype & 16)::text, ',') FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal AND tgfoid = 'public.auto_assign_customer_role()'::regprocedure`, 'on_auth_user_created:1:0:4:0');
  add('the trigger is enabled', '', `SELECT tgenabled::text FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created'`, (v) => v === 'D' || v === 'O');
  add('a normal signup is provisioned: customer role / 1 customer / 1 contact / 1 profile', enableTrigger, signUp(NEW, mail), 'signed up || customer/1/1/1', provisioned(NEW, mail));
  add('the new customer is linked to the new user and the profile to that customer', enableTrigger, signUp(NEW, mail), 'signed up || true/true',
    `SELECT concat_ws('/', (SELECT (user_id = '${NEW}')::text FROM public.customers WHERE email = '${mail}'), (SELECT (ct.customer_id = c.id)::text FROM public.customer_profiles cp JOIN public.contacts ct ON ct.id = cp.contact_id JOIN public.customers c ON c.email = '${mail}' WHERE cp.user_id = '${NEW}'))`);
  add('the profile keeps the name from the signup form', enableTrigger, signUp(NEW, mail), 'signed up || Nia Signup',
    `SELECT first_name || ' ' || last_name FROM public.customer_profiles WHERE user_id = '${NEW}'`);
  add('the role is the canonical lowercase value', enableTrigger, signUp(NEW, mail), 'signed up || customer', roleOf(NEW));
  add('the trigger log shows a clean run (no error step)', enableTrigger, signUp(NEW, mail), 'signed up || 0/1',
    `SELECT concat((SELECT count(*) FROM public.auth_trigger_logs WHERE user_id = '${NEW}' AND status = 'error'), '/', (SELECT count(*) FROM public.auth_trigger_logs WHERE user_id = '${NEW}' AND step = 'trigger_complete' AND status = 'success'))`);
  add('after a retry the user still has exactly one customer role', `${enableTrigger} ${retryTrigger} INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${NEW}', '${mail}', ${signupMeta});`, retry(NEW), 'retried || customer/1/1/1', provisioned(NEW, mail));

  // an existing role is never replaced or added to
  for (const role of ['customer', 'crew', 'admin', 'master']) {
    const uid = '33333333-0000-4000-8000-0000000000' + (role === 'customer' ? '01' : role === 'crew' ? '02' : role === 'admin' ? '03' : '04');
    add(`a user who already holds ${role} keeps exactly that role when provisioning runs again`,
      `INSERT INTO auth.users (id, email) VALUES ('${uid}', '${role}.holder@example.test'); INSERT INTO public.user_roles (user_id, role) VALUES ('${uid}', '${role}'); ${enableTrigger} ${retryTrigger}`,
      retry(uid), `retried || ${role}`, roleOf(uid));
  }
  add('provisioning never downgrades an elevated user to customer (admin + master rows both stay)',
    `INSERT INTO auth.users (id, email) VALUES ('33333333-0000-4000-8000-0000000000aa', 'both@example.test'); INSERT INTO public.user_roles (user_id, role) VALUES ('33333333-0000-4000-8000-0000000000aa', 'admin'), ('33333333-0000-4000-8000-0000000000aa', 'master'); ${enableTrigger} ${retryTrigger}`,
    retry('33333333-0000-4000-8000-0000000000aa'), 'retried || admin,master', roleOf('33333333-0000-4000-8000-0000000000aa'));
  add('a signup whose email already belongs to a customer record links that customer',
    `${enableTrigger} INSERT INTO public.customers (id, first_name, last_name, email, phone) VALUES ('44444444-0000-4000-8000-000000000001', 'Old', 'Customer', '${mail}', '555');`,
    signUp(NEW, mail), 'signed up || customer/1/1/1', provisioned(NEW, mail));
  add('... and the existing customer is the one linked to the new user', `${enableTrigger} INSERT INTO public.customers (id, first_name, last_name, email, phone) VALUES ('44444444-0000-4000-8000-000000000001', 'Old', 'Customer', '${mail}', '555');`,
    signUp(NEW, mail), 'signed up || true', `SELECT (user_id = '${NEW}' AND id = '44444444-0000-4000-8000-000000000001')::text FROM public.customers WHERE email = '${mail}'`);

  // error semantics are preserved: signup itself still succeeds when provisioning fails, nothing is half-created, the error is logged
  add('if a later provisioning step fails, the signup still succeeds (existing behaviour)',
    `${enableTrigger} ALTER TABLE public.customer_profiles ADD CONSTRAINT zz_always_fail CHECK (false) NOT VALID;`, signUp(NEW, mail), 'signed up || none/0/0/0', provisioned(NEW, mail));
  add('... and the failure is recorded in auth_trigger_logs',
    `${enableTrigger} ALTER TABLE public.customer_profiles ADD CONSTRAINT zz_always_fail CHECK (false) NOT VALID;`, signUp(NEW, mail), 'signed up || 1',
    `SELECT count(*)::text FROM public.auth_trigger_logs WHERE user_id = '${NEW}' AND status = 'error' AND step = 'create_customer_profile'`);
  add('the function keeps its exception handler', '', `SELECT (pg_get_functiondef('public.auto_assign_customer_role()'::regprocedure) ~ 'EXCEPTION WHEN OTHERS THEN')::text`, 'true');
  add('the signup function is not callable by browser roles', '', `SELECT (has_function_privilege('anon', 'public.auto_assign_customer_role()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.auto_assign_customer_role()', 'EXECUTE'))::text`, 'false');
  add('the signup function never relies on ON CONFLICT (user_id) for user_roles', '', `SELECT (pg_get_functiondef('public.auto_assign_customer_role()'::regprocedure) ~* 'INSERT INTO public.user_roles[^;]*ON CONFLICT \\(user_id\\)')::text`, 'false');
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dev-like pre-state: the live Dev constraint set and data, then the migration on top
// ---------------------------------------------------------------------------------------------------------------------
export const DEV_PRE_SQL = `
-- Dev has no role CHECK, no foreign key to auth.users, no signup trigger, and customer_profiles has first_name / last_name.
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS first_name text, ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE auth.users DISABLE TRIGGER USER;
DELETE FROM public.user_roles;
-- Dev data: lowercase roles only, plus two role rows whose auth users no longer exist.
INSERT INTO auth.users (id, email) VALUES ${USERS.map(([id]) => `('${id}', '${email(id)}')`).join(', ')};
INSERT INTO public.user_roles (user_id, role, created_at) VALUES ${USERS.flatMap(([id, roles]) => roles.map((r, i) => `('${id}', '${r}', now() - interval '${10 - i} minutes')`)).join(', ')},
  ('99999999-0000-4000-8000-0000000000a1', 'master', '2025-12-07'), ('99999999-0000-4000-8000-0000000000a2', 'master', '2025-12-07');
`;

export function devLikeScenarios(): RoleScenario[] {
  const s: RoleScenario[] = [];
  const add = (name: string, call: string, expect: RoleScenario['expect'], after?: string, setup?: string) => s.push({ name, role: 'postgres', uid: null, call, expect, after, setup });
  add('the migration removed exactly the two orphan role rows', `SELECT count(*)::text FROM public.user_roles WHERE user_id::text LIKE '99999999-%'`, '0');
  add('every real role row survived untouched', `SELECT count(*)::text FROM public.user_roles`, String(USERS.reduce((n, [, r]) => n + r.length, 0)));
  add('the role values are unchanged', `SELECT string_agg(role || '=' || n, ',' ORDER BY role) FROM (SELECT role, count(*) n FROM public.user_roles GROUP BY role) x`, 'admin=6,crew=4,customer=5,master=3');
  add('the foreign key was restored with cascade', `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.user_roles'::regclass AND contype = 'f'`, 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE');
  add('the lowercase CHECK is in place', `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.user_roles'::regclass AND conname = 'user_roles_role_check'`, "CHECK ((role = ANY (ARRAY['master'::text, 'admin'::text, 'crew'::text, 'customer'::text])))");
  add('there is exactly one role CHECK', `SELECT count(*)::text FROM pg_constraint WHERE conrelid = 'public.user_roles'::regclass AND contype = 'c'`, '1');
  add('UNIQUE (user_id, role) is still the only uniqueness on the pair', `SELECT string_agg(pg_get_constraintdef(oid), ';') FROM pg_constraint WHERE conrelid = 'public.user_roles'::regclass AND contype = 'u'`, 'UNIQUE (user_id, role)');
  add('the signup trigger was restored', `SELECT count(*)::text FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created' AND NOT tgisinternal`, '1');
  s.push({ name: 'assign_role_by_email now works for an existing user (Master -> crew on a customer)', role: 'authenticated', uid: MASTER, call: assign(email(TARGET), 'crew'), expect: 'true || crew', after: roleOf(TARGET) });
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Legacy data: role values written in other casings / with spaces, and rows that collapse into duplicates once normalized
// ---------------------------------------------------------------------------------------------------------------------
const L = (n: number) => `55555555-0000-4000-8000-00000000000${n}`;
export const LEGACY_PRE_SQL = `
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
ALTER TABLE auth.users DISABLE TRIGGER USER;
DELETE FROM public.user_roles;
INSERT INTO auth.users (id, email) VALUES ${[1, 2, 3, 4, 5].map((n) => `('${L(n)}', 'legacy${n}@example.test')`).join(', ')};
INSERT INTO public.user_roles (user_id, role, created_at) VALUES
  ('${L(1)}', 'ADMIN', now() - interval '5 minutes'),
  ('${L(2)}', 'Crew', now() - interval '5 minutes'),
  ('${L(3)}', ' customer ', now() - interval '5 minutes'),
  ('${L(4)}', 'Admin', now() - interval '5 minutes'),
  ('${L(4)}', 'admin', now() - interval '4 minutes'),
  ('${L(5)}', 'MASTER', now() - interval '5 minutes');
`;
export const LEGACY_UNKNOWN_ROLE_SQL = `INSERT INTO public.user_roles (user_id, role) VALUES ('${L(1)}', 'owner');`;
export const LEGACY_NO_AUTH_USERS_SQL = `DELETE FROM public.user_roles; DELETE FROM auth.users;`;

export function legacyScenarios(): RoleScenario[] {
  const s: RoleScenario[] = [];
  const add = (name: string, call: string, expect: RoleScenario['expect']) => s.push({ name, role: 'postgres', uid: null, call, expect });
  add('ADMIN is stored as admin', roleOf(L(1)), 'admin');
  add('Crew is stored as crew', roleOf(L(2)), 'crew');
  add('" customer " is stored as customer', roleOf(L(3)), 'customer');
  add('Admin + admin collapse into a single admin row', roleOf(L(4)), 'admin');
  add('the earlier of two duplicate rows is the one kept', `SELECT (created_at < now() - interval '4 minutes 30 seconds')::text FROM public.user_roles WHERE user_id = '${L(4)}'`, 'true');
  add('MASTER is stored as master', roleOf(L(5)), 'master');
  add('no role value with another casing remains', `SELECT count(*)::text FROM public.user_roles WHERE role <> lower(btrim(role))`, '0');
  add('after normalization the lowercase CHECK accepts every row (constraint validated)', `SELECT convalidated::text FROM pg_constraint WHERE conname = 'user_roles_role_check'`, 'true');
  return s;
}

// Pre-state for the "older migrations + this migration" runs: the migration, not the earlier history, must establish who may
// execute the two functions and that exactly one trigger runs the signup function.
export const PRE_GRANTS_SQL = `
REVOKE ALL ON FUNCTION public.assign_role_by_email(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_role_by_email(text, text) TO PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auto_assign_customer_role() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_assign_customer_role() TO PUBLIC, anon, authenticated;
CREATE TRIGGER zz_stale_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.auto_assign_customer_role();
`;
