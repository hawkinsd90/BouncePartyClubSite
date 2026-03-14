import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { MapPin, Play, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface BackfillAddress {
  id: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
}

interface BackfillResult {
  id: string;
  address: string;
  status: 'success' | 'error' | 'skipped';
  message?: string;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!window.google?.maps?.Geocoder) {
      resolve(null);
      return;
    }
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address, componentRestrictions: { country: 'us' } }, (results, status) => {
      if (status === 'OK' && results && results[0]?.geometry?.location) {
        resolve({
          lat: results[0].geometry.location.lat(),
          lng: results[0].geometry.location.lng(),
        });
      } else {
        resolve(null);
      }
    });
  });
}

const BATCH_SIZE = 25;
const DELAY_MS = 250;

export function AddressCoordinateBackfill() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BackfillResult[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [done, setDone] = useState(false);

  async function runBackfill() {
    setRunning(true);
    setDone(false);
    setResults([]);
    setProgress({ current: 0, total: 0 });

    const { data: addresses, error } = await supabase
      .from('addresses')
      .select('id, line1, city, state, zip')
      .or('lat.is.null,lng.is.null')
      .limit(BATCH_SIZE);

    if (error || !addresses) {
      setResults([{ id: '', address: 'Query failed', status: 'error', message: error?.message }]);
      setRunning(false);
      return;
    }

    const toProcess = (addresses as BackfillAddress[]).filter(a => a.line1 && a.city && a.state && a.zip);
    setProgress({ current: 0, total: toProcess.length });

    const newResults: BackfillResult[] = [];

    for (let i = 0; i < toProcess.length; i++) {
      const addr = toProcess[i];
      const fullAddress = `${addr.line1}, ${addr.city}, ${addr.state} ${addr.zip}`;

      try {
        const coords = await geocodeAddress(fullAddress);

        if (coords) {
          const { error: updateError } = await supabase
            .from('addresses')
            .update({ lat: coords.lat, lng: coords.lng })
            .eq('id', addr.id);

          if (updateError) {
            newResults.push({ id: addr.id, address: fullAddress, status: 'error', message: updateError.message });
          } else {
            newResults.push({ id: addr.id, address: fullAddress, status: 'success', message: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` });
          }
        } else {
          newResults.push({ id: addr.id, address: fullAddress, status: 'error', message: 'Geocoder returned no results' });
        }
      } catch (err) {
        newResults.push({ id: addr.id, address: fullAddress, status: 'error', message: String(err) });
      }

      setProgress({ current: i + 1, total: toProcess.length });
      setResults([...newResults]);

      if (i < toProcess.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    setDone(true);
    setRunning(false);
  }

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-start gap-4 mb-6">
        <div className="p-3 bg-blue-50 rounded-xl">
          <MapPin className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Backfill Address Coordinates</h3>
          <p className="text-sm text-slate-500 mt-1">
            Geocode up to {BATCH_SIZE} addresses that are missing lat/lng. Re-run multiple times to process all addresses. Already-geocoded rows are skipped automatically.
          </p>
        </div>
      </div>

      {!window.google?.maps?.Geocoder && !running && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          Google Maps API not loaded. Make sure the page has loaded the Maps API (visit the quote page first, or wait a moment and retry).
        </div>
      )}

      <button
        onClick={runBackfill}
        disabled={running}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {running ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Running...
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            Run Backfill (next {BATCH_SIZE})
          </>
        )}
      </button>

      {(running || done) && progress.total > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">
              Progress: {progress.current}/{progress.total}
            </span>
            {done && (
              <span className="text-sm text-slate-500">
                {successCount} updated &bull; {errorCount} failed
              </span>
            )}
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 mb-4">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto">
            {results.map((r, i) => (
              <div
                key={r.id || i}
                className={`flex items-start gap-2 text-sm p-2.5 rounded-lg ${
                  r.status === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                }`}
              >
                {r.status === 'success' ? (
                  <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" />
                )}
                <div className="min-w-0">
                  <span className="font-medium truncate block">{r.address}</span>
                  {r.message && <span className="text-xs opacity-75">{r.message}</span>}
                </div>
              </div>
            ))}
          </div>

          {done && successCount > 0 && (
            <p className="mt-3 text-sm text-green-700 font-medium">
              Done! {successCount} address{successCount !== 1 ? 'es' : ''} now have coordinates. Run again to process more if needed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
