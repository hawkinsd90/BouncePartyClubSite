// Feature-local request mechanics for TaskDetailModal, extracted verbatim from its handlers.
//
// postSessionEdge: the session-authenticated POST used by refund, cash, check, charge, cancel and the
// two paper-waiver calls. The caller still fetches the session and passes `session?.access_token`
// (so a missing session still sends "Bearer undefined"). The body is parsed as JSON BEFORE `ok` is
// checked; a non-OK response throws `new Error(data.error || fallbackMessage)`.
//
// postTaskSms: the three equivalent SMS sends (En Route, Arrived, Drop-Off Complete), authenticated with the signed-in
// staff member's session token (the relay rejects the public anon key). It only
// projects the outcome; callers keep their own warnings, failure rows and sequencing. The pickup
// template SMS and email stay inline in the modal, and this is not the global sendSms.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface EdgeRequestDeps {
  fetch?: typeof fetch;
  // Defaults to import.meta.env.VITE_SUPABASE_URL (read lazily so tests can inject).
  baseUrl?: string;
  // The signed-in user's access token (postTaskSms only). Defaults to the current session's token.
  accessToken?: string;
}

export interface SessionEdgeRequest {
  functionName: string;
  accessToken: string | undefined;
  // A plain object is sent as JSON with a Content-Type header; FormData is sent as-is with no
  // Content-Type header (the browser sets the multipart boundary).
  body: Record<string, unknown> | FormData;
  // Used when the response carries no `error` message.
  fallbackMessage: string;
  // charge-deposit only: also fail when the response body has no truthy `success`.
  requireSuccess?: boolean;
}

export async function postSessionEdge(request: SessionEdgeRequest, deps: EdgeRequestDeps = {}): Promise<any> {
  const { functionName, accessToken, body, fallbackMessage, requireSuccess } = request;
  const doFetch = deps.fetch ?? fetch;
  const baseUrl = deps.baseUrl ?? import.meta.env.VITE_SUPABASE_URL;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const r = await doFetch(`${baseUrl}/functions/v1/${functionName}`, isForm
    ? {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: body as FormData,
    }
    : {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const data = await r.json();
  if (requireSuccess ? (!r.ok || !data.success) : !r.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

export type TaskSmsOutcome =
  | { ok: true }
  | { ok: false; warning: string; failureError: string };

// POSTs the given body to send-sms-notification. Never throws; every failure is projected exactly as
// the inline blocks did: a non-OK response is "SMS failed to send" / "SMS endpoint returned <status>"
// (after logging the response text under `label`), and a thrown error is "SMS failed: <message>".
// The current session's access token, or undefined when nobody is signed in.
export async function currentAccessToken(): Promise<string | undefined> {
  try {
    const { supabase } = await import('../../../lib/supabase');
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? undefined;
  } catch {
    return undefined;
  }
}

export async function postTaskSms(body: Record<string, unknown>, label: string, deps: EdgeRequestDeps = {}): Promise<TaskSmsOutcome> {
  const doFetch = deps.fetch ?? fetch;
  const baseUrl = deps.baseUrl ?? import.meta.env.VITE_SUPABASE_URL;
  const accessToken = deps.accessToken ?? (await currentAccessToken());
  if (!accessToken) return { ok: false, warning: 'SMS failed: not signed in', failureError: 'Not signed in' };
  try {
    const r = await doFetch(`${baseUrl}/functions/v1/send-sms-notification`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const failure = { ok: false as const, warning: 'SMS failed to send', failureError: `SMS endpoint returned ${r.status}` };
      console.warn(`${label} SMS failed:`, await r.text());
      return failure;
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, warning: 'SMS failed: ' + e.message, failureError: e.message };
  }
}
