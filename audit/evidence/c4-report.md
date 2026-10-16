# Stage C4 report: three October migration headers (comments only)

HEAD `831ea9496438fd3188c954106e88f6e9d500329b`, branch `Dev`. Raw before/after JSON: `C:/Users/vikki/migration-evidence/c4-scratch/`. Scanner: `audit/evidence/tools/c4_sql_fingerprint.py` (PostgreSQL-aware: keeps '...' and E'...' strings, "..." identifiers and $tag$ bodies verbatim; removes only `--` and nested `/* */` comments outside them; collapses whitespace; LF-normalised).

## Hashes
| Version | Full SHA-256 before | Full SHA-256 after | Executable-SQL SHA-256 before | after |
|---|---|---|---|---|
| `20261010110000` | `18a609d58c09de80f2aae95825bb0a09e667ee4182eaaea15311e00a25d63827` | `b977c47fc8cccea9b7cd3c61da69a6b6e172386189a4f58e6d32b52053033ce6` | `4708d96a5c9703b842cea053b5faa2074d22203910cc843716c0ea2ed2beb1e5` | `4708d96a5c9703b842cea053b5faa2074d22203910cc843716c0ea2ed2beb1e5` |
| `20261013120000` | `b21804fa83d999ed59b4c79d0d66c92da90fedd05cbaed22c95458cc3fd309e5` | `a68824b6076ced053b78bdf209f12fe79912d5403b3354b24e5091d2cc9aaff7` | `cc3f40a323aaa2764c284a652486dccbc55848a390b08d404c8e1cd265caf236` | `cc3f40a323aaa2764c284a652486dccbc55848a390b08d404c8e1cd265caf236` |
| `20261016120000` | `7ac0c75eed78aedb547b6113c72178aa60907fa13d83133e34e33f8af222179f` | `2ca02e10dfa040575798c71ef30bf605f6a7ad8b54918928e99a41f7deb6970b` | `b75ce69b2e873ecf81a398b823fe14f480c60b212e9dad396a691eb79cb53b7a` | `b75ce69b2e873ecf81a398b823fe14f480c60b212e9dad396a691eb79cb53b7a` |

All three executable-SQL fingerprints are **identical**, so the changes are comment-only. The `20261016120000` "before" hash equals the SHA-256 recorded at the end of C2 (`7ac0c75e...179f`), proving the C2 file was the starting point.

## Corrections (exact)
1. `20261010110000_add_customer_approval_timestamp.sql` (header). Was: "...selected and listed by create_booking_request, but no earlier migration creates it. Add it as a nullable timestamp with no default..." Now: "...by create_booking_request. Migration 20251126190624 (add_customer_approval_workflow) already creates it; this statement only ensures it exists, as a nullable timestamp with no default..."
2. `20261013120000_restrict_remaining_public_database_access.sql` (header). Was: "public.billing_addresses exists only on the live database (no tracked migration, no application code reads or writes it)." Now: "public.billing_addresses is created by migration 20260501173826 (add_billing_addresses_table); no application code reads or writes it."
3. `20261016120000_repair_role_assignment_and_signup_provisioning.sql` (two comments). Header item 6 was: "columns the repository migrations never create ... Dev already has them; a fresh replay does not, so signup failed at that step too." Now: "Migration 20251229223230 (update_customer_profiles_names) already adds them ... they exist on Production, on Dev and in a replay; the ADD COLUMN IF NOT EXISTS below only keeps this migration self-contained." Inline comment was: "Dev has these columns; the repository migrations never created them." Now: "Migration 20251229223230 (update_customer_profiles_names) already adds them, so this is a no-op wherever that migration was applied."

Sources confirmed: `20251126190624` creates `customer_approved_at`; `20260501173826` creates `billing_addresses`; `20251229223230` adds `first_name`/`last_name` to `customer_profiles`.

## Verification
- C2 order intact in `20261016120000`: drop-CHECK block line 56, normalising UPDATE line 72, vocabulary guard line 75, ADD CHECK line 81.
- Case 43 absent from `supabase/migrations/`; 386 files.
- `git diff --name-status HEAD -- supabase/`: the Case 43 deletion plus modifications of exactly `20261010110000`, `20261013120000`, `20261016120000`. No applied or recovered migration modified.
- Tests: `migrationReplaySafety` 144 passed, 0 failed; `recoveredMigrationFiles` 63 passed, 0 failed; `contactInquiryMigrations` 14 passed, 0 failed, 1 skipped (its executed layer needs a scratch PostgreSQL, which was not running; not a pass). Full replay not repeated (no executable change).

Hosted Production and Development untouched; no Supabase CLI, Docker or WSL; nothing staged.
