# Agreement test: prod (pg_dump vs SQL catalog snapshot)

Names and counts only. Result per object class:
a
| Class | Result | Detail |
|---|---|---|
| tables (all captured schemas) | AGREE | dump 94 / catalog 94; only-dump=[] only-catalog=[] |
| columns per table | AGREE | 94 tables compared; differing: {} |
| constraint names | AGREE | dump 329 named (inline+ALTER) / catalog 330 (catalog also lists NOT NULL/unnamed forms) |
| public constraints present in dump | AGREE | missing in dump: [] |
| public functions (names) | AGREE | dump 67 / catalog 67; only-dump=[] only-catalog=[] |
| function bodies (md5 of body text) | AGREE | 67 compared; differing: [] |
| policies (table, name, command) | AGREE | dump 199 / catalog 199; only-dump=[] only-catalog=[] |
| triggers | AGREE | dump 33 / catalog 33; diff=[] |
| indexes (excluding constraint-backing indexes and dynamic realtime partitions) | AGREE | dump 210 / catalog 210; diff=[] |
| publications and members | NOT IN DUMP | pg_dump emitted no CREATE PUBLICATION; the SQL catalog is the only capture. Catalog: {k: sorted(v)[:8] for k, v in cpub.items() if not k.endswith('messages_publication')} |
| table/sequence grants to non-owner roles (public) | AGREE | 57 relations in catalog / 57 in dump; differing: [] |
| default ACL statements | AGREE | dump 49 ALTER DEFAULT PRIVILEGES statements / catalog 24 entries (informational) |

**Differences: 0**
