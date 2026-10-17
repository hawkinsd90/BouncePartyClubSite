"""Regenerate every generated Step 2 recovery artifact from the committed inputs (audit/evidence/derived and the committed evidence CSVs).
Run once after a fresh clone, before the migration manifest tests:  python -I audit/evidence/tools/generate_all.py
Writes the 7 files in audit/ (manifests, rules, execution manifest, batches, approval package). Output is deterministic (LF line endings).
No database, no network, no protected evidence folder needed."""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STEPS = [("build_development_plan.py",), ("build_execution_manifest.py",), ("build_execution_package.py",), ("render_approval_package.py",),
         ("build_production_plan.py", "candidates"), ("build_production_plan.py", "manifest")]
for step in STEPS:
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, step[0])] + list(step[1:]), capture_output=True, text=True)
    print(("ok   " if r.returncode == 0 else "FAIL ") + " ".join(step))
    if r.returncode != 0:
        sys.exit(r.stdout[-800:] + r.stderr[-800:])
