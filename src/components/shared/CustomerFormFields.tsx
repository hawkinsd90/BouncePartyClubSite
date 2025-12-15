import { TextInput } from '../forms/TextInput';

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

export function CustomerFormFields({
  data,
  onChange,
  showBusinessName = false,
  layout = 'grid',
}: CustomerFormFieldsProps) {
  const gridClass = layout === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'space-y-4';

  return (
    <div className="space-y-4">
      <div className={gridClass}>
        <TextInput
          label="First Name"
          type="text"
          value={data.first_name}
          onChange={(value) => onChange('first_name', value)}
          required
        />
        <TextInput
          label="Last Name"
          type="text"
          value={data.last_name}
          onChange={(value) => onChange('last_name', value)}
          required
        />
      </div>
      <div className={gridClass}>
        <TextInput
          label="Email"
          type="email"
          value={data.email}
          onChange={(value) => onChange('email', value)}
          required
        />
        <TextInput
          label="Phone"
          type="tel"
          value={data.phone}
          onChange={(value) => onChange('phone', value)}
          placeholder="(555) 555-5555"
          required
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
