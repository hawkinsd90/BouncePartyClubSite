// The decision an Admin goes through before a unit is deleted or deactivated: look up its future bookings, then
//   none    -> delete asks the ordinary "are you sure"; deactivate needs no question
//   found   -> the existing WARNING listing the bookings, and an explicit confirmation
//   unknown -> the lookup FAILED. Nothing may proceed on that basis: the Admin is told, and can only try the check again or cancel.
// The dialog is injected (showConfirm in the app) so the whole flow, including "the delete was not reached", can be executed in tests.
import { describeFutureBooking, type FutureBookingCheck } from './futureBooking';

export type UnitAction = 'delete' | 'deactivate';
export type ConfirmFn = (message: string, options?: { confirmText?: string; cancelText?: string; type?: 'warning' | 'info' }) => Promise<boolean>;

const PREVIEW_COUNT = 5;

export function futureBookingWarning(unitName: string, action: UnitAction, bookings: Parameters<typeof describeFutureBooking>[0][]): string {
  const details = bookings.slice(0, PREVIEW_COUNT).map(describeFutureBooking).join('\n');
  const more = bookings.length > PREVIEW_COUNT ? `\n...and ${bookings.length - PREVIEW_COUNT} more` : '';
  const consequence =
    action === 'delete'
      ? 'Deleting this unit may cause issues with these orders.'
      : 'Marking this unit as inactive may cause issues with these orders.';
  return `WARNING: "${unitName}" has ${bookings.length} future booking(s)!\n\n${details}${more}\n\n${consequence} Are you sure you want to continue?`;
}

export function verificationFailedMessage(unitName: string, action: UnitAction, error: string): string {
  const doing = action === 'delete' ? 'deleting' : 'deactivating';
  return `Could not check "${unitName}" for future bookings (${error}).\n\nNothing has been changed, and ${doing} it is blocked until the check succeeds, because an unchecked unit might still be booked. Check your connection and try again.`;
}

export const RETRY_CHECK_OPTIONS = { confirmText: 'Try again', cancelText: 'Cancel', type: 'warning' as const };

/**
 * Resolves true only when the action may go ahead: the lookup succeeded and, where a question applies, the Admin confirmed it.
 * A failed lookup never resolves true; it loops through "Try again" until the check succeeds or the Admin cancels.
 */
export async function confirmUnitAction(args: {
  unitName: string;
  action: UnitAction;
  check: () => Promise<FutureBookingCheck>;
  ask: ConfirmFn;
}): Promise<boolean> {
  const { unitName, action, check, ask } = args;
  for (;;) {
    const result = await check();
    if (result.status === 'unknown') {
      const retry = await ask(verificationFailedMessage(unitName, action, result.error), RETRY_CHECK_OPTIONS);
      if (!retry) return false;
      continue;
    }
    if (result.status === 'found') return ask(futureBookingWarning(unitName, action, result.bookings));
    return action === 'delete' ? ask(`Are you sure you want to delete "${unitName}"?`) : true;
  }
}
