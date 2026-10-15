// Pure model for the Event Essentials package form: constants, editable row
// and state types, and unit/availability helpers. No React and no runtime
// imports, so it can be loaded from Node-based tests.

import type {
  ProductBundleWithConfiguration,
  PackageAdminFormData,
  PackageInflatableSelectionMode,
  AdminInflatableUnit,
} from '../../../../../types';

export const MAX_INT = 2147483647;
export const QTY_REGEX = /^[0-9]+$/;

export interface EditableComponentRow {
  product_id: string;
  quantity_input: string;
}

export interface EditableInflatableRow {
  unit_id: string;
  quantity_input: string;
  selection_mode: PackageInflatableSelectionMode;
}

export type PackageFormState = Omit<PackageAdminFormData, 'components' | 'inflatable_components'> & {
  components: EditableComponentRow[];
  inflatable_components: EditableInflatableRow[];
};

export function deriveAvailable(bundle: ProductBundleWithConfiguration | null): boolean {
  if (!bundle) return true;
  return bundle.active && bundle.public_visible;
}

export function unitSupportsWater(unit: AdminInflatableUnit): boolean {
  return unit.price_water_cents !== null && unit.price_water_cents !== undefined;
}

export function unitSupportsBoth(unit: AdminInflatableUnit): boolean {
  return unitSupportsWater(unit) && unit.price_dry_cents !== null;
}

export function unitStatus(unit: AdminInflatableUnit): string {
  return unit.active ? '' : ' (Inactive)';
}
