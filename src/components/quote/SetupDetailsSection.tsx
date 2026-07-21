import { Zap, AlertCircle, CheckCircle2, Anchor, CheckCircle } from 'lucide-react';
import type { GeneratorCheckboxState } from '../../hooks/useGeneratorCheckbox';

interface SetupDetailsSectionProps {
  formData: {
    can_stake: boolean | null;
  };
  onFormDataChange: (updates: Partial<{ can_stake: boolean | null }>) => void;
  generatorState: GeneratorCheckboxState;
  onGeneratorToggle: (checked: boolean) => void;
  onRetryConversion: () => void;
}

export function SetupDetailsSection({ formData, onFormDataChange, generatorState, onGeneratorToggle, onRetryConversion }: SetupDetailsSectionProps) {
  const generatorChecked = generatorState.checked;
  const packageHasGenerator = generatorState.packageContainedQty > 0;
  const directQty = generatorState.directQty;

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
              formData.can_stake === true
                ? 'border-green-600 bg-green-50'
                : 'border-slate-300 hover:border-green-400'
            }`}
          >
            <CheckCircle2
              className={`w-8 h-8 mx-auto mb-2 ${
                formData.can_stake === true ? 'text-green-600' : 'text-slate-400'
              }`}
            />
            <p
              className={`font-semibold text-center ${
                formData.can_stake === true ? 'text-green-900' : 'text-slate-700'
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
              formData.can_stake === false
                ? 'border-orange-600 bg-orange-50'
                : 'border-slate-300 hover:border-orange-400'
            }`}
          >
            <AlertCircle
              className={`w-8 h-8 mx-auto mb-2 ${
                formData.can_stake === false ? 'text-orange-600' : 'text-slate-400'
              }`}
            />
            <p
              className={`font-semibold text-center ${
                formData.can_stake === false ? 'text-orange-900' : 'text-slate-700'
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

        {packageHasGenerator ? (
          <div className="flex items-start gap-3 p-4 bg-green-50 rounded-lg border-2 border-green-300">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-base font-bold text-slate-900 mb-1">
                Generator included in your selected package.
              </p>
              <p className="text-sm text-slate-700">
                Your selected package already includes a Generator. No additional Generator is needed.
              </p>
            </div>
          </div>
        ) : generatorState.configurationLoading ? (
          <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg border-2 border-slate-200">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-slate-600"></div>
            <p className="text-sm text-slate-600">Loading Generator options…</p>
          </div>
        ) : (
          <label className="flex items-start cursor-pointer p-4 bg-white rounded-lg border-2 border-amber-300 hover:border-amber-500 transition-colors">
            <input
              type="checkbox"
              checked={generatorChecked}
              disabled={generatorState.loading || generatorState.configurationFailed}
              onChange={(e) => onGeneratorToggle(e.target.checked)}
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
              {directQty > 1 && (
                <p className="text-xs text-slate-500 mt-2">
                  {directQty} Generators in your cart. Adjust quantities on the Event Essentials page.
                </p>
              )}
            </div>
          </label>
        )}

        {generatorState.legacyConversionNeeded && !generatorState.conversionInFlight && (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-800 mb-2">
              Your saved Generator selection needs to be reviewed before continuing.
            </p>
            <button
              type="button"
              onClick={() => onRetryConversion()}
              disabled={generatorState.configurationLoading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-400 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Retry Generator Selection
            </button>
          </div>
        )}

        {generatorState.message && generatorState.messageType && (
          <div
            className={`mt-3 p-3 rounded-lg text-sm ${
              generatorState.messageType === 'error'
                ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-blue-50 border border-blue-200 text-blue-700'
            }`}
          >
            {generatorState.message}
          </div>
        )}
      </div>

      <div className="mt-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Special Details</h2>
        <p className="text-sm text-slate-600 mb-4">
          Tell us about your event! Is it a birthday party? Any special setup instructions? Special
          needs we should know about?
        </p>
        <textarea
          value={(formData as any).special_details || ''}
          onChange={(e) => onFormDataChange({ special_details: e.target.value } as any)}
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
