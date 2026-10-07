// Customer Portal action payload validation (Payment Safety A2.2).
//
// Every customer mutation is a NAMED action with an exact payload shape. An unknown action, an unknown key, a wrong type
// or an out-of-range value is rejected before anything touches the database. There is no generic "update this field"
// path: the caller can never choose a table, a column or a filter.
// Import-free so the Node test harness can load it unchanged.

export type PortalActionName =
  | "invoice_accept_details"
  | "invoice_select_payment"
  | "invoice_confirm_no_card"
  | "approve_changes"
  | "reject_changes"
  | "register_lot_pictures"
  | "delete_lot_picture"
  | "register_order_pictures"
  | "check_unit_availability";

export const PORTAL_ACTION_NAMES: readonly PortalActionName[] = [
  "invoice_accept_details",
  "invoice_select_payment",
  "invoice_confirm_no_card",
  "approve_changes",
  "reject_changes",
  "register_lot_pictures",
  "delete_lot_picture",
  "register_order_pictures",
  "check_unit_availability",
];

// Same values the ReferralSourceSelect offers.
export const REFERRAL_SOURCES: readonly string[] = ["social_media", "google", "physical_marketing", "referral", "returning_customer", "other"];
export const PAYMENT_TYPES: readonly string[] = ["deposit", "full", "custom"];

export const MAX_LOT_PICTURES = 4;
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const MAX_CENTS = 100_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isCents = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_CENTS;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null);

// True when the object has no keys outside the allowed set.
function onlyKeys(o: Obj, allowed: readonly string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

// A storage object path must live in the order's own folder and may not climb out of it.
export function isOrderStoragePath(path: unknown, orderId: string): path is string {
  return (
    typeof path === "string" &&
    path.length <= 300 &&
    path.startsWith(`${orderId}/`) &&
    !path.includes("..") &&
    !path.includes("//") &&
    !path.includes("\\") &&
    /^[A-Za-z0-9._\-/]+$/.test(path)
  );
}

export interface ValidatedAction {
  name: PortalActionName;
  payload: Obj;
}

export function validateAction(name: unknown, payload: unknown, orderId: string): ValidatedAction | null {
  if (typeof name !== "string" || !PORTAL_ACTION_NAMES.includes(name as PortalActionName)) return null;
  const p: Obj = payload === undefined || payload === null ? {} : isObj(payload) ? payload : ({ __bad: true } as Obj);
  if ("__bad" in p) return null;

  switch (name as PortalActionName) {
    case "invoice_accept_details": {
      if (!onlyKeys(p, ["customer", "cardOnFileConsent", "smsConsent", "referralSource", "referralSourceDetail", "tipCents"])) return null;
      if (typeof p.cardOnFileConsent !== "boolean" || typeof p.smsConsent !== "boolean") return null;
      const out: Obj = { cardOnFileConsent: p.cardOnFileConsent, smsConsent: p.smsConsent };
      if (p.customer !== undefined) {
        if (!isObj(p.customer) || !onlyKeys(p.customer, ["first_name", "last_name", "email", "phone", "business_name"])) return null;
        const first = str(p.customer.first_name, 100);
        const last = str(p.customer.last_name, 100);
        const email = str(p.customer.email, 254);
        const phone = str(p.customer.phone, 40);
        if (!first || !last || !email || !phone || !EMAIL_RE.test(email)) return null;
        let business: string | null = null;
        if (p.customer.business_name !== undefined && p.customer.business_name !== null && p.customer.business_name !== "") {
          business = str(p.customer.business_name, 150);
          if (!business) return null;
        }
        out.customer = { first_name: first, last_name: last, email, phone, business_name: business };
      }
      if (p.referralSource !== undefined && p.referralSource !== null && p.referralSource !== "") {
        if (typeof p.referralSource !== "string" || !REFERRAL_SOURCES.includes(p.referralSource)) return null;
        out.referralSource = p.referralSource;
        if (p.referralSourceDetail !== undefined && p.referralSourceDetail !== null && p.referralSourceDetail !== "") {
          const detail = str(p.referralSourceDetail, 200);
          if (!detail) return null;
          out.referralSourceDetail = detail;
        }
      } else if (p.referralSourceDetail) {
        return null;
      }
      if (p.tipCents !== undefined && p.tipCents !== null) {
        if (!isCents(p.tipCents)) return null;
        out.tipCents = p.tipCents;
      }
      return { name: "invoice_accept_details", payload: out };
    }
    case "invoice_select_payment": {
      if (!onlyKeys(p, ["amountCents", "type"])) return null;
      if (!isCents(p.amountCents) || typeof p.type !== "string" || !PAYMENT_TYPES.includes(p.type)) return null;
      return { name: "invoice_select_payment", payload: { amountCents: p.amountCents, type: p.type } };
    }
    case "invoice_confirm_no_card":
    case "check_unit_availability": {
      if (Object.keys(p).length > 0) return null;
      return { name: name as PortalActionName, payload: {} };
    }
    case "approve_changes": {
      if (!onlyKeys(p, ["selectedPaymentCents", "selectedPaymentType", "tipCents"])) return null;
      if (!isCents(p.selectedPaymentCents) || typeof p.selectedPaymentType !== "string" || !PAYMENT_TYPES.includes(p.selectedPaymentType)) return null;
      const out: Obj = { selectedPaymentCents: p.selectedPaymentCents, selectedPaymentType: p.selectedPaymentType };
      if (p.tipCents !== undefined && p.tipCents !== null) {
        if (!isCents(p.tipCents)) return null;
        if (p.tipCents > 0) out.tipCents = p.tipCents;
      }
      return { name: "approve_changes", payload: out };
    }
    case "reject_changes": {
      if (!onlyKeys(p, ["reason"])) return null;
      if (p.reason === undefined || p.reason === null || p.reason === "") return { name: "reject_changes", payload: { reason: null } };
      const reason = str(p.reason, 500);
      return reason ? { name: "reject_changes", payload: { reason } } : null;
    }
    case "register_lot_pictures": {
      if (!onlyKeys(p, ["files"]) || !Array.isArray(p.files) || p.files.length < 1 || p.files.length > MAX_LOT_PICTURES) return null;
      const files: Obj[] = [];
      for (const f of p.files) {
        if (!isObj(f) || !onlyKeys(f, ["path", "name"])) return null;
        const name = str(f.name, 255);
        if (!isOrderStoragePath(f.path, orderId) || !name) return null;
        files.push({ path: f.path, name });
      }
      return { name: "register_lot_pictures", payload: { files } };
    }
    case "delete_lot_picture": {
      if (!onlyKeys(p, ["pictureId"]) || typeof p.pictureId !== "string" || !UUID_RE.test(p.pictureId)) return null;
      return { name: "delete_lot_picture", payload: { pictureId: p.pictureId } };
    }
    case "register_order_pictures": {
      if (!onlyKeys(p, ["files", "notes"]) || !Array.isArray(p.files) || p.files.length < 1 || p.files.length > 20) return null;
      const files: Obj[] = [];
      for (const f of p.files) {
        if (!isObj(f) || !onlyKeys(f, ["path", "name", "size", "mimeType"])) return null;
        const name = str(f.name, 255);
        const mime = typeof f.mimeType === "string" && f.mimeType.length <= 100 ? f.mimeType : "";
        const size = typeof f.size === "number" && Number.isInteger(f.size) && f.size >= 0 && f.size <= MAX_PICTURE_BYTES ? f.size : null;
        if (!isOrderStoragePath(f.path, orderId) || !name || size === null || !/^(image\/|application\/pdf$)/.test(mime)) return null;
        files.push({ path: f.path, name, size, mimeType: mime });
      }
      let notes: string | null = null;
      if (p.notes !== undefined && p.notes !== null && p.notes !== "") {
        notes = str(p.notes, 2000);
        if (!notes) return null;
      }
      return { name: "register_order_pictures", payload: { files, notes } };
    }
  }
  return null;
}

// Server-side check of a chosen payment amount against the order's own figures (no new arithmetic: the same
// deposit / full / custom amounts the invoice screen offers).
export function paymentSelectionIsValid(
  selection: { amountCents: number; type: string },
  order: { deposit_due_cents?: number | null; balance_due_cents?: number | null },
): boolean {
  const deposit = order.deposit_due_cents ?? 0;
  const total = deposit + (order.balance_due_cents ?? 0);
  if (selection.type === "deposit") return selection.amountCents === deposit;
  if (selection.type === "full") return selection.amountCents === total;
  if (selection.type === "custom") return selection.amountCents >= deposit && selection.amountCents <= total;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Capability split and approval-selection invariants (Payment Safety A2.2 correction)
// ---------------------------------------------------------------------------------------------------------------

// Actions that only make sense for an Admin Invoice. A normal portal token proves access to the order, not that the
// order is an invoice, so these additionally require an invoice context (see invoiceContextAllowed).
export const INVOICE_ONLY_ACTIONS: readonly PortalActionName[] = ["invoice_accept_details", "invoice_select_payment", "invoice_confirm_no_card"];

export interface OrderTotalInputs {
  subtotal_cents?: number | null;
  travel_fee_cents?: number | null;
  surface_fee_cents?: number | null;
  same_day_pickup_fee_cents?: number | null;
  same_day_weekday_delivery_fee_cents?: number | null;
  generator_fee_cents?: number | null;
  setup_fee_cents?: number | null;
  tax_cents?: number | null;
}

// Mirrors src/lib/orderSummary.ts calculateTotalFromOrder (the figure the approval screen shows as the order total):
// subtotal + fees + custom fees - discounts + tax. Tip is separate and not part of the total.
export function orderTotalCents(
  order: OrderTotalInputs,
  discounts: Array<{ amount_cents?: number | null; percentage?: number | null }>,
  customFees: Array<{ amount_cents?: number | null }>,
): number {
  const subtotal = order.subtotal_cents || 0;
  const totalFees =
    (order.travel_fee_cents || 0) +
    (order.surface_fee_cents || 0) +
    (order.same_day_pickup_fee_cents || 0) +
    (order.same_day_weekday_delivery_fee_cents || 0) +
    (order.generator_fee_cents || 0) +
    (order.setup_fee_cents || 0);
  const totalCustomFees = customFees.reduce((sum, f) => sum + (f.amount_cents || 0), 0);
  const discountTotal = discounts.reduce((sum, d) => {
    if (d.percentage) return sum + Math.round(subtotal * (d.percentage / 100));
    return sum + (d.amount_cents || 0);
  }, 0);
  return subtotal + totalFees + totalCustomFees - discountTotal + (order.tax_cents || 0);
}

// Server-side bounds for what the approval screen can legitimately send as the customer's payment selection, without
// changing the UX:
//   - never below the order's CURRENT deposit, never above the CURRENT order total;
//   - "deposit" must equal the current deposit, "full" must equal the current total, "custom" may be anything between;
//   - "keep original payment" re-sends the stored selection, which may no longer equal the current deposit/total after
//     an admin edit (it only has to still sit inside the bounds);
//   - a zero selection is only possible when the current deposit is zero.
export function approvalSelectionIsValid(
  selection: { selectedPaymentCents: number; selectedPaymentType: string },
  order: { deposit_due_cents?: number | null; customer_selected_payment_cents?: number | null },
  totalCents: number,
): boolean {
  const c = selection.selectedPaymentCents;
  const deposit = order.deposit_due_cents ?? 0;
  const ceiling = Math.max(totalCents, deposit);
  if (!Number.isInteger(c) || c < deposit || c > ceiling) return false;
  const stored = order.customer_selected_payment_cents ?? 0;
  const retained = stored > 0 && c === stored;
  switch (selection.selectedPaymentType) {
    case "deposit":
      return c === deposit || retained;
    case "full":
      return c === ceiling || retained;
    case "custom":
      return true;
    default:
      return false;
  }
}

// A tip can never exceed the order total (the screen offers up to 20%, plus a custom amount).
export function approvalTipIsValid(tipCents: number | undefined, totalCents: number): boolean {
  return tipCents === undefined || (Number.isInteger(tipCents) && tipCents >= 0 && tipCents <= Math.max(totalCents, 0));
}
