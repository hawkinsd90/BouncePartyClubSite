/*
# Stage B — Narrowed cleanup: remove broad prefix deletions from earlier cleanup

The earlier cleanup migration (20260718003000) used slug LIKE 'stage-b-%' and
name LIKE 'STAGE-B-%' patterns. Those are broad conditions that could
theoretically match future legitimate records. The historical test harness
migrations only CREATE functions — they do not insert data during replay.
Test records are only created when those functions are manually invoked.

This migration is a no-op in the current database (no test records exist).
It exists to document that the exact-UUID deletions in the prior migration
are the only cleanup needed. No additional data deletion is performed here.

Safety properties for fresh replay:
  - 20260718120200..20260718120600 create test functions (no data)
  - 20260718003000 drops those functions + deletes exact known UUIDs
  - This migration (no-op) confirms no broad prefix deletion is needed
*/
SELECT 1;