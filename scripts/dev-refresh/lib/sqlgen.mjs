// Generates the psql scripts of the refresh. Pure string building: nothing here touches a database.
//
// Shape of the destructive script (apply / rehearsal / restore): ONE transaction.
//   lock -> prove nothing changed since the preview/backup -> fingerprint what must not change -> stage the new rows in TEMP tables
//   -> validate them (nothing destroyed yet) -> switch off ONLY the named application triggers -> delete -> insert (circular
//   references filled afterwards) -> put preserved references back -> verify content, untouched tables and trigger states -> COMMIT
// Any failed statement or failed check raises, the transaction rolls back, and Development is exactly as it was.
// Foreign keys, unique, check and not-null constraints are never switched off.

import { CHURN_TABLES } from './config.mjs';
import { psqlPath, sqlIdent as qi, sqlLit as ql } from './psql.mjs';

const col = (c) => qi(c);
const colList = (cols) => cols.map(col).join(', ');
const tbl = (t) => `public.${qi(t)}`;
const stage = (t) => qi(`_s_${t}`);

class Script {
  constructor() {
    this.lines = [];
  }
  add(...l) {
    this.lines.push(...l);
    return this;
  }
  // A DO block whose exception text starts with a stable tag so callers can recognise it.
  doBlock(body) {
    this.lines.push(`DO $chk$ BEGIN ${body} END $chk$;`);
    return this;
  }
  toString() {
    return this.lines.join('\n') + '\n';
  }
}

export const fingerprintExpr = (t) => `SELECT count(*)::text || ':' || md5(COALESCE(string_agg(x::text, E'\\n' ORDER BY x::text), '')) FROM ${tbl(t)} x`;

export function buildFingerprintQuery(tables) {
  return tables.map((t) => `SELECT '@@fp|${t}|' || (${fingerprintExpr(t)})`).join(';\n') + ';\n';
}

// ---------------------------------------------------------------------------------------------------------------------
// Export from Production (read-only snapshot)
// ---------------------------------------------------------------------------------------------------------------------
export function buildExportScript({ plan, exportDir }) {
  const s = new Script();
  s.add('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  s.add(`SELECT '@@snapshot|' || now()::text;`);
  for (const t of plan.tables.filter((x) => x.mode === 'import')) {
    s.add(`\\copy (SELECT ${colList(t.copied)} FROM ${tbl(t.name)}) TO '${psqlPath(exportDir)}/${t.name}.copy'`);
    s.add(`SELECT '@@count|${t.name}|' || count(*) FROM ${tbl(t.name)};`);
    for (const c of t.prodOnly) s.add(`SELECT '@@prodonly|${t.name}|${c}|' || count(${col(c)}) FROM ${tbl(t.name)};`);
    // What Production itself says about money-bearing columns, for the post-import reconciliation.
  }
  s.add('COMMIT;');
  return s.toString();
}

// ---------------------------------------------------------------------------------------------------------------------
// Backup of the Development rows that will be replaced
// ---------------------------------------------------------------------------------------------------------------------
export function buildBackupScript({ plan, backupDir }) {
  const s = new Script();
  s.add('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  for (const t of plan.tables.filter((x) => x.mode === 'import' || x.mode === 'delete-only')) {
    s.add(`\\copy (SELECT ${colList(t.devColumns)} FROM ${tbl(t.name)}) TO '${psqlPath(backupDir)}/${t.name}.copy'`);
    s.add(`SELECT '@@count|${t.name}|' || count(*) FROM ${tbl(t.name)};`);
    s.add(`SELECT '@@fp|${t.name}|' || (${fingerprintExpr(t.name)});`);
  }
  for (const c of plan.clearedWithOrders) {
    s.add(`\\copy (SELECT ${colList(c.columns)} FROM ${tbl(c.table)}) TO '${psqlPath(backupDir)}/${c.table}.copy'`);
    s.add(`SELECT '@@count|${c.table}|' || count(*) FROM ${tbl(c.table)};`);
    s.add(`SELECT '@@fp|${c.table}|' || (${fingerprintExpr(c.table)});`);
  }
  plan.preservedChildren.forEach((p, i) => {
    s.add(`\\copy (SELECT ${colList(p.pk)}, ${col(p.column)} FROM ${tbl(p.table)} WHERE ${col(p.column)} IS NOT NULL) TO '${psqlPath(backupDir)}/keep_${i}.copy'`);
    s.add(`SELECT '@@keepcount|${i}|${p.table}.${p.column}|' || count(*) FROM ${tbl(p.table)} WHERE ${col(p.column)} IS NOT NULL;`);
  });
  s.add('COMMIT;');
  return s.toString();
}

// ---------------------------------------------------------------------------------------------------------------------
// Pieces shared by apply and restore
// ---------------------------------------------------------------------------------------------------------------------
function header(s, { expectedDatabase, tablesToLock }) {
  s.add('\\set ON_ERROR_STOP on');
  s.add('BEGIN ISOLATION LEVEL REPEATABLE READ;');
  s.add(`SET LOCAL lock_timeout = '20s';`);
  s.add(`SET LOCAL statement_timeout = '10min';`);
  s.add(`SET LOCAL client_min_messages = warning;`);
  s.doBlock(`IF current_database() <> ${ql(expectedDatabase)} THEN RAISE EXCEPTION 'WRONG_DATABASE|expected %, connected to %', ${ql(expectedDatabase)}, current_database(); END IF;`);
  s.add(`LOCK TABLE ${tablesToLock.map(tbl).join(', ')} IN SHARE ROW EXCLUSIVE MODE;`);
}

function staleCheck(s, expectedFingerprints, label) {
  for (const [t, fp] of Object.entries(expectedFingerprints || {})) {
    s.doBlock(`IF (${fingerprintExpr(t)}) <> ${ql(fp)} THEN RAISE EXCEPTION 'STALE|${t}|Development table ${t} changed since ${label}; run the preview again'; END IF;`);
  }
}

// A preserved table that holds a reference to a replaced row legitimately loses the references whose row is gone. Those columns
// (and only those) are masked out of that table's fingerprint; the references themselves are reported separately.
function maskJson(plan) {
  const m = {};
  for (const p of plan.preservedChildren) (m[p.table] = m[p.table] || []).push(p.column);
  return `${ql(JSON.stringify(m))}::jsonb`;
}

function untouchedFingerprints(s, excluded, mask) {
  const ex = `ARRAY[${excluded.map(ql).join(', ') || "''"}]::text[], ${mask}`;
  s.add(`CREATE TEMP TABLE _fp (phase text, tbl text, fp text) ON COMMIT DROP;`);
  s.add(`CREATE FUNCTION pg_temp.fp_all(p_phase text, p_exclude text[], p_mask jsonb) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r record; v text; m text[];
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> ALL (p_exclude) ORDER BY 1 LOOP
    m := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_mask -> r.relname)), '{}'::text[]);
    EXECUTE format('SELECT count(*)::text || '':'' || md5(COALESCE(string_agg((to_jsonb(x) - %L::text[])::text, E''\\n'' ORDER BY (to_jsonb(x) - %L::text[])::text), '''')) FROM public.%I x', m, m, r.relname) INTO v;
    INSERT INTO _fp VALUES (p_phase, r.relname, v);
  END LOOP;
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO _fp SELECT p_phase, 'auth.users', count(*)::text || ':' || md5(COALESCE(string_agg(id::text || '|' || COALESCE(email, ''), ',' ORDER BY id), '')) FROM auth.users;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO _fp SELECT p_phase, 'storage.objects', count(*)::text || ':' || md5(COALESCE(string_agg(bucket_id || '/' || name, ',' ORDER BY bucket_id, name), '')) FROM storage.objects;
  END IF;
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO _fp SELECT p_phase, 'storage.buckets', count(*)::text || ':' || md5(COALESCE(string_agg(id || '|' || public::text, ',' ORDER BY id), '')) FROM storage.buckets;
  END IF;
  INSERT INTO _fp SELECT p_phase, 'policies', count(*)::text || ':' || md5(COALESCE(string_agg(schemaname || '.' || tablename || '.' || policyname || '|' || cmd || '|' || roles::text || '|' || COALESCE(qual, '') || '|' || COALESCE(with_check, ''), E'\\n' ORDER BY schemaname, tablename, policyname), ''))
    FROM pg_policies WHERE schemaname IN ('public', 'storage');
END $f$;`);
  s.add(`SELECT pg_temp.fp_all('pre', ${ex});`);
  return {
    verify() {
      s.add(`SELECT pg_temp.fp_all('post', ${ex});`);
      s.doBlock(`IF EXISTS (SELECT 1 FROM _fp a FULL JOIN _fp b ON a.tbl = b.tbl AND b.phase = 'post' WHERE a.phase = 'pre' AND (b.tbl IS NULL OR a.fp IS DISTINCT FROM b.fp)) THEN
        RAISE EXCEPTION 'UNTOUCHED_CHANGED|%', (SELECT string_agg(a.tbl, ', ') FROM _fp a LEFT JOIN _fp b ON a.tbl = b.tbl AND b.phase = 'post' WHERE a.phase = 'pre' AND a.fp IS DISTINCT FROM b.fp);
      END IF;`);
      s.add(`SELECT '@@untouched|' || count(*) FROM _fp WHERE phase = 'pre';`);
    },
  };
}

function disableTriggers(s, tables) {
  const arr = `ARRAY[${tables.map(ql).join(', ')}]::text[]`;
  s.add(`CREATE TEMP TABLE _trg ON COMMIT DROP AS
SELECT c.relname::text AS tbl, t.tgname::text AS name, t.tgenabled::text AS enabled
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = ANY (${arr});`);
  s.add(`DO $t$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM _trg WHERE enabled <> 'D' LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', r.tbl, r.name);
  END LOOP;
END $t$;`);
  // Constraint enforcement must be untouched: no internal (foreign-key) trigger may be disabled.
  s.doBlock(`IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE t.tgisinternal AND t.tgenabled <> 'O' AND n.nspname = 'public' AND c.relname = ANY (${arr})) THEN RAISE EXCEPTION 'CONSTRAINT_TRIGGERS_DISABLED'; END IF;`);
  s.add(`SELECT '@@triggers_suppressed|' || count(*) FROM _trg WHERE enabled <> 'D';`);
  return {
    restore() {
      s.add(`DO $t$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM _trg WHERE enabled <> 'D' LOOP
    EXECUTE format(CASE r.enabled WHEN 'A' THEN 'ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I' WHEN 'R' THEN 'ALTER TABLE public.%I ENABLE REPLICA TRIGGER %I' ELSE 'ALTER TABLE public.%I ENABLE TRIGGER %I' END, r.tbl, r.name);
  END LOOP;
END $t$;`);
      s.doBlock(`IF EXISTS (SELECT 1 FROM _trg o FULL JOIN (SELECT c.relname::text AS tbl, t.tgname::text AS name, t.tgenabled::text AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = ANY (${arr})) cur ON cur.tbl = o.tbl AND cur.name = o.name WHERE o.enabled IS DISTINCT FROM cur.enabled) THEN RAISE EXCEPTION 'TRIGGER_STATE_NOT_RESTORED'; END IF;`);
      s.add(`SELECT '@@triggers_restored|' || count(*) FROM _trg;`);
    },
  };
}

function captureKept(s, plan) {
  plan.preservedChildren.forEach((p, i) => {
    const pkSel = p.pk.map((k, j) => `${col(k)} AS pk${j}`).join(', ');
    s.add(`CREATE TEMP TABLE _keep_${i} ON COMMIT DROP AS SELECT ${pkSel}, ${col(p.column)} AS val FROM ${tbl(p.table)} WHERE ${col(p.column)} IS NOT NULL;`);
    s.add(`SELECT '@@kept|${p.table}.${p.column}|' || count(*) FROM _keep_${i};`);
  });
}

function restoreKept(s, plan, { useConditions }) {
  plan.preservedChildren.forEach((p, i) => {
    const pkMatch = p.pk.map((k, j) => `c.${col(k)} = k.pk${j}`).join(' AND ');
    const cond = useConditions && p.condition ? ` AND (${p.condition})` : '';
    s.add(`WITH u AS (UPDATE ${tbl(p.table)} c SET ${col(p.column)} = k.val FROM _keep_${i} k WHERE ${pkMatch} AND c.${col(p.column)} IS NULL AND EXISTS (SELECT 1 FROM ${tbl(p.parent)} p WHERE p.${col(p.parentColumn)} = k.val)${cond} RETURNING 1) SELECT '@@restored|${p.table}.${p.column}|' || count(*) FROM u;`);
  });
}

function deleteAll(s, plan, { clearedFirst = true } = {}) {
  if (clearedFirst) {
    for (const c of plan.clearedWithOrders) s.add(`SELECT '@@cleared|${c.table}|' || count(*) FROM ${tbl(c.table)};`);
  }
  const reverse = [...plan.tables.filter((t) => t.mode === 'import' || t.mode === 'delete-only')].reverse();
  for (const t of reverse) s.add(`WITH d AS (DELETE FROM ${tbl(t.name)} RETURNING 1) SELECT '@@deleted|${t.name}|' || count(*) FROM d;`);
}

// Fills the circular references after every referenced row exists.
function fillDeferred(s, t, src) {
  for (const c of t.deferred || []) {
    const pkMatch = t.pk.map((k) => `t.${col(k)} = s.${col(k)}`).join(' AND ');
    s.add(`UPDATE ${tbl(t.name)} t SET ${col(c)} = s.${col(c)} FROM ${src(t.name)} s WHERE ${pkMatch} AND s.${col(c)} IS NOT NULL;`);
  }
}

const rowText = (cols, alias = '') => `(ROW(${cols.map((c) => (alias ? `${alias}.` : '') + col(c)).join(', ')}))::text`;

function compareContent(s, name, cols, srcName) {
  if (!cols.length) return;
  s.doBlock(`IF (SELECT count(*) FROM (SELECT ${rowText(cols)} FROM ${tbl(name)} EXCEPT SELECT ${rowText(cols)} FROM ${srcName}) z) > 0
      OR (SELECT count(*) FROM (SELECT ${rowText(cols)} FROM ${srcName} EXCEPT SELECT ${rowText(cols)} FROM ${tbl(name)}) z) > 0
    THEN RAISE EXCEPTION 'CONTENT_MISMATCH|${name}|imported rows differ from the source rows'; END IF;`);
}

// ---------------------------------------------------------------------------------------------------------------------
// APPLY / REHEARSAL
// ---------------------------------------------------------------------------------------------------------------------
export function buildApplyScript({ plan, expectedDatabase, exportDir, exportCounts, runDir, devFingerprints, rehearsal, afterDir }) {
  const importT = plan.tables.filter((t) => t.mode === 'import');
  const allReplaced = plan.tables.filter((t) => t.mode === 'import' || t.mode === 'delete-only').map((t) => t.name);
  const cleared = plan.clearedWithOrders.map((c) => c.table);
  const preserved = [...new Set(plan.preservedChildren.map((p) => p.table))];
  const suppressed = [...new Set([...allReplaced, ...cleared, ...preserved])];
  const owner = importT.find((t) => t.ownerColumn);
  const s = new Script();

  header(s, { expectedDatabase, tablesToLock: [...allReplaced, ...cleared, ...preserved] });
  staleCheck(s, devFingerprints, rehearsal ? 'the schema was read for this preview' : 'the preview');

  const fp = untouchedFingerprints(s, [...allReplaced, ...cleared, ...CHURN_TABLES], maskJson(plan));
  captureKept(s, plan);

  // ---- stage the Production rows in session-only temp tables ---------------------------------------------------------
  for (const t of importT) {
    s.add(`CREATE TEMP TABLE ${stage(t.name)} ON COMMIT DROP AS SELECT ${colList(t.copied)} FROM ${tbl(t.name)} WITH NO DATA;`);
    s.add(`\\copy ${stage(t.name)} (${colList(t.copied)}) FROM '${psqlPath(exportDir)}/${t.name}.copy'`);
    const expected = exportCounts?.[t.name];
    if (expected !== undefined) s.doBlock(`IF (SELECT count(*) FROM ${stage(t.name)}) <> ${Number(expected)} THEN RAISE EXCEPTION 'EXPORT_COUNT|${t.name}|staged % rows, the export holds ${Number(expected)}', (SELECT count(*) FROM ${stage(t.name)}); END IF;`);
    s.add(`SELECT '@@staged|${t.name}|' || count(*) FROM ${stage(t.name)};`);
  }

  // ---- validate before anything is destroyed ------------------------------------------------------------------------
  for (const t of importT) {
    if (t.pk.length) s.doBlock(`IF (SELECT count(*) - count(DISTINCT (${t.pk.map(col).join(', ')})) FROM ${stage(t.name)}) > 0 THEN RAISE EXCEPTION 'DUPLICATE_KEY|${t.name}'; END IF;`);
    for (const c of t.nonNullChecked) s.doBlock(`IF EXISTS (SELECT 1 FROM ${stage(t.name)} WHERE ${col(c)} IS NULL) THEN RAISE EXCEPTION 'NULL_NOT_ALLOWED|${t.name}.${c}|Production has NULLs where Development requires a value'; END IF;`);
  }
  const stagedNames = new Set(importT.map((t) => t.name));
  for (const f of plan.intraFks) {
    if (!stagedNames.has(f.child)) continue;
    const parentExists = stagedNames.has(f.parent);
    const cond = parentExists ? `NOT EXISTS (SELECT 1 FROM ${stage(f.parent)} p WHERE p.${col(f.parentColumn)} = c.${col(f.childColumn)})` : 'true';
    s.doBlock(`IF EXISTS (SELECT 1 FROM ${stage(f.child)} c WHERE c.${col(f.childColumn)} IS NOT NULL AND ${cond}) THEN RAISE EXCEPTION 'ORPHAN|${f.child}.${f.childColumn} -> ${f.parent}|% row(s) in the export reference a ${f.parent} row that is not in the export', (SELECT count(*) FROM ${stage(f.child)} c WHERE c.${col(f.childColumn)} IS NOT NULL AND ${cond}); END IF;`);
  }
  for (const f of plan.externalFks) {
    if (!stagedNames.has(f.child)) continue;
    const cond = `NOT EXISTS (SELECT 1 FROM ${tbl(f.parent)} p WHERE p.${col(f.parentColumn)} = c.${col(f.childColumn)})`;
    s.doBlock(`IF EXISTS (SELECT 1 FROM ${stage(f.child)} c WHERE c.${col(f.childColumn)} IS NOT NULL AND ${cond}) THEN RAISE EXCEPTION 'MISSING_REFERENCE|${f.child}.${f.childColumn} -> ${f.parent}|% value(s) are not present in Development ${f.parent} (a table this refresh preserves)', (SELECT count(*) FROM ${stage(f.child)} c WHERE c.${col(f.childColumn)} IS NOT NULL AND ${cond}); END IF;`);
  }

  // ---- Auth mapping (computed, reported; applied below) --------------------------------------------------------------
  const needsAuth = importT.some((t) => t.ownerColumn || t.authRefs.length);
  if (needsAuth) s.add(`CREATE TEMP TABLE _dev_auth ON COMMIT DROP AS SELECT id, lower(email) AS email, (email_confirmed_at IS NOT NULL) AS confirmed FROM auth.users;`);
  if (owner) {
    s.add(`CREATE TEMP TABLE _cust_map ON COMMIT DROP AS
WITH cand AS (
  SELECT s.id AS customer_id, s.${col(owner.ownerColumn)} AS prod_user_id, a.id AS same_id, (a.email = lower(s.email)) AS same_email,
         (SELECT count(*) FROM _dev_auth d WHERE d.email = lower(s.email) AND d.confirmed) AS email_matches,
         (SELECT d.id FROM _dev_auth d WHERE d.email = lower(s.email) AND d.confirmed ORDER BY d.id LIMIT 1) AS email_user
  FROM ${stage('customers')} s LEFT JOIN _dev_auth a ON a.id = s.${col(owner.ownerColumn)}
), ruled AS (
  SELECT *, CASE
    WHEN prod_user_id IS NULL THEN 'none'
    WHEN same_id IS NOT NULL AND same_email THEN 'same-id-same-email'
    WHEN same_id IS NOT NULL THEN 'conflict-same-id-different-email'
    WHEN email_matches = 1 THEN 'email-match'
    WHEN email_matches > 1 THEN 'ambiguous-email'
    ELSE 'unmatched' END AS rule
  FROM cand
), target AS (
  SELECT *, CASE rule WHEN 'same-id-same-email' THEN same_id WHEN 'email-match' THEN email_user END AS dev_user_id FROM ruled
)
SELECT t.customer_id, t.prod_user_id, t.rule,
       CASE WHEN t.dev_user_id IS NOT NULL AND (SELECT count(*) FROM target t2 WHERE t2.dev_user_id = t.dev_user_id) > 1 THEN NULL ELSE t.dev_user_id END AS dev_user_id,
       (t.dev_user_id IS NOT NULL AND (SELECT count(*) FROM target t2 WHERE t2.dev_user_id = t.dev_user_id) > 1) AS collision
FROM target t;`);
    s.add(`SELECT '@@owner|' || rule || '|' || count(*) FROM _cust_map GROUP BY rule ORDER BY rule;`);
    s.add(`SELECT '@@owner|collision-set-to-none|' || count(*) FROM _cust_map WHERE collision;`);
    s.add(`SELECT '@@owner|linked|' || count(*) FROM _cust_map WHERE dev_user_id IS NOT NULL;`);
    s.add(`\\copy (SELECT customer_id, prod_user_id, rule FROM _cust_map WHERE prod_user_id IS NOT NULL AND dev_user_id IS NULL ORDER BY customer_id) TO '${psqlPath(runDir)}/auth-unlinked-customers.copy'`);
  }
  for (const t of importT) {
    for (const c of t.authRefs) {
      s.add(`SELECT '@@authref|${t.name}.${c}|kept|' || count(*) FILTER (WHERE s.${col(c)} IS NOT NULL AND EXISTS (SELECT 1 FROM _dev_auth a WHERE a.id = s.${col(c)})) || '|nulled|' || count(*) FILTER (WHERE s.${col(c)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM _dev_auth a WHERE a.id = s.${col(c)})) FROM ${stage(t.name)} s;`);
      const pkSel = t.pk.map((k) => `s.${col(k)}`).join(', ');
      s.add(`\\copy (SELECT ${pkSel}, s.${col(c)} FROM ${stage(t.name)} s WHERE s.${col(c)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM _dev_auth a WHERE a.id = s.${col(c)})) TO '${psqlPath(runDir)}/auth-attribution-${t.name}.${c}.copy'`);
    }
    for (const c of t.quarantined) {
      const pkSel = t.pk.map((k) => `s.${col(k)}`).join(', ');
      s.add(`SELECT '@@quarantined|${t.name}.${c}|' || count(s.${col(c)}) FROM ${stage(t.name)} s;`);
      s.add(`\\copy (SELECT ${pkSel}, s.${col(c)} FROM ${stage(t.name)} s WHERE s.${col(c)} IS NOT NULL) TO '${psqlPath(runDir)}/stripe-quarantine-${t.name}.${c}.copy'`);
    }
    for (const f of t.forced) s.add(`SELECT '@@forced|${t.name}.${f.column}|' || count(*) FILTER (WHERE s.${col(f.column)} IS DISTINCT FROM (${f.sql})) FROM ${stage(t.name)} s;`);
  }

  // ---- point of no return: still inside the transaction -------------------------------------------------------------
  const trg = disableTriggers(s, suppressed);
  deleteAll(s, plan);

  for (const t of importT) {
    const exprs = t.copied.map((c) => {
      if (t.deferred.includes(c)) return 'NULL';
      if (t.quarantined.includes(c)) return 'NULL';
      const forced = t.forced.find((f) => f.column === c);
      if (forced) return `(${forced.sql})`;
      if (t.authRefs.includes(c)) return `CASE WHEN s.${col(c)} IS NOT NULL AND EXISTS (SELECT 1 FROM _dev_auth a WHERE a.id = s.${col(c)}) THEN s.${col(c)} END`;
      if (t.ownerColumn === c) return 'm.dev_user_id';
      const co = t.coalesced.find((x) => x.column === c);
      if (co) return `COALESCE(s.${col(c)}, ${co.default})`;
      return `s.${col(c)}`;
    });
    const join = t.ownerColumn ? ` LEFT JOIN _cust_map m ON m.customer_id = s.id` : '';
    s.add(`INSERT INTO ${tbl(t.name)} (${colList(t.copied)})${t.overridingSystem ? ' OVERRIDING SYSTEM VALUE' : ''} SELECT ${exprs.join(', ')} FROM ${stage(t.name)} s${join};`);
  }
  for (const t of importT) fillDeferred(s, t, (n) => stage(n));
  restoreKept(s, plan, { useConditions: true });

  // ---- verify, still inside the transaction ------------------------------------------------------------------------
  for (const t of importT) {
    s.doBlock(`IF (SELECT count(*) FROM ${tbl(t.name)}) <> (SELECT count(*) FROM ${stage(t.name)}) THEN RAISE EXCEPTION 'COUNT_MISMATCH|${t.name}'; END IF;`);
    compareContent(s, t.name, t.compared, stage(t.name));
    for (const c of t.quarantined) s.doBlock(`IF EXISTS (SELECT 1 FROM ${tbl(t.name)} WHERE ${col(c)} IS NOT NULL) THEN RAISE EXCEPTION 'QUARANTINE_LEAK|${t.name}.${c}'; END IF;`);
    for (const f of t.forced) s.doBlock(`IF EXISTS (SELECT 1 FROM ${tbl(t.name)} WHERE ${col(f.column)} IS DISTINCT FROM (${f.sql})) THEN RAISE EXCEPTION 'FORCED_VALUE|${t.name}.${f.column}'; END IF;`);
    s.add(`SELECT '@@imported|${t.name}|' || count(*) FROM ${tbl(t.name)};`);
  }
  if (owner) {
    s.doBlock(`IF (SELECT count(*) FROM ${tbl('customers')} WHERE ${col(owner.ownerColumn)} IS NOT NULL) <> (SELECT count(*) FROM _cust_map WHERE dev_user_id IS NOT NULL) THEN RAISE EXCEPTION 'OWNER_MISMATCH'; END IF;`);
    s.doBlock(`IF EXISTS (SELECT 1 FROM ${tbl('customers')} c WHERE c.${col(owner.ownerColumn)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM _cust_map m WHERE m.customer_id = c.id AND m.dev_user_id = c.${col(owner.ownerColumn)})) THEN RAISE EXCEPTION 'OWNER_MISMATCH|a customer is linked to a login outside the proven mapping'; END IF;`);
  }
  for (const t of allReplaced.filter((n) => !stagedNames.has(n))) s.add(`SELECT '@@imported|${t}|0';`);
  trg.restore();
  fp.verify();
  // The exact state that is about to be committed: its fingerprints and one hash per row. A later restore compares the database with
  // this to see whether anything was created, changed or removed after the refresh.
  if (!rehearsal && afterDir) {
    const after = [...plan.tables.filter((t) => t.mode === 'import' || t.mode === 'delete-only').map((t) => ({ name: t.name, pk: t.pk })), ...plan.clearedWithOrders.map((c) => ({ name: c.table, pk: c.pk }))];
    for (const t of after) {
      s.add(`SELECT '@@afterfp|${t.name}|' || (${fingerprintExpr(t.name)});`);
      if (t.pk.length) s.add(`\\copy (SELECT ${colList(t.pk)}, md5(x::text) FROM ${tbl(t.name)} x ORDER BY 1) TO '${psqlPath(afterDir)}/${t.name}.hash'`);
    }
  }
  s.add(rehearsal ? `SELECT '@@end|rolled-back';\nROLLBACK;` : `SELECT '@@end|committing';\nCOMMIT;`);
  return s.toString();
}

// Sequences of the replaced tables are moved up to the data just loaded (setval is not transactional, so it runs after COMMIT and
// only ever raises a sequence).
export function buildSequenceScript(plan) {
  const s = new Script();
  for (const t of plan.tables.filter((x) => x.mode === 'import')) {
    for (const sq of t.serials || []) {
      s.add(`SELECT setval(${ql(sq.sequence)}::regclass, GREATEST((SELECT COALESCE(max(${col(sq.column)}), 1) FROM ${tbl(t.name)}), (SELECT last_value FROM ${sq.sequence})), true);`);
      s.add(`SELECT '@@sequence|${t.name}.${sq.column}|raised';`);
    }
  }
  return s.toString();
}

// ---------------------------------------------------------------------------------------------------------------------
// RESTORE (from the backup taken before an apply)
// ---------------------------------------------------------------------------------------------------------------------
export function buildRestoreScript({ plan, expectedDatabase, backupDir, backupFingerprints }) {
  const replaced = plan.tables.filter((t) => t.mode === 'import' || t.mode === 'delete-only');
  const replacedNames = replaced.map((t) => t.name);
  const cleared = plan.clearedWithOrders.map((c) => c.table);
  const preserved = [...new Set(plan.preservedChildren.map((p) => p.table))];
  const suppressed = [...new Set([...replacedNames, ...cleared, ...preserved])];
  const bname = (t) => qi(`_b_${t}`);
  const s = new Script();

  header(s, { expectedDatabase, tablesToLock: [...replacedNames, ...cleared, ...preserved] });
  const fp = untouchedFingerprints(s, [...replacedNames, ...cleared, ...CHURN_TABLES], maskJson(plan));

  for (const t of replaced) {
    s.add(`CREATE TEMP TABLE ${bname(t.name)} ON COMMIT DROP AS SELECT ${colList(t.devColumns)} FROM ${tbl(t.name)} WITH NO DATA;`);
    s.add(`\\copy ${bname(t.name)} (${colList(t.devColumns)}) FROM '${psqlPath(backupDir)}/${t.name}.copy'`);
  }
  for (const c of plan.clearedWithOrders) {
    s.add(`CREATE TEMP TABLE ${bname(c.table)} ON COMMIT DROP AS SELECT ${colList(c.columns)} FROM ${tbl(c.table)} WITH NO DATA;`);
    s.add(`\\copy ${bname(c.table)} (${colList(c.columns)}) FROM '${psqlPath(backupDir)}/${c.table}.copy'`);
  }
  // remembered references from the backup, in the same shape captureKept produces
  plan.preservedChildren.forEach((p, i) => {
    const pkSel = p.pk.map((k, j) => `${col(k)} AS pk${j}`).join(', ');
    s.add(`CREATE TEMP TABLE _keep_${i} ON COMMIT DROP AS SELECT ${pkSel}, ${col(p.column)} AS val FROM ${tbl(p.table)} WITH NO DATA;`);
    s.add(`\\copy _keep_${i} FROM '${psqlPath(backupDir)}/keep_${i}.copy'`);
  });
  // verify the backup file matches what the backup recorded
  for (const [t, fpv] of Object.entries(backupFingerprints || {})) {
    const n = Number(fpv.split(':')[0]);
    s.doBlock(`IF (SELECT count(*) FROM ${bname(t)}) <> ${n} THEN RAISE EXCEPTION 'BACKUP_COUNT|${t}|the backup file holds % rows, the manifest says ${n}', (SELECT count(*) FROM ${bname(t)}); END IF;`);
  }

  const trg = disableTriggers(s, suppressed);
  deleteAll(s, plan, { clearedFirst: false });
  for (const t of replaced) {
    s.add(`INSERT INTO ${tbl(t.name)} (${colList(t.devColumns)})${t.overridingSystem ? ' OVERRIDING SYSTEM VALUE' : ''} SELECT ${t.devColumns.map((c) => ((t.deferred || []).includes(c) ? 'NULL' : `s.${col(c)}`)).join(', ')} FROM ${bname(t.name)} s;`);
  }
  for (const t of replaced) fillDeferred(s, { ...t, deferred: t.deferred || [] }, (n) => bname(n));
  for (const c of plan.clearedWithOrders) s.add(`INSERT INTO ${tbl(c.table)} (${colList(c.columns)}) SELECT ${colList(c.columns)} FROM ${bname(c.table)};`);
  // kept references need typed comparison: cast through the real column types
  plan.preservedChildren.forEach((p, i) => {
    const pkMatch = p.pk.map((k, j) => `c.${col(k)} = k.pk${j}`).join(' AND ');
    s.add(`WITH u AS (UPDATE ${tbl(p.table)} c SET ${col(p.column)} = k.val FROM _keep_${i} k WHERE ${pkMatch} AND c.${col(p.column)} IS NULL RETURNING 1) SELECT '@@restored|${p.table}.${p.column}|' || count(*) FROM u;`);
  });

  for (const t of replaced) {
    s.doBlock(`IF (SELECT count(*) FROM ${tbl(t.name)}) <> (SELECT count(*) FROM ${bname(t.name)}) THEN RAISE EXCEPTION 'COUNT_MISMATCH|${t.name}'; END IF;`);
    compareContent(s, t.name, t.devColumns, bname(t.name));
    s.add(`SELECT '@@restored_table|${t.name}|' || count(*) FROM ${tbl(t.name)};`);
  }
  for (const c of plan.clearedWithOrders) s.add(`SELECT '@@restored_table|${c.table}|' || count(*) FROM ${tbl(c.table)};`);
  trg.restore();
  fp.verify();
  s.add(`SELECT '@@end|committing';`, 'COMMIT;');
  return s.toString();
}
