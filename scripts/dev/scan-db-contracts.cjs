// Static contract scanner: finds supabase-js calls in src/ and supabase/functions/ whose table, column, embed, RPC name or RPC argument does not
// exist in the live catalog of a replayed scratch database. It reads code with the TypeScript parser (never executes it) and is deliberately
// conservative: anything it cannot resolve to literals (a variable table name, a template with expressions, a chain split over statements,
// an `.or()` filter string) is reported as UNPARSED instead of being guessed.
//
//   node scripts/dev/scan-db-contracts.cjs [--db bpc_replay_full] [--json out.json] [--include-tests]
//
// Checked: .from('t') tables; .select('cols, alias:col, embed(cols), embed!hint(cols)') columns and embeds (an embed needs a foreign key between the two
// tables in either direction, or a matching constraint/column hint); .insert/.upsert/.update object keys (and, for .insert, required columns with no
// default); .eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/.in/.contains/.not/.order/.filter/.match column names; .rpc('fn', {args}) names, argument
// names and required arguments. Loopback scratch databases named bpc_replay_* only.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DB = get('--db', 'bpc_replay_full');
const JSON_OUT = get('--json', null);
const INCLUDE_TESTS = argv.includes('--include-tests');
const HOST = process.env.PGHOST || '127.0.0.1';
const PORT = process.env.PGPORT || '54339';
const PSQL = process.env.CORE_DB_PSQL || (fs.existsSync('C:/Program Files/PostgreSQL/18/bin/psql.exe') ? 'C:/Program Files/PostgreSQL/18/bin/psql.exe' : 'psql');
if (!/^bpc_replay_[a-z0-9_]{1,32}$/.test(DB)) throw new Error('refusing: database name must match bpc_replay_*');
if (!/^(127\.0\.0\.1|localhost|::1)$/.test(HOST)) throw new Error('refusing: loopback servers only');

function q(sql) {
  const r = spawnSync(PSQL, ['-h', HOST, '-p', PORT, '-U', 'postgres', '-d', DB, '-X', '-q', '-w', '-At'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim());
}

// ---- catalog ----------------------------------------------------------------------------------------------------------------------------
const rel = q(`select coalesce(json_agg(json_build_object('name', c.relname, 'cols', (select json_agg(json_build_object('name', a.attname, 'notnull', a.attnotnull, 'hasdef', a.atthasdef, 'identity', a.attidentity, 'generated', a.attgenerated) order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))), '[]'::json)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m')`);
const fks = q(`select coalesce(json_agg(json_build_object('table', c.relname, 'name', k.conname, 'cols', (select json_agg(a.attname) from unnest(k.conkey) x(n) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.n), 'ref', rc.relname)), '[]'::json)
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class rc on rc.oid = k.confrelid join pg_namespace n on n.oid = c.relnamespace where k.contype = 'f' and n.nspname = 'public'`);
const fns = q(`select coalesce(json_agg(json_build_object('name', p.proname, 'args', coalesce((select json_agg(json_build_object('name', an, 'mode', am, 'idx', i) order by i) from (select unnest(coalesce(p.proargnames, array[]::text[])) an, unnest(coalesce(p.proargmodes, array_fill('i'::"char", array[coalesce(array_length(p.proargnames, 1), 0)]))) am, generate_series(1, coalesce(array_length(p.proargnames, 1), 0)) i) s), '[]'::json), 'nin', p.pronargs, 'ndef', p.pronargdefaults)), '[]'::json)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`);
const T = new Map(rel.map((r) => [r.name, new Map(r.cols.map((c) => [c.name, c]))]));
const FKS = fks;
const FN = new Map();
for (const f of fns) (FN.get(f.name) || FN.set(f.name, []).get(f.name)).push(f);
const hasRel = (a, b) => FKS.some((k) => (k.table === a && k.ref === b) || (k.table === b && k.ref === a));
const hintOk = (a, b, hint) => FKS.some((k) => ((k.table === a && k.ref === b) || (k.table === b && k.ref === a)) && (k.name === hint || (k.cols || []).includes(hint))) || (T.get(a) && T.get(a).has(hint)) || (T.get(b) && T.get(b).has(hint));

// ---- source files -----------------------------------------------------------------------------------------------------------------------
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (!['node_modules', '.SyncDevDataFromProd'].includes(e.name)) walk(p); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/database\.types\.ts$/.test(e.name) && (INCLUDE_TESTS || !/\.test\.ts$|[\\/]tests[\\/]/.test(p))) files.push(p);
  }
})('src');
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else if (/\.ts$/.test(e.name) && (INCLUDE_TESTS || !/\.test\.ts$/.test(e.name))) files.push(p);
  }
})('supabase/functions');

const EXTRA = get('--extra', null);
if (EXTRA) { files.length = 0; files.push(EXTRA); }
// exported string constants (e.g. a shared SELECT list) resolved by name when the name is unique
const GLOBAL_STR = new Map();
(function collect() {
  const dup = new Set();
  for (const f of files) {
    let sf;
    try { sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.ES2020, true); } catch { continue; }
    for (const st of sf.statements) {
      if (ts.isVariableStatement(st) && st.modifiers && st.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer))) {
            if (GLOBAL_STR.has(d.name.text)) dup.add(d.name.text); else GLOBAL_STR.set(d.name.text, d.initializer.text);
          }
        }
      }
    }
  }
  for (const d of dup) GLOBAL_STR.delete(d);
})();
const violations = [];
const unparsed = [];
let callsChecked = 0;
const viol = (file, line, severity, kind, call, detail) => violations.push({ file, line, severity, kind, call, detail });
const unp = (file, line, why, call) => unparsed.push({ file, line, why, call });

const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'not', 'order', 'filter', 'textSearch', 'overlaps', 'range']);

let LOCAL = { str: new Map(), obj: new Map() };
function litString(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return LOCAL.str.has(node.text) ? LOCAL.str.get(node.text) : GLOBAL_STR.has(node.text) ? GLOBAL_STR.get(node.text) : null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return litString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) { const l = litString(node.left), r = litString(node.right); return l !== null && r !== null ? l + r : null; }
  if (ts.isTemplateExpression(node)) { let out = node.head.text; for (const sp of node.templateSpans) { const v = litString(sp.expression); if (v === null) return null; out += v + sp.literal.text; } return out; }
  return null;
}
function resolveObject(node) {
  if (node && ts.isObjectLiteralExpression(node)) return node;
  if (node && ts.isIdentifier(node) && LOCAL.obj.has(node.text)) return LOCAL.obj.get(node.text);
  if (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))) return resolveObject(node.expression);
  return null;
}

// select grammar -> [{ kind: 'col'|'embed', name, hint, children }]
function parseSelect(str) {
  let i = 0;
  const s = str;
  function items(depth) {
    const out = [];
    while (i < s.length) {
      while (i < s.length && /[\s,]/.test(s[i])) i++;
      if (i >= s.length || s[i] === ')') break;
      let tok = '';
      while (i < s.length && !/[,()]/.test(s[i])) tok += s[i++];
      tok = tok.trim();
      if (s[i] === '(') {
        i++;
        const children = items(depth + 1);
        if (s[i] === ')') i++;
        let name = tok;
        let alias = null;
        const am = /^([^:!]+):(.+)$/.exec(name);
        if (am) { alias = am[1]; name = am[2]; }
        const [base, ...mods] = name.split('!');
        out.push({ kind: 'embed', name: base.trim(), hint: mods.find((m) => m !== 'inner' && m !== 'left') || null, inner: mods.includes('inner'), alias, children });
      } else if (tok) {
        let name = tok.replace(/::[a-z0-9_\[\]]+$/i, '');
        const am = /^([^:]+):(.+)$/.exec(name);
        if (am) name = am[2];
        if (name.includes('->')) name = name.split('->')[0];
        out.push({ kind: 'col', name: name.trim() });
      }
    }
    return out;
  }
  return items(0);
}

function checkSelect(file, line, table, nodes, call, parentLabel) {
  const cols = T.get(table);
  for (const n of nodes) {
    if (n.kind === 'col') {
      if (n.name === '*' || n.name === 'count') continue;
      if (!cols.has(n.name)) viol(file, line, 'high', 'nonexistent column in select', call, `${table}.${n.name} does not exist${parentLabel ? ` (via ${parentLabel})` : ''}`);
    } else {
      // an embed may name a table, or a foreign-key column / constraint
      let target = n.name;
      if (!T.has(target)) {
        const fk = FKS.find((k) => k.table === table && (k.name === n.name || (k.cols || []).includes(n.name)));
        const rev = FKS.find((k) => k.ref === table && k.name === n.name);
        target = fk ? fk.ref : rev ? rev.table : null;
      }
      if (!target) { viol(file, line, 'high', 'nonexistent embed', call, `${table} -> ${n.name}: no such table, constraint or foreign-key column`); continue; }
      if (!hasRel(table, target)) { viol(file, line, 'high', 'embed without foreign key', call, `${table} -> ${target}: no foreign key in either direction`); continue; }
      if (n.hint && !hintOk(table, target, n.hint)) viol(file, line, 'medium', 'embed hint matches nothing', call, `${table} -> ${target}!${n.hint}`);
      checkSelect(file, line, target, n.children, call, `${parentLabel ? parentLabel + ' > ' : ''}${table}->${target}`);
    }
  }
}

function objectKeys(node) {
  // returns { keys: [...], hasSpread, computed }
  const keys = [];
  let hasSpread = false, computed = false;
  for (const p of node.properties) {
    if (ts.isSpreadAssignment(p)) { hasSpread = true; continue; }
    if (ts.isShorthandPropertyAssignment(p)) { keys.push(p.name.text); continue; }
    if (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) {
      const n = p.name;
      if (ts.isIdentifier(n) || ts.isStringLiteral(n)) keys.push(n.text);
      else computed = true;
    }
  }
  return { keys, hasSpread, computed };
}

function processFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const handled = new Set();
  LOCAL = { str: new Map(), obj: new Map() };
  (function locals(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const)) {
      const init = n.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) LOCAL.str.set(n.name.text, init.text);
      else if (ts.isObjectLiteralExpression(init)) LOCAL.obj.set(n.name.text, init);
    }
    ts.forEachChild(n, locals);
  })(sf);

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === 'rpc') {
        const recv = node.expression.expression.getText(sf);
        const arg0 = node.arguments[0];
        if (arg0 && !/\bstorage\b|^Array$|^Object$/.test(recv)) {
          const name = litString(arg0);
          const line = lineOf(node);
          if (name === null) unp(file, line, 'rpc name is not a literal', node.getText(sf).slice(0, 100));
          else {
            callsChecked++;
            const defs = FN.get(name);
            if (!defs) viol(file, line, 'high', 'nonexistent rpc', `rpc('${name}')`, `function ${name} does not exist in the public schema`);
            else if (node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
              const { keys, hasSpread, computed } = objectKeys(node.arguments[1]);
              const ok = defs.some((d) => {
                const inNames = d.args.filter((a) => a.mode === 'i' || a.mode === 'b' || a.mode === 'v').map((a) => a.name);
                const required = inNames.slice(0, Math.max(0, inNames.length - d.ndef));
                return keys.every((k) => inNames.includes(k)) && (hasSpread || computed || required.every((r) => keys.includes(r)));
              });
              if (!ok) {
                const sigs = defs.map((d) => '(' + d.args.filter((a) => a.mode === 'i' || a.mode === 'b' || a.mode === 'v').map((a) => a.name).join(', ') + ')').join(' | ');
                viol(file, line, 'high', 'rpc arguments do not match', `rpc('${name}', { ${keys.join(', ')}${hasSpread ? ', ...' : ''} })`, `database signature ${name}${sigs}`);
              }
            } else if (!node.arguments[1]) {
              const ok = defs.some((d) => d.nin - d.ndef <= 0);
              if (!ok) viol(file, line, 'medium', 'rpc called without required arguments', `rpc('${name}')`, `every overload has required arguments`);
            }
          }
        }
      }
      // find a chain rooted at .from(...) and process it once (at its outermost call)
      if (!handled.has(node)) {
        const chain = [];
        let cur = node;
        while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
          chain.unshift({ method: cur.expression.name.text, call: cur });
          handled.add(cur);
          cur = cur.expression.expression;
          // look through `await` / parentheses / non-null / `as` wrappers
          while (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur) || ts.isAwaitExpression(cur)) cur = cur.expression;
        }
        const first = chain[0];
        if (first && first.method === 'from') {
          const recvText = first.call.expression.expression.getText(sf);
          if (!/storage|^Array$|^Object$|^Buffer$|^Uint8Array$|^Promise$/.test(recvText)) processChain(file, sf, chain, lineOf);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function processChain(file, sf, chain, lineOf) {
  const fromCall = chain[0].call;
  const line = lineOf(fromCall);
  const arg0 = fromCall.arguments[0];
  const table = litString(arg0);
  const callText = chain.map((c) => `.${c.method}(${c.call.arguments.map((a) => a.getText(sf)).join(', ').slice(0, 60)})`).join('').slice(0, 160);
  if (table === null) { unp(file, line, 'table name is not a literal', callText); return; }
  callsChecked++;
  if (!T.has(table)) { viol(file, line, 'high', 'nonexistent table', `from('${table}')`, `public.${table} does not exist in the replayed schema`); return; }
  const cols = T.get(table);
  const embedTables = new Set([table]);
  for (let ci = 1; ci < chain.length; ci++) {
    const { method, call } = chain[ci];
    const ln = lineOf(call);
    const a0 = call.arguments[0];
    if (method === 'select') {
      const s = litString(a0);
      if (a0 === undefined) continue;
      if (s === null) { unp(file, ln, 'select columns are not a literal string', callText); continue; }
      const nodes = parseSelect(s);
      checkSelect(file, ln, table, nodes, callText, '');
      const gather = (ns) => ns.forEach((n) => { if (n.kind === 'embed') { embedTables.add(n.name); embedTables.add(n.alias || n.name); gather(n.children); } });
      gather(nodes);
    } else if (method === 'insert' || method === 'upsert' || method === 'update') {
      if (!a0) continue;
      const rows = ts.isArrayLiteralExpression(a0) ? a0.elements : [a0];
      for (const row of rows) {
        const obj = resolveObject(row);
        if (!obj) { unp(file, ln, `${method} payload is not an object literal`, callText); continue; }
        const { keys, hasSpread, computed } = objectKeys(obj);
        for (const k of keys) if (!cols.has(k)) viol(file, ln, 'high', `nonexistent column in ${method}`, callText, `${table}.${k} does not exist`);
        if (method === 'insert' && !hasSpread && !computed) {
          const missing = [...cols.values()].filter((c) => c.notnull && !c.hasdef && !c.identity && !c.generated && !keys.includes(c.name)).map((c) => c.name);
          if (missing.length) viol(file, ln, 'medium', 'insert omits required columns', callText, `${table}: NOT NULL without default: ${missing.join(', ')}`);
        }
      }
    } else if (FILTERS.has(method)) {
      const colName = litString(a0);
      if (a0 === undefined) continue;
      if (colName === null) { unp(file, ln, `${method} column is not a literal`, callText); continue; }
      if (method === 'filter' || method === 'not' || FILTERS.has(method)) {
        // order('a, b') names several columns in one literal (PostgREST accepts the comma list)
        const parts = method === 'order' ? colName.split(',').map((x) => x.trim().split(/s+/)[0]) : [colName];
        if (parts.length > 1) { for (const pc of parts) if (!cols.has(pc.split('->')[0])) viol(file, ln, 'high', 'nonexistent column in order', callText, table + '.' + pc + ' does not exist'); continue; }
        const base = colName.split('->')[0];
        if (base.includes('.')) {
          const [emb, col] = base.split('.');
          // embedded filter: validate only when the embed resolves to a known table
          if (T.has(emb) && !T.get(emb).has(col)) viol(file, ln, 'high', `nonexistent column in ${method}`, callText, `${emb}.${col} does not exist`);
          else if (!T.has(emb)) unp(file, ln, `embedded filter on alias "${emb}"`, callText);
        } else if (!cols.has(base)) viol(file, ln, 'high', `nonexistent column in ${method}`, callText, `${table}.${base} does not exist`);
      }
    } else if (method === 'or' || method === 'match') {
      if (method === 'match' && a0 && ts.isObjectLiteralExpression(a0)) {
        for (const k of objectKeys(a0).keys) if (!cols.has(k)) viol(file, ln, 'high', 'nonexistent column in match', callText, `${table}.${k} does not exist`);
      } else unp(file, ln, `${method} filter string is not validated`, callText);
    }
  }
}

for (const f of files) {
  try { processFile(f); } catch (e) { unp(f, 0, `parse error: ${e.message}`, ''); }
}

// de-duplicate identical findings
const seen = new Set();
const uniq = violations.filter((v) => { const k = `${v.file}:${v.line}:${v.kind}:${v.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
const bySev = {};
for (const v of uniq) bySev[v.severity] = (bySev[v.severity] || 0) + 1;
const out = { db: DB, files: files.length, callsChecked, violations: uniq, unparsed, counts: { violations: uniq.length, bySeverity: bySev, unparsed: unparsed.length } };
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
console.log(`files ${files.length}, calls checked ${callsChecked}, violations ${uniq.length} (${JSON.stringify(bySev)}), unparsed ${unparsed.length}`);
for (const v of uniq) console.log(`${v.severity.toUpperCase().padEnd(6)} ${v.file}:${v.line}  ${v.kind}: ${v.detail}`);
