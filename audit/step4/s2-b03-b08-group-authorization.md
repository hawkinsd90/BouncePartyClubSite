# S2 group authorization record: batches B03 to B08 (2026-10-20)

Status: **owner group authorization recorded; execution evidence is in `s2-authorization-package.md` section 11.** This file derives six clearly scoped per-batch approval records from the owner's single group message. **The owner sent one message, not six; no owner signature is claimed for the per-batch records.**

## 1. The owner's operative authorization (quoted exactly from the message received 2026-10-20)
> The owner explicitly authorizes the continuous, sequential execution of **S2 history-only batches B03 through B08** against Bounce Party Club Development.

SHA-256 of that sentence (UTF-8): `a541b0bb5a85e41594424bf981303a42646830297ae0a2ec95297c8d471e4a9e`. The full message (scope table, expected hashes, stop conditions, exclusions) is in the conversation transcript; it limits the authorization to B03 to B08, forbids any other batch, the 44 attestations, any historical SQL and any provider, Git, Netlify or Production action, and requires a stop at the first failed check with no automatic retry or reversal.

## 2. How the prepared scripts bind this authorization
The batch scripts carry the per-batch approval text hash only in their first comment line (`approval <sha256>`); no statement asserts it, so binding the group authorization does not change any migration logic, assertion or ledger marker. The six per-batch statements below are the exact texts prepared in `s2-wave1-approval-package.md` before this authorization; the owner's group message authorizes executing exactly those prepared scripts (template hashes verified in full against the package and against `development-execution-batches.json`).

| Batch | Per-batch statement (prepared text) | Statement SHA-256 | Script template SHA-256 | Filled script SHA-256 |
|---|---|---|---|---|
| B03 | AUTH-7 B03: apply S2 history-only batch B03 (12 versions, template SHA-256 b89c9617) to Development as one transaction. Start 71 rows, ledger SHA-256 aaa09489. Records only, no migration SQL runs. Nothing else. | `0f29951f9b873918d0a12f17560cc26e8a5369cfa292a9723535f5b14bf53891` | `b89c96171c5ff647ac5523d0cec6b386d4967c4efa3e62184f2a84e5ee587e06` | `7d76d1d4c49ffabd88294f258ad34a908d176ca02a61fb5e5fb29235771cd733` |
| B04 | AUTH-7 B04: apply S2 history-only batch B04 (12 versions, template SHA-256 4e4aaf6f) to Development as one transaction. Start 83 rows, ledger SHA-256 7990552f. Records only, no migration SQL runs. Nothing else. | `41e1bb7c96133e621314a4b20c8cee16851bdb5aa2897c9e6a6b19b1aadcbfdd` | `4e4aaf6feb4f6a75e85745274df1b7abd8a9babee9583618106f61b18f53a1d2` | `cf16e049df1eb8519ad41b3cc085e7636bcef39f5fcb053de9a4aa75f2f9be6f` |
| B05 | AUTH-7 B05: apply S2 history-only batch B05 (12 versions, template SHA-256 2d4f4cca) to Development as one transaction. Start 95 rows, ledger SHA-256 1695bf3e. Records only, no migration SQL runs. Nothing else. | `fe1d54545b940c327ec70c2fc0f649b7d046dec85c6d8053cc4799e92027b888` | `2d4f4cca05225cba6ecc3579d955519175d4df2889636aa09844ce74f4495364` | `93dda6dcefcb160ee9614f18c63abd5312ce16d9dd0840b357b058ceb7189614` |
| B06 | AUTH-7 B06: apply S2 history-only batch B06 (12 versions, template SHA-256 4a838bdf) to Development as one transaction. Start 107 rows, ledger SHA-256 f9820661. Records only, no migration SQL runs. Nothing else. | `d6d3c8ea9b13911373c0b1f254ad36bff1f11abc5ca8ffa7081889df194309f1` | `4a838bdf7747e649c8c50b9334aba4c242c090dbd48b01ce8e548f95ffdf8d84` | `ef5441bac12dabe9f55c0d376f6922ee2a008257567cdc15674f109aa3f0769b` |
| B07 | AUTH-7 B07: apply S2 history-only batch B07 (12 versions, template SHA-256 71d4b40a) to Development as one transaction. Start 119 rows, ledger SHA-256 d56a5aa7. Records only, no migration SQL runs. Nothing else. | `922acfee727fe26cacc7a3995c626d5aa9055110307ec22d40bf214f01246baf` | `71d4b40ab3a97c5667fe7f7c8f68fdcfdadb7b9111043ffc8b12b4173fc84bec` | `bd4fa6fff8fdbb6e569e9861a03f45eae4ed73fd37b9ce1031b035894d9ce902` |
| B08 | AUTH-7 B08: apply S2 history-only batch B08 (10 versions, template SHA-256 cf12b904) to Development as one transaction. Start 131 rows, ledger SHA-256 055a4036. Records only, no migration SQL runs. Nothing else. | `0c648b7c1d97032a8b7af6f8cc77b18b22872638c458a8417a17e68beb89da19` | `cf12b904bd65483d3eb9d37463d4ff1fe8b1c85d8f8f68fe8ccc1741689feb62` | `6a6519ae708e99d59ac0f66c752c0bafec7f8a760d89282778c97c84ea3b1271` |

## 3. Expected ledger path (verified equal to the owner's table)
| Batch | Versions | Start rows | End rows | Expected end SHA-256 |
|---|---:|---:|---:|---|
| B03 | 12 | 71 | 83 | `7990552f9bff2ef5141a4d7eb3747984ca6b27892186df50d1364723f81e1fdd` |
| B04 | 12 | 83 | 95 | `1695bf3e8fe6c1b37a9683a229480d4485cd2883c282838d32b1fee4b476abdb` |
| B05 | 12 | 95 | 107 | `f98206614cedc69b97cc80e6efd75ea57032adaa240ea9b627f19d787d837f93` |
| B06 | 12 | 107 | 119 | `d56a5aa725c8fe197d1c320d9f43aed9d994c94f30bdb1e63157037ad773d00a` |
| B07 | 12 | 119 | 131 | `055a4036b1822dbe53e7add35430b893d8a8d971ee9f2655107151c0d7e5a033` |
| B08 | 10 | 131 | 141 | `97797bb27b3fa497314b4deaa47ee4961501539f34dbbc0293218ee2826c5b9e` |
