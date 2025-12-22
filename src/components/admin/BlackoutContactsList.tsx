import { UserX, Trash2 } from 'lucide-react';

interface BlackoutContact {
  id: string;
  email: string | null;
  phone: string | null;
  customer_name: string | null;
  reason: string;
  notes: string | null;
  created_at: string;
}

interface BlackoutContactsListProps {
  contacts: BlackoutContact[];
  onDelete: (id: string) => void;
}

export function BlackoutContactsList({ contacts, onDelete }: BlackoutContactsListProps) {
  return (
    <div className="space-y-3">
      {contacts.map((contact) => (
        <div key={contact.id} className="border-2 border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <UserX className="w-5 h-5 text-red-600" />
                <span className="font-bold text-slate-900">
                  {contact.customer_name || 'Unknown Customer'}
                </span>
              </div>
              {contact.email && <p className="text-slate-700"><strong>Email:</strong> {contact.email}</p>}
              {contact.phone && <p className="text-slate-700"><strong>Phone:</strong> {contact.phone}</p>}
              <p className="text-slate-700"><strong>Reason:</strong> {contact.reason}</p>
              {contact.notes && <p className="text-sm text-slate-600 mt-1">{contact.notes}</p>}
              <p className="text-xs text-slate-500 mt-2">Added: {new Date(contact.created_at).toLocaleString()}</p>
            </div>
            <button
              onClick={() => onDelete(contact.id)}
              className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      ))}
      {contacts.length === 0 && (
        <p className="text-center text-slate-500 py-8">No blocked contacts configured</p>
      )}
    </div>
  );
}
