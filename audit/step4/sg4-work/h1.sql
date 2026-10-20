SELECT encode(sha256(convert_to(string_agg(version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'
'),'')), E'
' ORDER BY version),'UTF8')),'hex') h FROM supabase_migrations.schema_migrations;