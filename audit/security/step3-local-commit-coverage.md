# Step 3A: what the local `Dev` commits already fix

Baseline: `Dev` is 296 commits ahead of `main` (merge base `b79ca48`). Nothing here is deployed to Production or hosted Development. "Tested" means a committed local test exists; the executed (database) layers of those tests need a scratch PostgreSQL that was **not running** during this audit, so only static/source layers were re-run (see section 3).

## 1. Security-relevant commits

| Commit | Subject | Migration / code | Issues addressed | Local test |
|---|---|---|---|---|
| 2887507 | harden payment authorization | 20261007120000; `_shared/auth.ts` | SEC-012, 013 | paymentRpcHandlerAuthorization |
| 7c63edf | close public admin security exposure | 20261008120000 | SEC-006, 011 | adminAccessHardening, roleAssignment |
| b75cd30, b1b001e | secure customer portal links / data | 20261009120000; portal functions | SEC-033 | customerPortalAccess, portalLinks |
| 45377db, ba07859 | secure public booking creation | 20261010120000, 20261011120000; create-booking | SEC-001 (anon inserts removed) | publicBookingSecurity |
| 6a9e63b, 98edf56 | restrict private customer and order data; repair chain | 20261012120000 | SEC-001, 002, 003 | coreDatabaseAccess |
| ad69b5d | restrict remaining public database access | 20261013120000 | SEC-003, 010, 011, 012 | databaseFunctionAccessClassification |
| dfffd8f | protect waiver media | 20261014120000 | SEC-018 | waiverAuthorization, privateMediaAccess |
| 36121ae | protect customer photos and evidence | 20261015120000, 20261015123000 | SEC-019, 020 | customerPhotoAccess, orderEvidenceAccess |
| 91da72a, fa08fb5 | repair role assignment; correct sequencing | 20261016120000 | SEC-007 | roleAssignment |
| 4cc55b3 | secure notification relays and confirmations | 20261017120000; send-email, send-sms-notification | SEC-030, 031 | notificationRelayAuthorization |
| 22377fe | harden database access and public event ingestion | 20261018120000, 20261018120100, 20261018120200 | SEC-008, 009, partly 015 | siteEventIngestion |
| b14fbd9, 6fd2b5a, 31de880, c5543e1, 2afc8d7, 26522ff, 00b900d | card charging, server pricing, refunds | 20261019 to 20261025 | SEC-034 | payment/refund harness |
| 84cdc3e | contact-inquiry order; secure payment-method recovery | fix-payment-method | SEC-022 | fixPaymentMethodAuthorization |
| 8b4a514 | refresh utility, notification isolation | relay guards | SEC-040 | devRefresh and relay tests |

Overlaps and contradictions checked: 1007 says `approve_order_changes` stays anon-executable; 1012 revokes it (final state wins). Three October headers carry stale statements (recovered files exist); comment-only. 1014 creates policies that 1015 drops; the three storage files must apply together. No two commits implement the same fix twice.

## 2. Classification of every issue
Full detail is in `step3-security-issue-register.csv`.

- **Already corrected locally, testing required (16):** SEC-001, 002, 003, 006 to 009, 011, 012, 013, 018, 019, 022, 030, 033, 034.
- **Partially corrected (5):** SEC-010 (no allow-list), SEC-015 (supabase_admin defaults), SEC-020 (public-assets evidence), SEC-040 (relays not deployed), SEC-044 (transient exposure).
- **Confirmed unresolved (16):** SEC-005, 014, 016, 017, 021, 023, 024, 025, 027, 028, 032, 036, 038, 041, plus test debt SEC-042, 043.
- **Potential vulnerability or decision (6):** SEC-004, 026, 029, 035, 039, 045.
- **Production state not yet verified (2):** SEC-031, 037.
- **Not a vulnerability (1):** SEC-046.

## 3. The two failing suites (re-run this audit, no scratch DB)
- `coreDatabaseAccess`: 307 passed, 1 failed. The failing static assertion encodes a pre-recovery fact about `customer_approved_at`. Recovered migration `20251126190624` creates it. **Outdated expectation** (SEC-042).
- `databaseFunctionAccessClassification`: 59 passed, 1 failed. It asserts no migration creates `billing_addresses`; recovered `20260501173826` does. **Outdated expectation** (SEC-043).
Neither indicates a live vulnerability. Both executed layers were SKIPPED, so they have not run against a replayed database in this session; that is the first Step 3B task.

## 4. Dependence on uncommitted deployment
Everything in section 1 protects nothing until deployed. Production's catalog is unchanged by any of it (LIVE-PROD).
