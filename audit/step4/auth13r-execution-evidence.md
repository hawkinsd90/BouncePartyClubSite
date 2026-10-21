# AUTH-13R execution evidence (2026-10-20/21, Development srxunxiytojjsuhcmzjg only)

| Stage | Result |
|---|---|
| First S8A attempt (old hashes) | guard refused (baseline sha used CRLF separator); rolled back, nothing written; package regenerated (see sg4-sg6-authorization-package.md section 10) |
| SG-4A S8A (sha 61266b2b...) | ledger 333 (04b1f1bb...) -> 366 (eb782d6a...), 33 markers, business data unchanged |
| S9 push | performed by the owner in their own terminal (the permission layer blocked the agent push); remote Dev = local HEAD c6443ac1f187b9f305db83ba61c0b166c0e7892a, fast-forward; Netlify deploy 6ad802f10897b55d48e7016c ready, commit c6443ac, branch Dev, dev.bouncepartyclub.com only; Supabase branch record unchanged (updated 2026-10-20T01:27:01Z), ledger still 366 (no migration automation ran) |
| S10 | 20 gate rows (G01-G16), all true before S11 |
| S11 (sha 3cddacfe...) | applied; s11-post-probe.sh: ALL EXPECTATIONS MET (re-run after D20 too) |
| SG-4B S8B (sha 52fcaa33...) | ledger 366 -> 372 (1dd1460ed16934cedba0bfa64e4db15f91268bdd9e87de1c59d0b5b0756b56ed), 6 markers |
| S12b D20 (sha e2e727d3...) | exactly 57 contacts changed (captured before in BPC-Operator-Log/d20-before-capture.json); orders 171, payments 185, items 184, invoices 82 and their md5 digests identical before/after |

Post state: ledger 372; G01 and G14 now report false by design (they assert the pre-S11 containment and the pre-S11 schema ACL); all other gates true. Note: gate file has 20 rows, not 21 as earlier documents said.
