export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function dollarsToCents(dollars: string | number): number {
  return Math.round(parseFloat(String(dollars)) * 100);
}

export function calculateRentalDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

export function calculateTax(taxableAmountCents: number, taxRate = 0.06): number {
  return Math.round(taxableAmountCents * taxRate);
}

export function getFullName(
  customer: { first_name?: string; last_name?: string } | null | undefined
): string {
  if (!customer) return '';
  return `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
}

export function validateCustomerName(
  enteredName: string,
  customer: { first_name?: string; last_name?: string } | null | undefined
): boolean {
  const expectedName = getFullName(customer).toLowerCase();
  const entered = enteredName.trim().toLowerCase();
  return expectedName === entered;
}

export function calculateDiscountTotal(
  discounts: Array<{ amount_cents: number; percentage: number }>,
  subtotalCents: number
): number {
  return discounts.reduce((sum, discount) => {
    if (discount.amount_cents > 0) {
      return sum + discount.amount_cents;
    }
    if (discount.percentage > 0) {
      return sum + Math.round(subtotalCents * (discount.percentage / 100));
    }
    return sum;
  }, 0);
}

export function calculateFeeTotal(
  fees: Array<{ amount_cents: number; percentage: number }>,
  subtotalCents: number
): number {
  return fees.reduce((sum, fee) => {
    if (fee.amount_cents > 0) {
      return sum + fee.amount_cents;
    }
    if (fee.percentage > 0) {
      return sum + Math.round(subtotalCents * (fee.percentage / 100));
    }
    return sum;
  }, 0);
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length === 10;
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function (...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Format order ID for display purposes
 * Takes the first 8 characters of the UUID and converts to uppercase
 * Example: "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6" => "A1B2C3D4"
 */
export function formatOrderId(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}
