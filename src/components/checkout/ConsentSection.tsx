import { Shield, CreditCard } from 'lucide-react';
import { useBusinessSettings } from '../../contexts/BusinessContext';

interface ConsentSectionProps {
  cardOnFileConsent: boolean;
  smsConsent: boolean;
  onCardOnFileConsentChange: (consent: boolean) => void;
  onSmsConsentChange: (consent: boolean) => void;
}

export function ConsentSection({
  cardOnFileConsent,
  smsConsent,
  onCardOnFileConsentChange,
  onSmsConsentChange,
}: ConsentSectionProps) {
  const business = useBusinessSettings();

  return (
    <>
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
          <Shield className="w-6 h-6 mr-2 text-green-600" />
          Payment Authorization
        </h2>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-green-900 mb-2 flex items-center">
            <Shield className="w-5 h-5 mr-2" />
            Secure Stripe Payment Processing
          </h3>
          <p className="text-sm text-green-800">
            Your payment information is processed securely by Stripe and never stored on our servers. Payment will be entered after your order is created.
          </p>
        </div>

        <h3 className="font-bold text-slate-900 mb-3 text-lg">Card-on-File Authorization</h3>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            I authorize {business.business_legal_entity} to securely store my payment method and
            charge it for incidentals including damage, excess cleaning, or late fees as
            itemized in a receipt. I understand that any charges will be accompanied by
            photographic evidence and a detailed explanation.
          </p>
        </div>
        <label className="flex items-start cursor-pointer mb-6">
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

        <h3 className="font-bold text-slate-900 mb-3 text-lg">SMS Notifications Consent</h3>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            By providing my phone number and checking the box below, I consent to receive
            transactional SMS text messages from {business.business_legal_entity} at the phone number
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
    </>
  );
}
