import { TaxWaiver } from '../../order-detail/TaxWaiver';
import { FeeWaiver } from '../../shared/FeeWaiver';

interface WaiverPricing {
  tax_cents?: number;
  travel_fee_cents?: number;
  same_day_pickup_fee_cents?: number;
  surface_fee_cents?: number;
  generator_fee_cents?: number;
  same_day_weekday_delivery_fee_cents?: number;
}

interface Props {
  calculatedPricing: WaiverPricing | null;
  pricingRules: { apply_taxes_by_default?: boolean | null } | null;
  taxWaived: boolean;
  taxWaiveReason: string;
  setTaxWaived: (value: boolean) => void;
  setTaxWaiveReason: (value: string) => void;
  travelFeeWaived: boolean;
  travelFeeWaiveReason: string;
  setTravelFeeWaived: (value: boolean) => void;
  setTravelFeeWaiveReason: (value: string) => void;
  sameDayPickupFeeWaived: boolean;
  sameDayPickupFeeWaiveReason: string;
  setSameDayPickupFeeWaived: (value: boolean) => void;
  setSameDayPickupFeeWaiveReason: (value: string) => void;
  surfaceFeeWaived: boolean;
  surfaceFeeWaiveReason: string;
  setSurfaceFeeWaived: (value: boolean) => void;
  setSurfaceFeeWaiveReason: (value: string) => void;
  generatorFeeWaived: boolean;
  generatorFeeWaiveReason: string;
  setGeneratorFeeWaived: (value: boolean) => void;
  setGeneratorFeeWaiveReason: (value: string) => void;
  sameDayWeekdayDeliveryFeeWaived: boolean;
  sameDayWeekdayDeliveryFeeWaiveReason: string;
  setSameDayWeekdayDeliveryFeeWaived: (value: boolean) => void;
  setSameDayWeekdayDeliveryFeeWaiveReason: (value: string) => void;
}

// Groups InvoiceBuilder's existing TaxWaiver / FeeWaiver wiring. InvoiceBuilder owns all waiver state.
export function InvoiceFeeWaivers({
  calculatedPricing,
  pricingRules,
  taxWaived, taxWaiveReason, setTaxWaived, setTaxWaiveReason,
  travelFeeWaived, travelFeeWaiveReason, setTravelFeeWaived, setTravelFeeWaiveReason,
  sameDayPickupFeeWaived, sameDayPickupFeeWaiveReason, setSameDayPickupFeeWaived, setSameDayPickupFeeWaiveReason,
  surfaceFeeWaived, surfaceFeeWaiveReason, setSurfaceFeeWaived, setSurfaceFeeWaiveReason,
  generatorFeeWaived, generatorFeeWaiveReason, setGeneratorFeeWaived, setGeneratorFeeWaiveReason,
  sameDayWeekdayDeliveryFeeWaived, sameDayWeekdayDeliveryFeeWaiveReason, setSameDayWeekdayDeliveryFeeWaived, setSameDayWeekdayDeliveryFeeWaiveReason,
}: Props) {
  return (
    <>
      <TaxWaiver
        taxCents={calculatedPricing?.tax_cents || 0}
        taxWaived={taxWaived}
        taxWaiveReason={taxWaiveReason}
        onToggle={(reason) => {
          setTaxWaived(!taxWaived);
          setTaxWaiveReason(reason);
        }}
        applyTaxesByDefault={pricingRules?.apply_taxes_by_default ?? true}
        originalOrderTaxCents={0}
        compact={true}
      />

      {((calculatedPricing?.travel_fee_cents || 0) > 0 || travelFeeWaived) && (
        <FeeWaiver
          feeName="Travel Fee"
          feeAmount={calculatedPricing?.travel_fee_cents || 0}
          isWaived={travelFeeWaived}
          waiveReason={travelFeeWaiveReason}
          onToggle={(reason) => {
            setTravelFeeWaived(!travelFeeWaived);
            setTravelFeeWaiveReason(reason);
          }}
          color="orange"
          compact={true}
        />
      )}

      {((calculatedPricing?.same_day_pickup_fee_cents || 0) > 0 || sameDayPickupFeeWaived) && (
        <FeeWaiver
          feeName="Same Day Pickup Fee"
          feeAmount={calculatedPricing?.same_day_pickup_fee_cents || 0}
          isWaived={sameDayPickupFeeWaived}
          waiveReason={sameDayPickupFeeWaiveReason}
          onToggle={(reason) => {
            setSameDayPickupFeeWaived(!sameDayPickupFeeWaived);
            setSameDayPickupFeeWaiveReason(reason);
          }}
          color="blue"
          compact={true}
        />
      )}

      {((calculatedPricing?.surface_fee_cents || 0) > 0 || surfaceFeeWaived) && (
        <FeeWaiver
          feeName="Sandbags Fee"
          feeAmount={calculatedPricing?.surface_fee_cents || 0}
          isWaived={surfaceFeeWaived}
          waiveReason={surfaceFeeWaiveReason}
          onToggle={(reason) => {
            setSurfaceFeeWaived(!surfaceFeeWaived);
            setSurfaceFeeWaiveReason(reason);
          }}
          color="orange"
          compact={true}
        />
      )}

      {((calculatedPricing?.generator_fee_cents || 0) > 0 || generatorFeeWaived) && (
        <FeeWaiver
          feeName="Generator Fee"
          feeAmount={calculatedPricing?.generator_fee_cents || 0}
          isWaived={generatorFeeWaived}
          waiveReason={generatorFeeWaiveReason}
          onToggle={(reason) => {
            setGeneratorFeeWaived(!generatorFeeWaived);
            setGeneratorFeeWaiveReason(reason);
          }}
          color="blue"
          compact={true}
        />
      )}

      {((calculatedPricing?.same_day_weekday_delivery_fee_cents || 0) > 0 || sameDayWeekdayDeliveryFeeWaived) && (
        <FeeWaiver
          feeName="Same-Day Weekday Delivery Fee"
          feeAmount={calculatedPricing?.same_day_weekday_delivery_fee_cents || 0}
          isWaived={sameDayWeekdayDeliveryFeeWaived}
          waiveReason={sameDayWeekdayDeliveryFeeWaiveReason}
          onToggle={(reason) => {
            setSameDayWeekdayDeliveryFeeWaived(!sameDayWeekdayDeliveryFeeWaived);
            setSameDayWeekdayDeliveryFeeWaiveReason(reason);
          }}
          color="orange"
          compact={true}
        />
      )}
    </>
  );
}
