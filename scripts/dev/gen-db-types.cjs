// Generates a Supabase-format TypeScript definition of the `public` schema from a LOCAL replayed scratch database (no Docker, no Supabase
// project, no network). It emits what `supabase gen types typescript` emits: Tables { Row, Insert, Update, Relationships }, Views, Functions
// { Args, Returns }, Enums and CompositeTypes, plus the existing `Json` type, so src/lib/database.types.ts can be reconciled against the
// verified schema instead of hand-edited.
//
//   node scripts/dev/gen-db-types.cjs --db bpc_replay_full --out <file>      (defaults: db bpc_replay_full, stdout)
//
// The database must be one of the replay scratch databases (name bpc_replay_*) on a loopback server: the same rule the replay tool enforces.
const { spawnSync } = require('child_process');
const fs = require('fs');

const argv = process.argv.slice(2);
const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DB = get('--db', 'bpc_replay_full');
const OUT = get('--out', null);
const HOST = process.env.PGHOST || '127.0.0.1';
const PORT = process.env.PGPORT || '54339';
const PSQL = process.env.CORE_DB_PSQL || (fs.existsSync('C:/Program Files/PostgreSQL/18/bin/psql.exe') ? 'C:/Program Files/PostgreSQL/18/bin/psql.exe' : 'psql');
if (!/^bpc_replay_[a-z0-9_]{1,32}$/.test(DB)) throw new Error('refusing: database name must match bpc_replay_*');
if (!/^(127\.0\.0\.1|localhost|::1)$/.test(HOST)) throw new Error('refusing: loopback servers only');

function q(sql) {
  const r = spawnSync(PSQL, ['-h', HOST, '-p', PORT, '-U', 'postgres', '-d', DB, '-X', '-q', '-w', '-At'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim() || 'null');
}

const types = q(`
select coalesce(json_agg(json_build_object('oid', t.oid::int, 'name', t.typname, 'type', t.typtype, 'cat', t.typcategory, 'elem', t.typelem::int, 'base', t.typbasetype::int, 'schema', n.nspname)), '[]'::json)
from pg_type t join pg_namespace n on n.oid = t.typnamespace`);
const typeByOid = new Map(types.map((t) => [t.oid, t]));

const enums = q(`
select coalesce(json_agg(json_build_object('name', t.typname, 'values', (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)) order by t.typname), '[]'::json)
from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e'`);
const enumNames = new Set(enums.map((e) => e.name));

const rels = q(`
select coalesce(json_agg(json_build_object('table', c.relname, 'rel', k.conname, 'cols', (select json_agg(a.attname order by x.ord) from unnest(k.conkey) with ordinality x(attnum, ord) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.attnum),
  'ref', rc.relname, 'refcols', (select json_agg(a.attname order by x.ord) from unnest(k.confkey) with ordinality x(attnum, ord) join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.attnum),
  'unique', exists (select 1 from pg_constraint u where u.conrelid = k.conrelid and u.contype in ('p','u') and u.conkey = k.conkey)) order by c.relname, k.conname), '[]'::json)
from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class rc on rc.oid = k.confrelid join pg_namespace n on n.oid = c.relnamespace
where k.contype = 'f' and n.nspname = 'public' and rc.relnamespace = n.oid`);

const relations = q(`
select coalesce(json_agg(json_build_object('name', c.relname, 'kind', c.relkind,
  'cols', (select json_agg(json_build_object('name', a.attname, 'type', a.atttypid::int, 'notnull', a.attnotnull, 'hasdef', a.atthasdef, 'identity', a.attidentity, 'generated', a.attgenerated) order by a.attnum)
           from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)) order by c.relname), '[]'::json)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p','v','m') and not c.relispartition`);

const fns = q(`
select coalesce(json_agg(json_build_object('name', p.proname, 'args', coalesce((select json_agg(json_build_object('name', coalesce(nullif(an, ''), ''), 'type', at::int, 'mode', am, 'idx', i) order by i)
      from (select unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) at, unnest(coalesce(p.proargmodes, array_fill('i'::"char", array[coalesce(array_length(p.proallargtypes, 1), p.pronargs)]))) am,
                   unnest(coalesce(p.proargnames, array_fill(''::text, array[coalesce(array_length(p.proallargtypes, 1), p.pronargs)]))) an, generate_series(1, coalesce(array_length(p.proallargtypes, 1), p.pronargs)) i) s), '[]'::json),
  'ndefaults', p.pronargdefaults, 'nin', p.pronargs, 'ret', p.prorettype::int, 'set', p.proretset, 'variadic', p.provariadic::int, 'oid', p.oid::int) order by p.proname, p.oid), '[]'::json)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);

const composites = q(`
select coalesce(json_agg(c.relname), '[]'::json) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind = 'c'`);

// ---- type mapping -----------------------------------------------------------------------------------------------------------------------
function tsType(oid, ctx = {}) {
  const t = typeByOid.get(oid);
  if (!t) return 'unknown';
  if (t.type === 'd') return tsType(t.base, ctx);
  if (t.cat === 'A' || (t.elem && t.name.startsWith('_'))) return `${wrap(tsType(t.elem, ctx))}[]`;
  if (t.type === 'e') return t.schema === 'public' ? `Database["public"]["Enums"]["${t.name}"]` : 'string';
  switch (t.name) {
    case 'int2': case 'int4': case 'int8': case 'float4': case 'float8': case 'numeric': case 'oid': case 'money': return 'number';
    case 'bool': return 'boolean';
    case 'json': case 'jsonb': return 'Json';
    case 'text': case 'varchar': case 'bpchar': case 'char': case 'name': case 'citext': case 'uuid': case 'date': case 'time': case 'timetz':
    case 'timestamp': case 'timestamptz': case 'interval': case 'inet': case 'cidr': case 'macaddr': case 'bytea': case 'xml': case 'tsvector': case 'tsquery':
      return 'string';
    case 'void': return 'undefined';
    case 'record': return 'Record<string, unknown>';
    default: return t.type === 'c' && t.schema === 'public' ? `Database["public"]["CompositeTypes"]["${t.name}"]` : 'unknown';
  }
}
const wrap = (s) => (/[|&]/.test(s) ? `(${s})` : s);
const key = (n) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n) ? n : JSON.stringify(n));

// ---- emit -------------------------------------------------------------------------------------------------------------------------------
const L = [];
const w = (s = '') => L.push(s);
w(`// Generated by scripts/dev/gen-db-types.cjs from the local replayed database "${DB}" (the repository migration chain). Do not edit by hand:`);
w('// regenerate with `node scripts/dev/gen-db-types.cjs --db bpc_replay_full --out src/lib/database.types.ts` and review the diff.');
w('export type Json =');
w('  | string');
w('  | number');
w('  | boolean');
w('  | null');
w('  | { [key: string]: Json | undefined }');
w('  | Json[]');
w('');
w('export type Database = {');
w('  public: {');
w('    Tables: {');
const tables = relations.filter((r) => r.kind === 'r' || r.kind === 'p');
const views = relations.filter((r) => r.kind === 'v' || r.kind === 'm');
for (const t of tables) {
  w(`      ${key(t.name)}: {`);
  w('        Row: {');
  for (const c of t.cols) w(`          ${key(c.name)}: ${tsType(c.type)}${c.notnull ? '' : ' | null'}`);
  w('        }');
  w('        Insert: {');
  for (const c of t.cols) {
    const generatedAlways = c.generated === 's' || c.identity === 'a';
    if (generatedAlways) { w(`          ${key(c.name)}?: never`); continue; }
    const optional = !c.notnull || c.hasdef || c.identity === 'd';
    w(`          ${key(c.name)}${optional ? '?' : ''}: ${tsType(c.type)}${c.notnull ? '' : ' | null'}`);
  }
  w('        }');
  w('        Update: {');
  for (const c of t.cols) {
    const generatedAlways = c.generated === 's' || c.identity === 'a';
    w(`          ${key(c.name)}?: ${generatedAlways ? 'never' : `${tsType(c.type)}${c.notnull ? '' : ' | null'}`}`);
  }
  w('        }');
  const r = rels.filter((x) => x.table === t.name);
  if (r.length === 0) w('        Relationships: []');
  else {
    w('        Relationships: [');
    for (const x of r) {
      w('          {');
      w(`            foreignKeyName: ${JSON.stringify(x.rel)}`);
      w(`            columns: ${JSON.stringify(x.cols)}`);
      w(`            isOneToOne: ${x.unique ? 'true' : 'false'}`);
      w(`            referencedRelation: ${JSON.stringify(x.ref)}`);
      w(`            referencedColumns: ${JSON.stringify(x.refcols)}`);
      w('          },');
    }
    w('        ]');
  }
  w('      }');
}
w('    }');
if (views.length === 0) w('    Views: { [_ in never]: never }');
else {
  w('    Views: {');
  for (const v of views) {
    w(`      ${key(v.name)}: {`);
    w('        Row: {');
    for (const c of v.cols) w(`          ${key(c.name)}: ${tsType(c.type)} | null`);
    w('        }');
    w('        Relationships: []');
    w('      }');
  }
  w('    }');
}
w('    Functions: {');
const byName = new Map();
for (const f of fns) (byName.get(f.name) || byName.set(f.name, []).get(f.name)).push(f);
for (const [name, list] of byName) {
  const variants = list.map((f) => {
    const inArgs = f.args.filter((a) => a.mode === 'i' || a.mode === 'b' || a.mode === 'v');
    const outArgs = f.args.filter((a) => a.mode === 'o' || a.mode === 't' || a.mode === 'b');
    const firstDefault = inArgs.length - f.ndefaults;
    const args = inArgs.length === 0 ? 'Record<PropertyKey, never>' : `{ ${inArgs.map((a, i) => `${key(a.name)}${i >= firstDefault ? '?' : ''}: ${tsType(a.type)}`).join('; ')} }`;
    let ret;
    if (outArgs.length > 0 && outArgs.some((a) => a.mode === 't' || a.mode === 'o')) {
      const cols = f.args.filter((a) => a.mode === 't' || a.mode === 'o');
      ret = `{ ${cols.map((a) => `${key(a.name)}: ${tsType(a.type)}`).join('; ')} }`;
      ret = f.set ? `${ret}[]` : ret;
    } else {
      const rt = typeByOid.get(f.ret);
      if (rt && rt.type === 'c' && rt.schema === 'public' && tables.some((t) => t.name === rt.name)) ret = `Database["public"]["Tables"]["${rt.name}"]["Row"]${f.set ? '[]' : ''}`;
      else ret = f.set ? `${wrap(tsType(f.ret))}[]` : tsType(f.ret);
    }
    return `{ Args: ${args}; Returns: ${ret} }`;
  });
  w(`      ${key(name)}: ${variants.length === 1 ? variants[0] : '\n        | ' + variants.join('\n        | ')}`);
}
w('    }');
if (enums.length === 0) w('    Enums: { [_ in never]: never }');
else {
  w('    Enums: {');
  for (const e of enums) w(`      ${key(e.name)}: ${e.values.map((v) => JSON.stringify(v)).join(' | ')}`);
  w('    }');
}
if (composites.length === 0) w('    CompositeTypes: { [_ in never]: never }');
else {
  w('    CompositeTypes: {');
  for (const c of composites) w(`      ${key(c)}: Record<string, unknown>`);
  w('    }');
}
w('  }');
w('}');
w('');

const text = L.join('\n');
if (OUT) { fs.writeFileSync(OUT, text); console.error(`wrote ${OUT}: ${tables.length} tables, ${views.length} views, ${fns.length} functions, ${enums.length} enums`); }
else process.stdout.write(text);
