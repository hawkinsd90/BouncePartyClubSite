"""Stage B targeted inspection (read-only): recorded-SQL vs repo-file differences for named versions.

Fetches the recorded statements of the given versions from the chosen environment through a read-only session and prints a short,
whitespace-insensitive difference summary. Prints at most ~160 characters of context per difference. No credentials are printed.
Usage: python -I stage_b_inspect.py prod|dev VERSION [VERSION ...]
"""
import difflib
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from stage_b_capture import Target  # noqa: E402  (same read-only guards)

MIG = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite\supabase\migrations"


def tokens(text):
    return re.findall(r"\s+|[^\s]+", text)


def norm_lines(text):
    text = text.replace("\r", "").replace("\\n", "\n")
    return [re.sub(r"\s+", " ", ln).strip() for ln in text.split("\n") if ln.strip()]


def main():
    env, versions = sys.argv[1], sys.argv[2:]
    t = Target(env)
    for v in versions:
        out = t.psql(f"select array_to_string(statements, ';') from supabase_migrations.schema_migrations where version='{v}'")
        rec = norm_lines(out)
        fpath = glob.glob(os.path.join(MIG, f"{v}_*.sql"))[0]
        fil = norm_lines(open(fpath, encoding="utf-8", errors="replace").read())
        sm = difflib.SequenceMatcher(None, rec, fil, autojunk=False)
        ops = [o for o in sm.get_opcodes() if o[0] != "equal"]
        print(f"== {env} {v} {os.path.basename(fpath)}: recorded {len(rec)} lines / file {len(fil)} lines / {len(ops)} differing blocks / ratio {sm.ratio():.3f}")
        for tag, i1, i2, j1, j2 in ops[:6]:
            print(f"   {tag}: recorded[{i1}:{i2}] = {' | '.join(rec[i1:i2])[:160]!r}")
            print(f"        file[{j1}:{j2}]    = {' | '.join(fil[j1:j2])[:160]!r}")


if __name__ == "__main__":
    main()
