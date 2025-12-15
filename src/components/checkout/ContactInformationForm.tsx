import { User } from 'lucide-react';

interface ContactData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name: string;
}

interface ContactInformationFormProps {
  contactData: ContactData;
  onChange: (data: ContactData) => void;
}

export function ContactInformationForm({ contactData, onChange }: ContactInformationFormProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
        <User className="w-6 h-6 mr-2 text-blue-600" />
        Contact Information
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Business Name (Optional)
          </label>
          <input
            type="text"
            value={contactData.business_name}
            onChange={(e) =>
              onChange({ ...contactData, business_name: e.target.value })
            }
            placeholder="Leave blank if booking as an individual"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            First Name *
          </label>
          <input
            type="text"
            required
            value={contactData.first_name}
            onChange={(e) =>
              onChange({ ...contactData, first_name: e.target.value })
            }
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Last Name *
          </label>
          <input
            type="text"
            required
            value={contactData.last_name}
            onChange={(e) =>
              onChange({ ...contactData, last_name: e.target.value })
            }
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Email *
          </label>
          <input
            type="email"
            required
            value={contactData.email}
            onChange={(e) =>
              onChange({ ...contactData, email: e.target.value })
            }
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Phone *
          </label>
          <input
            type="tel"
            required
            value={contactData.phone}
            onChange={(e) =>
              onChange({ ...contactData, phone: e.target.value })
            }
            placeholder="(313) 555-0123"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
          />
        </div>
      </div>
    </div>
  );
}
