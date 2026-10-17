# Derived generator inputs (committed)

These four files are the only inputs the Step 2 generators read that are not themselves committed manifests or migrations. With them, `build_development_plan.py`, `build_execution_manifest.py`, `build_execution_package.py`, `render_approval_package.py` and `build_production_plan.py` (`candidates`, then `manifest`) regenerate every canonical manifest, rules file and batch file byte for byte from a clean checkout, with no access to the protected `migration-evidence` folder.

| File | What it is | Produced by (needs the protected captures and local PostgreSQL) | Sanitization |
|---|---|---|---|
| `e2a-statements-all.csv` | One row per statement-level object of every migration file, with its PRESENT/ABSENT/UNPROVABLE status against the captured Production and Development catalogs (object names, statuses and classification phrases) | `e2a_run.py` | The `detail` column of `data` and `dynamic` rows (a truncated copy of migration SQL, which can contain addresses and seed values) is replaced by a fixed placeholder; no generator reads it |
| `atom-validation.json` | For each catalog-check expression used in a Development rule: whether it evaluates (true/false) on the captured Development schema restored locally | `test_execution_scripts.py` (check T01), which rewrites it cumulatively in the work directory | none needed: object names and booleans only |
| `prod-validated.json` | For each of the 58 Production steps: the pre/post-state check atoms that held on the local rehearsal | `rehearse_production_plan.py` | none needed |
| `dev-ledger-versions.txt` | The versions in the Development migration-history table at the read-only capture (sorted) | transcribed from the E2J-B read-only query Q01 | versions only, no statements |

Nothing here is a raw capture, a customer record, a credential or a token value. Object names such as `invoice_links.link_token` are schema names, not secrets.

Rehearsals regenerate `prod-validated.json` and `atom-validation.json` in the work directory and must reproduce these files exactly (verified at Step 2 acceptance). Paths: `tools/step2_paths.py` (`BPC_WORKDIR` for intermediate files, `BPC_EVIDENCE_ROOT` for the protected folder used only by the rehearsals).
