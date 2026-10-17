# E2A: recorded-version exceptions and the Development alias

A recorded migration whose effect is missing today is not automatically wrongly applied: its effect may have been replaced by a later migration, removed out of band, or never created. Each case below states which explanation the evidence supports. Evidence base: Stage B captures (2026-10-16 18:54-18:55 UTC), repository SQL, and `tools/e2a_analyze.py`. No hosted system was contacted.

## 1. Production `20251207163822_add_role_hierarchy_and_oauth` (recorded): role CHECK absent
- **Missing effect:** `user_roles_role_check` (the uppercase `MASTER/ADMIN/CREW/CUSTOMER` CHECK) is absent from Production. The other 38 statements of the file are present (22), superseded (14) or data statements (2).
- **Later migrations:** the chain for this constraint is `20251207163822` (drop and add), then `20261016120000` (October, unapplied). **No applied migration removes it.**
- **Independent evidence of when it disappeared:** Production's history records `20260324175546` and `20260324190039`, which run `UPDATE user_roles SET role = LOWER(role)`; with the uppercase-only CHECK present those updates fail (reproduced in C0, failures F1 and F2). Since both are recorded as applied, the CHECK was already absent when they ran (before 2026-03-24 17:55 UTC).
- **Classification:** out-of-band drift (Stage B D2, drift register), **not** an error of the recorded row and **not** a supersession. The recorded row stays; nothing is repaired. The October `20261016120000` creates the lowercase CHECK, which is the intended final state.
- **Unresolved:** who removed it and when (needs Production's DDL audit trail, outside the catalog).

## 2. Development `20260718000744_stage_b_pricing_eligibility_schema` (recorded): two policies "missing"
- **Previous claim (Stage B note, carried into E1):** two public-read policies exist on Development "under different names than the file creates (out-of-band rename)", so the version was counted as a recorded-with-missing-effects exception.
- **Finding (correction):** the names differ only because **PostgreSQL truncates identifiers to 63 bytes**. The file creates `"Public can view eligibility of active visible bundles with active units"` (71 characters) and `"Public can view inflatable components of active visible bundles with active units"` (81); Development holds `"Public can view eligibility of active visible bundles with acti"` and `"Public can view inflatable components of active visible bundles"`, which are exactly the first 63 bytes. With truncation applied, all 92 statements of this version are `PRESENT` (69) or `SUPERSEDED` (23) in Development.
- **Classification:** no exception. The row is consistent; the earlier "out-of-band rename" explanation was wrong. This reduces the recorded-effect-missing count for Development from 2 to 1.

## 3. Development `20260723174017_restore_lot_pictures_storage_policies` (recorded): `Public can view lot pictures` absent
- **Missing effect:** the storage policy `Public can view lot pictures` (the file drops and re-creates it) is absent on Development; Development currently holds only `Anyone can upload lot pictures` and `Authenticated can delete lot pictures` for that bucket. Production has the policy.
- **Later migrations:** none drops it (the chain ends with this file's drop-and-create); the unapplied October `20261014120000/20261015120000` replace the storage policy set for these buckets.
- **Independent evidence:** the audit records that Development's storage configuration was changed by another workstream after the migration (section U-1, privacy containment); this is consistent with the observed absence. The capture cannot show when it was removed.
- **Classification:** later out-of-band removal (storage containment), **not** an incorrect application. No restoration is proposed; the final storage policy set is defined by the October migrations.
- **Unresolved:** a dated record of the containment change would confirm the timing.

## 4. Development alias: recorded `20260814002658` vs repository `20260814120000_create_contact_inquiries.sql`
- **Recorded row:** version `20260814002658`, name `20260814120000_create_contact_inquiries.sql`, 6 statements.
- **Comparison:** the whitespace/semicolon-normalized digest of the recorded statements (`c2fd5486...`) and the comment-free digest (`faa9f2b1...`) **both equal** the digests computed from `20260814120000_create_contact_inquiries.sql`; no other repository file matches. The recorded SQL is therefore the content of the repository file; only the version string differs (the migration was recorded under the application timestamp `...002658`, the file carries `...120000`).
- **Effects:** the `contact_inquiries` objects of this file are present on Development (14 present, 1 superseded). In Production the file's effects are absent (the table does not exist).
- **Classification:** version-identity discrepancy (class I). Three truthful options remain: rename the repository file to `20260814002658` (safe for Development because Production never recorded either version, but it changes a file in `main`), add a Development history row for `20260814120000` marked as an alias of the recorded row, or leave both unreconciled. This is the owner decision N4. E2A changed nothing.
- **Unresolved:** none for content identity; the choice of identity is the owner's.

## Summary
| Version | Environment | Finding | Class of explanation |
|---|---|---|---|
| `20251207163822` | Production (and absent on Development) | role CHECK missing; no applied migration removes it; later recorded migrations prove it was gone before 2026-03-24 | out-of-band drift |
| `20260718000744` | Development | "missing" policies are 63-byte truncated names; fully reflected | none (earlier claim corrected) |
| `20260723174017` | Development | policy removed after application, consistent with the containment record | later out-of-band removal |
| `20260814002658` | Development | recorded SQL identical to the repository file `20260814120000_...` | identity discrepancy (owner decision) |
