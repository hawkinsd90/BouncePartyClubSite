"""Stage E2D: re-runs the unmodified Stage D4 scenario harness (d4_run.py) against the exact 58-version candidate of Stage E2C.
d4_run.py is NOT edited. This wrapper (1) restricts the upgrade set to the 58 versions (the 67 of d3-selected-manifest.json minus the nine E2C omissions, every file hash re-verified),
(2) points results at a separate scratch folder and database names (bpc_replay_e2d_*), and (3) changes ONLY the expected counts and labels 67 -> 58 in the harness text. No check is weakened or removed.
Local scratch PostgreSQL only (127.0.0.1:54329); synthetic data only; no hosted system.
Usage: python -I e2d_run.py <preflight|A|B|V|C|X|all>"""
import csv
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402

OUT = r"C:\Users\vikki\migration-evidence\e2d-scratch"
os.makedirs(OUT, exist_ok=True)
EV = os.path.join(HERE, "..")
OMIT9 = ["20260715221828", "20260716104333", "20261010110000", "20260716151530", "20260716152823", "20260716173644", "20260717111737", "20260717113131", "20260814114825"]
_orig_verify = L.verify_upgrade_set


def rows58():
    rows = _orig_verify()  # verifies the sha256 of all 67 files first
    out = [r for r in rows if r["version"] not in OMIT9]
    assert len(rows) == 67 and len(out) == 58
    return out


def preflight():
    res = {}
    git = lambda *a: subprocess.run(["git", *a], capture_output=True, text=True, cwd=L.REPO).stdout.strip()
    res["branch"] = git("branch", "--show-current")
    res["head"] = git("rev-parse", "HEAD")
    res["checkpoint_commits_present"] = {c: bool(git("cat-file", "-t", c)) for c in ("831ea94", "992da3a", "fa08fb5", "d36af73", "63672cd", "eb0b43c", "efda417")}
    res["status_lines"] = [l for l in git("status", "--short", "-uall").splitlines() if "__pycache__" not in l]
    res["migration_dir_changes"] = [l for l in res["status_lines"] if "supabase/" in l or "src/" in l]
    man = json.load(open(os.path.join(EV, "d3-selected-manifest.json"), encoding="utf-8"))
    rows = _orig_verify()
    res["d3_manifest_upgrade_versions"] = len(rows)
    res["d3_manifest_sha256_recorded"] = man.get("upgrade_manifest_sha256")
    res["all_67_file_hashes_match_manifest"] = True  # _orig_verify asserts every file sha256
    d2 = json.load(open(os.path.join(EV, "d2-selected-manifest.json"), encoding="utf-8"))["selected"]
    bad = [x["file"] for x in d2 if L.sha(os.path.join(L.MIG, x["file"])) != x["sha256"]]
    res["d2_317_historical_files_hash_mismatches"] = bad
    res["d2_317_historical_files_checked"] = len(d2)
    allfiles = [f for f in os.listdir(L.MIG) if f.endswith(".sql")]
    res["repository_migration_files"] = len(allfiles)
    r58 = rows58()
    e2c = list(csv.DictReader(open(os.path.join(EV, "e2c-proposed-execution-manifest.csv"), encoding="utf-8")))
    e2c_exec = [r["version"] for r in e2c if r["proposed_action"] == "execute"]
    e2c_omit = sorted(r["version"] for r in e2c if r["proposed_action"].startswith("do-not-execute"))
    res["e2c_manifest_execute_count"] = len(e2c_exec)
    res["e2c_omissions"] = e2c_omit
    res["omissions_equal_hardcoded_list"] = e2c_omit == sorted(OMIT9)
    res["58_equals_e2c_execute_list"] = [r["version"] for r in r58] == e2c_exec
    res["58_versions_first_last"] = [r58[0]["version"], r58[-1]["version"]]
    res["58_older_than_latest_recorded_20260928172217"] = sum(1 for r in r58 if r["version"] < "20260928172217")
    res["case_43_absent"] = not any(f.startswith("20260407211122") for f in os.listdir(L.MIG))
    res["template_database_present"] = L.q("postgres", "select count(*) from pg_database where datname='bpc_replay_d4_template'") == "1"
    res["scratch_template_marker"] = L.q("postgres", "select shobj_description(oid,'pg_database') from pg_database where datname='bpc_replay_d4_template'")
    json.dump(res, open(os.path.join(OUT, "e2d-preflight.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(res, indent=1))
    assert not res["d2_317_historical_files_hash_mismatches"] and res["omissions_equal_hardcoded_list"] and res["58_equals_e2c_execute_list"] and not res["migration_dir_changes"]


def load_harness():
    L.OUT = OUT
    L.verify_upgrade_set = rows58
    src = open(os.path.join(HERE, "d4_run.py"), encoding="utf-8").read()
    src = src.replace("bpc_replay_d4_", "bpc_replay_e2d_")
    src = re.sub(r"\b67\b", "58", src)
    mod = type(sys)("e2d_d4_harness")
    mod.__dict__["__file__"] = os.path.join(HERE, "d4_run.py")
    exec(compile(src, "d4_run(58-variant)", "exec"), mod.__dict__)
    return mod


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "preflight":
        preflight()
    else:
        h = load_harness()
        for part in {"A": ["A"], "B": ["B"], "V": ["V"], "C": ["C"], "X": ["X"], "all": ["A", "B", "V", "C", "X"]}[cmd]:
            getattr(h, "scenario_" + part)()
        h.save()
