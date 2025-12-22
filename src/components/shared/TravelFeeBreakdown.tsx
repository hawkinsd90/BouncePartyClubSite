import { MapPin, Info } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface TravelFeeBreakdownProps {
  distanceMiles: number;
  baseRadiusMiles: number;
  chargeableMiles: number;
  ratePerMileCents: number;
  travelFeeCents: number;
  displayName?: string;
  showDetailedBreakdown?: boolean;
  isIncludedCity?: boolean;
  cityName?: string;
  isFlatFee?: boolean;
  zoneName?: string;
}

export function TravelFeeBreakdown({
  distanceMiles,
  baseRadiusMiles,
  chargeableMiles,
  ratePerMileCents,
  travelFeeCents,
  displayName,
  showDetailedBreakdown = false,
  isIncludedCity = false,
  cityName,
  isFlatFee = false,
  zoneName,
}: TravelFeeBreakdownProps) {
  if (!showDetailedBreakdown) {
    // Simple display for quotes
    return (
      <div className="space-y-1">
        {isIncludedCity && cityName && (
          <div className="flex items-start gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
            <Info className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-green-800">
              {cityName} is in the free delivery zone
            </p>
          </div>
        )}
        {isFlatFee && zoneName && (
          <div className="flex items-start gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
            <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-blue-800">
              Flat rate for {zoneName}
            </p>
          </div>
        )}
        {travelFeeCents > 0 && (
          <div className="text-sm text-slate-600">
            {displayName || `Travel Fee (${distanceMiles.toFixed(1)} mi)`}
          </div>
        )}
      </div>
    );
  }

  // Detailed breakdown for admin travel calculator
  return (
    <div className="space-y-3 bg-green-50 border-2 border-green-200 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <MapPin className="w-5 h-5 text-green-600" />
        <h3 className="text-lg font-bold text-slate-900">Travel Fee Breakdown</h3>
      </div>

      {isIncludedCity && cityName && (
        <div className="p-3 bg-green-100 border border-green-300 rounded-lg">
          <p className="text-sm font-semibold text-green-800">
            ✓ {cityName} is in the FREE delivery zone!
          </p>
          <p className="text-xs text-green-700 mt-1">No travel fee will be charged for this location.</p>
        </div>
      )}

      {isFlatFee && zoneName && (
        <div className="p-3 bg-blue-100 border border-blue-300 rounded-lg">
          <p className="text-sm font-semibold text-blue-800">📍 Flat Rate Zone: {zoneName}</p>
          <p className="text-xs text-blue-700 mt-1">This location has a fixed travel fee.</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-slate-700">Total Distance from Home Base:</span>
          <span className="font-semibold text-slate-900">{distanceMiles.toFixed(1)} miles</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-slate-700">Base Radius (Free):</span>
          <span className="font-semibold text-slate-900">{baseRadiusMiles} miles</span>
        </div>

        {!isFlatFee && !isIncludedCity && (
          <>
            <div className="flex justify-between items-center">
              <span className="text-slate-700">Miles Beyond Base:</span>
              <span className="font-semibold text-slate-900">{chargeableMiles.toFixed(1)} miles</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-700">Rate Per Mile:</span>
              <span className="font-semibold text-slate-900">{formatCurrency(ratePerMileCents)}</span>
            </div>
          </>
        )}
      </div>

      <div className="pt-3 mt-3 border-t-2 border-green-300">
        <div className="flex justify-between items-center">
          <span className="text-lg font-bold text-slate-900">TRAVEL FEE:</span>
          <span className="text-2xl font-bold text-green-700">{formatCurrency(travelFeeCents)}</span>
        </div>
      </div>
    </div>
  );
}
