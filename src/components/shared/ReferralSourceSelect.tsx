import { ChevronDown } from 'lucide-react';

export interface ReferralSourceValue {
  source: string;
  detail: string;
}

interface ReferralSourceSelectProps {
  value: string;
  detail: string;
  onChange: (source: string, detail: string) => void;
  error?: string;
  readOnly?: boolean;
}

export const REFERRAL_SOURCE_LABELS: Record<string, string> = {
  social_media: 'Social Media',
  google: 'Google',
  physical_marketing: 'Flyer / Sign / Card',
  referral: 'Friend Referral',
  returning_customer: 'Returning Customer',
  other: 'Other',
};

export const REFERRAL_DETAIL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  google_search: 'Google Search',
  google_business: 'Google Maps / Business Profile',
  not_sure: 'Not sure',
  other: 'Other / Not sure',
};

const SOCIAL_MEDIA_OPTIONS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'other', label: 'Other / Not sure' },
];

const GOOGLE_OPTIONS = [
  { value: 'google_search', label: 'Google Search' },
  { value: 'google_business', label: 'Google Maps / Business Profile' },
  { value: 'not_sure', label: 'Not sure' },
];

const MAIN_OPTIONS = [
  { value: 'social_media', label: 'Social Media' },
  { value: 'google', label: 'Google' },
  { value: 'physical_marketing', label: 'Flyer / Sign / Card' },
  { value: 'referral', label: 'Friend Referral' },
  { value: 'returning_customer', label: 'Returning Customer' },
  { value: 'other', label: 'Other' },
];

export function ReferralSourceSelect({
  value,
  detail,
  onChange,
  error,
  readOnly = false,
}: ReferralSourceSelectProps) {
  if (readOnly && value) {
    const sourceLabel = REFERRAL_SOURCE_LABELS[value] || value;
    const detailLabel = detail ? (REFERRAL_DETAIL_LABELS[detail] || detail) : null;
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <p className="text-sm font-medium text-slate-600 mb-1">How you heard about us</p>
        <p className="text-sm font-semibold text-slate-800">
          {sourceLabel}
          {detailLabel && <span className="text-slate-500 font-normal"> — {detailLabel}</span>}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          How did you hear about us? <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <select
            value={value}
            onChange={e => onChange(e.target.value, '')}
            className={`w-full appearance-none px-4 py-3 pr-10 border-2 rounded-xl text-sm bg-white text-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
              error ? 'border-red-400' : value ? 'border-slate-300' : 'border-slate-300'
            }`}
          >
            <option value="">Select one...</option>
            {MAIN_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>

      {value === 'social_media' && (
        <div className="pl-4 border-l-2 border-blue-200 space-y-2">
          <p className="text-xs text-slate-500">Examples: Facebook, Instagram, TikTok, WhatsApp</p>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Which platform? <span className="text-slate-400">(optional)</span>
            </label>
            <div className="relative">
              <select
                value={detail}
                onChange={e => onChange(value, e.target.value)}
                className="w-full appearance-none px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Not specified</option>
                {SOCIAL_MEDIA_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
          </div>
        </div>
      )}

      {value === 'google' && (
        <div className="pl-4 border-l-2 border-blue-200">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Where on Google? <span className="text-slate-400">(optional)</span>
          </label>
          <div className="relative">
            <select
              value={detail}
              onChange={e => onChange(value, e.target.value)}
              className="w-full appearance-none px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Not specified</option>
              {GOOGLE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          </div>
        </div>
      )}

      {value === 'referral' && (
        <div className="pl-4 border-l-2 border-blue-200">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Friend's name <span className="text-slate-400">(optional)</span>
          </label>
          <input
            type="text"
            value={detail}
            onChange={e => onChange(value, e.target.value)}
            placeholder="Enter their name"
            maxLength={100}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      )}

      {value === 'other' && (
        <div className="pl-4 border-l-2 border-blue-200">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Tell us where <span className="text-slate-400">(optional)</span>
          </label>
          <input
            type="text"
            value={detail}
            onChange={e => onChange(value, e.target.value)}
            placeholder="Where did you hear about us?"
            maxLength={200}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      )}
    </div>
  );
}
