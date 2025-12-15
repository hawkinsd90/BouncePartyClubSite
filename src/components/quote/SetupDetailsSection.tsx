import { Zap, AlertCircle, CheckCircle2, Anchor } from 'lucide-react';
import type { QuoteFormData } from '../../hooks/useQuoteForm';

interface SetupDetailsSectionProps {
  formData: QuoteFormData;
  onFormDataChange: (updates: Partial<QuoteFormData>) => void;
}

export function SetupDetailsSection({ formData, onFormDataChange }: SetupDetailsSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Setup Details</h2>

      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-3">
          Can we anchor the inflatable with stakes? *
        </label>
        <div className="flex items-start gap-3 mb-4 p-3 bg-slate-50 rounded-lg">
          <Anchor className="w-5 h-5 text-slate-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-slate-600">
            Stakes are driven into grass to secure the inflatable. If stakes cannot be used (cement
            surface, no grass, etc.), we'll provide sandbags which will be added to your quote.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => onFormDataChange({ can_stake: true })}
            className={`p-4 rounded-lg border-2 transition-all ${
              formData.can_stake
                ? 'border-green-600 bg-green-50'
                : 'border-slate-300 hover:border-green-400'
            }`}
          >
            <CheckCircle2
              className={`w-8 h-8 mx-auto mb-2 ${
                formData.can_stake ? 'text-green-600' : 'text-slate-400'
              }`}
            />
            <p
              className={`font-semibold text-center ${
                formData.can_stake ? 'text-green-900' : 'text-slate-700'
              }`}
            >
              Yes
            </p>
            <p className="text-xs text-slate-600 text-center mt-1">Grass surface available</p>
          </button>
          <button
            type="button"
            onClick={() => onFormDataChange({ can_stake: false })}
            className={`p-4 rounded-lg border-2 transition-all ${
              !formData.can_stake
                ? 'border-orange-600 bg-orange-50'
                : 'border-slate-300 hover:border-orange-400'
            }`}
          >
            <AlertCircle
              className={`w-8 h-8 mx-auto mb-2 ${
                !formData.can_stake ? 'text-orange-600' : 'text-slate-400'
              }`}
            />
            <p
              className={`font-semibold text-center ${
                !formData.can_stake ? 'text-orange-900' : 'text-slate-700'
              }`}
            >
              No
            </p>
            <p className="text-xs text-slate-600 text-center mt-1">Sandbags required</p>
          </button>
        </div>
      </div>

      <div className="p-6 bg-amber-50 border-2 border-amber-400 rounded-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-amber-900">Power Source Required!</h3>
            <p className="text-sm text-amber-800">Please verify electrical requirements</p>
          </div>
        </div>
        <label className="flex items-start cursor-pointer p-4 bg-white rounded-lg border-2 border-amber-300 hover:border-amber-500 transition-colors">
          <input
            type="checkbox"
            checked={formData.has_generator}
            onChange={(e) => onFormDataChange({ has_generator: e.target.checked })}
            className="mt-1 mr-4 w-5 h-5"
          />
          <div>
            <p className="text-base font-bold text-slate-900 mb-2">
              I need a generator (no power outlet available)
            </p>
            <p className="text-sm text-slate-700 leading-relaxed">
              <strong>Check this box if:</strong> There is NO standard electrical outlet within 50
              feet of the setup location. We'll provide a generator to power the inflatable blower.
              Each generator can power up to 2 blowers.{' '}
              <strong className="text-amber-800">Additional rental fees apply.</strong>
            </p>
          </div>
        </label>
      </div>

      <div className="mt-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Special Details</h2>
        <p className="text-sm text-slate-600 mb-4">
          Tell us about your event! Is it a birthday party? Any special setup instructions? Special
          needs we should know about?
        </p>
        <textarea
          value={formData.special_details}
          onChange={(e) => onFormDataChange({ special_details: e.target.value })}
          rows={6}
          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
          placeholder="Example: It's my daughter's 8th birthday party! We're expecting about 20 kids. Please call 15 minutes before arrival so we can make sure the driveway is clear."
        />
        <p className="text-xs text-slate-500 mt-2">
          This information will be saved with your order and visible to our crew for better service.
        </p>
      </div>
    </div>
  );
}
