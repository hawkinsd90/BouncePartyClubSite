/**
 * Tests for the real sendApprovalConfirmationNotifications orchestration.
 *
 * These tests call the actual production function with injected dependencies
 * (mocked createShortPortalLink, sendEmail, supabase client, and sendSms fn)
 * to verify the orchestration logic without hitting real services.
 */

/**
 * Tests for the real sendApprovalConfirmationNotifications orchestration.
 *
 * These tests call the actual production function with injected dependencies
 * (mocked createShortPortalLink, sendEmail, supabase client, and sendSms fn)
 * to verify the orchestration logic without hitting real services.
 *
 * Run with: npx tsx --import ./scripts/env-preload.mjs src/lib/approvalNotification.test.ts
 */

const { sendApprovalConfirmationNotifications } = await import('./orderApprovalService');

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

// --- Tests ---

async function runTests() {
  // 1. createShortPortalLink is called exactly once
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/abc');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'test@test.com', phone: '5551234', first_name: 'John' });

    await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('1 link called once', link.getCallCount() === 1);
  }

  // 2. Email and SMS receive the exact same short URL
  {
    const sb = makeMockSupabase() as any;
    const sharedUrl = 'https://example.com/i/shared';
    const link = makeMockLinkCreator(sharedUrl);
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'both@test.com', phone: '5550000', first_name: 'Jane' });

    await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('2 email html contains url', email.getLastHtml()?.includes(sharedUrl) === true);
    ok('2 sms message contains url', sms.getLastMessage()?.includes(sharedUrl) === true);
  }

  // 3. Email-only customer sends email and does not attempt SMS
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/email-only');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'email-only@test.com', first_name: 'Bob' });

    await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('3 email sent', email.getCallCount() === 1);
    ok('3 sms not attempted', sms.getCallCount() === 0);
  }

  // 4. Phone-only customer sends SMS and does not attempt email
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/phone-only');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ phone: '5559999', first_name: 'Alice' });

    await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('4 sms sent', sms.getCallCount() === 1);
    ok('4 email not attempted', email.getCallCount() === 0);
  }

  // 5. Customer with both receives both using one URL
  {
    const sb = makeMockSupabase() as any;
    const sharedUrl = 'https://example.com/i/both-channels';
    const link = makeMockLinkCreator(sharedUrl);
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'both@test.com', phone: '5551111', first_name: 'Sam' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('5 email sent', email.getCallCount() === 1);
    ok('5 sms sent', sms.getCallCount() === 1);
    ok('5 email has url', email.getLastHtml()?.includes(sharedUrl) === true);
    ok('5 sms has url', sms.getLastMessage()?.includes(sharedUrl) === true);
    ok('5 no errors', result.errors.length === 0);
  }

  // 6. Email failure is returned and recorded
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/email-fail');
    const email = makeMockSendEmail(true);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'fail@test.com', first_name: 'Tom' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('6 email attempted', email.getCallCount() === 1);
    ok('6 emailSent false', result.emailSent === false);
    ok('6 error returned', result.errors.length > 0);
    ok('6 error mentions email', result.errors.some((e: string) => e.toLowerCase().includes('email')));
    ok('6 failure recorded in db', sb._insertRows.some((r: any) => r.channel === 'email'));
  }

  // 7. SMS failure is returned and recorded
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/sms-fail');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(true, false);
    const order = makeOrder({ phone: '5552222', first_name: 'Sue' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('7 sms attempted', sms.getCallCount() === 1);
    ok('7 smsSent false', result.smsSent === false);
    ok('7 error returned', result.errors.length > 0);
    ok('7 error mentions sms', result.errors.some((e: string) => e.toLowerCase().includes('sms')));
    ok('7 failure recorded in db', sb._insertRows.some((r: any) => r.channel === 'sms'));
  }

  // 8. Neither email nor phone returns a notification warning
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/no-contact');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ first_name: 'NoContact' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('8 email not attempted', email.getCallCount() === 0);
    ok('8 sms not attempted', sms.getCallCount() === 0);
    ok('8 has warning', result.errors.length > 0);
    ok('8 warning mentions no email or phone', result.errors.some((e: string) =>
      e.toLowerCase().includes('no customer email') && e.toLowerCase().includes('phone')
    ));
  }

  // 9. Approval remains successful when notification fails (function returns errors, not throw)
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator(null, 'Short-link RPC down');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, false);
    const order = makeOrder({ email: 'test@test.com', phone: '5553333', first_name: 'Joe' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('9 link called once', link.getCallCount() === 1);
    ok('9 email not sent', result.emailSent === false);
    ok('9 sms not sent', result.smsSent === false);
    ok('9 errors returned (not thrown)', result.errors.length > 0);
    ok('9 both channels recorded', sb._insertRows.some((r: any) => r.channel === 'email') && sb._insertRows.some((r: any) => r.channel === 'sms'));
  }

  // 10. SMS returns false (not exception) is also recorded as failure
  {
    const sb = makeMockSupabase() as any;
    const link = makeMockLinkCreator('https://example.com/i/sms-false');
    const email = makeMockSendEmail(false);
    const sms = makeMockSendSms(false, true);
    const order = makeOrder({ phone: '5554444', first_name: 'FalseReturn' });

    const result = await sendApprovalConfirmationNotifications(order, 50000, sms.fn, {
      createLink: link.fn as any,
      sendEmailFn: email.fn as any,
      supabaseClient: sb,
    });

    ok('10 smsSent false', result.smsSent === false);
    ok('10 error mentions sms', result.errors.some((e: string) => e.toLowerCase().includes('sms')));
    ok('10 failure recorded', sb._insertRows.some((r: any) => r.channel === 'sms'));
  }

  console.log(`\nApproval Notification Orchestration Tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
