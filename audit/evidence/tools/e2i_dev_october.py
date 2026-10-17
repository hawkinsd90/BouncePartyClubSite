"""Stage E2I: dry-run of the 23 October migrations on a scratch restore of the captured DEVELOPMENT schema (analysis helper, not the executor; disposable local PostgreSQL only; synthetic data).
Reports where Development's current catalog would make the October migrations fail, optionally after scratch-only alignment SQL files.
Usage: python -I e2i_dev_october.py <name> [alignment.sql ...]"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402
import d4_seed as S  # noqa: E402
import e2i_dev_restore as R  # noqa: E402

OCT = sorted(f for f in os.listdir(L.MIG) if f.endswith(".sql") and f[:14] >= "20261007000000")


def prepare(name, seed=True, align=()):
    db = f"bpc_replay_e2i_{name}"
    L.clone(R.BASE, db)
    if seed:
        for part in (S.users_and_roles(), S.commerce()):
            r = L.psql(db, ["-v", "ON_ERROR_STOP=1"], text=part)
            if r.returncode != 0:
                return db, {"seed_error": L.err1(r.stderr)}
    for a in align:
        r = L.psql(db, ["-v", "ON_ERROR_STOP=1", "-1", "-f", a])
        if r.returncode != 0:
            return db, {"alignment_error": L.err1(r.stderr), "file": a}
    return db, None


def main():
    name = sys.argv[1]
    align = [os.path.abspath(a) for a in sys.argv[2:]]
    db, err = prepare(name, True, align)
    if err:
        print(json.dumps(err))
        return
    applied, fail = R.run_files(db, OCT)
    print(json.dumps({"database": db, "october_files": len(OCT), "applied": len(applied), "first_failure": fail}, indent=1))


if __name__ == "__main__":
    main()
