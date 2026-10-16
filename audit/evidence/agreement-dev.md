# Agreement test: dev (pg_dump vs SQL catalog snapshot)

Names and counts only. Result per object class:

| Class | Result | Detail |
|---|---|---|
| tables (all captured schemas) | AGREE | dump 106 / catalog 106; only-dump=[] only-catalog=[] |
| columns per table | AGREE | 106 tables compared; differing: {} |
| constraint names | AGREE | dump 384 named (inline+ALTER) / catalog 385 (catalog also lists NOT NULL/unnamed forms) |
| public constraints present in dump | AGREE | missing in dump: [] |
| public functions (names) | AGREE | dump 81 / catalog 81; only-dump=[] only-catalog=[] |
| function bodies (md5 of body text) | AGREE | 81 compared; differing: [] |
| policies (table, name, command) | AGREE | dump 228 / catalog 228; only-dump=[] only-catalog=[] |
| triggers | AGREE | dump 38 / catalog 38; diff=[] |
| indexes (excluding constraint-backing indexes and dynamic realtime partitions) | AGREE | dump 228 / catalog 228; diff=[] |
| publications and members | NOT IN DUMP | pg_dump emitted no CREATE PUBLICATION; the SQL catalog is the only capture. Catalog: {k: sorted(v)[:8] for k, v in cpub.items() if not k.endswith('messages_publication')} |
| table/sequence grants to non-owner roles (public) | AGREE | 68 relations in catalog / 68 in dump; differing: [] |
| default ACL statements | AGREE | dump 25 ALTER DEFAULT PRIVILEGES statements / catalog 18 entries (informational) |

**Differences: 0**
