"""Stage E2E: re-runs the unmodified Stage D4 scenario harness on the 58-version candidate with 20260814120000 moved to its Development-recorded position (the order a rename to
20260814002658 would produce). Same mechanical substitutions as e2d_run.py (upgrade set, database prefix bpc_replay_e2e_, counts 67 -> 58); no check is weakened.
Local scratch PostgreSQL only; synthetic data only; the repository is not modified (the move is applied to the in-memory order only).
Usage: python -I e2e_alias_run.py all"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402
import e2d_run as E  # noqa: E402

OUT = r"C:\Users\vikki\migration-evidence\e2e-scratch\alias-d4"
os.makedirs(OUT, exist_ok=True)
ALIAS = "20260814120000"


def rows_alias_order():
    rows = E.rows58()
    mv = next(r for r in rows if r["version"] == ALIAS)
    rows = [r for r in rows if r is not mv]
    i = next(k for k, r in enumerate(rows) if r["version"] == "20260814113146")
    rows.insert(i, mv)
    assert len(rows) == 58 and [r["version"] for r in rows].index(ALIAS) < [r["version"] for r in rows].index("20260814113146")
    return rows


def load():
    L.OUT = OUT
    L.verify_upgrade_set = rows_alias_order
    src = open(os.path.join(HERE, "d4_run.py"), encoding="utf-8").read()
    src = src.replace("bpc_replay_d4_", "bpc_replay_e2e_")
    src = re.sub(r"\b67\b", "58", src)
    mod = type(sys)("e2e_d4_harness")
    mod.__dict__["__file__"] = os.path.join(HERE, "d4_run.py")
    exec(compile(src, "d4_run(58-alias-order variant)", "exec"), mod.__dict__)
    return mod


if __name__ == "__main__":
    h = load()
    for part in ("A", "B", "V", "C", "X"):
        getattr(h, "scenario_" + part)()
    h.save()
