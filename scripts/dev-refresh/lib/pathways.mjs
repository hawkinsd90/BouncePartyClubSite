// Notification pathways: which Edge Functions can cause a message (or any outbound contact) to leave the system.
//
// The relays (send-email -> Resend, send-sms-notification -> Twilio) are guarded by _shared/notifications/outbound-guard.ts. Every other function is
// either a caller of those relays (so it inherits the guard), or sends nothing. This module classifies function SOURCE text so a new or
// changed function that starts to message people cannot go unnoticed: the test suite compares the classification of every function in
// the repository with the reviewed list below, and `audit-functions` compares a list of the functions deployed to a project with
// both the repository and the reviewed hosted-only list.

export const PATHWAY = {
  PROVIDER_EMAIL: 'provider-email', // talks to Resend; must pass the environment guard
  PROVIDER_SMS: 'provider-sms', // talks to Twilio; must pass the environment guard
  VIA_RELAYS: 'via-relays', // sends only by calling the two relays
  INBOUND_REPLY: 'inbound-reply', // answers the sender of an inbound text (TwiML), nobody else
  NONE: 'none', // sends nothing
};

export function classifyFunctionSource(src) {
  const s = String(src).replace(/\/\*[\s\S]*?\*\//g, '');
  if (/api\.resend\.com/.test(s)) return PATHWAY.PROVIDER_EMAIL;
  if (/api\.twilio\.com/.test(s)) return PATHWAY.PROVIDER_SMS;
  if (/functions\/v1\/send-(email|sms-notification)|invoke\(\s*['"](send-email|send-sms-notification|resend)['"]/.test(s)) return PATHWAY.VIA_RELAYS;
  if (/<Message>/.test(s)) return PATHWAY.INBOUND_REPLY;
  return PATHWAY.NONE;
}

const RELAY_CALL = /functions\/v1\/send-(email|sms-notification)|invoke\(\s*['"](send-email|send-sms-notification|resend)['"]/;
const importKeys = (src) => [...String(src).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1].split('/').pop().replace(/\.(ts|js|mjs)$/, ''));
const STRENGTH = [PATHWAY.PROVIDER_EMAIL, PATHWAY.PROVIDER_SMS, PATHWAY.VIA_RELAYS, PATHWAY.INBOUND_REPLY, PATHWAY.NONE];

// Shared modules that reach the relays, directly or through another shared module. files: [{ path, src }]
export function relayCallingModules(files) {
  const key = (f) => f.path.split('/').pop().replace(/\.(ts|js|mjs)$/, '');
  const set = new Set(files.filter((f) => RELAY_CALL.test(f.src)).map(key));
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of files) if (!set.has(key(f)) && importKeys(f.src).some((k) => set.has(k))) { set.add(key(f)); grew = true; }
  }
  return set;
}

// The strongest pathway among a function's files; importing a relay-calling shared module counts as calling the relays.
export function classifyFunctionFiles(files, relayModules) {
  const found = new Set();
  for (const f of files) {
    found.add(classifyFunctionSource(f.src));
    if (importKeys(f.src).some((k) => relayModules.has(k))) found.add(PATHWAY.VIA_RELAYS);
  }
  return STRENGTH.find((c) => found.has(c));
}

// Any other way of reaching people (a different mail / SMS vendor, SMTP, a chat webhook). None exists today; one appearing must be reviewed.
export const UNREVIEWED_PROVIDER = /sendgrid|mailgun|postmarkapp|nodemailer|smtp\.|SmtpClient|hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|api\.pushover|ntfy\.sh|api\.vonage|api\.messagebird|sns\.[a-z0-9-]+\.amazonaws\.com/i;
export const usesUnreviewedProvider = (src) => UNREVIEWED_PROVIDER.test(String(src));

// Reviewed classification of every Edge Function in this repository (reviewed 2026-10-15). Add a function here only after reading it.
export const REVIEWED_FUNCTIONS = {
  'auth-email-hook': PATHWAY.NONE, // deprecated stub that answers 410
  'backfill-oauth-customers': PATHWAY.NONE,
  'backfill-payment-methods': PATHWAY.NONE,
  'calculate-route-mileage': PATHWAY.NONE,
  'charge-deposit': PATHWAY.VIA_RELAYS,
  'check-availability': PATHWAY.NONE,
  'checkout-bridge': PATHWAY.NONE,
  'complete-booking': PATHWAY.VIA_RELAYS, // through _shared/customer-notice.ts
  'create-admin-user': PATHWAY.NONE, // auth.admin.createUser sends no mail
  'create-booking': PATHWAY.NONE,
  'create-order-short-link': PATHWAY.NONE,
  'customer-balance-payment': PATHWAY.VIA_RELAYS,
  'customer-cancel-order': PATHWAY.VIA_RELAYS,
  'customer-portal-action': PATHWAY.VIA_RELAYS,
  'customer-portal-data': PATHWAY.NONE,
  'fix-payment-method': PATHWAY.NONE,
  'generate-blank-waiver': PATHWAY.NONE,
  'generate-signed-waiver': PATHWAY.NONE,
  'get-payment-method': PATHWAY.NONE,
  'get-session-metadata': PATHWAY.NONE,
  'get-stripe-publishable-key': PATHWAY.NONE,
  'get-user-info': PATHWAY.NONE,
  'get-waiver-status': PATHWAY.NONE,
  'order-lifecycle': PATHWAY.VIA_RELAYS,
  'portal-link': PATHWAY.NONE,
  'promote-media': PATHWAY.NONE,
  'reconcile-balance-payment': PATHWAY.VIA_RELAYS,
  'record-cash-payment': PATHWAY.VIA_RELAYS,
  'record-check-payment': PATHWAY.VIA_RELAYS,
  'record-consent': PATHWAY.NONE,
  'record-site-event': PATHWAY.NONE,
  'request-portal-link': PATHWAY.VIA_RELAYS,
  'resolve-link': PATHWAY.NONE,
  'save-payment-method-from-session': PATHWAY.NONE,
  'save-pending-consent': PATHWAY.NONE,
  'save-signature': PATHWAY.VIA_RELAYS,
  'save-signup-address': PATHWAY.NONE,
  'send-email': PATHWAY.PROVIDER_EMAIL,
  'send-error-notification': PATHWAY.VIA_RELAYS, // invokes a function named "resend" that does not exist: fails closed
  'send-invoice': PATHWAY.VIA_RELAYS,
  'send-sms-notification': PATHWAY.PROVIDER_SMS,
  'staff-order-save': PATHWAY.NONE,
  'stripe-charge': PATHWAY.NONE,
  'stripe-checkout': PATHWAY.NONE,
  'stripe-refund': PATHWAY.NONE,
  'stripe-webhook': PATHWAY.VIA_RELAYS,
  'submit-contact-inquiry': PATHWAY.VIA_RELAYS,
  'sync-google-calendar': PATHWAY.NONE, // writes calendar events; invites nobody
  'task-evidence': PATHWAY.NONE,
  'twilio-status-callback': PATHWAY.NONE,
  'twilio-webhook': PATHWAY.INBOUND_REPLY,
  'upload-physical-waiver': PATHWAY.NONE,
};

// Functions deployed to a hosted project that are NOT in this repository, each read and reviewed. The source hash makes a later change visible.
export const REVIEWED_HOSTED_ONLY = {
  'send-booking-confirmation': {
    project: 'srxunxiytojjsuhcmzjg',
    pathway: PATHWAY.VIA_RELAYS,
    sourceSha256: '6b69bc74191fb714f71a5d68da2682317f0d97aabc3962a2d4a9a76fbb9c1cd5',
    note: 'Sends only by invoking send-sms-notification and send-email with the service role; no provider call of its own. Unauthenticated (verify_jwt false) but claim-protected (one send per order).',
  },
};

// Compares a deployed-function listing with the repository and the reviewed hosted-only list.
//   deployed: array of slugs, or of { slug, ezbr_sha256 }
// Returns { unknown: [...], changedHostedOnly: [...], missingFromProject: [...] }
export function auditDeployedFunctions(deployed, repoSlugs, project) {
  const list = deployed.map((d) => (typeof d === 'string' ? { slug: d } : d));
  const repo = new Set(repoSlugs);
  const unknown = [];
  const changed = [];
  for (const f of list) {
    if (repo.has(f.slug)) continue;
    const reviewed = REVIEWED_HOSTED_ONLY[f.slug];
    if (!reviewed || (reviewed.project && project && reviewed.project !== project)) {
      unknown.push(f.slug);
      continue;
    }
    if (f.ezbr_sha256 && reviewed.sourceSha256 && f.ezbr_sha256 !== reviewed.sourceSha256) changed.push(f.slug);
  }
  return { unknown, changedHostedOnly: changed };
}

// What an operator must confirm about things this tool can not read (hosted function bodies, Auth settings, Edge Function secrets).
export const ATTESTATIONS = {
  'relays-guarded': 'The Development send-email and send-sms-notification functions are deployed from the version that contains the outbound guard, and the Development function list was audited with "audit-functions" (no unreviewed function).',
  'auth-email-contained': 'Development Authentication sends no email to real addresses: no custom SMTP server (or one that only reaches the test inboxes), and no Send Email hook enabled.',
  'stripe-edge-secrets-test': 'The STRIPE_SECRET_KEY Edge Function secret of the Development project (read by get-payment-method, get-session-metadata and stripe-webhook) is a test-mode key, and the Development Stripe webhook points only at Development.',
};
