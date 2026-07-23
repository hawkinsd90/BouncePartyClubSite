/**
 * Tests for the real sendApprovalConfirmationNotifications and
 * sendCardDeclinedNotifications orchestration, plus buildDeclineAdminMessage.
 *
 * Run with: npx tsx --import ./scripts/env-preload.mjs src/lib/approvalNotification.test.ts
 */

const mod = await import('./orderApprovalService');
const { sendApprovalConfirmationNotifications, sendCardDeclinedNotifications, buildDeclineAdminMessage } = mod;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${name}`); }
}

// --- Mock helpers ---

function makeMockSupabase() {
  const insertRows: any[] = [];
  const mockFrom = {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
    insert: (rows: any) => {
      if (Array.isArray(rows)) insertRows.push(...rows);
      else insertRows.push(rows);
      return Promise.resolve({ error: null });
    },
  };
  return {
    from: (_table: string) => mockFrom,
    _insertRows: insertRows,
  };
}

function makeMockLinkCreator(url: string | null, error?: string) {
  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (url) return { success: true, url, shortCode: 'abc123' };
    return { success: false, error: error || 'link failed' };
  };
  return { fn, getCallCount: () => callCount };
}

function makeMockSendEmail(shouldFail: boolean) {
  let callCount = 0;
  let lastTo: string | null = null;
  let lastHtml: string | null = null;
  const fn = async (opts: { to: string; subject: string; html: string }) => {
    callCount++;
    lastTo = opts.to;
    lastHtml = opts.html;
    if (shouldFail) throw new Error('SMTP relay down');
    return { success: true };
  };
  return { fn, getCallCount: () => callCount, getLastTo: () => lastTo, getLastHtml: () => lastHtml };
}

function makeMockSendSms(shouldFail: boolean, shouldReturnFalse: boolean) {
  let callCount = 0;
  let lastMessage: string | null = null;
  const fn = async (message: string) => {
    callCount++;
    lastMessage = message;
    if (shouldFail) throw new Error('Twilio error');
    return !shouldReturnFalse;
  };
  return { fn, getCallCount: () => callCount, getLastMessage: () => lastMessage };
}

function makeOrder(customer: any) {
  return {
    id: 'order-123',
    event_date: '2026-08-01',
    customers: customer,
    addresses: { street: '123 Main St' },
    order_items: [],
  };
}

// --- Confirmation notification tests ---

async function runConfirmationTests() {
  // 1. No-contact customer does not call createShortPortalLink
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/no-contact');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ first_name: 'NoContact' });

    await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('1 link not called', link.getCallCount() === 0);
  }

  // 2. No-contact customer creates zero notification failure rows
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/no-contact');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ first_name: 'NoContact' });

    await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('2 zero failure rows', sb._insertRows.length === 0);
  }

  // 3. No-contact customer leaves emailSent and smsSent null
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/no-contact');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ first_name: 'NoContact' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('3 emailSent null', result.emailSent === null);
    ok('3 smsSent null', result.smsSent === null);
  }

  // 4. Email-only link failure records email only
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator(null, 'Short-link RPC down');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'email-only@test.com', first_name: 'Bob' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('4 emailSent false', result.emailSent === false);
    ok('4 email failure recorded', sb._insertRows.some((r: any) => r.channel === 'email'));
    ok('4 no sms failure recorded', !sb._insertRows.some((r: any) => r.channel === 'sms'));
    ok('4 exactly one failure row', sb._insertRows.length === 1);
  }

  // 5. Email-only link failure leaves smsSent null
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator(null, 'Short-link RPC down');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'email-only@test.com', first_name: 'Bob' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('5 smsSent null', result.smsSent === null);
    ok('5 emailSent false', result.emailSent === false);
  }

  // 6. Phone-only link failure records SMS only
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator(null, 'Short-link RPC down');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ phone: '5559999', first_name: 'Alice' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('6 smsSent false', result.smsSent === false);
    ok('6 sms failure recorded', sb._insertRows.some((r: any) => r.channel === 'sms'));
    ok('6 no email failure recorded', !sb._insertRows.some((r: any) => r.channel === 'email'));
    ok('6 exactly one failure row', sb._insertRows.length === 1);
  }

  // 7. Phone-only link failure leaves emailSent null
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator(null, 'Short-link RPC down');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ phone: '5559999', first_name: 'Alice' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('7 emailSent null', result.emailSent === null);
    ok('7 smsSent false', result.smsSent === false);
  }

  // 8. Both-channel link failure records exactly two rows
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator(null, 'Short-link RPC down');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'both@test.com', phone: '5551111', first_name: 'Sam' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('8 exactly two rows', sb._insertRows.length === 2);
    ok('8 has email row', sb._insertRows.some((r: any) => r.channel === 'email'));
    ok('8 has sms row', sb._insertRows.some((r: any) => r.channel === 'sms'));
    ok('8 emailSent false', result.emailSent === false);
    ok('8 smsSent false', result.smsSent === false);
  }

  // 9. Missing customer relation returns the no-contact warning
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/null-customer');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder(null);

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('9 link not called', link.getCallCount() === 0);
    ok('9 has no-contact warning', result.errors.some((e: string) =>
      e.toLowerCase().includes('no customer email') && e.toLowerCase().includes('phone')
    ));
    ok('9 emailSent null', result.emailSent === null);
    ok('9 smsSent null', result.smsSent === null);
  }

  // 10. Relation reload failure produces notificationWarning and never produces "customer notified" success message
  // (This is tested via the approval function's caller behavior — here we verify the function itself
  //  returns errors without claiming success when no channels exist)
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/reload-fail');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder(null);

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    // The function must NOT return emailSent=true or smsSent=true
    ok('10 no emailSent true', result.emailSent !== true);
    ok('10 no smsSent true', result.smsSent !== true);
    // Must have the no-contact warning
    ok('10 has warning', result.errors.length > 0);
    ok('10 warning is no-contact', result.errors.some((e: string) =>
      e.toLowerCase().includes('no customer email')
    ));
  }

  // Shared URL test: both channels receive same URL
  {
    const sb = makeMockSupabase() as any;
    const sharedUrl = 'https://example.com/i/shared';
    const link = makeMockLinkCreator(sharedUrl);
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'both@test.com', phone: '5550000', first_name: 'Jane' });

    await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('shared email has url', email.getLastHtml()?.includes(sharedUrl) === true);
    ok('shared sms has url', sms.getLastMessage()?.includes(sharedUrl) === true);
  }

  // Email-only sends email, does not attempt SMS
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/email-only');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'email-only@test.com', first_name: 'Bob' });

    await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('email-only email sent', email.getCallCount() === 1);
    ok('email-only sms not attempted', sms.getCallCount() === 0);
  }

  // Phone-only sends SMS, does not attempt email
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/phone-only');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ phone: '5559999', first_name: 'Alice' });

    await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('phone-only sms sent', sms.getCallCount() === 1);
    ok('phone-only email not attempted', email.getCallCount() === 0);
  }

  // SMS returns false is treated as failure
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/sms-false');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, true);
    const order = makeOrder({ phone: '5554444', first_name: 'FalseReturn' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('sms false smsSent false', result.smsSent === false);
    ok('sms false error mentions sms', result.errors.some((e: string) => e.toLowerCase().includes('sms')));
    ok('sms false failure recorded', sb._insertRows.some((r: any) => r.channel === 'sms'));
  }
}

// --- Card-decline notification tests ---

async function runDeclineTests() {
  // 11. Email-only decline sends email only
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/decline-email');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'decline@test.com', first_name: 'DeclineEmail' });

    const result = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('11 email sent', email.getCallCount() === 1);
    ok('11 sms not attempted', sms.getCallCount() === 0);
    ok('11 emailSent true', result.emailSent === true);
    ok('11 smsSent null', result.smsSent === null);
  }

  // 12. Phone-only decline sends SMS only
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/decline-sms');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ phone: '5558888', first_name: 'DeclineSms' });

    const result = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('12 sms sent', sms.getCallCount() === 1);
    ok('12 email not attempted', email.getCallCount() === 0);
    ok('12 smsSent true', result.smsSent === true);
    ok('12 emailSent null', result.emailSent === null);
  }

  // 13. SMS returning false is treated as failure
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/decline-sms-false');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, true);
    const order = makeOrder({ phone: '5557777', first_name: 'FalseSms' });

    const result = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('13 smsSent false', result.smsSent === false);
    ok('13 error mentions sms', result.errors.some((e: string) => e.toLowerCase().includes('sms')));
    ok('13 failure recorded', sb._insertRows.some((r: any) => r.channel === 'sms'));
  }

  // 14. Email failure is treated as failure
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/decline-email-fail');
    const email = makeMockSendEmail(true);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'fail@decline.com', first_name: 'FailEmail' });

    const result = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('14 emailSent false', result.emailSent === false);
    ok('14 error mentions email', result.errors.some((e: string) => e.toLowerCase().includes('email')));
    ok('14 failure recorded', sb._insertRows.some((r: any) => r.channel === 'email'));
  }

  // 15. Link failure records only available channels
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator(null, 'Short-link RPC down');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'link-fail@decline.com', first_name: 'LinkFail' });

    const result = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('15 email failure recorded', sb._insertRows.some((r: any) => r.channel === 'email'));
    ok('15 no sms failure recorded', !sb._insertRows.some((r: any) => r.channel === 'sms'));
    ok('15 exactly one row', sb._insertRows.length === 1);
    ok('15 emailSent false', result.emailSent === false);
    ok('15 smsSent null', result.smsSent === null);
  }

  // 16. No-contact decline does not create a short link
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/decline-no-contact');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ first_name: 'NoContactDecline' });

    const result = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    ok('16 link not called', link.getCallCount() === 0);
    ok('16 zero failure rows', sb._insertRows.length === 0);
    ok('16 has no-contact warning', result.errors.some((e: string) =>
      e.toLowerCase().includes('no customer email')
    ));
  }

  // 17. Successful single-channel notification does not claim both SMS and email
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/decline-single');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'single@decline.com', first_name: 'SingleChannel' });

    const notifResult = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    const adminMsg = buildDeclineAdminMessage('Payment failed.', notifResult);

    ok('17 emailSent true', notifResult.emailSent === true);
    ok('17 smsSent null', notifResult.smsSent === null);
    // Must NOT claim both channels
    ok('17 does not say "via email and SMS"', !adminMsg.toLowerCase().includes('email and sms'));
    // Should say "customer was notified" since email succeeded
    ok('17 says customer was notified', adminMsg.includes('customer was notified'));
  }

  // 18. Failed decline notification tells Admin to contact the customer manually
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator(null, 'Short-link RPC down');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'manual@decline.com', first_name: 'ManualContact' });

    const notifResult = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    const adminMsg = buildDeclineAdminMessage('Payment failed.', notifResult);

    ok('18 says contact manually', adminMsg.toLowerCase().includes('contact the customer manually'));
  }

  // Both-channel decline success: admin message says "customer was notified"
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/decline-both');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'both@decline.com', phone: '5556666', first_name: 'BothDecline' });

    const notifResult = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    const adminMsg = buildDeclineAdminMessage('Payment failed.', notifResult);

    ok('both decline emailSent true', notifResult.emailSent === true);
    ok('both decline smsSent true', notifResult.smsSent === true);
    ok('both decline says notified', adminMsg.includes('customer was notified'));
    ok('both decline no manual contact', !adminMsg.toLowerCase().includes('contact the customer manually'));
  }

  // No-contact decline admin message
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/decline-no-contact-msg');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ first_name: 'NoContactMsg' });

    const notifResult = await sendCardDeclinedNotifications(order, 'order-123', sms.fn, {
      createLink: link.fn as any, sendEmailFn: email.fn as any, supabaseClient: sb,
    });

    const adminMsg = buildDeclineAdminMessage('Payment failed.', notifResult);

    ok('no-contact decline says no email or phone', adminMsg.toLowerCase().includes('no customer email address or phone number'));
  }
}

async function runTests() {
  await runConfirmationTests();
  await runDeclineTests();
  console.log(`\nApproval Notification Orchestration Tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
