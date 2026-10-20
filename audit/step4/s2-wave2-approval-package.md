# S2 wave 2: the remaining dependency-safe history-only batches, one group authorization (AUTH-9)

Status: **PREPARED FOR OWNER DECISION. NOT AUTHORIZED. NOTHING HAS BEEN EXECUTED.** Development's ledger is 141 rows, SHA-256 `97797bb27b3fa497314b4deaa47ee4961501539f34dbbc0293218ee2826c5b9e` (after B01 to B08; commit `cdfb4202`). This package covers every S2 history-only batch that is eligible now: **11 batches, 82 versions**. It adds no strategy and asks for nothing outside S2.

## 1. The one decision requested
Send the statement in section 2. It authorizes executing exactly the prepared scripts below, in the order listed, each as its own transaction, continuing automatically while every check passes and stopping at the first failure (no retry, no reversal). It excludes the 44 attestation versions, the 13 disputed versions, the S3 versions (B23, B24), batches B31, B33 and B40 (blocked behind attestations), any migration SQL, any Production access, any push.

## 2. Group statement (286 characters, text SHA-256 `32596a0949658c943f8272b6a9a09d6f634db4ec711e955aa6b229ddc45bc74f`)

> AUTH-9: apply S2 history-only batches B09,B10,B11,B12,B32,B34,B35,B36,B41,B42,B43 (82 versions) to Development in order, one transaction each, per s2-wave2-approval-package.md. Start 141 rows SHA 97797bb2, end 223 rows SHA e8f53b1e. Records only. Stop on any failed check. Nothing else.

**Approval binding.** Each batch script carries its own approval-text hash in its first comment line only (no statement asserts it), exactly as for B03 to B08. The group statement incorporates the per-batch statements of section 5 and the hashes of section 3: execution uses only scripts whose template, filled and approval hashes equal those tables. As with B03 to B08, the per-batch records are derived from this one message; no signature is claimed for them and no script is edited.

## 3. Batch table (start and end are exact; each batch starts where the previous one ends)
| Order | Batch | Versions | Security-touching rules | Start rows / SHA-256 | End rows / SHA-256 |
|---|---|---|---|---|---|
| 1 | B09 | 12 | 12 | 141 / `97797bb27b3fa497314b4deaa47ee4961501539f34dbbc0293218ee2826c5b9e` | 153 / `44fcce80144c16dd50abefcb8d16194423e929dd994c4d76fe4951cf28bec58b` |
| 2 | B10 | 12 | 12 | 153 / `44fcce80144c16dd50abefcb8d16194423e929dd994c4d76fe4951cf28bec58b` | 165 / `0035320c5b29c2bd00eaf4275fa16878e18990037307a700f6ff64d9dd3a0dc5` |
| 3 | B11 | 12 | 12 | 165 / `0035320c5b29c2bd00eaf4275fa16878e18990037307a700f6ff64d9dd3a0dc5` | 177 / `14d68c9a58d3b4770e5a1eacc08ac1af5cf77ede203e9bcc7da8ff0b8676e524` |
| 4 | B12 | 6 | 6 | 177 / `14d68c9a58d3b4770e5a1eacc08ac1af5cf77ede203e9bcc7da8ff0b8676e524` | 183 / `aeb430554d31e4f58fcfb8a9a1e1ea03f5975b2ec653a4c77cea0bdae2178021` |
| 5 | B32 | 12 | 0 | 183 / `aeb430554d31e4f58fcfb8a9a1e1ea03f5975b2ec653a4c77cea0bdae2178021` | 195 / `a3552e0377f52188c06fdd6ac36c48404c5f8780e01667560041a360eb19d232` |
| 6 | B34 | 12 | 0 | 195 / `a3552e0377f52188c06fdd6ac36c48404c5f8780e01667560041a360eb19d232` | 207 / `a60e40cf1b11c096ee519a40a58d88a3d1eb7c8ffc14c7f2a1eca2410657ade3` |
| 7 | B35 | 1 | 0 | 207 / `a60e40cf1b11c096ee519a40a58d88a3d1eb7c8ffc14c7f2a1eca2410657ade3` | 208 / `7912775df705727d1c3a9ede9cb5cc3fd15da9f69a07eb118b379a62a9f92d4e` |
| 8 | B36 | 11 | 11 | 208 / `7912775df705727d1c3a9ede9cb5cc3fd15da9f69a07eb118b379a62a9f92d4e` | 219 / `17b72ef79b1250f1216870c930d836f8ea63f613e2cd4e0a7941e2e40be3a7d0` |
| 9 | B41 | 2 | 0 | 219 / `17b72ef79b1250f1216870c930d836f8ea63f613e2cd4e0a7941e2e40be3a7d0` | 221 / `e1daa752f90f900230060e988928914ac58f7032d9b41c9be68267861d14464c` |
| 10 | B42 | 1 | 1 | 221 / `e1daa752f90f900230060e988928914ac58f7032d9b41c9be68267861d14464c` | 222 / `ea4a6f010bd3e303ffa6a30517c515f54ad439f588b3aae15684384ffb3542ed` |
| 11 | B43 | 1 | 1 | 222 / `ea4a6f010bd3e303ffa6a30517c515f54ad439f588b3aae15684384ffb3542ed` | 223 / `e8f53b1e951463a8731ac8fdb7497b689c4677da437cad02ff7b29b1b493bbf4` |

| Batch | Script template SHA-256 | Filled script SHA-256 | Approval text SHA-256 | Reversal template SHA-256 |
|---|---|---|---|---|
| B09 | `feab47c86058fedd6b3a8f372ad02806f69a718f7a731a3875f850594b81e8b3` | `344078960f0b64def4e169b48e7e72c3f79ecc1ca8bc40c68850c865c4aa852a` | `386d1d9ffcbaf8d8110891710981e14c3e8ecb96642d91a1bc82f6ec43fca8c1` | `a4fa78c74e2b9640896183a2023b335b10b7dca5a9f2c29c71da64c0de1a1f89` |
| B10 | `930366166b88b238f05041e962d9088c1bb14b27fb30e2a681d97f39ebdce36f` | `731177ef74e96eb96522899f2486c73fb3dea55670c2f809229e2420d7b99181` | `aa7c8bc560ea11d15213a80d24ef01b9f5e070d31a0651845c1be5af54f9d438` | `14b16577755081463af4ac5215bf08ca73bc7eabb0e57e61c7a5da1404a007e0` |
| B11 | `7e68c41178fd9bba6b6570fdeb177475049d3854e93fc0d0d0ee274475d1d1be` | `fd1d3dfbf3287ccf44e00c7705470133c06512292ab609c76a93da371819f448` | `c40ae7d7453b5dbcfe51d35bf36f7fd6927e47b73b315fdf8e956d9ef80044ef` | `146c13879a0682ae011f121a873d77ea7fc935c33019b99d2e1b2ff55f3691db` |
| B12 | `6315e3e16462ec4843d4690dbc58e58c894f5d53bd35548accf91189e0500f4d` | `e24abb48b9a4404b53841cf791bccd33c5238283087ec044297d85898f389fa3` | `c93a27e032b5f6670837755f7977ec08b5b232c9c8ad8225f38a2c30e0716a13` | `63e9955c68eb5440cb4b3db92c998fb385e78f226b91b7d55e4359f56ca78dc8` |
| B32 | `e3324f6972a804eeacf05ca57f516838e92fe292d175642cc3a3edd347c81b22` | `0f9d080f49e00e5b36caf399e2417e3925a3efbef797ca5d27ce402c6da832f5` | `dfea0e19e051ebcfb4f6f0b2943c1f53e9ebbe12c9fc56be7de69fedd8d6a2c5` | `87d74d4be52ca40b7914f026a5d388fa1e507a3bea56c2e73078ea29951077b2` |
| B34 | `e628e368da30cdecd18d1e43b0d2ebe3c77464f7f9cf4dcb8809a95ae9c99bc3` | `1457eada750a638e67f6e317d7b142092af57c33e9353d4357cea8c9b985c59a` | `1cc53ce6fab4511c4fcf654f135da94940bf188268ff4146d6cbafec2ba281da` | `9165aaeea862ef9d00af2ad077db42d11a3661c505ee285b73389a0d74489ec6` |
| B35 | `64a09bce03e95bb70d40f284904190a2a6181df5dbc604b2097acd5aff2f78b5` | `3ee465e46bc2843023d549d5c8fae121476f6daff5b727ff4c44450c7fce2e2c` | `3cf3a78d0530aa9349f21eb816932da305c2676ecb93c4363a656b80b12b4b41` | `aa77a4c7d929e5fb4548bcb1714ebcead345d7edf2b64412c6317404b6873ff9` |
| B36 | `fc1a6472a8741873794e48c0089d2c68c7c6f5b22ef08412cc9bebbf4a30aebc` | `cf926a6f6cd16cd58892325212d7620e9d5db289ba4f01d2f7841f25f916423e` | `45abb1c6fc4efd77988a93da783380f31c512b8f1a53e11a0a10ed07dbb41544` | `9d3bce72f7b498037d2c3c90c4c2ec8e7f862e2c158a3ed3d1610c4e754931dd` |
| B41 | `087e8c580cc36d40b4caadb07c4f40c5c29db7b79f922b544462c43f7e56beb4` | `1816bd4cdb0cfd77c3da8d05992ac3d4477bae83a1796189ab9ad2e6a6fa12f8` | `e68c2bdd7e4004eb06f6fda6cc8968b73ac185007d5c919b54e3f5b581eebec8` | `f9d5be260d28950088cdcb6fb42f9c9062f7e0300f0c12089fbeb8e74fee8c8a` |
| B42 | `06793f1f613218414792fc97930c6c7305268a566924f5ff252fbd02b6ef9e9d` | `0726fe8783ddcba2a65e235b74beb70e32634b8edba70c2cb045132ecac5894f` | `557f8f18f33727b9b8ccc5139e9b1530ac6b93108aa50ca680f1a8a0444ddfeb` | `0835821dda802be95571357217a82063c56aab5e51feb8d8d362d0ff29a7c2fa` |
| B43 | `3cdc10f669c81efa4961f7fdded764f8615949336248edc39ffbe9de91b8074a` | `e34a8c768ab4ea92160e19156e8020d82725247be8264bc2074a5601e4adce96` | `7aa876a9e9147dde64646ffd9d1879e0a7581b879333f5654edfe2540595c126` | `b61fbc950f187f7ec5bd2762921ad2e2412b1d95caa2f4b1ce3e860046d70054` |

Every script template hash and every reversal template hash above equals the value recorded in the committed `audit/development-execution-batches.json` (checked 2026-10-20).

Group totals: 82 versions; ledger 141 to 223 rows; final SHA-256 `e8f53b1e951463a8731ac8fdb7497b689c4677da437cad02ff7b29b1b493bbf4`. Predictions are computed from the real 141 rows (reconstruction asserted equal to `97797bb27b3fa497314b4deaa47ee4961501539f34dbbc0293218ee2826c5b9e` before use) plus each new row's marker md5.

## 4. Versions and manifest references
The versions of each batch are in `s2-reconciliation-manifest.csv` (filter column `batch`; filename, SHA-256 of the file, rule status, predecessors). Versions per batch:

- **B09** (12): `20251006222941`, `20251201023349`, `20251201204918`, `20251205125943`, `20251207182057`, `20251209124118`, `20251209125102`, `20251213223314`, `20251215015109`, `20251221231712`, `20251221234856`, `20251222022503`
- **B10** (12): `20251231170906`, `20260305005525`, `20260305010420`, `20260305011324`, `20260305012217`, `20260305160637`, `20260317181119`, `20260317183923`, `20260317201616`, `20260317202513`, `20260318191608`, `20260321194111`
- **B11** (12): `20260321210200`, `20260323175228`, `20260323200931`, `20260323200947`, `20260323201532`, `20260323204640`, `20260324135229`, `20260324150819`, `20260324162302`, `20260324175947`, `20260324191502`, `20260324191655`
- **B12** (6): `20260327211441`, `20260409155123`, `20260421025937`, `20260421160051`, `20260501173826`, `20260526165610`
- **B32** (12): `20251231190052`, `20260101163312`, `20260302131724`, `20260315173552`, `20260315175240`, `20260315190615`, `20260315194114`, `20260315202232`, `20260317144212`, `20260317162507`, `20260320001735`, `20260320150558`
- **B34** (12): `20260325061545`, `20260326052113`, `20260327125333`, `20260327131256`, `20260327162019`, `20260327163057`, `20260327170800`, `20260327171850`, `20260328182519`, `20260328183418`, `20260328183925`, `20260328184611`
- **B35** (1): `20260521153603`
- **B36** (11): `20251008180000`, `20251201025216`, `20251207182041`, `20251221224640`, `20251221231556`, `20260304230635`, `20260305004845`, `20260318182333`, `20260324052320`, `20260324161031`, `20260324191353`
- **B41** (2): `20260324051349`, `20260324190114`
- **B42** (1): `20260305002952`
- **B43** (1): `20260126193229`

## 5. Per-batch statements (derived records; each under 300 characters)
**B09** (text SHA-256 `386d1d9ffcbaf8d8110891710981e14c3e8ecb96642d91a1bc82f6ec43fca8c1`, 211 characters):

> AUTH-9 B09: apply S2 history-only batch B09 (12 versions, template SHA-256 feab47c8) to Development as one transaction. Start 141 rows, ledger SHA-256 97797bb2. Records only, no migration SQL runs. Nothing else.

**B10** (text SHA-256 `aa7c8bc560ea11d15213a80d24ef01b9f5e070d31a0651845c1be5af54f9d438`, 211 characters):

> AUTH-9 B10: apply S2 history-only batch B10 (12 versions, template SHA-256 93036616) to Development as one transaction. Start 153 rows, ledger SHA-256 44fcce80. Records only, no migration SQL runs. Nothing else.

**B11** (text SHA-256 `c40ae7d7453b5dbcfe51d35bf36f7fd6927e47b73b315fdf8e956d9ef80044ef`, 211 characters):

> AUTH-9 B11: apply S2 history-only batch B11 (12 versions, template SHA-256 7e68c411) to Development as one transaction. Start 165 rows, ledger SHA-256 0035320c. Records only, no migration SQL runs. Nothing else.

**B12** (text SHA-256 `c93a27e032b5f6670837755f7977ec08b5b232c9c8ad8225f38a2c30e0716a13`, 210 characters):

> AUTH-9 B12: apply S2 history-only batch B12 (6 versions, template SHA-256 6315e3e1) to Development as one transaction. Start 177 rows, ledger SHA-256 14d68c9a. Records only, no migration SQL runs. Nothing else.

**B32** (text SHA-256 `dfea0e19e051ebcfb4f6f0b2943c1f53e9ebbe12c9fc56be7de69fedd8d6a2c5`, 211 characters):

> AUTH-9 B32: apply S2 history-only batch B32 (12 versions, template SHA-256 e3324f69) to Development as one transaction. Start 183 rows, ledger SHA-256 aeb43055. Records only, no migration SQL runs. Nothing else.

**B34** (text SHA-256 `1cc53ce6fab4511c4fcf654f135da94940bf188268ff4146d6cbafec2ba281da`, 211 characters):

> AUTH-9 B34: apply S2 history-only batch B34 (12 versions, template SHA-256 e628e368) to Development as one transaction. Start 195 rows, ledger SHA-256 a3552e03. Records only, no migration SQL runs. Nothing else.

**B35** (text SHA-256 `3cf3a78d0530aa9349f21eb816932da305c2676ecb93c4363a656b80b12b4b41`, 210 characters):

> AUTH-9 B35: apply S2 history-only batch B35 (1 versions, template SHA-256 64a09bce) to Development as one transaction. Start 207 rows, ledger SHA-256 a60e40cf. Records only, no migration SQL runs. Nothing else.

**B36** (text SHA-256 `45abb1c6fc4efd77988a93da783380f31c512b8f1a53e11a0a10ed07dbb41544`, 211 characters):

> AUTH-9 B36: apply S2 history-only batch B36 (11 versions, template SHA-256 fc1a6472) to Development as one transaction. Start 208 rows, ledger SHA-256 7912775d. Records only, no migration SQL runs. Nothing else.

**B41** (text SHA-256 `e68c2bdd7e4004eb06f6fda6cc8968b73ac185007d5c919b54e3f5b581eebec8`, 210 characters):

> AUTH-9 B41: apply S2 history-only batch B41 (2 versions, template SHA-256 087e8c58) to Development as one transaction. Start 219 rows, ledger SHA-256 17b72ef7. Records only, no migration SQL runs. Nothing else.

**B42** (text SHA-256 `557f8f18f33727b9b8ccc5139e9b1530ac6b93108aa50ca680f1a8a0444ddfeb`, 210 characters):

> AUTH-9 B42: apply S2 history-only batch B42 (1 versions, template SHA-256 06793f1f) to Development as one transaction. Start 221 rows, ledger SHA-256 e1daa752. Records only, no migration SQL runs. Nothing else.

**B43** (text SHA-256 `7aa876a9e9147dde64646ffd9d1879e0a7581b879333f5654edfe2540595c126`, 210 characters):

> AUTH-9 B43: apply S2 history-only batch B43 (1 versions, template SHA-256 3cdc10f6) to Development as one transaction. Start 222 rows, ledger SHA-256 ea4a6f01. Records only, no migration SQL runs. Nothing else.

## 6. Why this grouping and order
- **B09, B10, B11, B12:** no predecessors; security-touching (their rules check policies, grants or row-level-security flags). They must be recorded **before** any later stage changes the objects they check, otherwise the rules would stop being true.
- **B32, B34, B35:** predecessors B05 to B08 are recorded; plain column/function rules.
- **B36:** needs B06, B09, B10, B11; security-touching. **B41, B42:** need B36. **B43:** needs B10 and B42; security-touching.
- **Not included:** B13 to B22 and B37 (44 attestations, unsigned), B25 to B30, B38 and B39 (13 disputed versions) and 26 versions that depend on objects of the October stages, B23 and B24 (S3), B31, B33 and B40 (behind attestation batches B18 and B21).

## 7. Preconditions checked before each batch (all must hold or the batch stops)
1. Project identity `srxunxiytojjsuhcmzjg` (never `qaagfafagdpgzcijnfbw`), role `postgres`; HEAD and the script, filled and approval hashes equal section 3.
2. Ledger count and full SHA-256 equal the batch's start values; none of the batch's versions is recorded; no duplicate version.
3. Every version's catalog rule is true. The 82 rules were **not** pre-evaluated together before this request; each script re-evaluates its own rules inside its transaction and raises (writing nothing) if any is false. A false rule is a stop condition, not a retry.
4. Encrypted restore point `dev-20261020T1206Z` hashes intact; its passphrase confirmation in Bitwarden remains an open owner action (nothing is deleted).

## 8. Expected database effects
Only rows in `supabase_migrations.schema_migrations` change: +82 rows, each `statements[1]` starting `-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED;`. No DDL, grant, policy, function, data or Storage change; no function is invoked; no message is sent.

## 9. Verification after every batch
1. Ending count and full ledger SHA-256 equal section 3; the batch's rows all carry the `history-only NOT EXECUTED` marker and its batch id; older rows unchanged.
2. The eleven-category schema fingerprint, run with the canonical search path (`SET LOCAL search_path = "$user", public, extensions;`, runbook "Canonical fingerprint methodology"), equals the AUTH-1 baseline in every category.
3. Business baseline unchanged: orders 171, payments 185, units 16, pricing rules 1, balance due 1,344,396, deposits 856,550, tips 74,928, payments sum 2,496,274, auth users 9, customers 123, `sms_conversations` 1,039, Storage 500 objects / 941,404,649 bytes, `anon`/`authenticated` without USAGE on `public`, 222 public policies.
4. Operator-log entry appended (hash chain). At the end of the group: `list_edge_functions` (relays `send-email` v8 and `send-sms-notification` v7 unchanged), log-chain validation, the targeted tests.

## 10. Failure and recovery boundaries
A failed script rolls back and records nothing. A passing batch is never reversed automatically; `REVERSAL Bnn` (hashes above) deletes exactly that batch's rows and needs separate written authorization. A ledger DELETE never undoes SQL, and none ran. If a connection drops with the commit uncertain, nothing is resent: the ledger is read and compared with the start and end values. Rollback fallback for the whole group: the restore point above.

## 11. After this group
Ledger 223 rows; 82 more versions are recorded as handled without execution. Remaining unrecorded S2 versions: the 44 attestations (own package), the 13 disputed and 26 stage-dependent versions (later stages), B23 and B24 (S3), and the 36 versions of B31, B33 and B40 that follow the attestations.
