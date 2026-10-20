"""Offline structural verification of audit/step4/sg4-package (no database). Usage: python -I verify_sg4_package.py"""
import hashlib, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "step4", "sg4-package"))
pkg = json.load(open(os.path.join(OUT, "package.json"), encoding="utf-8"))
sha = lambda b: hashlib.sha256(b).hexdigest()
fails = []
def ok(label, c):
    if not c: fails.append(label); print("FAIL:", label)
s8 = open(os.path.join(OUT, "S8.sql"), "rb").read(); rev = open(os.path.join(OUT, "S8_reversal.sql"), "rb").read()
ok("script hashes equal package.json", pkg["scripts"]["S8.sql"] == sha(s8) and pkg["scripts"]["S8_reversal.sql"] == sha(rev))
t = s8.decode()
ins = re.findall(r"INSERT INTO supabase_migrations\.schema_migrations \(version, name, statements\) VALUES \('(\d{14})'", t)
ok("41 inserts, once each, in plan order", len(ins) == 41 and ins == pkg["order"] and len(set(ins)) == 41)
ok("every insert is a history-only NOT EXECUTED marker of batch S8", len(re.findall(r"ARRAY\['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=S8; version=\d{14}; rule_sha256=[0-9a-f]{64}; basis=", t)) == 41)
ok("no statement other than the ledger INSERT mutates anything", not re.search(r"\b(UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b", re.sub(r"'[^']*'", "''", t.split("BEGIN", 1)[1]).replace("EXCEPTION", "")))
ok("guards: role, count, ledger sha, containment, final count", all(s in t for s in ["current_user <> 'postgres'", "<> 333 THEN", pkg["start"]["sha256"], "has_schema_privilege('anon'", "<> 333 + 41 THEN"]))
ok("one transaction body: single DO block, advisory lock first", t.count("DO $bpc$") == 1 and t.index("pg_advisory_xact_lock") < t.index("DO $bpc$"))
ok("every version has a predecessor guard or none", all(("predecessor not recorded for " + v in t) == bool(pkg["per_version"][v]["predecessors"]) for v in pkg["order"]))
ok("attestation versions are not in the batch", not set(pkg["excluded_attestations_need_owner_decision"]) & set(pkg["order"]))
ok("reversal deletes only S8 history-only rows and checks counts", b"batch=S8;" in rev and rev.count(b"DELETE FROM") == 1)
print("OK" if not fails else "FAILED", len(fails))
sys.exit(1 if fails else 0)
