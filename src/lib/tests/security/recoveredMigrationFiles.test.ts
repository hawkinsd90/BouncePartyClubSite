// Recovered Production-only migrations.
//
// Fifteen migrations were applied to the Production database (through the dashboard / an assistant tool) without their files ever
// being committed, so Production's migration history recorded them but the repository did not have them. Their SQL was recovered
// from supabase_migrations.schema_migrations (the stored statements are split at semicolons and carry literal "\n" in place of
// line breaks; rejoining the statements with ";" and turning each literal "\n" back into a line break restores the text).
//
// This test pins every recovered file to the MD5 of the SQL that Production recorded, so an accidental edit is caught. Line
// endings are normalised to LF before hashing (a Windows checkout may convert them).
//
// It also checks the migration directory itself: every file name is "<14-digit version>_<name>.sql" with a unique version, and the
// recovered versions sort into the position Production applied them (no gap-filling with a different timestamp).
//
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/recoveredMigrationFiles.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { exit(code: number): never };
const fs = require('fs');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}

const DIR = 'supabase/migrations/';
// version -> [name recorded in Production, md5 of the recorded SQL (LF, literal \n restored)]
const RECOVERED: Record<string, [string, string]> = {
  '20251126190624': ['add_customer_approval_workflow', '0374086d0f4d5b9cf33599c7fb278a1a'],
  '20251130201520': ['add_deposit_override_and_payment_clearing', '96d73afef9e0539dfb955ea3f9658755'],
  '20251209163552': ['fix_get_user_order_prefill_function', '58321de98ea3fb76bac831c1e4504b5e'],
  '20251229223230': ['update_customer_profiles_names', 'bf485fed40288c0c670e4d424615dc82'],
  '20260126193254': ['add_pictures_reminder_sms_template', '46f55a68f861acc2467a83b44fa0ce9b'],
  '20260316174421': ['restore_postgres_custom_email_hook', 'c28ca97b5ded2b2261535e2a32a5ea9f'],
  '20260317003321': ['fix_get_user_order_prefill_drop_and_recreate', '9a92f30291cfe9fa178b30d2133ab8c8'],
  '20260322204444': ['fix_auto_update_order_status_trigger_correct_columns', '95887cca1eed70d919351c2171ee8f66'],
  '20260324175546': ['fix_get_user_role_case_sensitivity_v2', '7787763ca5095a87c726457646d70378'],
  '20260324191353': ['tighten_contacts_anon_update_policy', '052fc610f295fc2fa87478c9f9fc328c'],
  '20260325231020': ['add_carousel_show_arrows_setting', '05c0447955547cd257c93f53de45ac2f'],
  '20260402143448': ['add_is_admin_internal_to_sms_conversations', '3e7bbdb390748eeb04fcc624b173898b'],
  '20260501173826': ['add_billing_addresses_table', 'b2fa6702b945ffb58ec903ba6e4b2cea'],
  '20260521153603': ['add_get_booking_sources_analytics_rpc', 'f2790d03fd63821d58b212734118e02c'],
  '20260521153805': ['fix_booking_sources_analytics_revenue_column', '79e84352d711fc2da75cf1974ba6c141'],
};

const files: string[] = fs.readdirSync(DIR).filter((f: string) => f.endsWith('.sql')).sort();
const versions = files.map((f) => f.slice(0, 14));
ok('every migration file name starts with a 14-digit version and an underscore', files.every((f) => /^\d{14}_/.test(f)));
ok('migration versions are unique', new Set(versions).size === versions.length);
ok('migration files are listed in ascending version order', versions.every((v, i) => i === 0 || versions[i - 1] < v));

for (const [version, [name, md5]] of Object.entries(RECOVERED)) {
  const matches = files.filter((f) => f.startsWith(version + '_'));
  ok(`${version}: exactly one file exists for the recovered version`, matches.length === 1);
  if (matches.length !== 1) continue;
  ok(`${version}: file is named ${name}.sql`, matches[0] === `${version}_${name}.sql`);
  const text = fs.readFileSync(DIR + matches[0], 'utf8').replace(/\r\n/g, '\n');
  ok(`${version}: SQL equals what Production recorded (md5)`, crypto.createHash('md5').update(text).digest('hex') === md5);
  ok(`${version}: contains no literal backslash-n left from the stored form`, !text.includes('\\n'));
}

console.log(`recovered migration files: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
