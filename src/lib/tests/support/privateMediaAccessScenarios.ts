// Executed scenarios for the "protect private order and waiver media" migration.
//
// The scratch database has the repository migrations replayed into it, and a minimal storage schema (storage.buckets,
// storage.objects with row level security, grants for anon / authenticated / service_role). Storage's HTTP layer does not
// exist there, so what is executed is exactly the part this migration controls: the bucket flags and the policies on
// storage.objects, evaluated by Postgres for the real roles. The script starts a transaction, recreates the live Dev
// pre-state (all nine buckets public as on Dev, a stray open policy, an unrelated policy that must survive, one object per
// bucket), applies the migration inside that transaction, runs the scenarios, and rolls everything back. No Supabase project
// is touched. NOT executable here: the public / private HTTP behaviour of a bucket (that is Supabase Storage, not Postgres).

import { IDS, buildScript } from './coreDatabaseAccessScenarios';
import type { Scenario } from './coreDatabaseAccessScenarios';

export const PRIVATE_BUCKETS = ['signed-waivers', 'signatures', 'physical-waivers'];
export const MARKETING_BUCKETS = ['unit-images', 'carousel-media', 'event-essentials-media'];
export const ALL_BUCKETS = [...PRIVATE_BUCKETS, 'lot-pictures', 'order-pictures', 'public-assets', ...MARKETING_BUCKETS];

// The complete policy set the migration leaves on storage.objects for these buckets.
export const EXPECTED_POLICIES = [
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
  'Upload lot pictures into an order folder',
  'Upload order pictures into an order folder',
];

const A = IDS.orderA;
const B = IDS.orderB;
const OBJECTS: Array<[string, string]> = [
  ['signed-waivers', `waiver-${A}-1.pdf`],
  ['signatures', `${A}-1.png`],
  ['physical-waivers', `${A}/paper.pdf`],
  ['lot-pictures', `${A}/a.jpg`],
  ['lot-pictures', `${B}/b.jpg`],
  ['order-pictures', `${A}/a.jpg`],
  ['public-assets', 'bounce-party-club-logo.png'],
  ['public-assets', `${A}-drop-off-1.jpg`],
  ['unit-images', 'u/1.jpg'],
  ['carousel-media', 'c.jpg'],
  ['event-essentials-media', 'products/p.jpg'],
  ['other-bucket', 'x.txt'],
];

export const MEDIA_FIXTURE_SQL = `
-- Live Dev pre-state: all nine buckets exist and (except physical-waivers) are public.
INSERT INTO storage.buckets (id, name, public) VALUES ${[...ALL_BUCKETS, 'other-bucket'].map((b) => `('${b}', '${b}', ${b === 'physical-waivers' ? 'false' : 'true'})`).join(', ')}
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
-- A stray open policy that a reset must remove whatever its name, and an unrelated policy that must survive.
CREATE POLICY "stray open lot access" ON storage.objects FOR ALL TO public USING (bucket_id = 'lot-pictures') WITH CHECK (bucket_id = 'lot-pictures');
CREATE POLICY "stray open waiver access" ON storage.objects FOR ALL TO anon USING (bucket_id = 'signed-waivers') WITH CHECK (bucket_id = 'signed-waivers');
CREATE POLICY "unrelated bucket policy" ON storage.objects FOR SELECT TO public USING (bucket_id = 'other-bucket');
INSERT INTO storage.objects (bucket_id, name) VALUES ${OBJECTS.map(([b, n]) => `('${b}', '${n}')`).join(', ')};
`;

const denied = 'ERR:42501';
const U = (id: string) => `'${id}'`;
const cnt = (bucket: string) => `SELECT count(*)::text FROM storage.objects WHERE bucket_id = '${bucket}'`;
const ins = (bucket: string, name: string) => `WITH i AS (INSERT INTO storage.objects (bucket_id, name) VALUES ('${bucket}', ${U(name)}) RETURNING 1) SELECT count(*)::text FROM i`;
const upd = (bucket: string) => `SELECT pg_temp.n($u$UPDATE storage.objects SET metadata = '{"x":1}'::jsonb WHERE bucket_id = '${bucket}'$u$)::text`;
const del = (bucket: string) => `SELECT pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = '${bucket}'$u$)::text`;

type Actor = { label: string; role: Scenario['role']; uid: string | null };
const ANON: Actor = { label: 'anonymous visitor', role: 'anon', uid: null };
const CUSTOMER: Actor = { label: 'signed-in customer', role: 'authenticated', uid: IDS.uA };
const OTHER_CUSTOMER: Actor = { label: 'another signed-in customer', role: 'authenticated', uid: IDS.uB };
const CREW: Actor = { label: 'crew', role: 'authenticated', uid: IDS.uCrew };
const ADMIN: Actor = { label: 'admin', role: 'authenticated', uid: IDS.uAdmin };
const SERVICE: Actor = { label: 'service role (Edge Functions)', role: 'service_role', uid: null };

export function buildMediaScenarios(): Scenario[] {
  const s: Scenario[] = [];
  const add = (a: Actor, name: string, sql: string, expect: Scenario['expect']) => s.push({ name: `${a.label}: ${name}`, role: a.role, uid: a.uid, sql, expect });

  // ---- bucket flags ----------------------------------------------------------------------------------------------------------------------
  const flag = (b: string) => `SELECT public::text FROM storage.buckets WHERE id = '${b}'`;
  for (const b of PRIVATE_BUCKETS) add(SERVICE, `${b} is a private bucket`, flag(b), 'false');
  for (const b of ['lot-pictures', 'order-pictures', 'public-assets', ...MARKETING_BUCKETS]) add(SERVICE, `${b} stays public (documented residual or marketing media)`, flag(b), 'true');

  // ---- the three private buckets: nobody but the service role ----------------------------------------------------------------------------------
  for (const b of PRIVATE_BUCKETS) {
    for (const a of [ANON, CUSTOMER, OTHER_CUSTOMER, CREW, ADMIN]) {
      add(a, `cannot see any object in ${b} (not even by listing)`, cnt(b), a.role === 'anon' ? '0' : '0');
      add(a, `cannot upload into ${b}`, ins(b, `${A}/new.pdf`), denied);
      add(a, `cannot overwrite an object in ${b}`, upd(b), '0');
      add(a, `cannot delete an object in ${b}`, del(b), '0');
    }
    add(SERVICE, `can read ${b} (signed URL minting and downloads run as the service role)`, cnt(b), '1');
    add(SERVICE, `can upload into ${b}`, ins(b, `${A}/svc-${b}.bin`), '1');
  }
  add(ANON, 'cannot upload a signature or waiver with any folder trick', ins('signatures', `${A}/../x.png`), denied);

  // ---- lot-pictures -----------------------------------------------------------------------------------------------------------------------------------
  const goodPath = `${A}/new-photo.jpg`;
  for (const a of [ANON, CUSTOMER]) add(a, 'can upload a lot picture into an order folder (portal flow)', ins('lot-pictures', goodPath), '1');
  add(ANON, 'can upload with an upper-case order id', ins('lot-pictures', `${A.toUpperCase()}/up.jpg`), '1');
  const badPaths: Array<[string, string]> = [
    ['a file with no folder', 'photo.jpg'], ['an empty file name', `${A}/`], ['a nested folder', `${A}/a/b.jpg`], ['a leading parent path', `../${A}/a.jpg`],
    ['a parent path after the folder', `${A}/../x.jpg`], ['a prefix in front of the order id', `x${A}/a.jpg`], ['a suffix after the order id', `${A}x/a.jpg`],
    ['a leading slash', `/${A}/a.jpg`], ['an extra top folder', `public/${A}/a.jpg`], ['a bare order id', A], ['a short id', `${A.slice(0, 8)}/a.jpg`],
    ['a random folder name', 'random-folder/a.jpg'], ['an empty name', ''],
  ];
  for (const [what, path] of badPaths) add(ANON, `cannot upload a lot picture with ${what}`, ins('lot-pictures', path), denied);
  add(CUSTOMER, 'cannot upload a lot picture with a nested folder', ins('lot-pictures', `${A}/a/b.jpg`), denied);
  for (const a of [ANON, CUSTOMER, OTHER_CUSTOMER, CREW]) {
    add(a, 'cannot delete a lot picture', del('lot-pictures'), '0');
    add(a, 'cannot overwrite a lot picture', upd('lot-pictures'), '0');
  }
  for (const a of [ANON, CUSTOMER, CREW]) add(a, 'cannot list the lot-pictures bucket (no SELECT policy)', cnt('lot-pictures'), '0');
  add(ADMIN, 'can list the lot-pictures bucket (needed to delete and review)', cnt('lot-pictures'), '5');
  add(ADMIN, 'can delete a lot picture', `SELECT pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = 'lot-pictures' AND name = '${A}/a.jpg'$u$)::text`, '1');
  add(ADMIN, 'cannot overwrite a lot picture directly (not needed by any caller)', upd('lot-pictures'), '0');
  add(SERVICE, 'can read and write lot pictures (the portal deletes through the service role)', cnt('lot-pictures'), '4');

  // ---- order-pictures ---------------------------------------------------------------------------------------------------------------------------------
  for (const a of [ANON, CUSTOMER]) add(a, 'can upload an order picture into an order folder (portal flow)', ins('order-pictures', `${B}/o.jpg`), '1');
  for (const [what, path] of badPaths.slice(0, 8)) add(ANON, `cannot upload an order picture with ${what}`, ins('order-pictures', path), denied);
  for (const a of [ANON, CUSTOMER, OTHER_CUSTOMER]) {
    add(a, 'cannot list or read order-pictures objects through Storage policies (no customer policy)', cnt('order-pictures'), '0');
    add(a, 'cannot overwrite an order picture', upd('order-pictures'), '0');
    add(a, 'cannot delete an order picture', del('order-pictures'), '0');
  }
  add(CREW, 'can read order pictures (staff)', cnt('order-pictures'), '3');
  add(CREW, 'cannot delete or overwrite order pictures', `SELECT (${'pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = \'order-pictures\'$u$)'} + ${"pg_temp.n($u$UPDATE storage.objects SET metadata = '{}'::jsonb WHERE bucket_id = 'order-pictures'$u$)"})::text`, '0');
  add(ADMIN, 'can read order pictures', cnt('order-pictures'), '3');
  add(ADMIN, 'can overwrite order pictures', upd('order-pictures'), '3');
  add(ADMIN, 'can delete order pictures', del('order-pictures'), '3');

  // ---- public-assets (marketing files and, historically, delivery / damage photos) ------------------------------------------------------------------------
  for (const a of [ANON, CUSTOMER, OTHER_CUSTOMER]) {
    add(a, 'cannot upload into public-assets', ins('public-assets', `${A}-drop-off-9.jpg`), denied);
    add(a, 'cannot list public-assets (no SELECT policy; the objects are still served by URL)', cnt('public-assets'), '0');
    add(a, 'cannot overwrite or delete public-assets objects', `SELECT (${'pg_temp.n($u$UPDATE storage.objects SET metadata = \'{}\'::jsonb WHERE bucket_id = \'public-assets\'$u$)'} + ${"pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = 'public-assets'$u$)"})::text`, '0');
  }
  add(CREW, 'can upload a delivery / damage photo into public-assets (task screens)', ins('public-assets', `${A}-drop-off-2.jpg`), '1');
  add(ADMIN, 'can upload into public-assets', ins('public-assets', `${A}-pickup-1.jpg`), '1');
  add(CREW, 'cannot overwrite or delete public-assets objects', `SELECT (${'pg_temp.n($u$UPDATE storage.objects SET metadata = \'{}\'::jsonb WHERE bucket_id = \'public-assets\'$u$)'} + ${"pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = 'public-assets'$u$)"})::text`, '0');
  add(ADMIN, 'can overwrite public-assets objects', upd('public-assets'), '4');
  add(ADMIN, 'can delete public-assets objects', del('public-assets'), '4');
  add(SERVICE, 'can still upload into public-assets', ins('public-assets', 'svc.png'), '1');

  // ---- marketing buckets --------------------------------------------------------------------------------------------------------------------------------
  for (const b of MARKETING_BUCKETS) {
    add(ANON, `can still read ${b} (public website media)`, cnt(b), '1');
    add(CUSTOMER, `can still read ${b}`, cnt(b), '1');
    for (const a of [ANON, CUSTOMER, CREW]) {
      add(a, `cannot upload into ${b}`, ins(b, 'new.jpg'), denied);
      add(a, `cannot overwrite or delete in ${b}`, `SELECT (${`pg_temp.n($u$UPDATE storage.objects SET metadata = '{}'::jsonb WHERE bucket_id = '${b}'$u$)`} + ${`pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = '${b}'$u$)`})::text`, '0');
    }
    add(ADMIN, `can upload into ${b}`, ins(b, 'admin-new.jpg'), '1');
    add(ADMIN, `can overwrite in ${b}`, upd(b), '2');
    add(ADMIN, `can delete in ${b}`, del(b), '2');
    add(SERVICE, `can upload into ${b} (promote-media)`, ins(b, 'promoted/svc.jpg'), '1');
  }

  // ---- the policy catalog ---------------------------------------------------------------------------------------------------------------------------------
  const mentions = (list: string[]) => `(${list.map((b) => `coalesce(qual,'') || coalesce(with_check,'') LIKE '%''${b}''%'`).join(' OR ')})`;
  add(SERVICE, 'policy set: exactly the explicit minimal set remains for these buckets', `SELECT string_agg(policyname, ' | ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND ${mentions(ALL_BUCKETS)}`, EXPECTED_POLICIES.join(' | '));
  add(SERVICE, 'policy set: no policy at all mentions a private bucket', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND ${mentions(PRIVATE_BUCKETS)}`, '0');
  add(SERVICE, 'policy set: the stray open policies were removed whatever their names', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'stray open%'`, '0');
  add(SERVICE, 'policy set: an unrelated bucket\'s policy is untouched', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'unrelated bucket policy'`, '1');
  add(SERVICE, 'policy set: the only policies open to anonymous callers are marketing read and the two folder-shaped uploads (plus the unrelated one)', `SELECT string_agg(policyname, ' | ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (roles && ARRAY['anon','public']::name[])`, ['Public read marketing media', 'Upload lot pictures into an order folder', 'Upload order pictures into an order folder', 'unrelated bucket policy'].sort().join(' | '));
  add(SERVICE, 'policy set: no policy lets any role other than Admin / Master delete', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('DELETE','ALL') AND policyname NOT LIKE 'Admin and master%' AND policyname <> 'unrelated bucket policy' AND ${mentions(ALL_BUCKETS)}`, '0');
  add(SERVICE, 'policy set: no policy uses a bucket outside the nine in scope for these names', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = ANY (ARRAY['${EXPECTED_POLICIES.join("','")}']) AND NOT ${mentions(ALL_BUCKETS)}`, '0');
  return s;
}

export function buildMediaScript(scenarios: Scenario[], migrationSql: string): string {
  const base = buildScript(scenarios);
  return base.replace('BEGIN;', () => `BEGIN;\n${MEDIA_FIXTURE_SQL}\n${migrationSql}\n`);
}
