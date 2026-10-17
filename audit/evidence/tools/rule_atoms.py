"""Shared read-only catalog atoms for verification rules (PostgreSQL 17 and 18 safe: no pg_constraint NOT NULL entries). Each atom is one boolean SQL expression over catalogs only. Offline text generation."""

lit = lambda s: "'" + str(s).replace("'", "''") + "'"


# ------------------------------------------------------------------ catalog atoms (PostgreSQL 17 and 18 safe: no pg_constraint NOT NULL entries)
def atom(kind, obj):
    if kind == "table":
        return f"to_regclass('public.{obj}') IS NOT NULL"
    if kind == "col":
        t, c = obj.split(".", 1)
        return f"EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name={lit(t)} AND column_name={lit(c)})"
    if kind == "index":
        return f"EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname={lit(obj)})"
    if kind == "rls":
        return f"COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.{obj}')), false)"
    if kind == "policy":
        if obj.startswith("storage.objects."):
            return f"EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname={lit(obj[len('storage.objects.'):])})"
        t, p = obj.split(".", 1)
        return f"EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename={lit(t)} AND policyname={lit(p)})"
    if kind == "trigger":
        t, n = obj.split(".", 1)
        return f"EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.{t}') AND tgname={lit(n)} AND NOT tgisinternal)"
    if kind == "function":
        return f"EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname={lit(obj)})"
    if kind == "constraint":
        t, n = obj.split(".", 1)
        return f"EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.{t}') AND conname={lit(n)})"
    if kind == "bucket":
        return f"EXISTS (SELECT 1 FROM storage.buckets WHERE id={lit(obj)})"
    if kind == "grant":
        typ, name, grantee, priv = obj.split(":")
        if priv == "ALL":
            return None
        who = "0" if grantee.upper() == "PUBLIC" else None
        if typ == "FUNCTION":
            if who is None:  # effective privilege (explicit grant, PUBLIC or membership)
                return f"EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname={lit(name)} AND has_function_privilege({lit(grantee)}, p.oid, {lit(priv)}))"
            return (f"EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE p.pronamespace='public'::regnamespace AND p.proname={lit(name)} "
                    f"AND a.privilege_type={lit(priv)} AND a.grantee = 0)")
        if typ == "TABLE":
            if who is None:
                return f"COALESCE(has_table_privilege({lit(grantee)}, to_regclass('public.{name}'), {lit(priv)}), false)"
            return (f"EXISTS (SELECT 1 FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a WHERE c.oid = to_regclass('public.{name}') "
                    f"AND a.privilege_type={lit(priv)} AND a.grantee = 0)")
    return None
