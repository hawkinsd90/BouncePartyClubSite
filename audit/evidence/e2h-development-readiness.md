# E2H Development readiness assessment

**Assessment only.** No hosted system was contacted and no Development migration, history row or object was changed. Sources: `e2e-development-manifest.csv` (388 rows, built in E2E from the Stage B captures of 2026-10-16 and compared against the Production capture), the captured Development history (58 rows) and catalog, `e2a-dev-proof.csv`, `e2c-development-first-plan.md`, E2G/E2H executor results. Production's captured schema and working behavior remain the reference; Development is never the authority for Production.

## 1. Where Development stands (captured 2026-10-16 18:55 UTC)
| Category | Versions | What it means |
|---|---|---|
| Already recorded | 58 history rows (+1 repository-file row for the alias) | rows present in `supabase_migrations.schema_migrations`; 46 consistent with the catalog, 12 carry a note (below) |
| History-only reconciliation candidate | 213 | 209 whose material statements are present, superseded or no-op in Development, plus 4 net-zero chains; none is executed, each needs a fresh re-verification and a true predicate |
| Requires additional evidence | 80 | 68 with data or dynamic statements a schema capture cannot prove, 12 whose live definition differs from the chain or from Production |
| Withheld until security or containment prerequisites | 33 | 23 October migrations plus 10 containment-related versions |
| Explicitly withdrawn or excluded | 3 | Cases 41, 42, 43 |
| Proven to need SQL execution before the October gate | 0 | the 23 October migrations will need SQL execution after the gate |
Development pending after the withdrawals: 327 (326 if the alias file is later renamed).

## 2. Recorded versions (58)
- 14 of the 58 are also recorded in Production; 42 belong to Production's 67-version set (34 of them are items of the 58-version execute list, 8 are among the nine omitted versions: `20260715221828`, `20260716104333`, `20260716151530`, `20260716152823`, `20260716173644`, `20260717111737`, `20260717113131`, `20260814114825`).
- `20260722172048` is recorded in Development with its effect present (nullable `orders.surface`): nothing to do there; it is only a Production-release item (D-2).
- 12 recorded rows carry a Stage B note: nine are "recorded, no catalog-verifiable effect" (data or privilege only, covered by owner attestation in Stage B); `20260718000744` was flagged recorded-with-missing-effect and corrected in E2A (63-byte policy names); `20260723174017` lost a storage policy later (consistent with containment); `20260814002658` is the alias. They stay recorded; none is re-executed.

## 3. Development-specific alias treatment
Development recorded the contact-inquiry creation as `20260814002658`; the repository file is `20260814120000_create_contact_inquiries.sql` (SQL digest-identical). In the manifest the file is **"already recorded (identity alias)"**, not pending and not to be executed. Unchanged by E2H: no rename, no new history row. The CLI-documented (untested) complaint about a recorded version with no local file and the repository-order story in `contactInquiryMigrations.test.ts` are the reasons U-E2E-2 remains open. Of Production's 58, `20260814120100` (ensure invoice fields) is **not** recorded in Development; its effect is present there through the earlier migrations, so for Development it is a history-only candidate, not a copy of Production's execute item.

## 4. History-only candidates (213)
- 209 versions: all material statements present, superseded or no-op in the Development catalog (E2A class H). Each still needs (a) a fresh capture, (b) a statement-level predicate evaluated read-only immediately before the record is written, (c) the marker "history-only, NOT EXECUTED, basis ...". Production's recorded history is **not** evidence for any of them.
- 4 net-zero chains (`20260315190615`, `20260315202232`, `20260316174421`, `20260324191543`): they create the objects `custom_email_hook` and `claim_order_for_approval` that later versions drop; both objects are absent in Production and Development and Production recorded the whole chains. They may be recorded only together with their dropping versions and must **never be executed** (a transient security-definer function would be created). This refines E2A's class X (owner decision U-E2E-10).

## 5. Versions still lacking evidence (80)
- **68 data or dynamic statements** (seeds, backfills, deletes, DO blocks): need per-statement read-only count queries (`readonly_queries_needed` in `e2a-dev-proof.csv`) or labelled owner attestations (U-E2E-14). A count never proves that the original SQL ran.
- **12 definition differences**, each to be compared with Production's live definition before any decision: `20251001051901`, `20251207163822`, `20251207184549`, `20251215015109`, `20260311111714`, `20260314213726`, `20260317201616`, `20260318193312`, `20260324193222`, `20260501173826`, `20260611153900`, `20260611184401`. Examples: `user_roles` policies and the `assign_role_by_email` PUBLIC grant exist in Development only; `update_pricing_rules` exists in Production only; `20251215015109`, `20260311111714`, `20260314213726`, `20260317201616` and `20260318193312` are identical in both environments but differ from their chains (drift or matching limits).

## 6. Withheld versions (33)
- **23 October migrations** behind the deployment gate: the 14 Edge Function stubs and containment stay; `customer-cancel-order`, signed-URL consumers and the other prerequisites in `e2e-release-prerequisites.md` must be satisfied first. The October block is Development's own critical window (the anonymous function surface widens before `20261013120000`, see `e2h-security-recovery-plan.md`).
- **8 storage-policy versions** (`20251008190000`, `20251129190013`, `20251129190039`, `20251202171808`, `20251230184228`, `20251231161729`, `20260324012349`, `20260324180043`): the `storage.objects` policies are present in Production and absent in Development (consistent with containment; unverified). Not restored by default; the October storage migrations define the final policy set.
- `20260323201502` (`pg_net` extension and calendar-sync trigger path: Edge Function dependency) and `20251229223230` (signup trigger absent in Development; recreated by `20261016120000`).

## 7. Withdrawn
Cases 41 and 42 (decided, files archived in E2F) and Case 43 (Stage C3). Development records none of them and must never record them. Development also does not record `20260305205811`, whose backfill is unprovable there (class P, an evidence item), so withdrawing Case 41 does not settle it.

## 8. Required differences from Production's 58-version execution strategy
| Aspect | Production candidate (58) | Development |
|---|---|---|
| Starting ledger | 277 captured rows ending `20260928172217` | 58 captured rows (including the alias `20260814002658`) |
| Executable now | 58 versions, 9 history-only | **none proven**; 23 October migrations later; targeted alignments only after evidence and never by replaying historical files |
| Already done | none of the 58 | 34 of the 58 are already recorded; 8 of the 9 omitted ones are recorded |
| History-only | 9 (net-zero pair, `20261010110000`, six superseded) | 213 candidates plus evidence items; different predicates and different basis texts |
| `20261010110000` | no-op because `orders.customer_approved_at` exists via recorded `20251126190624` | Development has the column but has **not** recorded `20251126190624`; the reason must be re-established for Development, not copied |
| Older-than-latest versions | 31 of the 58 | a different set (the executor takes `latest` from the Development base history) |
| Critical window | `20260716151458` to `20261011120000` | the October block (the Development-line effects are already present) |
| Containment | none | 14 Edge Function stubs and removed storage policies are part of the starting state |
| Alias | the file `20260814120000` is an execute item | the file is already recorded under another version: never executed |
The local executor and builder are Production-58 specific (E2G tests D01 to D03); a Development executor needs its own allowlist rules, base history (58 rows), predicates, evidence-gated items and the October block behind the gate.

## 9. Minimum additional evidence before a Development-specific manifest can be approved
1. **Fresh read-only captures** of Development (catalog, history, containment inventory) and of Production (reference definitions) inside one 24 h window.
2. **Statement-level predicates** regenerated from the fresh capture for the 213 history-only candidates, reviewed by the owner (the 4 net-zero chains need their dropping versions proven first).
3. **Read-only count queries or labelled attestations** for the 68 data/dynamic versions.
4. **Definition comparison with Production** for the 12 differing items and an owner decision per object (align, accept drift, leave to the October migrations), including the extra `user_roles` policies and the PUBLIC grant on `assign_role_by_email` (a security finding for Development).
5. **Containment inventory** (which storage policies, triggers, extensions and functions were removed on purpose, and when) and the owner's decision on lifting it.
6. **October readiness**: Edge Functions restored and deployed in the required order, signed-URL consumers ready, the data preflight (the same checks as Production's, run on Development data) and a local rehearsal of the captured Development dump through the Development manifest.
7. **Executor requirements** in `e2h-ledger-integrity.md` met for the Development ledger (three-column table, marker kinds, external audit store with a pinned head) and an owner approval artifact for the Development project.
8. A decision on the alias (U-E2E-2) and on the two pre-existing failing test assertions (U-E2E-9), so the repository baseline is clean.

## 10. Rules that stay in force
No unknown migration is marked applied. No history row is copied from Production. No historical migration file is replayed to "align" Development. Every Development history-only or attestation record states its own basis; attestations are labelled "NOT EXECUTED, not proven by the catalog". The Production allowlist is never reused as a Development execution manifest.
