SELECT string_agg(version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'
'),'')), E'
' ORDER BY version) l FROM supabase_migrations.schema_migrations;