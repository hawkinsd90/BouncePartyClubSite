"""Stage B: export-safety verification and fingerprints.

 * scans every protected export (dumps + catalog JSON) and every repo-side evidence output for credential patterns, email addresses,
   COPY/INSERT data statements outside function bodies;
 * computes migration-history and catalog fingerprints per environment;
 * writes audit/evidence/stage-b-manifest.json (hashes and counts only).
Prints counts, never matched values.
"""
import glob
import hashlib
import json
import os
import re

PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
REPO_EVID = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite\audit\evidence"
PATTERNS = {
    "jwt_like": r"eyJ[A-Za-z0-9_-]{20,}", "stripe_secret": r"(sk|rk)_(live|test)_[A-Za-z0-9]{8,}", "stripe_webhook": r"whsec_[A-Za-z0-9]{8,}",
    "resend_key": r"\bre_[A-Za-z0-9]{20,}", "twilio_sid": r"\b(AC|SK)[0-9a-f]{32}\b", "pem_block": r"-----BEGIN", "bcrypt_hash": r"\$2[aby]\$[0-9]{2}\$",
    "bearer_token": r"Bearer [A-Za-z0-9._-]{20,}", "google_api_key": r"AIza[0-9A-Za-z_-]{30,}", "inline_password": r"(?i)password\s*[:=]\s*'[^']{4,}'",
    "supabase_service_key_marker": r"service_role['\"]?\s*[:=]\s*['\"]eyJ",
}
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for c in iter(lambda: fh.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def outside_body_inserts(text):
    inside, count = None, 0
    for line in text.split("\n"):
        if inside is None:
            m = re.search(r"(\$[A-Za-z_]*\$)", line)
            if m and line.count(m.group(1)) % 2 == 1:
                inside = m.group(1)
            if re.match(r"^\s*INSERT INTO", line):
                count += 1
        elif inside in line:
            inside = None
    return count


def scan_file(path):
    text = open(path, encoding="utf-8", errors="replace", newline="").read()
    res = {"bytes": len(text), "pattern_hits": {k: len(re.findall(v, text)) for k, v in PATTERNS.items()}, "emails": len(EMAIL.findall(text)),
           "COPY_statements": len(re.findall(r"^COPY ", text, re.M)), "INSERT_outside_function_bodies": outside_body_inserts(text) if path.endswith(".sql") else None}
    res["pattern_hits"] = {k: v for k, v in res["pattern_hits"].items() if v}
    return res


def main():
    out = {"protected_exports": {}, "repo_evidence_outputs": {}, "fingerprints": {}}
    for p in sorted(glob.glob(os.path.join(PROT, "*"))):
        if p.endswith(".json") or p.endswith(".sql"):
            r = scan_file(p)
            r["sha256"] = sha(p)
            out["protected_exports"][os.path.basename(p)] = r
    for p in sorted(glob.glob(os.path.join(REPO_EVID, "*")) + glob.glob(os.path.join(REPO_EVID, "tools", "*"))):
        if os.path.isfile(p) and p.endswith((".csv", ".md", ".json", ".py")):
            r = scan_file(p)
            r["sha256"] = sha(p)
            out["repo_evidence_outputs"][os.path.relpath(p, REPO_EVID)] = r
    for env in ("prod", "dev"):
        h = json.load(open(os.path.join(PROT, f"{env}_catalog_history.json"), encoding="utf-8"))
        lines = "\n".join(f"{x['version']}|{x['name']}|{x['norm_c_md5']}" for x in sorted(h, key=lambda x: x["version"]))
        cat = "".join(sha(os.path.join(PROT, f"{env}_catalog_{n}.json")) for n in sorted(
            ["tables", "columns", "constraints", "indexes", "triggers", "functions", "policies", "grants_relations", "grants_columns", "grants_functions",
             "grants_schemas", "default_acls", "publications", "extensions", "roles", "event_triggers", "views", "types", "storage_buckets"]))
        man = json.load(open(os.path.join(PROT, f"{env}_manifest.json"), encoding="utf-8"))
        out["fingerprints"][env] = {"history_rows": len(h), "history_fingerprint_sha256": hashlib.sha256(lines.encode()).hexdigest(),
                                    "catalog_fingerprint_sha256": hashlib.sha256(cat.encode()).hexdigest(),
                                    "captured_at_utc": man["server"]["captured_at_utc"], "server_version": man["server"]["server_version"],
                                    "schema_dump_sha256": man["files"][f"{env}_schema_only.sql"]["sha256"]}
    json.dump(out, open(os.path.join(REPO_EVID, "stage-b-manifest.json"), "w", encoding="utf-8"), indent=1)
    hits = {k: {n: v for n, v in r.items() if n in ("pattern_hits", "emails", "COPY_statements", "INSERT_outside_function_bodies") and v} for k, r in {**out["protected_exports"], **{"repo/" + a: b for a, b in out["repo_evidence_outputs"].items()}}.items()}
    hits = {k: v for k, v in hits.items() if v}
    print("files scanned:", len(out["protected_exports"]), "protected +", len(out["repo_evidence_outputs"]), "repo outputs")
    print("files with ANY hit (credential pattern / email / COPY / INSERT outside body):", json.dumps(hits, indent=0) if hits else "NONE")
    print(json.dumps(out["fingerprints"], indent=0))


if __name__ == "__main__":
    main()
