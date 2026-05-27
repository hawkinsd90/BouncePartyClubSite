import { useState } from 'react';
import { X, Image, ShieldAlert, Check, AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { AdminPhoto } from '../../../hooks/useAdminPhotos';

interface PromoteToCarouselModalProps {
  photo: AdminPhoto;
  onClose: () => void;
  onSuccess: () => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export function PromoteToCarouselModal({ photo, onClose, onSuccess }: PromoteToCarouselModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isDelivery = photo.source === 'delivery';

  async function handlePromote() {
    if (!consentChecked || promoting) return;
    setPromoting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/promote-media`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          Apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          source_type: photo.source,
          source_id: photo.id,
          action: 'carousel',
          carousel_title: title.trim() || null,
          carousel_description: description.trim() || null,
          consent_confirmed: true,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Promotion failed (${res.status})`);

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promotion failed');
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Image className="w-5 h-5 text-rose-600" />
            <h2 className="text-base font-bold text-slate-900">Add to Homepage Carousel</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Photo preview */}
          <div className="flex gap-4 items-start">
            <img
              src={photo.public_url}
              alt={photo.file_name}
              className="w-20 h-20 rounded-xl object-cover border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{photo.file_name}</p>
              {photo.customer_name && (
                <p className="text-xs text-slate-500 mt-0.5">{photo.customer_name}</p>
              )}
              {photo.order_event_date && (
                <p className="text-xs text-slate-400">
                  {new Date(photo.order_event_date + 'T12:00:00').toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                This photo will be copied and added as a new active carousel slide.
              </p>
            </div>
          </div>

          {/* Delivery warning */}
          {isDelivery && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-snug">
                <span className="font-bold">Delivery proof photo.</span> These are operational records
                that may include customer property, addresses, people, or vehicles. Review carefully
                before adding to the public homepage carousel.
              </p>
            </div>
          )}

          {/* Title field */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Title <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Birthday Parties"
              maxLength={80}
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-400"
            />
          </div>

          {/* Description field */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Description <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Make your celebration unforgettable"
              maxLength={200}
              rows={2}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
            />
            {description.length > 0 && (
              <p className="text-xs text-slate-400 mt-1 text-right">{description.length}/200</p>
            )}
          </div>

          {/* Consent checkbox */}
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <div className="mt-0.5 shrink-0">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => setConsentChecked(e.target.checked)}
                className="sr-only"
              />
              <div
                onClick={() => setConsentChecked(v => !v)}
                className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${
                  consentChecked
                    ? 'bg-rose-600 border-rose-600'
                    : 'bg-white border-slate-300'
                }`}
              >
                {consentChecked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </div>
            </div>
            <p className="text-xs text-slate-700 leading-snug">
              {isDelivery ? (
                <>
                  <span className="font-semibold">Delivery photo marketing review.</span>{' '}
                  I confirm this delivery photo does not show sensitive or private customer details
                  such as people, children, license plates, house numbers, private address details,
                  or damage/evidence concerns, and the customer has not opted out of media use.
                </>
              ) : (
                <>
                  <span className="font-semibold">Marketing use confirmation.</span>{' '}
                  I confirm this image does not show sensitive or private customer information,
                  and the customer has not opted out of media use.
                </>
              )}
            </p>
          </label>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <Check className="w-4 h-4 text-green-600 shrink-0" />
              <p className="text-xs text-green-800 font-semibold">Photo added to carousel successfully!</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex gap-3 px-5 pb-6 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePromote}
            disabled={!consentChecked || promoting || success}
            className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
          >
            {promoting ? 'Adding...' : 'Add to Carousel'}
          </button>
        </div>
      </div>
    </div>
  );
}
