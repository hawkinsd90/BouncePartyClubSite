// WP-12 (B8): the start-of-day mileage requirement.
//
// The owner can switch the requirement off (admin setting `require_start_mileage`, exposed to crew through
// get_public_business_settings()). Anything other than an explicit "false" counts as required, so a missing, empty or
// garbled value never lets the check be skipped by accident.

export function parseRequireStartMileage(raw: unknown): boolean {
  return !(typeof raw === 'string' && raw.trim().toLowerCase() === 'false');
}

export interface MileageLogLike {
  start_mileage?: number | null;
}

// A start reading counts when it is a positive number. (0 is not a plausible odometer reading and was always treated as missing.)
export function hasStartReading(log: MileageLogLike | null | undefined): boolean {
  return !!log && typeof log.start_mileage === 'number' && Number.isFinite(log.start_mileage) && log.start_mileage > 0;
}

export function shouldBlockForStartMileage(required: boolean, log: MileageLogLike | null | undefined): boolean {
  return required && !hasStartReading(log);
}

export type MileageGatedAction = 'en_route' | 'arrived' | 'drop_off' | 'pickup';

export const START_MILEAGE_PROMPTS: Record<MileageGatedAction, string> = {
  en_route: 'Starting mileage required before marking tasks as En Route.\n\nWould you like to record your starting mileage now?',
  arrived: 'You must enter your starting mileage before marking tasks. Please use the "Start Day Mileage" button in the day view.',
  drop_off: 'You must enter your starting mileage before completing tasks. Please use the "Start Day Mileage" button in the day view.',
  pickup: 'You must enter your starting mileage before completing tasks. Please use the "Start Day Mileage" button in the day view.',
};
