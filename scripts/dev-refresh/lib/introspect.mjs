// Reads the structure of one database (columns, keys, foreign keys, triggers) as plain JSON. Read-only catalog queries.

import { queryJson } from './psql.mjs';

const INTROSPECTION_SQL = `
SELECT json_build_object(
  'database', current_database(),
  'serverVersion', current_setting('server_version'),
  'role', json_build_object(
      'name', current_user,
      'bypassRls', (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user)),
  'tables', COALESCE((
    SELECT json_object_agg(c.relname, json_build_object(
      'forceRls', c.relforcerowsecurity,
      'rls', c.relrowsecurity,
      'columns', (
        SELECT json_agg(json_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'notNull', a.attnotnull,
          'default', pg_get_expr(d.adbin, d.adrelid),
          'generated', a.attgenerated <> '',
          'identity', a.attidentity::text) ORDER BY a.attnum)
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
      'pk', (
        SELECT json_agg(a.attname ORDER BY k.ord)
        FROM pg_constraint p
        CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = p.conrelid AND a.attnum = k.attnum
        WHERE p.conrelid = c.oid AND p.contype = 'p'),
      'serials', (
        SELECT json_agg(json_build_object('column', a.attname, 'sequence', pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname)))
        FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) IS NOT NULL)
    ))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')), '{}'::json),
  'fks', COALESCE((
    SELECT json_agg(json_build_object(
      'name', con.conname,
      'childSchema', cn.nspname, 'childTable', cc.relname,
      'childColumns', (SELECT json_agg(a.attname ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum),
      'parentSchema', pn.nspname, 'parentTable', pc.relname,
      'parentColumns', (SELECT json_agg(a.attname ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum),
      'onDelete', con.confdeltype::text))
    FROM pg_constraint con
    JOIN pg_class cc ON cc.oid = con.conrelid JOIN pg_namespace cn ON cn.oid = cc.relnamespace
    JOIN pg_class pc ON pc.oid = con.confrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE con.contype = 'f' AND (cn.nspname = 'public' OR pn.nspname = 'public')), '[]'::json),
  'triggers', COALESCE((
    SELECT json_agg(json_build_object(
      'table', c.relname, 'name', t.tgname, 'enabled', t.tgenabled::text,
      'function', p.proname,
      'callsOutside', (p.prosrc ~* '(net\\.http_|http_post|http_get|pg_net)')))
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname = 'public'), '[]'::json),
  'hasAuthUsers', to_regclass('auth.users') IS NOT NULL,
  'extensions', (SELECT json_agg(extname) FROM pg_extension)
)`;

export function introspect(target) {
  const j = queryJson(target, INTROSPECTION_SQL, 'schema introspection');
  for (const t of Object.values(j.tables)) {
    t.columns = t.columns || [];
    t.pk = t.pk || [];
    t.serials = t.serials || [];
  }
  j.fks = j.fks || [];
  j.triggers = j.triggers || [];
  return j;
}
