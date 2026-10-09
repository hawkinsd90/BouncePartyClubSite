// Executed scenarios for the "protect customer order photos" migration.
//
// Same approach as privateMediaAccessScenarios: the scratch database has the repository migrations replayed into it plus a
// minimal storage schema, the script recreates the live Dev pre-state (all buckets public, stray open policies), applies
// the waiver-media migration and THEN the customer-photo migration inside one transaction, runs the scenarios as the real
// roles, and rolls everything back. A second script applies the customer-photo migration ALONE over the same pre-state to
// show it does not depend on the earlier migration to remove open policies. No Supabase project is touched. NOT executable
// here: Storage's HTTP layer (public / private serving, signed upload tokens, signed read URLs).

import { IDS, buildScript } from './coreDatabaseAccessScenarios';
import type { Scenario } from './coreDatabaseAccessScenarios';
import { MEDIA_FIXTURE_SQL, ALL_BUCKETS, MARKETING_BUCKETS, PRIVATE_BUCKETS } from './privateMediaAccessScenarios';

export const PHOTO_BUCKETS = ['lot-pictures', 'order-pictures'];

// What is left on storage.objects for the nine buckets once both migrations have run.
export const FINAL_POLICIES = [
  'Admin and master delete lot pictures',
  'Admin and master delete order pictures',
  'Admin and master delete public assets',
  'Admin and master manage marketing media',
  'Admin and master read lot pictures',
  'Admin and master read public assets',
  'Admin and master replace order pictures',
  'Admin and master replace public assets',
  'Public read marketing media',
  'Staff read order pictures',
  'Staff upload public assets',
];

const A = IDS.orderA;
const B = IDS.orderB;
const denied = 'ERR:42501';
const U = (v: string) => `'${v}'`;
const cnt = (bucket: string) => `SELECT count(*)::text FROM storage.objects WHERE bucket_id = '${bucket}'`;
const ins = (bucket: string, name: string) => `WITH i AS (INSERT INTO storage.objects (bucket_id, name) VALUES ('${bucket}', ${U(name)}) RETURNING 1) SELECT count(*)::text FROM i`;
const upd = (bucket: string) => `SELECT pg_temp.n($u$UPDATE storage.objects SET metadata = '{"x":1}'::jsonb WHERE bucket_id = '${bucket}'$u$)::text`;
const del = (bucket: string) => `SELECT pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = '${bucket}'$u$)::text`;
const flag = (b: string) => `SELECT public::text FROM storage.buckets WHERE id = '${b}'`;
const mentions = (list: string[]) => `(${list.map((b) => `coalesce(qual,'') || coalesce(with_check,'') LIKE '%''${b}''%'`).join(' OR ')})`;

type Actor = { label: string; role: Scenario['role']; uid: string | null };
const ANON: Actor = { label: 'anonymous visitor', role: 'anon', uid: null };
const CUSTOMER: Actor = { label: 'signed-in customer', role: 'authenticated', uid: IDS.uA };
const OTHER_CUSTOMER: Actor = { label: 'another signed-in customer', role: 'authenticated', uid: IDS.uB };
const CREW: Actor = { label: 'crew', role: 'authenticated', uid: IDS.uCrew };
const ADMIN: Actor = { label: 'admin', role: 'authenticated', uid: IDS.uAdmin };
const SERVICE: Actor = { label: 'service role (Edge Functions)', role: 'service_role', uid: null };

// Objects the fixture puts in the two buckets (see MEDIA_FIXTURE_SQL): lot-pictures A/a.jpg and B/b.jpg, order-pictures A/a.jpg.
export function buildPhotoScenarios(): Scenario[] {
  const s: Scenario[] = [];
  const add = (a: Actor, name: string, sql: string, expect: Scenario['expect']) => s.push({ name: `${a.label}: ${name}`, role: a.role, uid: a.uid, sql, expect });

  for (const b of [...PHOTO_BUCKETS, ...PRIVATE_BUCKETS]) add(SERVICE, `${b} is a private bucket`, flag(b), 'false');
  for (const b of ['public-assets', ...MARKETING_BUCKETS]) add(SERVICE, `${b} stays public`, flag(b), 'true');

  // ---- the two customer photo buckets: no direct customer or visitor access of any kind -----------------------------------------------------------------------
  const folderShaped: Array<[string, string]> = [
    ['a path in the order folder (what the old policy allowed)', `${A}/new-photo.jpg`],
    ['an upper-case order folder path', `${A.toUpperCase()}/up.jpg`],
    ['another order\'s folder', `${B}/new-photo.jpg`],
    ['a path with no folder', 'photo.jpg'],
    ['a nested path', `${A}/a/b.jpg`],
    ['a parent-directory path', `${A}/../x.jpg`],
  ];
  for (const b of PHOTO_BUCKETS) {
    for (const a of [ANON, CUSTOMER, OTHER_CUSTOMER]) {
      for (const [what, path] of folderShaped) add(a, `cannot upload into ${b} directly with ${what}`, ins(b, path), denied);
      add(a, `cannot list or read ${b} through Storage policies`, cnt(b), '0');
      add(a, `cannot overwrite an object in ${b}`, upd(b), '0');
      add(a, `cannot delete an object in ${b}`, del(b), '0');
    }
  }
  add(CREW, 'cannot upload, overwrite or delete in lot-pictures', `SELECT (${"pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = 'lot-pictures'$u$)"} + ${"pg_temp.n($u$UPDATE storage.objects SET metadata = '{}'::jsonb WHERE bucket_id = 'lot-pictures'$u$)"})::text`, '0');
  add(CREW, 'cannot see lot-pictures', cnt('lot-pictures'), '0');
  add(CREW, 'cannot upload into lot-pictures directly', ins('lot-pictures', `${A}/c.jpg`), denied);
  add(CREW, 'cannot upload into order-pictures directly', ins('order-pictures', `${A}/c.jpg`), denied);
  add(CREW, 'can read order pictures (existing staff behaviour)', cnt('order-pictures'), '1');
  add(CREW, 'cannot overwrite or delete order pictures', `SELECT (${"pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = 'order-pictures'$u$)"} + ${"pg_temp.n($u$UPDATE storage.objects SET metadata = '{}'::jsonb WHERE bucket_id = 'order-pictures'$u$)"})::text`, '0');

  // ---- Admin / Master keep legitimate management of objects that existed BEFORE the migration --------------------------------------------------------------------
  add(ADMIN, 'can read the existing lot pictures (signed URLs and review)', cnt('lot-pictures'), '2');
  add(ADMIN, 'can read the existing order pictures', cnt('order-pictures'), '1');
  add(ADMIN, 'cannot upload into lot-pictures directly (no screen needs it)', ins('lot-pictures', `${A}/admin.jpg`), denied);
  add(ADMIN, 'cannot upload into order-pictures directly (no screen needs it)', ins('order-pictures', `${A}/admin.jpg`), denied);
  add(ADMIN, 'can overwrite order pictures', upd('order-pictures'), '1');
  add(ADMIN, 'can delete an existing lot picture', `SELECT pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = 'lot-pictures' AND name = '${A}/a.jpg'$u$)::text`, '1');
  add(ADMIN, 'can delete an existing order picture', del('order-pictures'), '1');

  // ---- the service role (portal functions, promote-media) --------------------------------------------------------------------------------------------------------------------
  add(SERVICE, 'can read the remaining lot pictures (portal signed URLs, promote-media source)', cnt('lot-pictures'), '1');
  add(SERVICE, 'can write lot pictures', ins('lot-pictures', `${A}/svc.jpg`), '1');
  add(SERVICE, 'can write order pictures', ins('order-pictures', `${A}/svc.jpg`), '1');

  // ---- the other buckets are unchanged -----------------------------------------------------------------------------------------------------------------------------------------------
  for (const b of PRIVATE_BUCKETS) {
    for (const a of [ANON, CUSTOMER, OTHER_CUSTOMER, CREW, ADMIN]) add(a, `still cannot see anything in ${b}`, cnt(b), '0');
  }
  for (const b of MARKETING_BUCKETS) add(ANON, `can still read ${b} (public website media)`, cnt(b), '1');
  add(ANON, 'cannot list public-assets (unchanged)', cnt('public-assets'), '0');
  add(CREW, 'can still upload a delivery / damage photo into public-assets (unchanged)', ins('public-assets', `${A}-drop-off-2.jpg`), '1');
  add(ANON, 'cannot upload into public-assets (unchanged)', ins('public-assets', `${A}-drop-off-9.jpg`), denied);

  // ---- the policy catalog --------------------------------------------------------------------------------------------------------------------------------------------------------------
  add(SERVICE, 'policy set: exactly the staff policies remain for the nine buckets', `SELECT string_agg(policyname, ' | ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND ${mentions(ALL_BUCKETS)}`, FINAL_POLICIES.join(' | '));
  add(SERVICE, 'policy set: no policy mentions a photo bucket other than the five staff policies', `SELECT string_agg(policyname, ' | ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND ${mentions(PHOTO_BUCKETS)}`, ['Admin and master delete lot pictures', 'Admin and master delete order pictures', 'Admin and master read lot pictures', 'Admin and master replace order pictures', 'Staff read order pictures'].sort().join(' | '));
  add(SERVICE, 'policy set: no INSERT policy exists for either photo bucket', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT','ALL') AND ${mentions(PHOTO_BUCKETS)}`, '0');
  add(SERVICE, 'policy set: no policy for either photo bucket is open to anon, public or every role', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND ${mentions(PHOTO_BUCKETS)} AND roles && ARRAY['anon','public']::name[]`, '0');
  add(SERVICE, 'policy set: every policy for the photo buckets is limited to the authenticated role and checks a staff role', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND ${mentions(PHOTO_BUCKETS)} AND (roles <> ARRAY['authenticated']::name[] OR coalesce(qual,'') !~ '(is_admin|is_crew_or_admin)')`, '0');
  add(SERVICE, 'policy set: the stray open policy was removed', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'stray open%'`, '0');
  add(SERVICE, 'policy set: an unrelated bucket\'s policy is untouched', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'unrelated bucket policy'`, '1');
  add(SERVICE, 'policy set: the only policies open to anonymous callers are marketing read and the unrelated one', `SELECT string_agg(policyname, ' | ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (roles && ARRAY['anon','public']::name[])`, ['Public read marketing media', 'unrelated bucket policy'].sort().join(' | '));
  return s;
}

// The customer-photo migration applied ALONE over the Dev pre-state (all buckets public, stray open policies, plus the
// earlier folder-shaped upload policies): it must make both buckets private and leave only the staff policies by itself.
export const ALONE_FIXTURE_SQL = `
CREATE POLICY "Upload lot pictures into an order folder" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'lot-pictures' AND name ~* '^[0-9a-f-]{36}/[^/]+$');
CREATE POLICY "stray open order access" ON storage.objects FOR ALL TO public USING (bucket_id = 'order-pictures') WITH CHECK (bucket_id = 'order-pictures');
`;

export function buildAloneScenarios(): Scenario[] {
  const s: Scenario[] = [];
  const add = (a: Actor, name: string, sql: string, expect: Scenario['expect']) => s.push({ name: `alone / ${a.label}: ${name}`, role: a.role, uid: a.uid, sql, expect });
  for (const b of PHOTO_BUCKETS) add(SERVICE, `${b} is private`, flag(b), 'false');
  for (const b of ['signed-waivers', 'signatures', 'public-assets', ...MARKETING_BUCKETS]) add(SERVICE, `${b} is not changed by this migration`, flag(b), 'true');
  for (const b of PHOTO_BUCKETS) {
    add(ANON, `cannot read ${b}`, cnt(b), '0');
    add(CUSTOMER, `cannot upload into ${b} even into an order folder`, ins(b, `${A}/new.jpg`), denied);
    add(ANON, `cannot upload into ${b}`, ins(b, `${A}/new.jpg`), denied);
  }
  add(SERVICE, 'the stray open policies on the photo buckets are gone', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname IN ('stray open lot access', 'stray open order access', 'Upload lot pictures into an order folder')`, '0');
  add(SERVICE, 'a stray policy on a waiver bucket is NOT this migration\'s business', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'stray open waiver access'`, '1');
  add(SERVICE, 'an unrelated bucket\'s policy is untouched', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'unrelated bucket policy'`, '1');
  add(ADMIN, 'can read lot pictures', cnt('lot-pictures'), '2');
  add(CREW, 'can read order pictures', cnt('order-pictures'), '1');
  return s;
}

export function buildPhotoScript(scenarios: Scenario[], migrationsSql: string[], extraFixture = ''): string {
  const base = buildScript(scenarios);
  return base.replace('BEGIN;', () => `BEGIN;\n${MEDIA_FIXTURE_SQL}\n${extraFixture}\n${migrationsSql.join('\n')}\n`);
}
