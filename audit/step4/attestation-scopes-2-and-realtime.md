# Two individual attestation scopes and two excluded Realtime migrations (prepared 2026-10-21; NOT attested, NOT recorded)
Development `srxunxiytojjsuhcmzjg`, ledger 372 (sha `1dd1460ed16934cedba0bfa64e4db15f91268bdd9e87de1c59d0b5b0756b56ed`). Observations below are read-only queries run on 2026-10-21. A row is a ledger marker only; the migration SQL is never run. Only the owner can complete `attested_by` and `attested_at`.

## A. 20251002210020 `008_add_admin_settings`
* File `supabase/migrations/20251002210020_008_add_admin_settings.sql`, sha256 `1be19867dc5ba5e600d5a04c1d372a784d1143722195328581b29327471fe74b`. Creates `admin_settings`, enables RLS, three ADMIN-role policies, seeds key `admin_notification_phone` (`ON CONFLICT DO NOTHING`).
* Observed: table exists; RLS on; key `admin_notification_phone` present (value length 12, content not compared with the file); the file's three original policies are absent by design (superseded: four newer policies "Admins can view/insert/update/delete ..." exist). Not yet recorded in the ledger (0 of the 4 versions here are).
* Limitations (must be signed knowingly): execution not proven; the stored phone value was never compared with the file or with Production; Development data is a Production copy; a database rebuilt from the files still runs this SQL (marker lives in the ledger only); re-running the file here would re-create superseded policies.
* Recommended state: `effects-present-execution-unproven`. Proposed marker (one statement, no SQL): `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run=<id> state=effects-present-execution-unproven version=20251002210020 attested_by=<owner> attested_at=<UTC> scope=ledger marker only, original SQL 20251002210020_008_add_admin_settings.sql sha256=1be19867... NOT executed by this record; effects observed 2026-10-21: table, RLS, admin_notification_phone key present; original policies superseded`.
* Owner confirmations before signing: the stored admin notification phone is the intended one.

## B. 20251207160232 `add_hero_carousel_system`
* File `supabase/migrations/20251207160232_add_hero_carousel_system.sql`, sha256 `42abe93bfa173c9b332a9bf18735e0abffc55c5ba96b67fececb250b3bdc1d86`. Creates `hero_carousel_images`, RLS, five policies, `updated_at` trigger, seeds 3 Pexels sample slides.
* Observed: table exists; RLS on; trigger `hero_carousel_updated_at` present; 6 policies exist (the file's five reworked by later migrations, plus public-view duplicates); 3 rows exist titled "Birthday Parties", "School Events", "Community Events" but **none uses a pexels URL** (they were replaced; image URLs now point to Development storage), so the rows are not provably the migration's seed.
* Limitations: execution not proven; the seed was not matched; same fresh-build and re-run caveats (re-running would insert 3 duplicate sample slides because the conflict clause has no unique key).
* Recommended state: `effects-present-execution-unproven`; marker as in A with version 20251207160232, sha256 `42abe93b...`, observed "table, RLS, trigger present; seed rows not matched".
* Owner confirmations before signing: the three live carousel slides are the intended content.

## C. Realtime migrations (excluded, no change proposed)
* `20260324051459` sha256 `b91664177686fb03c774c0efc07e6c9236a0ceb0bda3c0dbd9b09db7d8415bbd`; `20260324154955` sha256 `9fed5ab4c75b4441ae28ce3ba473fc574b34a996bc1c0127d5c71c23360d506c`. Live publication `supabase_realtime` holds only `public.orders`; the changes are absent, so `history-only` would be false. They stay excluded and unrecorded. Disposition options when you decide: (1) record both as `deliberately-not-executed` (my recommendation: no subscriber for `order_pictures`, none for `payments`/`order_signatures`; the portal polls); (2) separately, a new migration publishing only `task_status` and `order_lot_pictures` if live crew/lot-picture updates are wanted (admin calendar and pending-order card already subscribe); (3) execute as written (not recommended).

## D. How it would be executed
After you sign A and B (and optionally choose C1), I generate one sealed batch (2 to 4 rows, ledger 372 to 374 to 376, script sha and ledger hashes bound in one statement), run it unchanged with `supabase db query --linked -f`, and verify. Nothing here changes the schema.
