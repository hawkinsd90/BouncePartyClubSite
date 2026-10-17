"""Stage D2 (R-2a), part 1: select and replay Production's PRE-UPGRADE migration set into a disposable local scratch database.

Selected set = the baseline files that precede Production's recorded history (version < Production's first recorded version)
              + every repository file whose exact 14-digit version is recorded in Production's captured history (277 rows).
Excluded:     the Development-line files not recorded in Production, cases 41/42 (their versions are not recorded in Production),
              the 23 October migrations, and withdrawn Case 43 (not in the repository).
Order:        ascending version. S1/S2 are applied exactly as the replay tool applies them. A stub-limited file is skipped, never hidden.
The scratch database is created and bootstrapped by the guarded scripts/dev/migration-replay.cjs (--upto before any version); this driver
then replays the selected files itself. Local PostgreSQL only; Production data is never touched; no Production data is imported.
Usage: python -I d2_rebuild.py manifest|rebuild   (writes into the protected d2-scratch folder; manifest also into audit/evidence)
"""
import hashlib
import json
import os
import re
import subprocess
import sys

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
MIG = os.path.join(REPO, "supabase", "migrations")
PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUT = r"C:\Users\vikki\migration-evidence\d2-scratch"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
DB = "bpc_replay_d2_preupgrade"
STUB_LIMITED = {"20260323201502": "needs the pg_net extension, which plain PostgreSQL cannot install"}
S1 = ("after", "20251207163822", "user_roles_role_check legacy uppercase CHECK",
      "select count(*) from pg_constraint where conrelid = to_regclass('public.user_roles') and conname = 'user_roles_role_check' and contype = 'c' and pg_get_constraintdef(oid) like '%MASTER%'",
      "alter table public.user_roles drop constraint user_roles_role_check")
S2 = ("before", "20260615175816", "orders already in supabase_realtime",
      "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'",
      "alter publication supabase_realtime drop table public.orders")


def psql(db, args, text=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update(PGCLIENTENCODING="UTF8")
    return subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-d", db, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, input=text)


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def build_manifest():
    files = sorted(f for f in os.listdir(MIG) if re.match(r"^\d{14}_.+\.sql", f))
    local = {}
    for f in files:
        local.setdefault(f[:14], []).append(f)
    dups = {v: fs for v, fs in local.items() if len(fs) > 1}
    assert not dups, f"duplicate local versions: {dups}"
    prod = [x["version"] for x in json.load(open(os.path.join(PROT, "prod_catalog_history.json"), encoding="utf-8"))]
    assert len(prod) == 277 and len(set(prod)) == 277, "Production history must be 277 unique versions"
    first = min(prod)
    missing = [v for v in prod if v not in local]
    assert not missing, f"recorded Production versions without a repository file: {missing}"
    baseline = sorted(v for v in local if v < first)
    selected = sorted(set(baseline) | set(prod))
    excluded = sorted(set(local) - set(selected))
    october = [v for v in local if v >= "20261007000000"]
    assert all(v in excluded for v in october) and len(october) == 23
    assert len(baseline) == 40 and len(selected) == 317 and len(selected) == len(set(selected))
    assert max(selected) == max(prod) and max(selected) < "20261007000000"
    rows = [{"order": i + 1, "version": v, "file": local[v][0], "origin": "baseline (precedes Production history)" if v in baseline else "recorded in Production history", "sha256": sha(os.path.join(MIG, local[v][0]))} for i, v in enumerate(selected)]
    cat = "\n".join(f"{r['version']} {r['file']} {r['sha256']}" for r in rows)
    man = {"derivation": "baseline = repository versions < Production's first recorded version (%s); recorded = the 277 captured Production versions; union, ascending by version" % first,
           "counts": {"repository_files": len(local), "baseline": len(baseline), "production_recorded": len(prod), "selected": len(rows), "excluded": len(excluded), "excluded_october": len(october),
                      "excluded_other_dev_line_including_cases_41_42": len(excluded) - len(october)},
           "selected_manifest_sha256": hashlib.sha256(cat.encode()).hexdigest(),
           "selected_versions_sha256": hashlib.sha256("\n".join(selected).encode()).hexdigest(),
           "stub_limited_selected_files": [v for v in selected if v in STUB_LIMITED],
           "excluded_versions": excluded, "selected": rows,
           "aliasing": "none applied: Production's recorded versions are matched by exact version; cases 41 and 42 (20260305203528, 20260407203226) are excluded because their versions are not recorded in Production, while the related recorded versions 20260305205811 and 20260408200431 are included."}
    return man


def main():
    cmd = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    man = build_manifest()
    json.dump(man, open(os.path.join(OUT, "d2-selected-manifest.json"), "w", encoding="utf-8"), indent=1)
    print({k: v for k, v in man["counts"].items()}, "| selected manifest sha256", man["selected_manifest_sha256"])
    if cmd == "manifest":
        return
    # guarded scratch DB creation + stub bootstrap through the existing tool (no migration replayed: --upto before every version)
    env = dict(os.environ, BPC_REPLAY_CONFIRM_LOCAL="yes", PGPSQL=PSQL)
    r = subprocess.run(["node", os.path.join(REPO, "scripts", "dev", "migration-replay.cjs"), "--db", DB, "--mode", "diagnostic", "--upto", "20000101000000"], capture_output=True, text=True, cwd=REPO, env=env)
    assert r.returncode in (0, 1) and "INFRASTRUCTURE" not in r.stdout + r.stderr and "REFUSED" not in r.stderr, r.stdout + r.stderr
    log, failures, executed, skipped = [], [], 0, []

    def adjust(spec, when):
        _, ver, label, probe, apply_sql = spec
        b = psql(DB, ["-At", "-c", probe]).stdout.strip()
        if b == "0":
            log.append(f"{spec[0]} {ver}: no-op ({label} not present)")
            return
        x = psql(DB, ["-v", "ON_ERROR_STOP=1", "-c", apply_sql])
        a = psql(DB, ["-At", "-c", probe]).stdout.strip()
        log.append(f"{spec[0]} {ver}: applied ({label}); present before={b}, after={a}; exit {x.returncode}")
        if x.returncode != 0 or a != "0":
            failures.append({"version": ver, "error": "adjustment failed"})

    for row in man["selected"]:
        v = row["version"]
        if v in STUB_LIMITED:
            skipped.append({"version": v, "reason": STUB_LIMITED[v]})
            continue
        if S2[1] == v and S2[0] == "before":
            adjust(S2, "before")
        p = psql(DB, ["-v", "ON_ERROR_STOP=1", "-1", "-f", os.path.join(MIG, row["file"])])
        executed += 1
        if p.returncode != 0:
            m = re.search(r"ERROR:\s+(.*)", p.stderr)
            failures.append({"version": v, "file": row["file"], "error": (m.group(1) if m else p.stderr)[:300], "line": (re.search(r":(\d+): ERROR", p.stderr) or [None, None])[1]})
            break
        if S1[1] == v and S1[0] == "after":
            adjust(S1, "after")
    res = {"database": DB, "selected": len(man["selected"]), "executed_ok_or_failed": executed, "skipped": skipped, "failures": failures, "adjustments": log,
           "result": "COMPLETED" if not failures else "STOPPED AT FIRST FAILURE"}
    json.dump(res, open(os.path.join(OUT, "d2-rebuild-result.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(res, indent=1))


main()
