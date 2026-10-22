// Server availability verification (Payment Safety A2.3), shared by create-booking and the public check-availability
// endpoint so both apply identical rules. Port of src/lib/availability.ts (inflatables / blackout) and the Event
// Essentials product-availability check the Checkout runs today.
//
// The data access is behind a small port so the rules are testable without a database. Every uncertainty fails closed
// (an unreadable blackout table or booking list is "cannot verify", never "available").
//
// Nothing here returns order, customer or address information: results are booleans / reason codes only.

import { checkEventEssentialsAvailabilityWith } from "./eeOrderItemAvailability.ts";

export const BLOCKING_ORDER_STATUSES = [
  "pending_review",
  "awaiting_customer_approval",
  "approved",
  "confirmed",
  "in_progress",
  "completed",
] as const;

export interface BlackoutResult {
  is_full_blocked: boolean;
  is_same_day_pickup_blocked: boolean;
}

export interface BookedRange {
  unit_id: string;
  event_date: string;
  event_end_date: string | null;
  status: string;
}

export interface AvailabilityPort {
  // null = the blackout lookup failed
  blackout(start: string, end: string): Promise<BlackoutResult | null>;
  // Existing bookings for these units in any blocking status. null = the lookup failed.
  bookedRanges(unitIds: string[]): Promise<BookedRange[] | null>;
  productAvailability(
    items: Array<{ product_id: string; quantity: number }>,
    start: string,
    end: string,
    // An existing order whose own items must not count against itself (an approval re-checks an order that already holds its stock).
    excludeOrderId?: string | null,
  ): Promise<{ data?: unknown[] | null; error?: string | null }>;
}

export type AvailabilityReason = "blackout" | "same_day_blocked" | "unit_unavailable" | "ee_unavailable" | "unverifiable";

export type AvailabilityVerdict =
  | { ok: true }
  | { ok: false; reason: AvailabilityReason; unitIds?: string[] };

const ymd = (s: string | null | undefined): string => (s ?? "").substring(0, 10);

// Inclusive date-range overlap (YYYY-MM-DD strings compare correctly as text).
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function unitsWithConflicts(booked: BookedRange[], unitIds: string[], start: string, end: string): string[] {
  const wanted = new Set(unitIds);
  const blocking = new Set<string>(BLOCKING_ORDER_STATUSES);
  const conflicted = new Set<string>();
  for (const b of booked) {
    if (!wanted.has(b.unit_id) || !blocking.has(b.status)) continue;
    const bStart = ymd(b.event_date);
    const bEnd = ymd(b.event_end_date) || bStart;
    if (!bStart) continue;
    if (rangesOverlap(start, end, bStart, bEnd)) conflicted.add(b.unit_id);
  }
  return [...conflicted];
}

export async function verifyBookingAvailability(
  port: AvailabilityPort,
  req: {
    unitIds: string[];
    // Event Essentials order-item shaped rows (product_id / bundle_id + qty [+ component_snapshot])
    eeItems: unknown[];
    startDate: string;
    endDate: string;
    sameDayOrder?: boolean;
    excludeOrderId?: string | null;
  },
): Promise<AvailabilityVerdict> {
  const blackout = await port.blackout(req.startDate, req.endDate);
  if (!blackout) return { ok: false, reason: "unverifiable" };
  if (blackout.is_full_blocked) return { ok: false, reason: "blackout" };
  if (blackout.is_same_day_pickup_blocked && req.sameDayOrder) return { ok: false, reason: "same_day_blocked" };

  const uniqueUnits = [...new Set(req.unitIds)];
  if (uniqueUnits.length > 0) {
    const booked = await port.bookedRanges(uniqueUnits);
    if (!booked) return { ok: false, reason: "unverifiable" };
    const conflicts = unitsWithConflicts(booked, uniqueUnits, req.startDate, req.endDate);
    if (conflicts.length > 0) return { ok: false, reason: "unit_unavailable", unitIds: conflicts };
  }

  if (req.eeItems.length > 0) {
    const ee = await checkEventEssentialsAvailabilityWith(
      (items, start, end, exclude) => port.productAvailability(items, start, end, exclude),
      { items: req.eeItems, eventDate: req.startDate, eventEndDate: req.endDate, excludeOrderId: req.excludeOrderId ?? undefined },
    );
    if (!ee.ok) return { ok: false, reason: ee.kind === "unavailable" ? "ee_unavailable" : "unverifiable" };
  }
  return { ok: true };
}

// Supabase-backed port (service-role client). Not used by tests.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseAvailabilityPort(db: any): AvailabilityPort {
  return {
    async blackout(start, end) {
      const { data, error } = await db.rpc("check_date_blackout", { p_start: start.substring(0, 10), p_end: end.substring(0, 10) });
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { is_full_blocked: false, is_same_day_pickup_blocked: false };
      return { is_full_blocked: row.is_full_blocked === true, is_same_day_pickup_blocked: row.is_same_day_pickup_blocked === true };
    },
    async bookedRanges(unitIds) {
      const { data, error } = await db
        .from("order_items")
        .select("unit_id, orders!inner(event_date, event_end_date, status)")
        .in("unit_id", unitIds)
        .in("orders.status", [...BLOCKING_ORDER_STATUSES]);
      if (error || !Array.isArray(data)) return null;
      // deno-lint-ignore no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data.map((r: any) => ({
        unit_id: r.unit_id,
        event_date: r.orders?.event_date,
        event_end_date: r.orders?.event_end_date ?? null,
        status: r.orders?.status,
      }));
    },
    async productAvailability(items, start, end, excludeOrderId) {
      const { data, error } = await db.rpc("check_product_availability", {
        p_requested_items: items,
        p_start_date: start,
        p_end_date: end,
        p_exclude_order_id: excludeOrderId ?? null,
      });
      return { data: data ?? null, error: error ? String(error.message ?? error) : null };
    },
  };
}
