/**
 * Formats an order ID for display by taking the first 8 characters and uppercasing them.
 * This is the canonical way to display order numbers to users.
 *
 * @param orderId - The full order ID (UUID)
 * @returns Formatted order ID (e.g., "A1B2C3D4")
 */
export function formatOrderId(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}
