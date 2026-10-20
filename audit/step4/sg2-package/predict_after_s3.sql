WITH new_rows(ord,version,name,h) AS (VALUES
(1,'20260325231044','increase_carousel_media_file_size_limit','10271ae64c9121f4135fb6457061b6e0'),
(2,'20260517221038','fix_public_assets_bucket_size_and_mime_types','4ef9c85068a8e49b0018959e6bf44a24')
), k AS (SELECT generate_series(0,2) k),
base AS (SELECT version, coalesce(name,'') name, md5(coalesce(array_to_string(statements,E'\n'),'')) h FROM supabase_migrations.schema_migrations),
u AS (SELECT k.k, version, name, h FROM k, base UNION ALL SELECT k.k, n.version, n.name, n.h FROM k JOIN new_rows n ON n.ord <= k.k)
SELECT k, count(*) rows, encode(sha256(convert_to(string_agg(version||'|'||name||'|'||h, E'\n' ORDER BY version),'UTF8')),'hex') sha FROM u GROUP BY k ORDER BY k;
