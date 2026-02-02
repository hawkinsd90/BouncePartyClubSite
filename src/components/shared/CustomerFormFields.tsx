import { useState } from 'react';
import { TextInput } from '../forms/TextInput';
import { validateEmail, validatePhone, formatPhone, validateRequired } from '../../lib/validation';

interface CustomerData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name?: string;
}

interface CustomerFormFieldsProps {
  data: CustomerData;
  onChange: (field: keyof CustomerData, value: string) => void;
  showBusinessName?: boolean;
  layout?: 'grid' | 'stack';
}

interface ValidationErrors {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export function CustomerFormFields({
  data,
  onChange,
  showBusinessName = false,
  layout = 'grid',
}: CustomerFormFieldsProps) {
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const gridClass = layout === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'space-y-4';

  const validateField = (field: keyof CustomerData, value: string) => {
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
  };


  const handleChange = (field: keyof CustomerData, value: string) => {
    if (field === 'phone') {
      const formatted = formatPhone(value);
      onChange(field, formatted);
    } else {
      onChange(field, value);
    }

    if (touched[field]) {
      validateField(field, field === 'phone' ? formatPhone(value) : value);
    }
  };

  return (
    <div className="space-y-4">
      <div className={gridClass}>
        <TextInput
          label="First Name"
          type="text"
          value={data.first_name}
          onChange={(value) => handleChange('first_name', value)}
          required
          error={touched.first_name ? errors.first_name : undefined}
          className="focus:outline-none"
        />
        <TextInput
          label="Last Name"
          type="text"
          value={data.last_name}
          onChange={(value) => handleChange('last_name', value)}
          required
          error={touched.last_name ? errors.last_name : undefined}
          className="focus:outline-none"
        />
      </div>
      <div className={gridClass}>
        <TextInput
          label="Email"
          type="email"
          value={data.email}
          onChange={(value) => handleChange('email', value)}
          placeholder="you@example.com"
          required
          error={touched.email ? errors.email : undefined}
          className="focus:outline-none"
        />
        <TextInput
          label="Phone"
          type="tel"
          value={data.phone}
          onChange={(value) => handleChange('phone', value)}
          placeholder="(313) 555-0123"
          required
          error={touched.phone ? errors.phone : undefined}
          className="focus:outline-none"
        />
      </div>
      {showBusinessName && (
        <TextInput
          label="Business Name (Optional)"
          type="text"
          value={data.business_name || ''}
          onChange={(value) => onChange('business_name', value)}
        />
      )}
    </div>
  );
}
