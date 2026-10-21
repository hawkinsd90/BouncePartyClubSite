# S13 to S15 readiness (prepared 2026-10-21, after AUTH-13R; nothing hosted changed by this document)

## Provider-free checks run now (public key / HTTP only, Development)
* Dev site `/`, `/privacy`, `/terms`, `/bounce-houses` answer 200 (Netlify deploy 6ad802f10897b55d48e7016c, commit c6443ac).
* Anon reads work for the catalog allow-list (units 16, product_categories 4, pricing_rules 1, hero_carousel_images 3); `get_public_business_settings` answers; `admin_settings` and `orders` INSERT are refused (401); retired `get-session-metadata` answers 410; `s11-post-probe.sh` ALL EXPECTATIONS MET.
* `stripe-webhook` with a bad signature returns 500 "Webhook secret not configured" (fail-closed; not a pass of FIN-013 until `STRIPE_WEBHOOK_SECRET` is set).
* Matrix: 119 tests; 89 need no provider (PUB, SEC, most BKG/ADM/CRW) but most are `manual` and need signed-in test accounts.

## New finding for S13 (needs an owner decision)
Development data still points to **Production's public storage**: `admin_settings.logo_url`, 3 `hero_carousel_images` and about 30 `unit_media` rows contain `https://qaagfafagdpgzcijnfbw.supabase.co/storage/...` URLs (read-only public GETs from visitors' browsers; no write path, nothing was contacted by this work). Effects: the Dev site is not storage-isolated and breaks if Production files are renamed. Options: (A) leave as read-only references until launch, (B) copy the images into Development buckets and rewrite the URLs (hosted storage + data write, needs its own authorization; Production is only read as public files). Recommended B in the S13 package.

## Owner items that block provider tests
`SITE_URL` and `RETURN_ORIGINS` (`https://dev.bouncepartyclub.com`) and `STRIPE_WEBHOOK_SECRET` secrets; Twilio console routing; signed attestations for `20251002210020`, `20251207160232`; decision on `20260324051459` and `20260324154955` (realtime publication; not applied on Dev; options: execute or record as not executed); SEC-005 password rotation before 2026-11-13.

## S15 path (unchanged)
Attestations and alias rows to reach the final ledger, `config.toml` alignment commit, `supabase db push --dry-run` clean, canary push, then re-enable the Supabase GitHub integration. Current ledger 372.

## Next single authorization (proposed AUTH-14)
After the secrets exist: (1) copy referenced Production public images into Development buckets and rewrite the ~35 URLs (option B); (2) Stripe test-mode and Resend/Twilio approved-recipient tests per matrix; (3) the two realtime decisions and attestations. Details to be bound with hashes once you choose.

## AUTH-14 media package (prepared, not executed; supersedes the "copy images" idea)
Read-only inventory (Development database only): every Production-URL reference to public media already has its object in Development storage under the same bucket and path (unit_media 35 in `unit-images`, hero 3 in `carousel-media`; 84.8 MB total), so **no copy and no Production contact is needed, only a URL rewrite**. Files: `auth14-media-url-rewrite.sql` (guards: exact counts 35 and 3, each object exists in a public Development bucket, no triggers on those tables, zero Production references afterwards; data-only, one transaction) and `auth14-media-url-rollback.sql`.
Not included, owner decision: (1) `admin_settings.logo_url` points at bucket `public-assets`, which is **private** in Development, so rewriting it would break the logo; options: leave as is, or move the logo to a public marketing bucket (storage write). (2) 69 to 74 legacy rows (`order_signatures.signature_image_url` / `pdf_url`, `orders.signed_waiver_url`, `task_status.delivery_images` 74, `damage_images` 1) hold Production public-style URLs for private-bucket files; the app must use signed URLs / stored paths, so these are an S15 code/data question, not a blind rewrite. (3) one `sms_conversations` message and one `admin_settings_changelog` value mention the Production host (history, leave).
