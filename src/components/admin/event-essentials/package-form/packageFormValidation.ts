// Pure validation for the Event Essentials package form. Moved verbatim from
// PackageForm.validate(); the component keeps the setErrors step.

import { parsePrice, priceErrorMessage } from '../../../../lib/priceInput';
import type { InventoryProductWithPricing, AdminInflatableUnit } from '../../../../types';
import {
  MAX_INT,
  QTY_REGEX,
  unitSupportsWater,
  unitSupportsBoth,
  type PackageFormState,
} from './packageFormModel';

export interface PackageFormValidationInput {
  formData: PackageFormState;
  standalonePriceDisplay: string;
  addonPriceDisplay: string;
  addonThresholdDisplay: string;
  products: InventoryProductWithPricing[];
  units: AdminInflatableUnit[];
}

export function validatePackageForm({
  formData,
  standalonePriceDisplay,
  addonPriceDisplay,
  addonThresholdDisplay,
  products,
  units,
}: PackageFormValidationInput): Record<string, string> {
  const e: Record<string, string> = {};

  if (!formData.name.trim()) e.name = 'Name is required';

  if (!Number.isInteger(formData.sort_order))
    e.sort_order = 'Sort order must be a whole integer';

  const standaloneTrimmed = standalonePriceDisplay.trim();
  const standaloneParsed = parsePrice(standalonePriceDisplay);
  if (formData.standalone_enabled && standaloneTrimmed === '') {
    e.standalone_price = 'Required when standalone is enabled';
  } else if (standaloneTrimmed !== '' && !standaloneParsed.valid) {
    e.standalone_price = priceErrorMessage(standaloneParsed.reason);
  }

  const addonTrimmed = addonPriceDisplay.trim();
  const addonParsed = parsePrice(addonPriceDisplay);
  if (formData.addon_enabled && addonTrimmed === '') {
    e.addon_price = 'Required when add-on is enabled';
  } else if (addonTrimmed !== '' && !addonParsed.valid) {
    e.addon_price = priceErrorMessage(addonParsed.reason);
  }

  // Add-on qualifying threshold
  const thresholdTrimmed = addonThresholdDisplay.trim();
  const thresholdParsed = parsePrice(addonThresholdDisplay);
  if (formData.addon_enabled && thresholdTrimmed === '') {
    e.addon_threshold = 'Required when add-on is enabled';
  } else if (thresholdTrimmed !== '' && !thresholdParsed.valid) {
    e.addon_threshold = priceErrorMessage(thresholdParsed.reason);
  } else if (
    thresholdParsed.valid &&
    thresholdParsed.cents !== null &&
    thresholdParsed.cents > MAX_INT
  ) {
    e.addon_threshold = 'Value is too large';
  }

  // Event Essential components validation
  const componentErrors: string[] = [];
  const seenProductIds = new Set<string>();
  const productNameById = (productId: string): string => {
    const p = products.find((pr) => pr.id === productId);
    return p?.name ?? 'Unknown Product';
  };

  for (let i = 0; i < formData.components.length; i++) {
    const comp = formData.components[i];
    if (!comp.product_id) {
      componentErrors.push(`Component ${i + 1}: Select a product.`);
    } else {
      if (seenProductIds.has(comp.product_id)) {
        componentErrors.push(
          `Component ${i + 1}: Duplicate product — ${productNameById(comp.product_id)} is already selected.`,
        );
      }
      seenProductIds.add(comp.product_id);
      const exists = products.some((p) => p.id === comp.product_id);
      if (!exists) {
        componentErrors.push(`Component ${i + 1}: Selected product no longer exists.`);
      }
    }

    const qStr = comp.quantity_input.trim();
    if (qStr === '') {
      componentErrors.push(`Component ${i + 1}: Quantity is required.`);
    } else if (!QTY_REGEX.test(qStr)) {
      componentErrors.push(`Component ${i + 1}: Quantity must be a whole positive number.`);
    } else {
      const q = Number(qStr);
      if (q < 1) {
        componentErrors.push(`Component ${i + 1}: Quantity must be at least 1.`);
      } else if (q > MAX_INT) {
        componentErrors.push(`Component ${i + 1}: Quantity is too large.`);
      }
    }
  }

  // Inflatable components validation
  const inflatableErrors: string[] = [];
  const seenUnitIds = new Set<string>();
  const unitById = (unitId: string): AdminInflatableUnit | undefined =>
    units.find((u) => u.id === unitId);

  for (let i = 0; i < formData.inflatable_components.length; i++) {
    const comp = formData.inflatable_components[i];
    if (!comp.unit_id) {
      inflatableErrors.push(`Inflatable ${i + 1}: Select a unit.`);
    } else {
      if (seenUnitIds.has(comp.unit_id)) {
        const u = unitById(comp.unit_id);
        inflatableErrors.push(
          `Inflatable ${i + 1}: Duplicate unit — ${u?.name ?? 'Unknown'} is already selected. Use one row per unit.`,
        );
      }
      seenUnitIds.add(comp.unit_id);
      const u = unitById(comp.unit_id);
      if (!u) {
        inflatableErrors.push(`Inflatable ${i + 1}: Selected unit no longer exists.`);
      } else if (comp.selection_mode === 'water' && !unitSupportsWater(u)) {
        inflatableErrors.push(
          `Inflatable ${i + 1}: ${u.name} does not support water mode.`,
        );
      } else if (comp.selection_mode === 'customer_choice' && !unitSupportsBoth(u)) {
        inflatableErrors.push(
          `Inflatable ${i + 1}: ${u.name} does not support both dry and water; customer choice is unavailable.`,
        );
      }
    }

    const qStr = comp.quantity_input.trim();
    if (qStr === '') {
      inflatableErrors.push(`Inflatable ${i + 1}: Quantity is required.`);
    } else if (!QTY_REGEX.test(qStr)) {
      inflatableErrors.push(`Inflatable ${i + 1}: Quantity must be a whole positive number.`);
    } else {
      const q = Number(qStr);
      if (q < 1) {
        inflatableErrors.push(`Inflatable ${i + 1}: Quantity must be at least 1.`);
      } else if (q > MAX_INT) {
        inflatableErrors.push(`Inflatable ${i + 1}: Quantity is too large.`);
      }
    }
  }

  // Eligibility validation — selected requires at least one unit
  if (
    formData.inflatable_eligibility_mode === 'selected' &&
    formData.eligible_unit_ids.length === 0
  ) {
    e.eligibility = 'Select at least one eligible inflatable when mode is "Only selected".';
  }

  // Available package must have at least one total component (product + inflatable)
  const totalComponents = formData.components.length + formData.inflatable_components.length;
  if (formData.active && totalComponents === 0) {
    const bothEmpty = componentErrors.length === 0 && inflatableErrors.length === 0;
    if (bothEmpty) {
      e.components = 'An available package must have at least one component (Event Essential or Inflatable).';
    }
  }

  if (componentErrors.length > 0) {
    e.components = componentErrors.join(' ');
  }
  if (inflatableErrors.length > 0) {
    e.inflatable_components = inflatableErrors.join(' ');
  }

  return e;
}
