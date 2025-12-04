interface OvernightResponsibilityAgreementProps {
  accepted: boolean;
  onChange: (accepted: boolean) => void;
  locationType?: 'residential' | 'commercial';
  pickupPreference: 'same_day' | 'next_day';
}

export function OvernightResponsibilityAgreement({
  accepted,
  onChange,
  locationType = 'residential',
  pickupPreference,
}: OvernightResponsibilityAgreementProps) {
  // Only show for next-day pickup at residential locations
  if (locationType !== 'residential' || pickupPreference !== 'next_day') {
    return null;
  }

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold">
            !
          </div>
        </div>
        <div className="flex-grow">
          <h4 className="font-semibold text-amber-900 text-sm mb-2">
            Overnight Responsibility Agreement
          </h4>
          <p className="text-xs text-amber-800 mb-3">
            For next-day pickup rentals, you are responsible for the equipment left on your property overnight.
          </p>
          <label className="flex items-start cursor-pointer">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => onChange(e.target.checked)}
              className="mt-0.5 mr-3"
              required
            />
            <p className="text-xs text-amber-900 font-medium">
              ⚠️ I understand the inflatable will remain on my property overnight and I am legally responsible for its safety and security until pickup the next morning. *
            </p>
          </label>
        </div>
      </div>
    </div>
  );
}
