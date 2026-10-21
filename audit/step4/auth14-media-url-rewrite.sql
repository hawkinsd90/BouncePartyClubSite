-- AUTH-14 (PREPARED, NOT EXECUTED): point Development catalog media at Development storage instead of Production's public URLs.
-- Data-only, one transaction, Development only. No storage object is copied (all 38 referenced objects already exist in Development), Production is not contacted.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $bpc$
DECLARE
  prod text := 'https://qaagfafagdpgzcijnfbw.supabase.co';
  dev  text := 'https://srxunxiytojjsuhcmzjg.supabase.co';
  n_um int; n_hero int; n_miss int;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'wrong database'; END IF;
  IF (SELECT count(*) FROM public.unit_media WHERE url LIKE prod||'%') <> 35 THEN RAISE EXCEPTION 'unit_media target count differs from 35'; END IF;
  IF (SELECT count(*) FROM public.hero_carousel_images WHERE image_url LIKE prod||'%') <> 3 THEN RAISE EXCEPTION 'hero target count differs from 3'; END IF;
  SELECT count(*) INTO n_miss FROM (
    SELECT substring(url from '/object/public/([^/]+)/') b, substring(url from '/object/public/[^/]+/(.*)$') p FROM public.unit_media WHERE url LIKE prod||'%'
    UNION ALL SELECT substring(image_url from '/object/public/([^/]+)/'), substring(image_url from '/object/public/[^/]+/(.*)$') FROM public.hero_carousel_images WHERE image_url LIKE prod||'%') r
  WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = r.b AND o.name = r.p)
     OR NOT EXISTS (SELECT 1 FROM storage.buckets bk WHERE bk.id = r.b AND bk.public);
  IF n_miss <> 0 THEN RAISE EXCEPTION '% referenced objects are missing or not in a public Development bucket', n_miss; END IF;
  UPDATE public.unit_media SET url = replace(url, prod, dev) WHERE url LIKE prod||'%';
  GET DIAGNOSTICS n_um = ROW_COUNT;
  UPDATE public.hero_carousel_images SET image_url = replace(image_url, prod, dev) WHERE image_url LIKE prod||'%';
  GET DIAGNOSTICS n_hero = ROW_COUNT;
  IF n_um <> 35 OR n_hero <> 3 THEN RAISE EXCEPTION 'unexpected update counts % / %', n_um, n_hero; END IF;
  IF EXISTS (SELECT 1 FROM public.unit_media WHERE url LIKE '%qaagfafagdpgzcijnfbw%') OR EXISTS (SELECT 1 FROM public.hero_carousel_images WHERE image_url LIKE '%qaagfafagdpgzcijnfbw%') THEN RAISE EXCEPTION 'Production references remain'; END IF;
END $bpc$;
