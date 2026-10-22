// WP-28 (B5): password recovery. Pure state machine, the browser capture module with a fake window and fake Auth client,
// and source assertions on the page, the client setup, the App handler and the signup password rule.
// PASS - LOCAL AUTOMATED. The real emailed link, Supabase redirect allow-list and token single-use are REQUIRES HOSTED DEV VERIFICATION.
import { readFileSync } from 'node:fs';
import {
  EMPTY_AUTH_LINK,
  MIN_PASSWORD_LENGTH,
  RECOVERY_FLAG_TTL_MS,
  RECOVERY_MESSAGES,
  decideRecoveryState,
  isRecoveryFlagFresh,
  parseAuthLink,
  passwordProblem,
  shouldOpenResetForm,
} from '../../auth/recoveryLink';

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
const read = (p: string) => readFileSync(p, 'utf8');

async function main() {
  // --- parsing the landing URL -------------------------------------------------------------------------------------
  const rec = parseAuthLink('#access_token=a&refresh_token=b&expires_in=3600&type=recovery', '');
  eq('recovery hash is recognised', [rec.type, rec.hasTokens, rec.errorCode], ['recovery', true, null]);
  const expired = parseAuthLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '');
  eq('expired-link error hash is recognised', [expired.errorCode, expired.hasTokens, expired.errorDescription], ['otp_expired', false, 'Email link is invalid or has expired']);
  eq('error in the query string is recognised too', parseAuthLink('', '?error_code=otp_expired').errorCode, 'otp_expired');
  eq('PKCE code is recognised', parseAuthLink('', '?code=abc').hasCode, true);
  eq('portal token hash is not an auth link', parseAuthLink('#t=abcdef', ''), EMPTY_AUTH_LINK);
  eq('empty / null input', [parseAuthLink('', ''), parseAuthLink(null, undefined)], [EMPTY_AUTH_LINK, EMPTY_AUTH_LINK]);
  const oauth = parseAuthLink('#access_token=a&refresh_token=b&provider_token=c', '');
  eq('an OAuth sign-in hash has tokens but no recovery type', [oauth.type, oauth.hasTokens], [null, true]);

  // --- readiness state machine -------------------------------------------------------------------------------------
  const base = { snapshot: EMPTY_AUTH_LINK, recoveryEvent: false, hasSession: false, timedOut: false };
  eq('nothing yet: waiting', decideRecoveryState(base), 'waiting');
  eq('session + recovery event: ready', decideRecoveryState({ ...base, hasSession: true, recoveryEvent: true }), 'ready');
  eq('hash cleared before mount, event remembered, session present: ready', decideRecoveryState({ ...base, hasSession: true, recoveryEvent: true, snapshot: EMPTY_AUTH_LINK }), 'ready');
  eq('snapshot says recovery and the client made a session: ready', decideRecoveryState({ ...base, hasSession: true, snapshot: rec }), 'ready');
  eq('a normal signed-in session without recovery is NOT ready (cannot reach the form by typing the URL)', decideRecoveryState({ ...base, hasSession: true, timedOut: true }), 'invalid');
  eq('recovery event but no session yet: still waiting', decideRecoveryState({ ...base, recoveryEvent: true }), 'waiting');
  eq('otp_expired: expired immediately', decideRecoveryState({ ...base, snapshot: expired }), 'expired');
  eq('other error code: invalid', decideRecoveryState({ ...base, snapshot: { ...EMPTY_AUTH_LINK, errorCode: 'server_error' } }), 'invalid');
  eq('error_description only: expired', decideRecoveryState({ ...base, snapshot: { ...EMPTY_AUTH_LINK, errorDescription: 'x' } }), 'expired');
  eq('an old error in the URL does not block a real recovery session', decideRecoveryState({ ...base, snapshot: { ...expired, type: 'recovery' }, hasSession: true, recoveryEvent: true }), 'ready');
  eq('timed out with no link at all: invalid', decideRecoveryState({ ...base, timedOut: true }), 'invalid');
  eq('timed out after a recovery link produced no session (used or expired): expired', decideRecoveryState({ ...base, timedOut: true, snapshot: rec }), 'expired');
  eq('timed out after a PKCE code with no session: expired', decideRecoveryState({ ...base, timedOut: true, snapshot: parseAuthLink('', '?code=x') }), 'expired');
  ok('expired and invalid have distinct customer messages, and the expired one says reset links work once', RECOVERY_MESSAGES.expired !== RECOVERY_MESSAGES.invalid && /already used/.test(RECOVERY_MESSAGES.expired));

  // --- where the app sends the visitor ----------------------------------------------------------------------------
  eq('recovery link landing on the homepage opens the form', shouldOpenResetForm({ snapshot: rec, recoveryPending: false, pathname: '/' }), true);
  eq('already on the form: no redirect', shouldOpenResetForm({ snapshot: rec, recoveryPending: true, pathname: '/reset-password' }), false);
  eq('Google/Apple sign-in landing is never redirected', shouldOpenResetForm({ snapshot: oauth, recoveryPending: false, pathname: '/' }), false);
  eq('portal #t= link is never redirected', shouldOpenResetForm({ snapshot: parseAuthLink('#t=abc', ''), recoveryPending: false, pathname: '/portal/1' }), false);
  eq('event fired before mount, link carried tokens: redirect', shouldOpenResetForm({ snapshot: { ...EMPTY_AUTH_LINK, hasTokens: true }, recoveryPending: true, pathname: '/' }), true);
  eq('stale flag without a link on this load: no redirect', shouldOpenResetForm({ snapshot: EMPTY_AUTH_LINK, recoveryPending: true, pathname: '/' }), false);

  // --- remembered recovery flag ----------------------------------------------------------------------------------
  ok('flag fresh inside the TTL', isRecoveryFlagFresh('1000', 1000 + RECOVERY_FLAG_TTL_MS - 1));
  ok('flag stale after the TTL', !isRecoveryFlagFresh('1000', 1000 + RECOVERY_FLAG_TTL_MS));
  ok('missing / garbage / future flag is not fresh', !isRecoveryFlagFresh(null, 5) && !isRecoveryFlagFresh('abc', 5) && !isRecoveryFlagFresh('9999', 5));

  // --- password policy -------------------------------------------------------------------------------------------
  eq('too short', passwordProblem('12345', '12345'), `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  eq('mismatch', passwordProblem('123456', '1234567'), 'Passwords do not match');
  eq('fine', passwordProblem('123456', '123456'), null);

  // --- browser capture module with a fake window + fake Auth client -------------------------------------------------
  const store = new Map<string, string>();
  const fakeWindow: any = {
    location: { hash: '#access_token=a&refresh_token=b&type=recovery', search: '', pathname: '/' },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  };
  (globalThis as any).window = fakeWindow;
  const cap = await import('../../auth/authLinkCapture');
  fakeWindow.location.hash = ''; // the Auth client clears the hash after verifying the link
  eq('snapshot survives the client clearing the hash', [cap.initialAuthLink.type, cap.initialAuthLink.hasTokens], ['recovery', true]);
  ok('nothing pending before the event', !cap.isRecoveryPending());
  let handler: ((event: string) => void) | null = null;
  cap.installRecoveryTracking({ onAuthStateChange: (cb) => { handler = cb; return null; } });
  let notified = 0;
  const unsub = cap.subscribeRecovery(() => { notified++; });
  handler!('SIGNED_IN');
  ok('other events do not mark recovery', !cap.isRecoveryPending() && notified === 0);
  handler!('PASSWORD_RECOVERY');
  ok('PASSWORD_RECOVERY is remembered and subscribers are told', cap.isRecoveryPending() && notified === 1 && store.has('bpc-password-recovery'));
  ok('the memory outlives a page that mounts late (read from storage)', cap.isRecoveryPending(Date.now() + 1000));
  ok('the memory expires', !cap.isRecoveryPending(Date.now() + RECOVERY_FLAG_TTL_MS + 5000));
  unsub();
  cap.clearRecoveryPending();
  ok('clearing forgets it', !cap.isRecoveryPending() && !store.has('bpc-password-recovery'));
  // blocked storage must not break the page
  fakeWindow.sessionStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  cap.markRecoveryPending();
  ok('with storage blocked the in-memory flag still works', cap.isRecoveryPending());
  cap.clearRecoveryPending();
  delete (globalThis as any).window;

  // --- source assertions ---------------------------------------------------------------------------------------------
  const page = read('src/pages/ResetPassword.tsx');
  ok('page never reads the live URL hash', !/location\.hash|location\.search/.test(page));
  ok('page reads the early snapshot and the client session', /initialAuthLink/.test(page) && /supabase\.auth\.getSession\(\)/.test(page) && /PASSWORD_RECOVERY/.test(page));
  ok('page no longer bounces to /forgot-password on its own timer', !/setTimeout\(\(\) => navigate\('\/forgot-password'\)/.test(page));
  ok('expired / used links get their own screen with a "Send a new link" action', /RECOVERY_MESSAGES\[recovery\]/.test(page) && /Send a new link/.test(page));
  const upd = page.indexOf('supabase.auth.updateUser');
  const out = page.indexOf("signOut({ scope: 'global' })");
  ok('after the password update every session is signed out (global scope)', upd > 0 && out > upd);
  ok('the remembered recovery state is cleared after a successful reset', /clearRecoveryPending\(\)/.test(page));
  ok('page and signup share one password minimum', /MIN_PASSWORD_LENGTH/.test(page) && /MIN_PASSWORD_LENGTH/.test(read('src/pages/SignUp.tsx')) && !/length < 6/.test(page + read('src/pages/SignUp.tsx')));

  const client = read('src/lib/supabase.ts');
  ok('the capture module is imported before the client is created', client.indexOf("./auth/authLinkCapture") > 0 && client.indexOf("./auth/authLinkCapture") < client.indexOf('createClient<'));
  ok('recovery tracking is installed on the client right after it is created', client.indexOf('installRecoveryTracking(supabase.auth)') > client.indexOf('createClient<'));
  ok('OAuth / portal detection settings are unchanged', /detectSessionInUrl: true/.test(client) && /persistSession: true/.test(client));

  const app = read('src/App.tsx');
  ok('App has a global recovery handler rendered next to the OAuth handler', /function RecoveryRedirectHandler/.test(app) && /<RecoveryRedirectHandler \/>/.test(app) && /navigate\('\/reset-password', \{ replace: true \}\)/.test(app));
  ok('forgot-password still requests a link back to /reset-password on the current origin', /redirectTo: `\$\{window\.location\.origin\}\/reset-password`/.test(read('src/pages/ForgotPassword.tsx')));
  ok('the capture module is the only new place that reads location.hash', !/location\.hash/.test(read('src/lib/auth/recoveryLink.ts')) && /location\.hash/.test(read('src/lib/auth/authLinkCapture.ts')));

  console.log(`passwordRecovery: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} password recovery test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
