import { useState } from 'react';
import { User } from 'lucide-react';
import { validateEmail, validatePhone, formatPhone, validateRequired } from '../../lib/validation';

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

interface ValidationErrors {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export function ContactInformationForm({ contactData, onChange }: ContactInformationFormProps) {
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleBlur = (field: keyof ContactData) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    validateField(field, contactData[field]);
  };

  const validateField = (field: keyof ContactData, value: string) => {
    let error: string | undefined;

    switch (field) {
      case 'first_name':
        const firstNameResult = validateRequired(value, 'First name');
        error = firstNameResult.isValid ? undefined : firstNameResult.error;
        break;
      case 'last_name':
        const lastNameResult = validateRequired(value, 'Last name');
        error = lastNameResult.isValid ? undefined : lastNameResult.error;
        break;
      case 'email':
        const emailResult = validateEmail(value);
        error = emailResult.isValid ? undefined : emailResult.error;
        break;
      case 'phone':
        const phoneResult = validatePhone(value);
        error = phoneResult.isValid ? undefined : phoneResult.error;
        break;
    }

    setErrors(prev => ({ ...prev, [field]: error }));
    return !error;
  };

  const handlePhoneChange = (value: string) => {
    const formatted = formatPhone(value);
    onChange({ ...contactData, phone: formatted });
  };
  return (
    <div className="bg-white rounded-xl shadow-md p-4 sm:p-6">
      <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6 flex items-center">
        <User className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-blue-600" />
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
            className="w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm sm:text-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={contactData.first_name}
            onChange={(e) => {
              onChange({ ...contactData, first_name: e.target.value });
              if (touched.first_name) {
                validateField('first_name', e.target.value);
              }
            }}
            onBlur={() => handleBlur('first_name')}
            className={`w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm sm:text-base border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 ${
              errors.first_name && touched.first_name
                ? 'border-red-300 bg-red-50'
                : 'border-slate-300'
            }`}
          />
          {errors.first_name && touched.first_name && (
            <p className="mt-1 text-xs sm:text-sm text-red-600">{errors.first_name}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={contactData.last_name}
            onChange={(e) => {
              onChange({ ...contactData, last_name: e.target.value });
              if (touched.last_name) {
                validateField('last_name', e.target.value);
              }
            }}
            onBlur={() => handleBlur('last_name')}
            className={`w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm sm:text-base border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 ${
              errors.last_name && touched.last_name
                ? 'border-red-300 bg-red-50'
                : 'border-slate-300'
            }`}
          />
          {errors.last_name && touched.last_name && (
            <p className="mt-1 text-xs sm:text-sm text-red-600">{errors.last_name}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            required
            value={contactData.email}
            onChange={(e) => {
              onChange({ ...contactData, email: e.target.value });
              if (touched.email) {
                validateField('email', e.target.value);
              }
            }}
            onBlur={() => handleBlur('email')}
            placeholder="you@example.com"
            className={`w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm sm:text-base border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 ${
              errors.email && touched.email
                ? 'border-red-300 bg-red-50'
                : 'border-slate-300'
            }`}
          />
          {errors.email && touched.email && (
            <p className="mt-1 text-xs sm:text-sm text-red-600">{errors.email}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Phone <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            required
            value={contactData.phone}
            onChange={(e) => {
              handlePhoneChange(e.target.value);
              if (touched.phone) {
                validateField('phone', e.target.value);
              }
            }}
            onBlur={() => handleBlur('phone')}
            placeholder="(313) 555-0123"
            className={`w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm sm:text-base border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 ${
              errors.phone && touched.phone
                ? 'border-red-300 bg-red-50'
                : 'border-slate-300'
            }`}
          />
          {errors.phone && touched.phone && (
            <p className="mt-1 text-xs sm:text-sm text-red-600">{errors.phone}</p>
          )}
        </div>
      </div>
    </div>
  );
}
