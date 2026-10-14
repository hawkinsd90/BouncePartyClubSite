// Generator Workflow Unification — low-level invariant validation only.
//
// The customer-facing conflict guard has been removed because the unified
// Quote checkbox and Event Essentials catalog now control the same Generator
// product. This module retains only the pure legacy-detection helper used
// by other modules.

export function hasLegacyGeneratorSelected(
  formData: { has_generator?: boolean; generator_qty?: number },
): boolean {
  return !!(formData.has_generator || (formData.generator_qty && formData.generator_qty > 0));
}
