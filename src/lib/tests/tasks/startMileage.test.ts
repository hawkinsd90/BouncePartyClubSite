// WP-12 (B8): the start-mileage requirement setting. Pure rules, the one shared gate in the crew task screen, the owner toggle, and
// the migration text (key list, grants, seeds). The migration was also executed against a throwaway local copy of the replay
// database (idempotent, 16 keys present there, grants as below): PASS - LOCAL INTEGRATION (manual run recorded in the log).
// Setting the toggle on hosted Dev and the crew behaviour are REQUIRES HOSTED DEV VERIFICATION (A-16, K-10).
import { readFileSync, readdirSync } from 'node:fs';
import { hasStartReading, parseRequireStartMileage, shouldBlockForStartMileage, START_MILEAGE_PROMPTS } from '../../core/startMileage';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label} (got ${g}, expected ${w})`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// --- setting parse: only an explicit "false" turns the requirement off ---------------------------------------------------
eq('missing => required', parseRequireStartMileage(undefined), true);
eq('null => required', parseRequireStartMileage(null), true);
eq('"true" => required', parseRequireStartMileage('true'), true);
eq('"false" => not required', parseRequireStartMileage('false'), false);
eq('" FALSE " (case / spaces) => not required', parseRequireStartMileage(' FALSE '), false);
eq('empty string => required', parseRequireStartMileage(''), true);
eq('garbage => required', parseRequireStartMileage('banana'), true);
eq('"0" / "no" are NOT an off switch', [parseRequireStartMileage('0'), parseRequireStartMileage('no')], [true, true]);
eq('a boolean false from a bad client is NOT an off switch (only the stored string is)', parseRequireStartMileage(false), true);

// --- start reading -------------------------------------------------------------------------------------------------------
eq('no log', hasStartReading(null), false);
eq('log without start', hasStartReading({ start_mileage: null }), false);
eq('start 0 is not a reading', hasStartReading({ start_mileage: 0 }), false);
eq('NaN is not a reading', hasStartReading({ start_mileage: NaN }), false);
eq('a string is not a reading', hasStartReading({ start_mileage: '123' as unknown as number }), false);
eq('a real reading', hasStartReading({ start_mileage: 48213.4 }), true);

// --- the gate: truth table ---------------------------------------------------------------------------------------------
const withReading = { start_mileage: 100 };
eq('required + no log => blocked', shouldBlockForStartMileage(true, null), true);
eq('required + log without start => blocked', shouldBlockForStartMileage(true, { start_mileage: null }), true);
eq('required + reading => allowed', shouldBlockForStartMileage(true, withReading), false);
eq('not required + no log => allowed', shouldBlockForStartMileage(false, null), false);
eq('not required + reading => allowed', shouldBlockForStartMileage(false, withReading), false);
ok('each gated action has its own prompt, and En Route offers to record the mileage', ['en_route', 'arrived', 'drop_off', 'pickup'].every((a) => (START_MILEAGE_PROMPTS as Record<string, string>)[a]?.includes('mileage')) && /record your starting mileage now/.test(START_MILEAGE_PROMPTS.en_route));

// --- one gate in the crew task screen -------------------------------------------------------------------------------
const modal = read('src/components/admin/tasks/TaskDetailModal.tsx');
ok('the old inline copies of the check are gone', !/!mileageLog \|\| !mileageLog\.start_mileage/.test(modal));
eq('exactly one gate function, used by the four actions', [(modal.match(/async function passesStartMileageGate/g) ?? []).length, (modal.match(/await passesStartMileageGate\('/g) ?? []).length], [1, 4]);
for (const a of ['en_route', 'arrived', 'drop_off', 'pickup']) ok(`gate is called for ${a}`, new RegExp(`passesStartMileageGate\\('${a}'\\)`).test(modal));
ok('the screen defaults to "required" until the setting has loaded (fail closed)', /useState\(true\)/.test(modal.slice(modal.indexOf('requireStartMileage'), modal.indexOf('requireStartMileage') + 120)));
ok('the setting is read through the public settings function (crew cannot read admin_settings)', /getPublicBusinessSettings\(\)/.test(modal) && !/from\('admin_settings'\)/.test(modal));

// --- settings cache + owner toggle ----------------------------------------------------------------------------------
const cache = read('src/lib/core/adminSettingsCache.ts');
ok('cache exposes require_start_mileage with a "required" default and the shared parser', /require_start_mileage: true/.test(cache) && /require_start_mileage: parseRequireStartMileage\(dataRecord\.require_start_mileage\)/.test(cache));
ok('cache falls back to "required" when the RPC fails (defaults object)', /if \(error \|\| !data\) \{[\s\S]{0,200}return defaults;/.test(cache));
const tab = read('src/components/admin/settings/BusinessBrandingTab.tsx');
ok('owner toggle is loaded, shown and saved through the existing upsert on key', /'require_start_mileage',/.test(tab) && /settings\.require_start_mileage/.test(tab) && /onConflict: 'key'/.test(tab));
ok('toggle off is stored as the string "false" (String(value)) and anything else loads as on', /value !== 'false'/.test(tab) && /String\(value\)/.test(tab));

// --- migration text ---------------------------------------------------------------------------------------------------
const file = readdirSync('supabase/migrations').find((f) => f.endsWith('_require_start_mileage_setting.sql'));
ok('migration file exists with a timestamp after the other release migrations', !!file && file >= '20261027140000');
const sql = read(`supabase/migrations/${file}`);
const arrayBody = sql.match(/allowed_keys text\[\] := ARRAY\[([\s\S]*?)\];/)?.[1] ?? '';
const keys = [...arrayBody.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
const FIFTEEN_EXISTING = ['business_name', 'business_phone', 'business_email', 'logo_url', 'instagram_url', 'facebook_url', 'business_address', 'home_address_line1', 'home_address_line2', 'home_address_city', 'home_address_state', 'home_address_zip', 'event_essentials_page_enabled', 'min_event_essentials_order_cents', 'how_did_you_hear_enabled'];
eq('the 15 existing keys are repeated exactly, in order, then the three new ones', keys, [...FIFTEEN_EXISTING, 'require_start_mileage', 'require_delivery_photo', 'require_pickup_photo']);
ok('no key in the list looks like a secret', keys.every((k) => !/secret|token|password|api_key|stripe|twilio|resend|credential|private/i.test(k)));
const previous = read('supabase/migrations/20260820165646_add_how_did_you_hear_enabled_setting.sql');
const previousKeys = [...(previous.match(/allowed_keys text\[\] := ARRAY\[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
eq('the 15 repeated keys are the same 15 the previous definition returned', previousKeys, FIFTEEN_EXISTING);
ok('SECURITY DEFINER with a pinned search_path', /SECURITY DEFINER\s+SET search_path = public/.test(sql));
ok('execute revoked from PUBLIC, granted to anon, authenticated and service_role', /REVOKE ALL ON FUNCTION public\.get_public_business_settings\(\) FROM PUBLIC/.test(sql) && ['anon', 'authenticated', 'service_role'].every((r) => new RegExp(`GRANT EXECUTE ON FUNCTION public\\.get_public_business_settings\\(\\) TO ${r}`).test(sql)));
ok('seeds are insert-only (never overwrite an owner choice) and default to required', /ON CONFLICT \(key\) DO NOTHING/.test(sql) && ['require_start_mileage', 'require_delivery_photo', 'require_pickup_photo'].every((k) => new RegExp(`\\('${k}', 'true'\\)`).test(sql)));
ok('no policy or table change in this migration', !/CREATE POLICY|ALTER TABLE|DROP POLICY|GRANT SELECT/i.test(sql));

console.log(`startMileage: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} start-mileage test(s) failed`);
