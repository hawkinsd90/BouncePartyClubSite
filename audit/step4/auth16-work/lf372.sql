SELECT version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\x0a'),'')) AS l FROM supabase_migrations.schema_migrations ORDER BY version;
