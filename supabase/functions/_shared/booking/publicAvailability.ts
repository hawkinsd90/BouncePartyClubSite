// Public availability endpoint core (Payment Safety A2.3). Booleans only: no order, customer, address, status or date
// of any other booking is ever part of the response. Any failure to verify answers "not available" (fail closed).

import { verifyBookingAvailability, type AvailabilityPort } from "./bookingAvailability.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
export const MAX_PUBLIC_AVAILABILITY_CHECKS = 60;

export interface PublicAvailabilityResult {
  status: number;
  body: Record<string, unknown>;
}

export async function checkPublicUnitAvailability(port: AvailabilityPort, raw: unknown): Promise<PublicAvailabilityResult> {
  const checks = (raw as { checks?: unknown } | null)?.checks;
  if (!Array.isArray(checks) || checks.length === 0 || checks.length > MAX_PUBLIC_AVAILABILITY_CHECKS) {
    return { status: 400, body: { success: false, error: "Invalid request" } };
  }
  const parsed: Array<{ unitId: string; start: string; end: string }> = [];
  for (const c of checks) {
    if (!c || typeof c !== "object") return { status: 400, body: { success: false, error: "Invalid request" } };
    const { unitId, eventStartDate, eventEndDate } = c as Record<string, unknown>;
    if (typeof unitId !== "string" || !UUID_RE.test(unitId) || typeof eventStartDate !== "string" || !DATE_RE.test(eventStartDate)) {
      return { status: 400, body: { success: false, error: "Invalid request" } };
    }
    const start = eventStartDate.substring(0, 10);
    const end = typeof eventEndDate === "string" && DATE_RE.test(eventEndDate) ? eventEndDate.substring(0, 10) : start;
    if (end < start) return { status: 400, body: { success: false, error: "Invalid request" } };
    parsed.push({ unitId, start, end });
  }

  const results: Array<{ unitId: string; isAvailable: boolean }> = [];
  for (const c of parsed) {
    const verdict = await verifyBookingAvailability(port, { unitIds: [c.unitId], eeItems: [], startDate: c.start, endDate: c.end });
    results.push({ unitId: c.unitId, isAvailable: verdict.ok });
  }
  return { status: 200, body: { success: true, results } };
}
