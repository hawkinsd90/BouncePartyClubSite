# E2J: Development release gates and sequence (updated for E2I and E2J findings)

Planning document only. Nothing here authorises a hosted action. **Development first; Production's existing working schema and business behaviour are the reference; Production is not modified in this programme until Development has been accepted and the owner separately approves it.** No hosted-capable executor is designed or built in E2J; the local executor stays local.

## 1. Five activities, kept apart
| Activity | What it is | Reversible? | Evidence it needs | Approver |
|---|---|---|---|---|
| A. Historical bookkeeping | Adding ledger rows (history-only or attested) for versions whose effect is already in the database | Yes, by deleting the rows (with an audit trail) | Fresh read-only evidence (E2J package), the closure rules, signed attestations | Owner, per version class |
| B. Actual SQL execution | Running migration SQL that changes schema or data (2 bucket updates, optionally `update_pricing_rules`, and later the 23 October files) | Only through prepared recovery SQL | Rehearsal on a fresh scratch restore; recovery plan; Edge Function gates | Owner, per batch |
| C. Security remediation | Grants, defaults, schema ACL, policies, secret redaction, demo-login review | Partly | The Step 3 list (section 4) and `e2j-default-privilege-analysis.md` | Owner + security review |
| D. Edge Function deployment | Replacing the 14 stubs with real functions, JWT settings, secrets | Redeploy | Deploy-first list (R.2 4.1 to 4.3) | Owner |
| E. Application validation | Build, type regeneration after the schema is final, browser acceptance (Step 6) | n/a | Step 6 checks | Owner |

A ledger row is never a substitute for B, C or D. Bookkeeping never runs SQL; SQL execution never edits the ledger by hand (rows come from the reviewed plan). Each activity has its own approval and its own stop point.

## 2. Updated sequence
| Step | Activity | Content | Entry gate | Exit evidence |
|---|---|---|---|---|
| 0 | Decisions | Answer A1 to A6 of the capture authorization and U-E2I-1 to U-E2I-11 | This stage's documents reviewed | Owner's written answers |
| 1 | Read-only evidence | Run the Development-only query package (31 ids) through the owner-approved role | Gate G1 | Output files with hashes; Q00 valid; Q01 = 58 captured rows |
| 2 | Manifest closure | Apply `e2j-manifest-closure-rules.csv` to the results; regenerate `e2i-development-manifest.csv` as a new reviewed file; independent review | Step 1 complete | Frozen manifest (hash), still not an allowlist |
| 3 | Security decisions | Decide the default-privilege target, the schema-ACL end state, the demo login, any changelog redaction | Gate G2 | Written target for section 4 items |
| 4 | Bookkeeping, part 1 | Record evidence-backed history-only candidates (net-zero chains after their droppers) and signed attestations that the evidence supports, **before** any SQL | Steps 2 and 3 | Ledger rows with markers; audit trail |
| 5 | Pre-October SQL (optional) | At most `20260325231044`, `20260517221038`, optionally `20260611184401`; any privilege remediation as a **new** reviewed migration (never an edit to historical SQL) | Owner approval U-E2I-3/4/7 | Rehearsed on scratch; catalog re-diff |
| 6 | Edge Function deployment | Deploy-first set before the October files that need it; stubs stay until their gate | Gate G3 | Per-function smoke checks |
| 7 | October rehearsal | Fresh restore of the then-current Development schema, 23/23 files, security-state capture, containment SQL prepared for the three portal functions | Steps 1 to 6 | Rehearsal report; recovery plan current |
| 8 | October execution | The 23 files in version order, recorded as executed rows, only by a mechanism the owner has approved (a separate, future, reviewed design) | Gate G4 | Post-run catalog = rehearsal catalog |
| 9 | Bookkeeping, part 2 | The 8 storage-policy versions history-only after 20261014120000, 20261015120000 and 20261015123000 have run and Q22 matches the target | Step 8 | Ledger rows; Q22/Q29/Q30 re-run |
| 10 | Containment removal | In the order of section 4; each removal separately approved and reversible | Gate G5 | Per-item verification |
| 11 | Application validation | Type regeneration only after the schema is final; Step 6 browser acceptance | Step 10 | Acceptance record |
| 12 | Production | Separate plan and approval; Production history bookkeeping timing chosen by the owner | Development accepted | Not planned here |

## 3. Gates
| Gate | Condition | Blocks |
|---|---|---|
| G1 | Owner approves the read-only capture (authorization A1 to A6); credential method agreed; evidence stored outside Git | Step 1 |
| G2 | Owner answers U-E2I-7 (default privileges and schema end state), U-E2I-8 (demo login), and Q18 is known | Steps 4 to 5 for any item touching privileges or secrets |
| G3 | Deploy-first Edge Functions available for the October files that need them (R.2 4.1 to 4.3) and `create-booking` can read its catalog tables (section 4, item E2J-1) | Step 8 |
| G4 | October rehearsal passed on the then-current schema; the three-portal-function containment SQL is ready; callers of the October restrictions confirmed (`e2h-security-recovery-plan.md`); snapshot before `20261016120000` | Step 8 |
| G5 | The Step 3 items marked "before containment removal" are closed | Step 10 |
| G6 | Standing prohibitions unchanged: no `--include-all`; no baseline/alias files applied; no CLI that initialises login roles; no October on hosted Development while the stubs and the coordinated release are unauthorised | Everything |

## 4. Step 3 findings that must be resolved before Development containment is removed
Containment here means: the 14 Edge Function stubs, the revoked schema USAGE for `anon`/`authenticated` on `public`, removed storage policies, private buckets, missing Realtime membership, absent pg_net and the missing signup trigger. Items refer to the audit's R.1 list; E2J adds the lines marked NEW.

**Before the schema containment (anon/authenticated USAGE on `public`) is removed** - from then on every grant, default and policy is reachable by anonymous callers:
| Item | Why it blocks |
|---|---|
| 3.2 anon-executable function allow-list | the audit (3.2) lists Development at 75/82; October narrows to a named list; reconcile first |
| 3.3 `supabase_admin` default ACLs | Production keeps them; Development must not inherit them. Confirm nothing in Development is created as `supabase_admin` |
| 3.4 anonymous INSERT on `pending_signups_consent` | deliberate in October; owner must accept |
| 3.5 crew policies on `orders`/`customers` | broad as written in `20261012` |
| 3.6 missing crew/receipt policies | would break flows rather than expose them, but must be known |
| 3.7 `SECURITY DEFINER` function without pinned `search_path` | identify and decide |
| 3.9 / 3.13 storage policy set and public buckets | October sets them; `public-assets` public/private decision |
| 3.11 signup trigger | `20261016120000` adds it; verify before signups are enabled |
| NEW E2J-1 object-level grants | 11 tables give `service_role` no rights; `create-booking` is denied on 8 of them (T3). Decide the target (`e2j-default-privilege-analysis.md` section 7) and apply it as a new reviewed migration |
| NEW E2J-2 sequences | Production lets `anon` call `setval` on `receipt_number_seq` and `payments_ledger_sequence_seq` (T5). Development must not inherit it: keep USAGE only. (A Production-side finding; no Production change is made or proposed here.) |
| NEW E2J-3 `service_role` CREATE on `public` | present in the captured Development schema; remove when the schema is reopened |
| NEW E2J-4 demo login and committed password | Q26 and G5b (password redaction after rotation is confirmed) |
| NEW E2J-5 secrets in the settings changelog | Q18 > 0 would be a live exposure; resolve before anything else |

**Before the Edge Function stubs are replaced:** 4.1 to 4.3 and 4.7 (deploy-first set, JWT setting changes, `get-waiver-status` version, hosted-source observations), 3.12 (`get_admin_users` caller).
**Before any October file runs:** 4.4 (apply with file version = recorded version, with a mechanism that does not initialise login roles), 4.5 (prerequisite files for `20261012`), 4.6 (snapshot before `20261016`), the executor-design requirements of `e2h-development-readiness.md`.
**After containment removal:** 3.1 (credential follow-through), 3.8 (`update_pricing_rules` long-term), 3.10 (hygiene), 4.8 (type regeneration), 4.9 (order-evidence migration script under its own approval).

## 5. What E2J changes in the earlier plan
1. Default privileges moved from a note (3.3) to a gate: the object-level grants of the 12 tables and 2 sequences are a blocking decision, because Development's captured schema has no defaults and Production's do.
2. A fixed order inside Step 4: bookkeeping of evidence-backed items first, SQL second, so that the ledger never claims a state the database does not have.
3. The read-only evidence run is a prerequisite for Step 2 and cannot be replaced by the Production captures (no Production row is copied into Development).
4. The two bucket-limit versions remain execution candidates; the demo-admin migration remains prohibited from execution.

## 6. Not done in E2J
No hosted query, role or CLI use; no hosted-capable executor; no grants, defaults, migration SQL, alias, application, Edge Function or frontend change; no commit or staging.
