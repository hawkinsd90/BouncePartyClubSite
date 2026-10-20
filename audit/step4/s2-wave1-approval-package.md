# S2 wave 1: the next history-only batches after the canary (AUTH-7), for owner review

Status: **AUTH-7 (batch B02) EXECUTED 2026-10-20 12:46 UTC; ledger 71 rows, SHA-256 `aaa094892be5…` as predicted (`s2-authorization-package.md` section 10). B03 to B08 are PREPARED for owner review and NOT authorized; their start rows and hashes below now begin at the 71-row ledger.** This file prepares only history-only batches of S2; it adds no strategy and asks for nothing outside S2.

## 1. Recommendation: the smallest safe approval
**AUTH-7 = batch B02 only** (12 versions). B02 has no predecessor batch and no dependence on the 44 attestations. B03 to B08 follow the same pattern and also have no predecessors, so you may later approve them one at a time (the same one-line form) or together; the procedure always applies **one batch per call, in order, each after its own fresh checks, stopping on the first failure**. Batches that depend on signed attestations (B31, B33, B40) and the security-touching batches are **not** in this file.

## 2. What a history-only batch is, and what it is not
Each version in the batch gets one ledger row `-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=Bnn; version=...; rule_sha256=...; basis=...`. **No historical migration SQL runs.** No schema, policy, grant, function, trigger or application data changes (the script contains no DDL, GRANT, REVOKE or TRUNCATE; verified by `test_execution_scripts.py` T19). The only write is the ledger INSERT inside one `DO` block with assertions. Consequence: Supabase tooling then treats those versions as applied, while the ledger honestly says they were not executed by this reconciliation. A batch needs your **batch approval**, not an individual signature, because every version is covered by a read-only rule that must be true.

## 3. Batch table (sequence assumes each earlier batch is applied exactly)
| Batch | Versions | Start rows / SHA-256 prefix | End rows / SHA-256 prefix | Script template SHA-256 (prefix) | Filled script SHA-256 (prefix) | Approval text SHA-256 (prefix) |
|---|---|---|---|---|---|---|
| B02 | 12 | 59 / `99f57ab95a29` | 71 / `aaa094892be5` | `090fe1be33f3` | `d22908b9d56b` | `3d0965c9abed` |
| B03 | 12 | 71 / `aaa094892be5` | 83 / `7990552f9bff` | `b89c96171c5f` | `7d76d1d4c49f` | `0f29951f9b87` |
| B04 | 12 | 83 / `7990552f9bff` | 95 / `1695bf3e8fe6` | `4e4aaf6feb4f` | `cf16e049df1e` | `41e1bb7c9613` |
| B05 | 12 | 95 / `1695bf3e8fe6` | 107 / `f98206614ced` | `2d4f4cca0522` | `93dda6dcefcb` | `fe1d54545b94` |
| B06 | 12 | 107 / `f98206614ced` | 119 / `d56a5aa725c8` | `4a838bdf7747` | `ef5441bac12d` | `d6d3c8ea9b13` |
| B07 | 12 | 119 / `d56a5aa725c8` | 131 / `055a4036b182` | `71d4b40ab3a9` | `bd4fa6fff8fd` | `922acfee727f` |
| B08 | 10 | 131 / `055a4036b182` | 141 / `97797bb27b3f` | `cf12b904bd65` | `6a6519ae708e` | `0c648b7c1d97` |
Full hashes are in section 6. The version list of each batch is in `s2-reconciliation-manifest.csv` (filter by `batch`); B02's twelve versions are listed in section 4. Reversal templates reproduce their recorded hashes (`development-execution-batches.json`); `REVERSAL Bnn` needs your separate written authorization and a ledger DELETE never undoes SQL.

## 4. B02 in detail (the proposed AUTH-7)
Versions (12): `20251003135541`, `20251003142953`, `20251003200000`, `20251004233954`, `20251006142419`, `20251008132209`, `20251008202716`, `20251019141249`, `20251126190540`, `20251130201520`, `20251201183508`, `20251202161637`.

| Item | Value |
|---|---|
| Starting ledger | 59 rows, SHA-256 `99f57ab95a29e7174e1c70fa7f69e05acf5b7669a3b43b4204a888883f751466` (equals Development now) |
| Ending ledger | 71 rows, SHA-256 `aaa094892be546bd80c565120d3e748ba6344ff2ce196a7d96e60c2c5668294d` (predicted from the real 59 rows plus 12 new rows with their marker md5) |
| Script template | SHA-256 `090fe1be33f32ca4966f9fda86d48698ea7bba0e366a9684ded4d64a3f15a251` (reproduced from `build_execution_package.py`; equals `development-execution-batches.json`) |
| Filled script | SHA-256 `d22908b9d56be42fa53e19773d2e3571c43ca997f33ce3b999e3d23f592d5bd4` with `{{BATCH_START_COUNT}}` = 59 and `{{APPROVAL_SHA256}}` = `3d0965c9abed5154ea72d454a0f9dfdcf4106d2d2eefacf5e9dd7f50d50459ab` |
| Reversal | template SHA-256 `80994612aaab0a1d4d77067dad57ad7f5be1f4301a89e1f820fdac6d39a3e12c`; filled SHA-256 `8e6a5e3394b0c585a9a6af137031415cfaf5c558d4f2ad97fe213fe74e16100d`; deletes exactly these 12 rows and asserts the count returns to 59 |
| Read-only preconditions | Q00 (project `srxunxiytojjsuhcmzjg`, role `postgres`); Q01 ledger export: 59 rows and the SHA-256 above; none of the 12 versions recorded; each version's rule SELECT true; the 11-category schema fingerprint equal to the baseline; the fresh backup `dev-20261020T1206Z` intact. **All 12 rules evaluated TRUE today at 12:3x UTC (read only)**; they are re-run immediately before the write |
| In-script assertions | advisory lock; start count = 59; per version: not already recorded, rule true; end count = 71; any failure rolls back the whole call and records nothing |
| Schema and data effect | none: ledger rows only; orders, payments, customers, pricing, Storage and functions are untouched; the schema fingerprint must stay equal on all 11 categories and only the ledger SHA-256 changes |
| Failure | a rejected script records nothing: report the assertion and change nothing; if the connection drops, never resend: run Q01 and compare |
| Dependencies on attestations | **none** (B02 has no predecessor batch); the 44 attestations stay unsigned and untouched |
| Log | an entry in `%USERPROFILE%\BPC-Operator-Log\s2-operator-log.jsonl` (chain head `153b8422…`) |

## 5. Dependencies that remain (not in this file)
B31 needs attestation batches B18 and B21; B33 needs B21; B40 needs B31 and B33. B09 to B12, B32, B34 to B36 and B41 to B43 are history-only batches with no attestation dependence but need their predecessor history-only batches first (`s2-reconciliation-manifest.csv`, column `predecessor_batches`). The 44 attestations (B13 to B22, B37) need individual signatures and are not requested. Security-touching batches must be recorded before any later stage changes the objects they check.

## 6. Approval statements (each under 300 characters, to avoid truncation) and their hashes
Reply with the statement for the batch you approve. Approving B02 does not approve B03.

**B02** (210 characters; text SHA-256 `3d0965c9abed5154ea72d454a0f9dfdcf4106d2d2eefacf5e9dd7f50d50459ab`; filled script `d22908b9d56be42fa53e19773d2e3571c43ca997f33ce3b999e3d23f592d5bd4`; end 71 rows `aaa094892be546bd80c565120d3e748ba6344ff2ce196a7d96e60c2c5668294d`):

> AUTH-7 B02: apply S2 history-only batch B02 (12 versions, template SHA-256 090fe1be) to Development as one transaction. Start 59 rows, ledger SHA-256 99f57ab9. Records only, no migration SQL runs. Nothing else.

**B03** (210 characters; text SHA-256 `0f29951f9b873918d0a12f17560cc26e8a5369cfa292a9723535f5b14bf53891`; filled script `7d76d1d4c49ffabd88294f258ad34a908d176ca02a61fb5e5fb29235771cd733`; end 83 rows `7990552f9bff2ef5141a4d7eb3747984ca6b27892186df50d1364723f81e1fdd`):

> AUTH-7 B03: apply S2 history-only batch B03 (12 versions, template SHA-256 b89c9617) to Development as one transaction. Start 71 rows, ledger SHA-256 aaa09489. Records only, no migration SQL runs. Nothing else.

**B04** (210 characters; text SHA-256 `41e1bb7c96133e621314a4b20c8cee16851bdb5aa2897c9e6a6b19b1aadcbfdd`; filled script `cf16e049df1eb8519ad41b3cc085e7636bcef39f5fcb053de9a4aa75f2f9be6f`; end 95 rows `1695bf3e8fe6c1b37a9683a229480d4485cd2883c282838d32b1fee4b476abdb`):

> AUTH-7 B04: apply S2 history-only batch B04 (12 versions, template SHA-256 4e4aaf6f) to Development as one transaction. Start 83 rows, ledger SHA-256 7990552f. Records only, no migration SQL runs. Nothing else.

**B05** (210 characters; text SHA-256 `fe1d54545b940c327ec70c2fc0f649b7d046dec85c6d8053cc4799e92027b888`; filled script `93dda6dcefcb160ee9614f18c63abd5312ce16d9dd0840b357b058ceb7189614`; end 107 rows `f98206614cedc69b97cc80e6efd75ea57032adaa240ea9b627f19d787d837f93`):

> AUTH-7 B05: apply S2 history-only batch B05 (12 versions, template SHA-256 2d4f4cca) to Development as one transaction. Start 95 rows, ledger SHA-256 1695bf3e. Records only, no migration SQL runs. Nothing else.

**B06** (211 characters; text SHA-256 `d6d3c8ea9b13911373c0b1f254ad36bff1f11abc5ca8ffa7081889df194309f1`; filled script `ef5441bac12dabe9f55c0d376f6922ee2a008257567cdc15674f109aa3f0769b`; end 119 rows `d56a5aa725c8fe197d1c320d9f43aed9d994c94f30bdb1e63157037ad773d00a`):

> AUTH-7 B06: apply S2 history-only batch B06 (12 versions, template SHA-256 4a838bdf) to Development as one transaction. Start 107 rows, ledger SHA-256 f9820661. Records only, no migration SQL runs. Nothing else.

**B07** (211 characters; text SHA-256 `922acfee727fe26cacc7a3995c626d5aa9055110307ec22d40bf214f01246baf`; filled script `bd4fa6fff8fdbb6e569e9861a03f45eae4ed73fd37b9ce1031b035894d9ce902`; end 131 rows `055a4036b1822dbe53e7add35430b893d8a8d971ee9f2655107151c0d7e5a033`):

> AUTH-7 B07: apply S2 history-only batch B07 (12 versions, template SHA-256 71d4b40a) to Development as one transaction. Start 119 rows, ledger SHA-256 d56a5aa7. Records only, no migration SQL runs. Nothing else.

**B08** (211 characters; text SHA-256 `0c648b7c1d97032a8b7af6f8cc77b18b22872638c458a8417a17e68beb89da19`; filled script `6a6519ae708e99d59ac0f66c752c0bafec7f8a760d89282778c97c84ea3b1271`; end 141 rows `97797bb27b3fa497314b4deaa47ee4961501539f34dbbc0293218ee2826c5b9e`):

> AUTH-7 B08: apply S2 history-only batch B08 (10 versions, template SHA-256 cf12b904) to Development as one transaction. Start 131 rows, ledger SHA-256 055a4036. Records only, no migration SQL runs. Nothing else.

