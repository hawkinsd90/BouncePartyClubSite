// Structured inventory of EVERY difference between two Supabase-style `Database` type files (the committed hand-maintained one and the one
// generated from the replayed database), resolved with the TypeScript type checker so derived forms (Omit<>, Partial<>, Pick<>) are compared by
// their real shape, not their text.
//
//   node scripts/dev/types-inventory.cjs --old <file> --new <file> [--json out.json] [--md out.md]
//
// For every discrepancy it records the object, both definitions, the application files that reference it (a conservative text search for
// .from('table') / .rpc('fn') and the column name near the table), the kind of operation seen, a risk area and a proposed correction.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OLD = path.resolve(get('--old', 'C:/Users/vikki/qg/database.types.committed.ts'));
const NEW = path.resolve(get('--new', 'src/lib/database.types.ts'));
const JSON_OUT = get('--json', null);
const MD_OUT = get('--md', null);
const SCAN = get('--scan', null);
// precise findings from scan-db-contracts.cjs (authoritative for supabase-js call sites); the word search below only finds CANDIDATES
const SCANV = SCAN && fs.existsSync(SCAN) ? JSON.parse(fs.readFileSync(SCAN, 'utf8')).violations : [];
const scanHit = (obj) => SCANV.filter((v) => v.detail.includes(obj));

function load(file) {
  const program = ts.createProgram([file], { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file);
  const mod = checker.getSymbolAtLocation(sf);
  const db = checker.getExportsOfModule(mod).find((s) => s.name === 'Database');
  const dbType = checker.getDeclaredTypeOfSymbol(db);
  const prop = (t, n) => { const p = checker.getPropertyOfType(t, n); return p ? checker.getTypeOfSymbolAtLocation(p, sf) : null; };
  const pub = prop(dbType, 'public');
  const out = { tables: {}, functions: {}, enums: [] };
  const members = (t, fn) => { for (const p of checker.getPropertiesOfType(t)) fn(p.name, checker.getTypeOfSymbolAtLocation(p, sf), p); };
  const tables = prop(pub, 'Tables');
  members(tables, (name, tt) => {
    const t = { row: {}, insert: {}, update: {}, rels: [] };
    for (const part of ['Row', 'Insert', 'Update']) {
      const pt = prop(tt, part);
      if (!pt) continue;
      members(pt, (cn, ct, sym) => {
        const optional = (sym.flags & ts.SymbolFlags.Optional) !== 0;
        const nn = checker.getNonNullableType(ct);
        const text = checker.typeToString(ct, undefined, ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope).replace(/\s+/g, ' ');
        t[part.toLowerCase()][cn] = { optional, type: text, nullable: ct.isUnion() && ct.types.some((x) => (x.flags & ts.TypeFlags.Null) !== 0), base: checker.typeToString(nn).replace(/\s+/g, ' ') };
      });
    }
    const rels = prop(tt, 'Relationships');
    if (rels) {
      const txt = checker.typeToString(rels, undefined, ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
      const re = /foreignKeyName: "([^"]+)"/g;
      let m;
      while ((m = re.exec(txt))) t.rels.push(m[1]);
    }
    out.tables[name] = t;
  });
  const fns = prop(pub, 'Functions');
  members(fns, (name, ft) => {
    const variants = ft.isUnion() ? ft.types : [ft];
    out.functions[name] = variants.map((v) => {
      const args = prop(v, 'Args');
      const ret = prop(v, 'Returns');
      const a = {};
      if (args) members(args, (an, at, sym) => { a[an] = ((sym.flags & ts.SymbolFlags.Optional) ? '?' : '') + checker.typeToString(at, undefined, ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope).replace(/\s+/g, ' '); });
      return { args: a, returns: ret ? checker.typeToString(ret, undefined, ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope).replace(/\s+/g, ' ').slice(0, 400) : 'unknown' };
    });
  });
  const enums = prop(pub, 'Enums');
  if (enums) members(enums, (n) => out.enums.push(n));
  return out;
}

// ---- application references -----------------------------------------------------------------------------------------------------------
const SRC_FILES = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/database\.types\.ts$/.test(e.name)) SRC_FILES.push(p);
  }
})('src');
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else if (/\.ts$/.test(e.name)) SRC_FILES.push(p);
  }
})('supabase/functions');
const TEXT = new Map(SRC_FILES.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const isTest = (f) => /\.test\.ts$|\/tests\//.test(f);

function refsTable(table) {
  const re = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]`);
  const out = [];
  for (const [f, t] of TEXT) {
    if (isTest(f)) continue;
    const m = re.exec(t);
    if (!m) continue;
    const ops = new Set();
    const lines = t.split('\n');
    lines.forEach((l, i) => {
      if (!re.test(l)) return;
      const chain = lines.slice(i, i + 12).join(' ');
      if (/\.insert\(/.test(chain)) ops.add('insert');
      if (/\.update\(/.test(chain)) ops.add('update');
      if (/\.upsert\(/.test(chain)) ops.add('upsert');
      if (/\.delete\(/.test(chain)) ops.add('delete');
      if (/\.select\(/.test(chain)) ops.add('read');
    });
    out.push({ file: f, ops: [...ops] });
  }
  return out;
}
function refsFn(name) {
  const re = new RegExp(`\\.rpc\\(\\s*['"\`]${name}['"\`]`);
  return [...TEXT].filter(([f, t]) => !isTest(f) && re.test(t)).map(([f]) => ({ file: f, ops: ['rpc'] }));
}
function refsColumn(table, col) {
  const tr = refsTable(table);
  const re = new RegExp(`\\b${col}\\b`);
  return tr.filter((r) => re.test(TEXT.get(r.file)));
}

const AREAS = [
  [/payment|refund|invoice|receipt|stripe|webhook/, 'payments'],
  [/pricing|fee|discount|tax|travel/, 'pricing'],
  [/order|booking|customer|address|checkout|quote/, 'booking / orders'],
  [/portal|signature|waiver|consent|link/, 'customer portal / consent'],
  [/unit|inventory|product|bundle|media|catalog|blackout/, 'inventory / Event Essentials'],
  [/task|mileage|crew|route|evidence|location/, 'tasks / Crew'],
  [/sms|email|notification|message|template/, 'messaging'],
  [/role|permission|admin|setting|changelog|audit|analytics/, 'admin / security'],
];
const area = (n) => (AREAS.find(([re]) => re.test(n)) || [null, 'other'])[1];

// ---- diff ------------------------------------------------------------------------------------------------------------------------------
const oldT = load(OLD);
const newT = load(NEW);
const items = [];
const add = (i) => items.push({ id: items.length + 1, ...i });

for (const t of Object.keys(newT.tables)) {
  if (!oldT.tables[t]) {
    const refs = refsTable(t);
    add({ kind: 'table added to types', object: t, db: `${Object.keys(newT.tables[t].row).length} columns`, ts: 'absent', refs, area: area(t), runtimeImpact: refs.length ? 'code queries it through an untyped path' : 'none (not queried by application code)', proposal: 'take the generated definition', risk: refs.length ? 'low' : 'none', tests: 'tsc', klass: 'Confirmed type drift' });
  }
}
for (const t of Object.keys(oldT.tables)) {
  if (!newT.tables[t]) {
    const refs = refsTable(t);
    add({ kind: 'table in types only', object: t, db: 'absent from the replayed schema', ts: `${Object.keys(oldT.tables[t].row).length} columns`, refs, area: area(t), runtimeImpact: refs.length ? 'application code queries a table that does not exist in the replayed schema: the query fails at runtime' : 'none (nothing queries it)', proposal: refs.length ? 'remove or repair the code, confirm the missing object really is missing on hosted Dev/Production' : 'drop the stale definition', risk: refs.length ? 'high' : 'none', tests: refs.length ? 'executed handler/DB test of the corrected query' : 'tsc', klass: refs.length ? 'Confirmed application-database contract defect' : 'Confirmed type drift' });
  }
}
for (const t of Object.keys(newT.tables)) {
  const o = oldT.tables[t];
  if (!o) continue;
  const n = newT.tables[t];
  for (const c of new Set([...Object.keys(n.row), ...Object.keys(o.row)])) {
    const a = o.row[c], b = n.row[c];
    if (!a && b) {
      const refs = refsColumn(t, c);
      add({ kind: 'column added to types', object: `${t}.${c}`, db: b.type, ts: 'absent', refs, area: area(t), runtimeImpact: refs.length ? 'code reads/writes it with hand-declared or cast types' : 'none', proposal: 'take the generated definition', risk: refs.length ? 'low' : 'none', tests: 'tsc', klass: 'Confirmed type drift' });
    } else if (a && !b) {
      const refs = refsColumn(t, c);
      add({ kind: 'column in types only', object: `${t}.${c}`, db: 'absent from the replayed schema', ts: a.type, refs, area: area(t), runtimeImpact: refs.length ? 'code mentions it: a select/insert naming it fails at runtime, a read is always undefined' : 'none', proposal: refs.length ? 'verify each reference; repair the code, never add the column to satisfy the type' : 'drop the stale definition', risk: refs.length ? 'medium' : 'none', tests: refs.length ? 'executed query test' : 'tsc', klass: refs.length ? 'Confirmed application-database contract defect' : 'Confirmed type drift' });
    } else if (a && b && a.type !== b.type) {
      const nullChange = a.nullable !== b.nullable;
      const refs = refsColumn(t, c);
      add({ kind: nullChange ? 'nullability changed' : 'type changed', object: `${t}.${c}`, db: b.type, ts: a.type, refs, area: area(t), runtimeImpact: nullChange ? (b.nullable ? 'the column can be null: readers must handle null (previously typed non-null)' : 'the column is NOT NULL (previously typed nullable)') : 'value type differs', proposal: 'adopt the generated type and handle null explicitly', risk: refs.length ? 'low' : 'none', tests: 'tsc plus a behavior test where null reaches logic', klass: 'Confirmed type drift' });
    }
  }
  for (const c of Object.keys(n.insert)) {
    const a = o.insert[c], b = n.insert[c];
    if (a && b && a.optional !== b.optional) add({ kind: 'Insert required-ness changed', object: `${t}.${c}`, db: b.optional ? 'optional (default or nullable)' : 'REQUIRED on insert', ts: a.optional ? 'optional' : 'required', refs: refsTable(t).filter((r) => r.ops.some((x) => x === 'insert' || x === 'upsert')), area: area(t), runtimeImpact: b.optional ? 'none' : 'inserts that omit it are rejected by the database today', proposal: b.optional ? 'adopt' : 'supply the value (do not invent a placeholder) or use the intended RPC', risk: b.optional ? 'none' : 'medium', tests: 'tsc plus an executed insert where required', klass: 'Confirmed type drift' });
  }
  const oldRel = new Set(o.rels), newRel = new Set(n.rels);
  for (const r of newRel) if (!oldRel.has(r)) add({ kind: 'relationship added', object: `${t}: ${r}`, db: r, ts: 'absent', refs: [], area: area(t), runtimeImpact: 'embeds through this foreign key become typed', proposal: 'adopt', risk: 'low', tests: 'tsc', klass: 'Confirmed type drift' });
  for (const r of oldRel) if (!newRel.has(r)) add({ kind: 'relationship in types only', object: `${t}: ${r}`, db: 'absent', ts: r, refs: [], area: area(t), runtimeImpact: 'a typed embed that the database cannot resolve', proposal: 'drop', risk: 'low', tests: 'tsc', klass: 'Confirmed type drift' });
}
for (const f of Object.keys(newT.functions)) {
  if (!oldT.functions[f]) { const refs = refsFn(f); add({ kind: 'function added to types', object: f, db: JSON.stringify(newT.functions[f]).slice(0, 300), ts: 'absent', refs, area: area(f), runtimeImpact: refs.length ? 'called through an untyped path' : 'none', proposal: 'take the generated definition', risk: refs.length ? 'low' : 'none', tests: 'tsc', klass: f === 'update_pricing_rules' ? 'Potential hosted-schema difference' : 'Confirmed type drift' }); continue; }
  const a = JSON.stringify(oldT.functions[f]), b = JSON.stringify(newT.functions[f]);
  if (a !== b) { const refs = refsFn(f); add({ kind: 'function signature changed', object: f, db: b.slice(0, 400), ts: a.slice(0, 400), refs, area: area(f), runtimeImpact: refs.length ? 'callers are checked against the real argument names/types' : 'none', proposal: 'adopt; fix callers against the real signature', risk: refs.length ? 'medium' : 'none', tests: 'executed RPC call with the corrected arguments', klass: 'Confirmed type drift' }); }
}
for (const f of Object.keys(oldT.functions)) {
  if (!newT.functions[f]) { const refs = refsFn(f); add({ kind: 'function in types only', object: f, db: 'absent from the replayed schema', ts: JSON.stringify(oldT.functions[f]).slice(0, 300), refs, area: area(f), runtimeImpact: refs.length ? 'application calls an RPC that does not exist in the replayed schema' : 'none', proposal: refs.length ? 'repair the caller or confirm the function exists on hosted' : 'drop the stale definition', risk: refs.length ? 'high' : 'none', tests: refs.length ? 'executed handler test' : 'tsc', klass: refs.length ? 'Confirmed application-database contract defect' : 'Confirmed type drift' }); }
}

for (const i of items) {
  if (i.kind === 'column in types only' || i.kind === 'table in types only') {
    const hits = scanHit(i.kind === 'table in types only' ? `public.${i.object}` : i.object);
    i.scanner = hits.map((h) => `${h.file}:${h.line}`);
    if (hits.length) { i.klass = 'Confirmed application-database contract defect'; i.risk = 'high'; }
    else if (i.klass === 'Confirmed application-database contract defect') { i.klass = 'Confirmed type drift'; i.runtimeImpact += ' [word-search candidate only: the contract scanner finds no supabase-js call using it; derived-object reads, if any, are reviewed separately]'; i.risk = 'low'; }
  }
}
const counts = {};
for (const i of items) { counts[i.kind] = (counts[i.kind] || 0) + 1; }
const byClass = {};
for (const i of items) { byClass[i.klass] = (byClass[i.klass] || 0) + 1; }
const result = { generatedAt: new Date().toISOString(), old: OLD, new: NEW, tablesOld: Object.keys(oldT.tables).length, tablesNew: Object.keys(newT.tables).length, functionsOld: Object.keys(oldT.functions).length, functionsNew: Object.keys(newT.functions).length, counts, byClass, total: items.length, items };
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 1));
const md = [];
md.push(`Tables: ${result.tablesOld} -> ${result.tablesNew}; functions: ${result.functionsOld} -> ${result.functionsNew}; discrepancies: ${items.length}`);
md.push('', '| Kind | Count |', '|---|---|');
for (const [k, v] of Object.entries(counts).sort((x, y) => y[1] - x[1])) md.push(`| ${k} | ${v} |`);
md.push('', '| Classification | Count |', '|---|---|');
for (const [k, v] of Object.entries(byClass)) md.push(`| ${k} | ${v} |`);
if (MD_OUT) fs.writeFileSync(MD_OUT, md.join('\n'));
console.log(md.join('\n'));
