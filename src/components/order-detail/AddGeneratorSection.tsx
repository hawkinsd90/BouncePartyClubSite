import { useState, useCallback } from 'react';
import { Plus, Zap, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { resolveEventEssentialsPricing } from '../../lib/eventEssentialsPricing';
import type {
  ResolverInput,
  ResolverInputLine,
  ResolverProductConfig,
} from '../../lib/eventEssentialsPricingTypes';
import { lookupAllGeneratorProducts } from '../../lib/generatorUnified';
import { buildEventEssentialAvailabilityRequestFromOrderItems, validateAvailabilityResult } from '../../lib/eeOrderItemAvailability';
import type { BundleComponentSnapshot } from '../admin/OrderDetailModal';

interface AddGeneratorSectionProps {
  orderId: string;
  editedOrder: any;
  stagedItems: StagedItem[];
  existingGeneratorFeeWaived: boolean;
  onAddGeneratorProduct: (item: StagedItem) => void;
  onLegacyFallback: (additionalQty: number, keepWaiver: boolean) => void;
}

interface GeneratorCandidate {
  product_id: string;
  product_name: string;
  resolved_price_cents: number;
  resolved_pricing_context: string;
  available: boolean;
}

export function AddGeneratorSection({
  orderId,
  editedOrder,
  stagedItems,
  existingGeneratorFeeWaived,
  onAddGeneratorProduct,
  onLegacyFallback,
}: AddGeneratorSectionProps) {
  const [additionalQty, setAdditionalQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSection, setShowSection] = useState(false);
  const [showWaiverDialog, setShowWaiverDialog] = useState(false);
  const [pendingFallbackQty, setPendingFallbackQty] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);


  const handleAddGenerator = useCallback(async () => {
    if (additionalQty < 1) return;
    setLoading(true);
    setError(null);
    try {
      const lookup = await lookupAllGeneratorProducts();
      if (lookup.status === 'configuration_failed') {
        setError(`Generator configuration error: ${lookup.error}`);
        return;
      }
      if (lookup.status === 'not_found') {
        // No EE generators configured — legacy fallback
        if (existingGeneratorFeeWaived) {
          setPendingFallbackQty(additionalQty);
          setShowWaiverDialog(true);
        } else {
          setPendingFallbackQty(additionalQty);
          setShowConfirm(true);
        }
        return;
      }

      // Build resolver input from staged items
      const productConfigs: Record<string, ResolverProductConfig> = {};
      for (const p of lookup.products) {
        productConfigs[p.product_id] = {
          id: p.product_id,
          categoryId: p.category_id,
          standalonePriceCents: p.standalone_price_cents,
          addonPriceCents: p.addon_price_cents,
          standaloneEnabled: p.standalone_enabled,
          addonEnabled: p.addon_enabled,
          addonQualifyingThresholdCents: null,
        };
      }

      const lines: ResolverInputLine[] = stagedItems
        .filter((item: StagedItem) => !item.is_deleted && (item.product_id || item.bundle_id))
        .map((item: StagedItem) => {
          if (item.bundle_id) {
            return {
              resolverKey: item.id || `bundle-${item.bundle_id}`,
              itemType: 'event_essential_bundle' as const,
              qty: item.qty,
              bundleId: item.bundle_id,
              savedUnitPriceCents: item.unit_price_cents,
            };
          }
          return {
            resolverKey: item.id || `product-${item.product_id}`,
            itemType: 'event_essential_product' as const,
            qty: item.qty,
            productId: item.product_id,
            savedUnitPriceCents: item.unit_price_cents,
          };
        });

      // Test each candidate
      const candidates: GeneratorCandidate[] = [];
      for (const genProduct of lookup.products) {
        const candidateLine: ResolverInputLine = {
          resolverKey: `candidate-${genProduct.product_id}`,
          itemType: 'event_essential_product',
          qty: additionalQty,
          productId: genProduct.product_id,
        };
        const input: ResolverInput = {
          lines: [...lines, candidateLine],
          productConfigs,
          bundleConfigs: {},
          categories: { [genProduct.category_id]: { id: genProduct.category_id } },
          units: {},
        };
        const result = resolveEventEssentialsPricing(input);
        const candidateResult = result.lines.find(l => l.resolverKey === candidateLine.resolverKey);
        if (!candidateResult || !candidateResult.selectable || candidateResult.resolvedUnitPriceCents === null) {
          continue;
        }

        // Check resulting-order availability
        const allEeItems = stagedItems
          .filter((item: StagedItem) => !item.is_deleted && (item.product_id || item.bundle_id))
          .map((item: StagedItem) => ({
            product_id: item.product_id,
            bundle_id: item.bundle_id,
            qty: item.qty,
            component_snapshot: item.component_snapshot,
          }));
        allEeItems.push({
          product_id: genProduct.product_id,
          bundle_id: undefined,
          qty: additionalQty,
          component_snapshot: null,
        });

        const expansion = buildEventEssentialAvailabilityRequestFromOrderItems(allEeItems);
        if (expansion.status === 'invalid') {
          continue;
        }

        const { data: availData, error: availError } = await supabase.rpc('check_product_availability', {
          p_requested_items: expansion.productQuantities,
          p_start_date: editedOrder.event_date,
          p_end_date: editedOrder.event_end_date,
          p_exclude_order_id: orderId,
        });
        if (availError) {
          setError(`Availability check failed: ${availError.message}`);
          return;
        }
        const validation = validateAvailabilityResult(
          expansion.productQuantities.map(pq => pq.product_id),
          { data: availData, error: null },
        );
        if (!validation.ok) {
          continue;
        }

        candidates.push({
          product_id: genProduct.product_id,
          product_name: genProduct.product_name,
          resolved_price_cents: candidateResult.resolvedUnitPriceCents,
          resolved_pricing_context: candidateResult.resolvedPricingContext || 'standalone',
          available: true,
        });
      }

      if (candidates.length === 0) {
        // Legacy fallback
        if (existingGeneratorFeeWaived) {
          setPendingFallbackQty(additionalQty);
          setShowWaiverDialog(true);
        } else {
          setPendingFallbackQty(additionalQty);
          setShowConfirm(true);
        }
        return;
      }

      // Select highest-priced candidate, tie-break by product_id ascending
      candidates.sort((a, b) => {
        if (b.resolved_price_cents !== a.resolved_price_cents) {
          return b.resolved_price_cents - a.resolved_price_cents;
        }
        return a.product_id.localeCompare(b.product_id);
      });
      const selected = candidates[0];

      // Check if same product_id already exists as a direct EE row
      const existing = stagedItems.find(
        (item: any) => !item.is_deleted && item.product_id === selected.product_id && !item.bundle_id,
      );

      if (existing) {
        if (existing.unit_price_cents === selected.resolved_price_cents &&
            (existing.pricing_context || 'standalone') === selected.resolved_pricing_context) {
          // Case A: same price and context — increase qty on existing row
          onAddGeneratorProduct({
            ...existing,
            qty: existing.qty + additionalQty,
            is_updated: true,
          });
        } else {
          // Case B: different price — create second row
          onAddGeneratorProduct({
            product_id: selected.product_id,
            product_name: selected.product_name,
            item_name: selected.product_name,
            qty: additionalQty,
            unit_price_cents: selected.resolved_price_cents,
            pricing_context: selected.resolved_pricing_context,
            component_snapshot: null,
            is_new: true,
            is_deleted: false,
          });
        }
      } else {
        onAddGeneratorProduct({
          product_id: selected.product_id,
          product_name: selected.product_name,
          item_name: selected.product_name,
          qty: additionalQty,
          unit_price_cents: selected.resolved_price_cents,
          pricing_context: selected.resolved_pricing_context,
          component_snapshot: null,
          is_new: true,
          is_deleted: false,
        });
      }

      setShowSection(false);
      setAdditionalQty(1);
    } catch (err: any) {
      setError(err?.message || 'Failed to add generator');
    } finally {
      setLoading(false);
    }
  }, [additionalQty, stagedItems, editedOrder, orderId, existingGeneratorFeeWaived, onAddGeneratorProduct, onLegacyFallback]);


  const handleConfirmLegacyFallback = useCallback((keepWaiver: boolean) => {
    onLegacyFallback(pendingFallbackQty, keepWaiver);
    setShowWaiverDialog(false);
    setShowConfirm(false);
    setPendingFallbackQty(0);
    setShowSection(false);
    setAdditionalQty(1);
  }, [pendingFallbackQty, onLegacyFallback]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-600" />
        Add Generator
      </h3>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {!showSection && (
        <button
          onClick={() => setShowSection(true)}
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Additional Generator
        </button>
      )}

      {showSection && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700">Additional Generators:</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAdditionalQty(Math.max(1, additionalQty - 1))}
                className="w-7 h-7 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded transition-colors text-sm font-bold"
              >
                -
              </button>
              <span className="w-10 text-center text-sm font-semibold text-slate-900">{additionalQty}</span>
              <button
                onClick={() => setAdditionalQty(additionalQty + 1)}
                className="w-7 h-7 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded transition-colors text-sm font-bold"
              >
                +
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddGenerator}
              disabled={loading}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {loading ? 'Checking...' : 'Add Generator'}
            </button>
            <button
              onClick={() => setShowSection(false)}
              className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="font-semibold text-slate-900">Add Legacy Generator</h3>
            </div>
            <p className="text-sm text-slate-700 mb-4">
              No Event Essentials Generator is available. The legacy Generator quantity will increase by {pendingFallbackQty} and the aggregate legacy Generator fee will be recalculated using current pricing rules.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowConfirm(false)} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium">
                Cancel
              </button>
              <button onClick={() => handleConfirmLegacyFallback(false)} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {showWaiverDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="font-semibold text-slate-900">Generator Fee Waiver Decision</h3>
            </div>
            <p className="text-sm text-slate-700 mb-4">
              The existing legacy Generator fee is currently waived. The waiver applies to the aggregate legacy Generator charge. Adding {pendingFallbackQty} additional legacy Generator(s) requires a decision about the aggregate waiver.
            </p>
            <div className="flex flex-col gap-2">
              <button onClick={() => handleConfirmLegacyFallback(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium text-left">
                Keep Generator fee waived
              </button>
              <button onClick={() => handleConfirmLegacyFallback(false)} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium text-left">
                Remove waiver and charge recalculated fee
              </button>
              <button onClick={() => { setShowWaiverDialog(false); setPendingFallbackQty(0); }} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
