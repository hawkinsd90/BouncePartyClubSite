interface CardOnFileAuthorizationProps {
  cardOnFileConsent: boolean;
  onCardOnFileConsentChange: (accepted: boolean) => void;
  smsConsent: boolean;
  onSmsConsentChange: (accepted: boolean) => void;
}

export function CardOnFileAuthorization({
  cardOnFileConsent,
  onCardOnFileConsentChange,
  smsConsent,
  onSmsConsentChange,
}: CardOnFileAuthorizationProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-slate-900 mb-3 text-lg">Card-on-File Authorization</h3>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            I authorize Bounce Party Club LLC to securely store my payment method and
            charge it for incidentals including damage, excess cleaning, or late fees as
            itemized in a receipt. I understand that any charges will be accompanied by
            photographic evidence and a detailed explanation.
          </p>
        </div>
        <label className="flex items-start cursor-pointer">
          <input
            type="checkbox"
            checked={cardOnFileConsent}
            onChange={(e) => onCardOnFileConsentChange(e.target.checked)}
            className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
            required
          />
          <span className="ml-3 text-sm text-slate-700">
            I have read and agree to the card-on-file authorization terms above. *
          </span>
        </label>
      </div>

      <div>
        <h3 className="font-bold text-slate-900 mb-3 text-lg">SMS Notifications Consent</h3>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            By providing my phone number and checking the box below, I consent to receive
            transactional SMS text messages from Bounce Party Club LLC at the phone number
            provided. These messages may include order confirmations, delivery updates,
            and service-related notifications about my booking. Message frequency varies.
            Message and data rates may apply. You can reply STOP to opt-out at any time.
          </p>
        </div>
        <label className="flex items-start cursor-pointer">
          <input
            type="checkbox"
            checked={smsConsent}
            onChange={(e) => onSmsConsentChange(e.target.checked)}
            className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
            required
          />
          <span className="ml-3 text-sm text-slate-700">
            I consent to receive SMS notifications about my booking and agree to the terms above. *
          </span>
        </label>
      </div>
    </div>
  );
}
