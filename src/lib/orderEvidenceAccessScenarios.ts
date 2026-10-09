// Executed scenarios for the private order-evidence Storage migration.
//
// Same approach as customerPhotoAccessScenarios: a scratch PostgreSQL database with the repository migrations replayed and a
// minimal storage schema; the script recreates the live Dev pre-state, applies the three Storage migrations in order inside one
// transaction, runs the scenarios as the real roles, and rolls everything back. A second script applies the evidence
// migration ALONE (with a stray policy on the new bucket and the old staff upload policy present) and then applies it a second
// time. No Supabase project is touched. NOT executable here: Storage's HTTP layer (signed uploads, signed reads, public /
// private serving).

import { IDS } from './coreDatabaseAccessScenarios';
import type { Scenario } from './coreDatabaseAccessScenarios';
import { ALL_BUCKETS, MARKETING_BUCKETS, PRIVATE_BUCKETS } from './privateMediaAccessScenarios';
import { FINAL_POLICIES, PHOTO_BUCKETS } from './customerPhotoAccessScenarios';

export const EVIDENCE_BUCKET = 'order-evidence';

// The complete policy set left on storage.objects for the nine pre-existing buckets after all three migrations: the photo
// state minus the staff upload policy for public-assets.
export const FINAL_POLICIES_WITH_EVIDENCE = FINAL_POLICIES.filter((p) => p !== 'Staff upload public assets');

const A = IDS.orderA;
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

const EVIDENCE_PATH = `${A}/22222222-2222-4222-8222-222222222222/delivery/00000000-0000-4000-8000-000000000001.jpg`;

export function buildEvidenceScenarios(): Scenario[] {
  const s: Scenario[] = [];
  const add = (a: Actor, name: string, sql: string, expect: Scenario['expect']) => s.push({ name: `${a.label}: ${name}`, role: a.role, uid: a.uid, sql, expect });

  for (const b of [EVIDENCE_BUCKET, ...PHOTO_BUCKETS, ...PRIVATE_BUCKETS]) add(SERVICE, `${b} is a private bucket`, flag(b), 'false');
  for (const b of ['public-assets', ...MARKETING_BUCKETS]) add(SERVICE, `${b} stays public`, flag(b), 'true');
  add(SERVICE, 'the evidence bucket keeps its limits (10 MB, images only)', `SELECT file_size_limit::text || ' ' || array_to_string(allowed_mime_types, ',') FROM storage.buckets WHERE id = '${EVIDENCE_BUCKET}'`, '10485760 image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif');

  // ---- order-evidence: with an object present, nobody but the service role can touch it --------------------------------------------------------------
  add(SERVICE, 'can store an evidence object (signed uploads and copies run as the service role)', ins(EVIDENCE_BUCKET, EVIDENCE_PATH), '1');
  for (const a of [ANON, CUSTOMER, OTHER_CUSTOMER, CREW, ADMIN]) {
    add(a, 'cannot see, list or read anything in order-evidence', cnt(EVIDENCE_BUCKET), '0');
    add(a, 'cannot upload into order-evidence directly (even to the exact server path shape)', ins(EVIDENCE_BUCKET, `${A}/22222222-2222-4222-8222-222222222222/damage/00000000-0000-4000-8000-000000000002.jpg`), denied);
    add(a, 'cannot overwrite an evidence object', upd(EVIDENCE_BUCKET), '0');
    add(a, 'cannot delete an evidence object', del(EVIDENCE_BUCKET), '0');
  }
  add(SERVICE, 'can still read the evidence object after the failed attempts', cnt(EVIDENCE_BUCKET), '1');

  // ---- public-assets: still public for real public assets, no staff upload policy any more ---------------------------------------------------------------------
  for (const a of [ANON, CUSTOMER, OTHER_CUSTOMER, CREW, ADMIN]) add(a, 'cannot upload into public-assets (the staff upload policy is gone)', ins('public-assets', `${A}-drop-off-9.jpg`), denied);
  for (const a of [ANON, CUSTOMER, CREW]) add(a, 'cannot list public-assets (no SELECT policy; objects are served by URL)', cnt('public-assets'), '0');
  add(ADMIN, 'can still read public-assets (public asset management)', cnt('public-assets'), '2');
  add(ADMIN, 'can still replace public-assets objects', upd('public-assets'), '2');
  add(CREW, 'cannot overwrite or delete public-assets objects', `SELECT (${"pg_temp.n($u$UPDATE storage.objects SET metadata = '{}'::jsonb WHERE bucket_id = 'public-assets'$u$)"} + ${"pg_temp.n($u$DELETE FROM storage.objects WHERE bucket_id = 'public-assets'$u$)"})::text`, '0');
  add(ADMIN, 'can still delete public-assets objects', del('public-assets'), '2');
  add(SERVICE, 'can still upload public assets (logo management, copies)', ins('public-assets', 'bounce-party-club-logo-2.png'), '1');

  // ---- the other buckets are unchanged --------------------------------------------------------------------------------------------------------------------------
  for (const b of [...PHOTO_BUCKETS, ...PRIVATE_BUCKETS]) {
    for (const a of [ANON, CUSTOMER, OTHER_CUSTOMER]) add(a, `still cannot see anything in ${b}`, cnt(b), '0');
  }
  for (const b of MARKETING_BUCKETS) add(ANON, `can still read ${b} (public website media)`, cnt(b), '1');

  // ---- the policy catalog ---------------------------------------------------------------------------------------------------------------------------------------
  add(SERVICE, 'policy set: exactly the remaining staff policies exist for the nine older buckets', `SELECT string_agg(policyname, ' | ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND ${mentions(ALL_BUCKETS)}`, FINAL_POLICIES_WITH_EVIDENCE.join(' | '));
  add(SERVICE, 'policy set: no policy at all mentions the evidence bucket', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%${EVIDENCE_BUCKET}%'`, '0');
  add(SERVICE, 'policy set: no INSERT policy exists for any photo, evidence, waiver or public-assets bucket', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT','ALL') AND ${mentions([...PHOTO_BUCKETS, EVIDENCE_BUCKET, ...PRIVATE_BUCKETS, 'public-assets'])}`, '0');
  add(SERVICE, 'policy set: the only policies open to anonymous callers are marketing read and the unrelated one', `SELECT string_agg(policyname, ' | ' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (roles && ARRAY['anon','public']::name[])`, ['Public read marketing media', 'unrelated bucket policy'].sort().join(' | '));
  add(SERVICE, 'policy set: an unrelated bucket\'s policy is untouched', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'unrelated bucket policy'`, '1');
  return s;
}

// The evidence migration applied ALONE over the Dev pre-state, twice: a stray open policy on the new bucket and the old staff
// upload policy for public-assets exist beforehand.
export const EVIDENCE_ALONE_FIXTURE_SQL = `
CREATE POLICY "Staff upload public assets" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'public-assets' AND (SELECT public.is_crew_or_admin()));
CREATE POLICY "Admin and master read public assets" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()));
INSERT INTO storage.buckets (id, name, public) VALUES ('${EVIDENCE_BUCKET}', '${EVIDENCE_BUCKET}', true) ON CONFLICT (id) DO UPDATE SET public = true;
CREATE POLICY "stray open evidence access" ON storage.objects FOR ALL TO public USING (bucket_id = '${EVIDENCE_BUCKET}') WITH CHECK (bucket_id = '${EVIDENCE_BUCKET}');
`;

export function buildEvidenceAloneScenarios(): Scenario[] {
  const s: Scenario[] = [];
  const add = (a: Actor, name: string, sql: string, expect: Scenario['expect']) => s.push({ name: `alone, applied twice / ${a.label}: ${name}`, role: a.role, uid: a.uid, sql, expect });
  add(SERVICE, 'the evidence bucket is private (it existed as public before)', flag(EVIDENCE_BUCKET), 'false');
  add(SERVICE, 'there is exactly one evidence bucket row after two runs', `SELECT count(*)::text FROM storage.buckets WHERE id = '${EVIDENCE_BUCKET}'`, '1');
  add(SERVICE, 'the stray policy on the evidence bucket is gone', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'stray open evidence access'`, '0');
  add(SERVICE, 'the staff upload policy for public-assets is gone', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Staff upload public assets'`, '0');
  add(SERVICE, 'the admin read policy for public-assets is kept', `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Admin and master read public assets'`, '1');
  add(SERVICE, 'public-assets and the marketing buckets are not changed by this migration', `SELECT string_agg(id || '=' || public::text, ',' ORDER BY id) FROM storage.buckets WHERE id IN ('public-assets','unit-images','carousel-media','event-essentials-media','signed-waivers','lot-pictures')`, 'carousel-media=true,event-essentials-media=true,lot-pictures=true,public-assets=true,signed-waivers=true,unit-images=true');
  add(ANON, 'cannot read the evidence bucket', cnt(EVIDENCE_BUCKET), '0');
  add(ADMIN, 'cannot upload into the evidence bucket', ins(EVIDENCE_BUCKET, EVIDENCE_PATH), denied);
  return s;
}
