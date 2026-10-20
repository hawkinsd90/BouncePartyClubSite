#!/bin/bash
# S11 post-change probe (Development only). Read-only HTTP GETs/RPC calls with the PUBLIC anon/publishable key. No provider is contacted.
# Usage: bash s11-post-probe.sh <publishable-or-anon-key>   Exit 0 = every expectation met; non-zero = run the S11 reversal at once.
set -u
K="$1"; B=https://srxunxiytojjsuhcmzjg.supabase.co; bad=0
code() { curl -s -o /tmp/s11p.txt -w "%{http_code}" "$@" --max-time 30; }
deny()  { c=$(code "$B/rest/v1/$1?select=*&limit=1" -H "apikey: $K"); if [ "$c" = "401" ] || [ "$c" = "403" ]; then echo "PASS denied  $1 ($c)"; else echo "FAIL $1 returned $c (expected 401/403)"; head -c 200 /tmp/s11p.txt; echo; bad=1; fi; }
allow() { c=$(code "$B/rest/v1/$1?select=*&limit=1" -H "apikey: $K"); if [ "$c" = "200" ]; then echo "PASS allowed $1"; else echo "FAIL $1 returned $c (expected 200)"; bad=1; fi; }
# private tables: privilege layer must refuse (42501 permission denied for table), and no row may come back
for t in orders customers payments contacts addresses order_items order_discounts order_custom_fees invoice_links consent_records messages sms_conversations admin_settings user_roles customer_profiles documents site_events notification_failures order_refunds stripe_webhook_events booking_setup_proofs; do deny $t; done
# public catalog tables (the accepted anon SELECT allow-list)
for t in units unit_media pricing_rules inventory_products product_categories product_pricing product_bundles hero_carousel_images google_reviews; do allow $t; done
# public RPCs (accepted allow-list)
c=$(code -X POST "$B/rest/v1/rpc/get_public_business_settings" -H "apikey: $K" -H "Content-Type: application/json" -d '{}'); [ "$c" = "200" ] && echo "PASS rpc get_public_business_settings" || { echo "FAIL rpc get_public_business_settings $c"; bad=1; }
# private RPCs must be refused
for f in is_crew_or_admin get_my_orders get_user_role order_net_financials check_rate_limit; do c=$(code -X POST "$B/rest/v1/rpc/$f" -H "apikey: $K" -H "Content-Type: application/json" -d '{}'); if [ "$c" = "401" ] || [ "$c" = "403" ] || [ "$c" = "404" ]; then echo "PASS denied rpc $f ($c)"; else echo "FAIL rpc $f $c"; head -c 160 /tmp/s11p.txt; echo; bad=1; fi; done
# anon must not write the allow-listed insert table with junk / must not insert elsewhere
c=$(code -X POST "$B/rest/v1/orders" -H "apikey: $K" -H "Content-Type: application/json" -d '{}'); [ "$c" = "401" ] || [ "$c" = "403" ] && echo "PASS denied INSERT orders ($c)" || { echo "FAIL INSERT orders $c"; bad=1; }
[ $bad -eq 0 ] && echo "S11 PROBE: ALL EXPECTATIONS MET" || echo "S11 PROBE: FAILED -> run the reversal: REVOKE USAGE ON SCHEMA public FROM anon, authenticated; GRANT CREATE ON SCHEMA public TO service_role;"
exit $bad
