"""Offline structural verification of audit/step4/sg4-package (no database). Usage: python -I verify_sg4_package.py"""
import hashlib, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "step4", "sg4-package"))
pkg = json.load(open(os.path.join(OUT, "package.json"), encoding="utf-8"))
sha = lambda b: hashlib.sha256(b).hexdigest()
fails = []
def ok(label, c):
    if not c:
        fails.append(label); print("FAIL:", label)
ok("batches partition the 41 versions", set(pkg["order_S8A"]) | set(pkg["order_S8B"]) == set(pkg["per_version"]) and not set(pkg["order_S8A"]) & set(pkg["order_S8B"]) and len(pkg["per_version"]) == 39)
ok("no S8A version depends on an S8B version", not any(q in pkg["order_S8B"] for v in pkg["order_S8A"] for q in pkg["per_version"][v]["predecessors"]))
for b, order, n0 in (("S8A", pkg["order_S8A"], pkg["start"]["count"]), ("S8B", pkg["order_S8B"], pkg["after_S8A"]["count"])):
    s = open(os.path.join(OUT, b + ".sql"), "rb").read(); rev = open(os.path.join(OUT, b + "_reversal.sql"), "rb").read()
    ok(b + " script hashes equal package.json", pkg["scripts"][b + ".sql"] == sha(s) and pkg["scripts"][b + "_reversal.sql"] == sha(rev))
    t = s.decode()
    ins = re.findall(r"INSERT INTO supabase_migrations\.schema_migrations \(version, name, statements\) VALUES \('(\d{14})'", t)
    ok(b + ": inserts once each in plan order", ins == order and len(set(ins)) == len(order))
    ok(b + ": every insert is a history-only NOT EXECUTED marker of its batch", len(re.findall(r"ARRAY\['-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; batch=" + b + r"; version=\d{14}; rule_sha256=[0-9a-f]{64}; basis=", t)) == len(order))
    ok(b + ": nothing but the ledger INSERT mutates", not re.search(r"\b(UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b", re.sub(r"'[^']*'", "''", t.split("BEGIN", 1)[1]).replace("EXCEPTION", "")))
    start_sha = pkg["start"]["sha256"] if b == "S8A" else pkg["after_S8A"]["sha256"]
    ok(b + ": guards role, count, ledger sha, schema state, final count", all(x in t for x in ["current_user <> 'postgres'", f"<> {n0} THEN", start_sha, f"<> {n0} + {len(order)} THEN"]))
    ok(b + ": containment guard direction", ("schema containment is not in force" in t) == (b == "S8A") and ("S11 end state is not in force" in t) == (b == "S8B"))
    ok(b + ": single DO block, advisory lock first", t.count("DO $bpc$") == 1 and t.index("pg_advisory_xact_lock") < t.index("DO $bpc$"))
    ok(b + ": predecessor guard present exactly where predecessors exist", all(("predecessor not recorded for " + v in t) == bool(pkg["per_version"][v]["predecessors"]) for v in order))
    ok(b + ": reversal deletes only its own rows", ("batch=" + b + ";").encode() in rev and rev.count(b"DELETE FROM") == 1)
ok("attestation versions excluded", not set(pkg["excluded_attestations_need_owner_decision"]) & set(pkg["per_version"]))
print("OK" if not fails else "FAILED", len(fails))
sys.exit(1 if fails else 0)
