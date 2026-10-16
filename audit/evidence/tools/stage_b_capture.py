"""Stage B read-only evidence capture (Prod and Dev).

Safety properties (each enforced in code):
  * reads ONLY DEV_REFRESH_PROD_DB_URL / DEV_REFRESH_DEV_DB_URL from the protected, git-ignored env file;
  * never prints, logs or writes a credential (stderr is scrubbed; connection settings go through PG* env vars);
  * every session is read-only: PGOPTIONS='-c default_transaction_read_only=on' and the tool asserts it before any query;
  * refuses a target whose host/user does not contain the expected project reference;
  * no Supabase CLI, no Docker, no hosted resource is created; schema-only dump (no table data);
  * outputs go to a protected folder OUTSIDE the repository.

Usage:  python -I stage_b_capture.py prod|dev
"""
import datetime
import hashlib
import json
import os
import subprocess
import sys
import urllib.parse

ENV_FILE = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite\.env.SyncDevDataFromProd"
OUT_DIR = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
PG_BIN = r"C:\Program Files\PostgreSQL\18\bin"
TARGETS = {
    "prod": ("DEV_REFRESH_PROD_DB_URL", "qaagfafagdpgzcijnfbw"),
    "dev": ("DEV_REFRESH_DEV_DB_URL", "srxunxiytojjsuhcmzjg"),
}
SCHEMAS = "'public','storage','auth','supabase_migrations','realtime'"


def read_env(var):
    with open(ENV_FILE, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line.startswith(var + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{var} not found in env file")


class Target:
    def __init__(self, name):
        var, ref = TARGETS[name]
        self.name, self.ref = name, ref
        u = urllib.parse.urlparse(read_env(var))
        self.user = urllib.parse.unquote(u.username or "")
        self.password = urllib.parse.unquote(u.password or "")
        self.host, self.port, self.db = u.hostname, str(u.port or 5432), (u.path or "/postgres").lstrip("/")
        if ref not in (self.host or "") and ref not in self.user:
            raise SystemExit(f"refusing {name}: host/user does not carry the expected project ref")
        self.env = dict(os.environ)
        for k in list(self.env):
            if k.startswith("PG"):
                del self.env[k]
        self.env.update(PGHOST=self.host, PGPORT=self.port, PGUSER=self.user, PGPASSWORD=self.password,
                        PGDATABASE=self.db, PGSSLMODE="require", PGCONNECT_TIMEOUT="25",
                        PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=300000",
                        PGAPPNAME="stage_b_readonly_evidence")

    def scrub(self, text):
        for secret in (self.password, urllib.parse.quote(self.password, safe="")):
            if secret:
                text = text.replace(secret, "<redacted>")
        return text

    def psql(self, sql):
        r = subprocess.run([os.path.join(PG_BIN, "psql.exe"), "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                           env=self.env, capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            raise SystemExit(f"psql failed ({self.name}): {self.scrub(r.stderr)[:600]}")
        return r.stdout.strip()


def jq(inner):
    return f"select coalesce(json_agg(t),'[]'::json) from ({inner}) t"


# The history store keeps backslash as `\\` and newline as `\n`; decode it exactly (placeholder avoids decoding `\\n` as a newline).
DEC = r"replace(replace(replace(array_to_string(statements,';'), E'\\\\', E'\x01'), E'\\n', E'\n'), E'\x01', E'\\')"

QUERIES = {
    "server": "select json_build_object('captured_at_utc', now(), 'server_version', current_setting('server_version'),"
              " 'database', current_database(), 'session_user', current_user,"
              " 'default_transaction_read_only', current_setting('default_transaction_read_only'),"
              " 'transaction_read_only', current_setting('transaction_read_only'),"
              " 'track_functions', current_setting('track_functions'), 'in_recovery', pg_is_in_recovery())",
    "tables": jq(f"select n.nspname as schema, c.relname as name, c.relkind, c.relrowsecurity as rls, c.relforcerowsecurity as rls_forced,"
                 f" pg_get_userbyid(c.relowner) as owner, c.relreplident as replica_identity, c.relpersistence, c.reloptions::text as reloptions"
                 f" from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ({SCHEMAS})"
                 f" and c.relkind in ('r','p','v','m','S','f') order by 1,2"),
    "columns": jq(f"select n.nspname as schema, c.relname as tbl, a.attnum, a.attname as name, format_type(a.atttypid,a.atttypmod) as type,"
                  f" a.attnotnull as not_null, pg_get_expr(d.adbin,d.adrelid) as default_expr, a.attidentity as identity, a.attgenerated as generated"
                  f" from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace"
                  f" left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum"
                  f" where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m') and n.nspname in ({SCHEMAS}) order by 1,2,3"),
    "constraints": jq(f"select n.nspname as schema, c.relname as tbl, con.conname as name, con.contype as type,"
                      f" pg_get_constraintdef(con.oid) as def, con.convalidated as validated"
                      f" from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace"
                      f" where n.nspname in ({SCHEMAS}) order by 1,2,3"),
    "indexes": jq(f"select schemaname as schema, tablename as tbl, indexname as name, indexdef as def from pg_indexes"
                  f" where schemaname in ({SCHEMAS}) order by 1,2,3"),
    "triggers": jq(f"select n.nspname as schema, c.relname as tbl, t.tgname as name, pg_get_triggerdef(t.oid) as def, t.tgenabled as enabled"
                   f" from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace"
                   f" where not t.tgisinternal and n.nspname in ({SCHEMAS}) order by 1,2,3"),
    "functions": jq("select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,"
                    " pg_get_function_result(p.oid) as result, pg_get_userbyid(p.proowner) as owner, l.lanname as lang,"
                    " p.prosecdef as secdef, p.provolatile as volatility, p.proconfig::text as config, p.prokind as kind,"
                    " md5(p.prosrc) as src_md5, md5(regexp_replace(p.prosrc,'\\s+','','g')) as src_norm_md5, length(p.prosrc) as src_len,"
                    " md5(regexp_replace(regexp_replace(regexp_replace(p.prosrc,'/\\*.*?\\*/','','g'),'--[^\\n]*','','g'),'[ \\t\\n\\r\\f\\v]+','','g')) as src_nocomment_md5"
                    " from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang"
                    " where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1,2,3"),
    "policies": jq(f"select schemaname as schema, tablename as tbl, policyname as name, permissive, array_to_string(roles,',') as roles, cmd,"
                   f" qual, with_check from pg_policies where schemaname in ({SCHEMAS}) order by 1,2,3"),
    "grants_relations": jq(f"select n.nspname as schema, c.relname as name, c.relkind,"
                           f" case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee, x.privilege_type, x.is_grantable"
                           f" from pg_class c join pg_namespace n on n.oid=c.relnamespace,"
                           f" lateral aclexplode(coalesce(c.relacl, acldefault((case c.relkind when 'S' then 'S' else 'r' end)::\"char\", c.relowner))) x"
                           f" where c.relkind in ('r','p','v','m','S') and n.nspname in ({SCHEMAS}) order by 1,2,4,5"),
    "grants_columns": jq(f"select n.nspname as schema, c.relname as tbl, a.attname as col,"
                         f" case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee, x.privilege_type"
                         f" from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace,"
                         f" lateral aclexplode(a.attacl) x where a.attacl is not null and not a.attisdropped and n.nspname in ({SCHEMAS}) order by 1,2,3,4,5"),
    "grants_functions": jq("select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,"
                           " case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee, x.privilege_type"
                           " from pg_proc p join pg_namespace n on n.oid=p.pronamespace,"
                           " lateral aclexplode(coalesce(p.proacl, acldefault('f'::\"char\", p.proowner))) x"
                           " where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1,2,3,4,5"),
    "grants_schemas": jq(f"select n.nspname as schema, pg_get_userbyid(n.nspowner) as owner,"
                         f" case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee, x.privilege_type"
                         f" from pg_namespace n, lateral aclexplode(coalesce(n.nspacl, acldefault('n'::\"char\", n.nspowner))) x"
                         f" where n.nspname in ({SCHEMAS}) order by 1,3,4"),
    "default_acls": jq("select pg_get_userbyid(d.defaclrole) as role, coalesce(n.nspname,'*') as schema, d.defaclobjtype::text as objtype,"
                       " d.defaclacl::text as acl from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace order by 1,2,3"),
    "publications": jq("select p.pubname as name, p.puballtables as all_tables, p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate,"
                       " coalesce((select json_agg(pt.schemaname||'.'||pt.tablename order by pt.schemaname, pt.tablename)"
                       " from pg_publication_tables pt where pt.pubname=p.pubname),'[]'::json) as tables from pg_publication p order by 1"),
    "extensions": jq("select e.extname as name, e.extversion as version, n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1"),
    "roles": jq("select rolname as name, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls,"
                " rolconnlimit, rolvaliduntil, (select json_agg(b.rolname order by b.rolname) from pg_auth_members m join pg_roles b on b.oid=m.roleid"
                " where m.member=r.oid) as member_of from pg_roles r where rolname !~ '^pg_' order by 1"),
    "event_triggers": jq("select evtname as name, evtevent as event, pg_get_userbyid(evtowner) as owner, evtenabled as enabled, evtfoid::regproc::text as func from pg_event_trigger order by 1"),
    "views": jq(f"select schemaname as schema, viewname as name, viewowner as owner, md5(definition) as def_md5 from pg_views where schemaname in ({SCHEMAS}) order by 1,2"),
    "types": jq("select n.nspname as schema, t.typname as name, t.typtype::text as kind from pg_type t join pg_namespace n on n.oid=t.typnamespace"
                " where n.nspname='public' and (t.typtype in ('e','d') or (t.typtype='c' and not exists (select 1 from pg_class c where c.reltype=t.oid and c.relkind<>'c'))) order by 1,2"),
    "storage_buckets": jq("select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by 1"),
    "history_columns": jq("select column_name as name, data_type as type from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations' order by ordinal_position"),
    "history": jq("select version, name, coalesce(array_length(statements,1),0) as stmt_count,"
                  " md5(regexp_replace(replace(array_to_string(statements,';'), E'\\\\n', E'\\n'),'[\\s;]+','','g')) as norm_a_md5,"
                  " length(regexp_replace(replace(array_to_string(statements,';'), E'\\\\n', E'\\n'),'[\\s;]+','','g')) as norm_a_len,"
                  " md5(regexp_replace(regexp_replace(regexp_replace(replace(array_to_string(statements,';'), E'\\\\n', E'\\n'),'/\\*.*?\\*/','','g'),'--[^\\n]*','','g'),'[\\s;]+','','g')) as norm_b_md5,"
                  " length(regexp_replace(regexp_replace(regexp_replace(replace(array_to_string(statements,';'), E'\\\\n', E'\\n'),'/\\*.*?\\*/','','g'),'--[^\\n]*','','g'),'[\\s;]+','','g')) as norm_b_len,"
                  " md5(regexp_replace(" + DEC + ",'[\\s;]+','','g')) as norm_c_md5,"
                  " md5(regexp_replace(regexp_replace(regexp_replace(" + DEC + ",'/\\*.*?\\*/','','g'),'--[^\\n]*','','g'),'[\\s;]+','','g')) as norm_d_md5"
                  " from supabase_migrations.schema_migrations order by version"),
}

PATTERNS = {
    "jwt_like": r"eyJ[A-Za-z0-9_-]{20,}",
    "stripe_secret": r"(sk|rk)_(live|test)_[A-Za-z0-9]{8,}",
    "stripe_webhook": r"whsec_[A-Za-z0-9]{8,}",
    "resend_key": r"re_[A-Za-z0-9]{20,}",
    "twilio_sid": r"(AC|SK)[0-9a-f]{32}",
    "pem_block": r"-----BEGIN",
    "bcrypt_hash": r"\$2[aby]\$[0-9]{2}\$",
    "bearer_token": r"Bearer [A-Za-z0-9._-]{20,}",
    "google_api_key": r"AIza[0-9A-Za-z_-]{30,}",
    "inline_password": r"(?i)password\s*[:=]\s*'[^']{4,}'",
    "email_address": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
}


def scan_sql():
    parts = []
    sources = {
        "function_bodies": "select prosrc as t from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
        "column_defaults": "select pg_get_expr(d.adbin,d.adrelid) as t from pg_attrdef d",
        "policy_text": "select coalesce(qual,'')||' '||coalesce(with_check,'') as t from pg_policies",
        "trigger_defs": "select pg_get_triggerdef(oid) as t from pg_trigger where not tgisinternal",
        "view_defs": "select definition as t from pg_views where schemaname in ('public','storage')",
        "history_statements": "select array_to_string(statements,';') as t from supabase_migrations.schema_migrations",
    }
    for sname, ssql in sources.items():
        for pname, rx in PATTERNS.items():
            parts.append(f"select '{sname}' as source, '{pname}' as pattern, count(*)::int as rows_matching from ({ssql}) s where s.t ~ '{rx.replace(chr(39), chr(39) * 2)}'")
    return jq(" union all ".join(parts))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    name = sys.argv[1]
    t = Target(name)
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {"environment": name, "project_ref": t.ref, "files": {}}

    # 1. prove the session is read-only before anything else
    srv = json.loads(t.psql(QUERIES["server"]))
    assert srv["default_transaction_read_only"] == "on" and srv["transaction_read_only"] == "on", "session is not read-only"
    manifest["server"] = srv

    # 2. history count before (consistency probe)
    before = t.psql("select count(*) from supabase_migrations.schema_migrations")

    # 3. catalog snapshots (independent SQL capture)
    for qname, sql in QUERIES.items():
        data = t.psql(sql)
        path = os.path.join(OUT_DIR, f"{name}_catalog_{qname}.json")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(data + "\n")
        manifest["files"][os.path.basename(path)] = {"sha256": sha256(path), "bytes": os.path.getsize(path)}

    scan = t.psql(scan_sql())
    path = os.path.join(OUT_DIR, f"{name}_catalog_credential_scan.json")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(scan + "\n")
    manifest["files"][os.path.basename(path)] = {"sha256": sha256(path), "bytes": os.path.getsize(path)}

    # 4. schema-only dump through local pg_dump (second, independent capture)
    dump = os.path.join(OUT_DIR, f"{name}_schema_only.sql")
    cmd = [os.path.join(PG_BIN, "pg_dump.exe"), "--schema-only", "--no-sync", "-f", dump]
    for s in ("public", "storage", "auth", "supabase_migrations", "realtime"):
        cmd += ["-n", s]
    r = subprocess.run(cmd, env=t.env, capture_output=True, text=True, encoding="utf-8")
    manifest["pg_dump"] = {"exit_code": r.returncode, "stderr_scrubbed": t.scrub(r.stderr)[:1500]}
    if os.path.exists(dump):
        manifest["files"][os.path.basename(dump)] = {"sha256": sha256(dump), "bytes": os.path.getsize(dump)}

    after = t.psql("select count(*) from supabase_migrations.schema_migrations")
    manifest["history_rows_before"], manifest["history_rows_after"] = int(before), int(after)
    manifest["finished_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with open(os.path.join(OUT_DIR, f"{name}_manifest.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, indent=1)
    print(f"{name}: read-only confirmed; {len(manifest['files'])} artifacts; history rows {before} -> {after}; pg_dump exit {r.returncode}")


if __name__ == "__main__":
    main()
