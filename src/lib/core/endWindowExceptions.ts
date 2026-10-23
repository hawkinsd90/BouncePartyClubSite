// The normal customer booking window for same-day (residential) and commercial rentals ends at 19:00: the customer Quote caps its End Time input
// at this value (src/components/quote/EventDetailsSection.tsx, `max=... '19:00'`; src/hooks/booking/useQuoteForm.ts). Staff may deliberately book a
// later end time on an invoice, so the staff invoice screens do not forbid it: they say so and ask for an explicit confirmation instead
// (useInvoiceEventDetails). Pure rules only; the confirmation dialog and the state live in the hook.
export const SAME_DAY_LATEST_END_TIME = '19:00';

interface EndWindowContext {
  location_type: string;
  pickup_preference: string;
}

/** The rental types the customer Quote limits to SAME_DAY_LATEST_END_TIME. */
export function isEndWindowRestricted(ctx: EndWindowContext): boolean {
  return (ctx.location_type === 'residential' && ctx.pickup_preference === 'same_day') || ctx.location_type === 'commercial';
}

/**
 * True when this end time is outside the normal customer window for the rental type and staff have not yet confirmed THIS exact time.
 * An unchanged, already-confirmed exception is never asked about again; any other end time (or a change of rental type) is evaluated afresh.
 */
export function needsEndWindowConfirmation(ctx: EndWindowContext & { end_window: string; confirmedEndWindow: string | null }): boolean {
  return isEndWindowRestricted(ctx) && ctx.end_window > SAME_DAY_LATEST_END_TIME && ctx.confirmedEndWindow !== ctx.end_window;
}

/** Where the end time goes back to when staff decline the exception: the last accepted time if it is still allowed, otherwise the normal limit. */
export function endWindowAfterDecline(ctx: EndWindowContext & { lastAcceptedEndWindow: string; confirmedEndWindow: string | null }): string {
  return needsEndWindowConfirmation({ ...ctx, end_window: ctx.lastAcceptedEndWindow }) ? SAME_DAY_LATEST_END_TIME : ctx.lastAcceptedEndWindow;
}

export function endWindowExceptionMessage(endWindow: string): string {
  return `${endWindow} is after ${SAME_DAY_LATEST_END_TIME}, outside the normal customer booking window for same-day and commercial rentals (customers cannot choose it on the Quote page). Keep this end time as an exception for this order?`;
}
