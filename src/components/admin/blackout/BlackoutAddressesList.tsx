import { MapPin, Trash2 } from 'lucide-react';

interface BlackoutAddress {
  id: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  zip_code: string;
  reason: string;
  notes: string | null;
  created_at: string;
}

interface BlackoutAddressesListProps {
  addresses: BlackoutAddress[];
  onDelete: (id: string) => void;
}

export function BlackoutAddressesList({ addresses, onDelete }: BlackoutAddressesListProps) {
  return (
    <div className="space-y-3">
      {addresses.map((address) => (
        <div key={address.id} className="border-2 border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-5 h-5 text-green-600" />
                <span className="font-bold text-slate-900">
                  {address.address_line1}
                  {address.address_line2 && `, ${address.address_line2}`}
                </span>
              </div>
              <p className="text-slate-700">
                {address.city}, {address.state} {address.zip_code}
              </p>
              <p className="text-slate-700"><strong>Reason:</strong> {address.reason}</p>
              {address.notes && <p className="text-sm text-slate-600 mt-1">{address.notes}</p>}
              <p className="text-xs text-slate-500 mt-2">Added: {new Date(address.created_at).toLocaleString()}</p>
            </div>
            <button
              onClick={() => onDelete(address.id)}
              className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      ))}
      {addresses.length === 0 && (
        <p className="text-center text-slate-500 py-8">No blocked addresses configured</p>
      )}
    </div>
  );
}
