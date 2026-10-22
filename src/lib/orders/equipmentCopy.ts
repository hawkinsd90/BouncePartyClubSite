// WP-15 (B12): wording that depends on what is in the order. Text written for inflatables ("anchor the inflatable", "plugged in and fully
// inflated", "inflatable blower") was shown on Event Essentials-only orders (tables, chairs, tents), where it makes no sense. An order
// that has at least one inflatable keeps the exact wording it always had.

export function onlyEventEssentials(items: ReadonlyArray<{ unit_id?: string | null }>): boolean {
  return items.length > 0 && items.every((i) => !i.unit_id);
}

export function generatorExplanation(hasInflatables: boolean): string {
  return hasInflatables
    ? "There is NO standard electrical outlet within 50 feet of the setup location. We'll provide a generator to power the inflatable blower. Each generator can power up to 2 blowers."
    : "There is NO standard electrical outlet within 50 feet of the setup location. We'll provide a generator to power your equipment.";
}

export interface RentalTermsCopy {
  depositSentence: (depositAmount: string) => string;
  receiveLine: string;
  duringPickupLine: string | null;
}

export function rentalTermsCopy(hasInflatables: boolean): RentalTermsCopy {
  if (hasInflatables) {
    return {
      depositSentence: (d) => `This booking requires a minimum ${d} deposit per inflatable to reserve your event date with Bounce Party Club. The remaining balance is due on or before the day of your event. You may choose to pay the full amount at booking.`,
      receiveLine: 'An adult must be present between 7:00 AM and 12:00 PM to receive the inflatable and review safety information with our team',
      duringPickupLine: 'Please ensure the inflatable remains plugged in and fully inflated for the duration of the rental period until Bounce Party Club staff arrives for pickup, unless specified otherwise',
    };
  }
  return {
    depositSentence: () => 'This booking requires a deposit to reserve your event date with Bounce Party Club. The remaining balance is due on or before the day of your event. You may choose to pay the full amount at booking.',
    receiveLine: 'An adult must be present between 7:00 AM and 12:00 PM to receive the equipment and review the setup with our team',
    duringPickupLine: null,
  };
}

export function overnightResponsibilityNoun(items: ReadonlyArray<{ unit_id?: string | null }>): 'inflatable' | 'equipment' {
  return onlyEventEssentials(items) ? 'equipment' : 'inflatable';
}
