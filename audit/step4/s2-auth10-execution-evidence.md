# AUTH-10 execution evidence (S2 final group), 2026-10-20

Authorization: the owner sent the exact AUTH-10 statement (SHA-256 `386ffca2d22e210c0b548f75babeb3068ea27eb0594e7e771f468bb66101f872`) with a continuous-execution directive. Executed on Development `srxunxiytojjsuhcmzjg` only, through the Supabase connector `execute_sql`, one call (one transaction) per batch, in the authorized order. Nothing else was written. Production was not contacted. No historical migration SQL was executed: every inserted row is a `NOT EXECUTED` marker.

## Start and end

| | Rows | SHA-256 |
|---|---|---|
| Start (re-read immediately before B13) | 223 | `e8f53b1e951463a8731ac8fdb7497b689c4677da437cad02ff7b29b1b493bbf4` |
| End (after B40) | 303 | `b4f1f35ef890f200286199c84d0b3b76659453ba11ed20cac980b4bf3f828176` (equals the prediction) |

## Per batch (script text sent = file text in `s2-consolidated-package/`; result = ledger re-read after each batch)

| Batch | Versions | Ledger after | SHA-256 after (equals the prediction) |
|---|---|---|---|
| B13 | 7 | 230 | `09a0383245d24ca32b49d09409cf60f4190a03baaf9e971ae517b397db3baaf3` |
| B14 | 5 | 235 | `21c11ec340f05b60f19d8dd4a25a2941ff13d7eb9b5da78e6a9efe73064c863d` |
| B15 | 6 | 241 | `602f9b4ae35a393514f1daf44bae7bad406cd1e3d4b128e6ddd775e932d5e6c6` |
| B16 | 6 | 247 | `d9c631faee5eca12189cfd83560cb578f5e374e7722ff354f9d49d70d873c7eb` |
| B17 | 5 | 252 | `6995cc2f31567d55de91f26f256654b2a5c70128f8fb17fea91fb4f98e4d7981` |
| B18 | 2 | 254 | `0290b7a67197e08a494b108c2586d9536edd7396bba2a7ea3a311c3c2a5c4f50` |
| B19 | 8 | 262 | `e28554fc516b780f10683f74827a2736e930ffd236f3f2c695d5ff00fbd8933f` |
| B20 | 2 | 264 | `4ea447a112d18783176e8be901a13433b7669c7f888b9db6380686a28fa5e7ee` |
| B21 | 1 | 265 | `53f2c682c5495889175eb06d71cbd8d44afe02765fb660793d80c6ce9eaf2f5a` |
| B22 | 1 | 266 | `36c02d834fd61673d6ca8118f1bcfe4fb496d78066017b2d9887301b1042b4d1` |
| B31 | 12 | 278 | `2f8419dd1981d6cea15c83ca574109651a7c8b4a42ea9fb604988def5e466b3d` |
| B33 | 12 | 290 | `e18d68f24d17193173da79e554984ef4f8f2624348f50d4b4c7f8afa1e8d315a` |
| B37 | 1 | 291 | `3e4a2686034bdd9911794841ad0b4e472b26c1be3915a7c022f5d53621640b5f` |
| B40 | 12 | 303 | `b4f1f35ef890f200286199c84d0b3b76659453ba11ed20cac980b4bf3f828176` |

No batch failed, none was retried, none was reversed. Every in-script assertion (pre-count, not-already-recorded, predecessors, verification rules, post-count) passed. Because the ledger SHA covers the md5 of every marker's full text, equality with the prediction also proves that every one of the 80 markers (attestor, time, scope, not-proven text, evidence hash, rule hash) is byte-identical to the reviewed package.

## Integrity after B40 (read-only)

- Ledger: 303 rows; 44 `attestation NOT EXECUTED`, 201 `history-only NOT EXECUTED` (165 earlier + 36 now), 0 `executed` markers from this operation.
- Catalog fingerprint (canonical `SET LOCAL search_path = "$user", public, extensions`): all 11 category digests equal the baseline (fn `3a11af85…` 82, trg `f729c8fe…` 37, col `a63239ea…` 804, con `3ab6496d…` 235, idx `b3988572…` 237, pol `8ee2e2c1…` 228, rel `e3bdf399…` 69, bkt `7d8cac3a…` 9, nsp `c20defe7…` 2, pub `350879c0…` 8, ext `5f40a353…` 4).
- Business data unchanged: orders 171, payments 185, units 16, pricing_rules 1, balance due 1,344,396, deposits paid 856,550, tips 74,928, payments sum 2,496,274, auth users 9, customers 123, contacts 95, sms_conversations 1,039.
- Storage: 500 objects / 941,404,649 bytes (unchanged).
- Containment: `anon` and `authenticated` still have no USAGE on `public`; 222 public policies; both compromised accounts still banned until 2026-11-13 15:16:05 and 15:16:16 UTC.
- Operator log `C:\Users\vikki\BPC-Operator-Log\s2-operator-log.jsonl`: 14 new hash-chained entries (34 total), chain valid.
- The fingerprint, business and Storage checks were taken once after the last batch, not after each batch (the per-batch ledger check was immediate).
