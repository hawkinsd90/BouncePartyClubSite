// WP-P1-16 (F-18, owner decision D1): a stock re-check at confirmation.
//
// charge-deposit re-checks availability before it charges. Confirmations that never reach a charge ("waived", "zero_due_with_card",
// "already_paid" for an approval of an edited order) used to confirm without looking. order-lifecycle now runs this check:
//   - BLOCK: when order-lifecycle is itself about to move the order to confirmed and no money has just been collected by this call,
//     a known conflict or an unverifiable check stops the transition (the caller gets an actionable explanation naming the equipment).
//   - WARN: when the order is ALREADY confirmed (an Admin approval or a payment RPC wrote the status first), or money was just
//     collected, nothing can be undone here and no payment is touched: the conflict is only recorded and added to the Admin alert.
// It never throws and never touches payments. An unreadable stock list is "unverifiable", never a conflict and never "ok".
// Nothing here holds or reserves stock (comprehensive holds are R2).

import { checkEventEssentialsAvailabilityWith } from "./eeOrderItemAvailability.ts";
import { unitsWithConflicts, type AvailabilityPort } from "./bookingAvailability.ts";

// Money the caller has just collected (or recorded): the order is never left in limbo or refused because of stock after the fact.
export const MONEY_COLLECTED_CONFIRM_OUTCOMES: readonly string[] = ["charged_now", "cash"];

export const AVAILABILITY_CONFLICT_CHANGE_TYPE = "availability_conflict";
export const AVAILABILITY_UNVERIFIED_CHANGE_TYPE = "availability_unverified";

export const AVAILABILITY_CONFLICT_SMS_SUFFIX = " CHECK STOCK: an item may be double-booked.";
export const AVAILABILITY_UNVERIFIED_SMS_SUFFIX = " CHECK STOCK: availability could not be verified.";

/** True when order-lifecycle should refuse the transition on a conflict / unverifiable result (it is the writer of the status). */
export function confirmAvailabilityBlocks(paymentOutcome: string, orderStatusBeforeWrite: string): boolean {
  return orderStatusBeforeWrite !== "confirmed" && !MONEY_COLLECTED_CONFIRM_OUTCOMES.includes(paymentOutcome);
}

export type ConfirmAvailabilityResult =
  | { kind: "ok" }
  // `note` is a staff-facing sentence; `unavailable` names the equipment (inflatables by name, Event Essentials with quantities)
  | { kind: "conflict"; note: string; unavailable: string[] }
  | { kind: "unverifiable"; note: string };

export const UNVERIFIABLE_NOTE = "Availability for this order's equipment could not be verified.";

const ymd = (s: string | null | undefined): string => (s ?? "").substring(0, 10);

interface ItemRow {
  unit_id?: string | null;
  product_id?: string | null;
  bundle_id?: string | null;
}

export interface ConfirmAvailabilityNames {
  // unit id -> display name; may return a partial map or throw (names are best effort, never decide the verdict)
  units?: (unitIds: string[]) => Promise<Record<string, string>>;
}

/**
 * Re-checks the order's own items against every other blocking order on its dates. The order itself is excluded. Never throws.
 * `items` are the order's order_items rows (unit_id / product_id / bundle_id / qty / component_snapshot).
 */
export async function checkOrderAvailabilityForConfirm(
  port: AvailabilityPort,
  order: { id: string; event_date: string | null; event_end_date?: string | null },
  items: ItemRow[] | null,
  names: ConfirmAvailabilityNames = {},
): Promise<ConfirmAvailabilityResult> {
  try {
    const start = ymd(order.event_date);
    if (!start || !Array.isArray(items)) return { kind: "unverifiable", note: UNVERIFIABLE_NOTE };
    const end = ymd(order.event_end_date) || start;

    const unitIds = [...new Set(items.filter((r) => !!r.unit_id).map((r) => String(r.unit_id)))];
    const eeRows = items.filter((r) => !r.unit_id && (r.product_id || r.bundle_id));

    let unverifiable = false;
    const unavailable: string[] = [];

    if (unitIds.length > 0) {
      const booked = await port.bookedRanges(unitIds, order.id);
      if (!booked) unverifiable = true;
      else {
        const conflicting = unitsWithConflicts(booked, unitIds, start, end);
        if (conflicting.length > 0) {
          let nameMap: Record<string, string> = {};
          try {
            nameMap = (await names.units?.(conflicting)) ?? {};
          } catch {
            nameMap = {};
          }
          for (const id of conflicting) unavailable.push(nameMap[id] || "an inflatable on this order");
        }
      }
    }

    if (eeRows.length > 0) {
      let rows: unknown[] = [];
      const ee = await checkEventEssentialsAvailabilityWith(
        async (reqItems, s, e, exclude) => {
          const result = await port.productAvailability(reqItems, s, e, exclude);
          if (Array.isArray(result?.data)) rows = result.data;
          return result;
        },
        { items: eeRows, eventDate: start, eventEndDate: end, excludeOrderId: order.id },
      );
      if (!ee.ok) {
        if (ee.kind === "unavailable") {
          const short = (rows as Array<Record<string, unknown>>).filter((r) => r && r.is_allowed === false);
          if (short.length === 0) unavailable.push("Event Essentials items on this order");
          for (const r of short) {
            const name = typeof r.product_name === "string" && r.product_name ? r.product_name : "an Event Essentials item";
            const want = typeof r.quantity_requested === "number" ? r.quantity_requested : null;
            const have = typeof r.available_before_request === "number" ? Math.max(0, r.available_before_request) : null;
            unavailable.push(want !== null && have !== null ? `${name} (need ${want}, ${have} available)` : name);
          }
        } else unverifiable = true;
      }
    }

    if (unavailable.length > 0) {
      return {
        kind: "conflict",
        unavailable,
        note: `Not available for the event dates: ${unavailable.join("; ")}. Another active order holds this equipment on the same dates.`,
      };
    }
    return unverifiable ? { kind: "unverifiable", note: UNVERIFIABLE_NOTE } : { kind: "ok" };
  } catch {
    return { kind: "unverifiable", note: UNVERIFIABLE_NOTE };
  }
}

/** The sentence a caller of a BLOCKED confirmation sees (names the equipment; says what to do; never mentions payment). */
export function blockedConfirmationMessage(result: Exclude<ConfirmAvailabilityResult, { kind: "ok" }>): string {
  if (result.kind === "conflict") {
    return `This order could not be confirmed: ${result.unavailable.join("; ")} ${result.unavailable.length === 1 ? "is" : "are"} not available for the event dates. Choose different dates or equipment, or contact us. This did not change any payment.`;
  }
  return "This order could not be confirmed because equipment availability could not be verified. It needs a review by our team; please try again shortly or contact us. This did not change any payment.";
}
