import { TextInput } from '../forms/TextInput';

interface AddressData {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

interface AddressFormFieldsProps {
  data: AddressData;
  onChange: (field: keyof AddressData, value: string) => void;
  showLine2?: boolean;
}

export function AddressFormFields({
  data,
  onChange,
  showLine2 = true,
}: AddressFormFieldsProps) {
  return (
    <div className="space-y-4">
      <TextInput
        label="Street Address"
        type="text"
        value={data.line1}
        onChange={(value) => onChange('line1', value)}
        placeholder="123 Main St"
        required
      />
      {showLine2 && (
        <TextInput
          label="Apartment, Suite, etc. (Optional)"
          type="text"
          value={data.line2 || ''}
          onChange={(value) => onChange('line2', value)}
        />
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TextInput
          label="City"
          type="text"
          value={data.city}
          onChange={(value) => onChange('city', value)}
          required
        />
        <TextInput
          label="State"
          type="text"
          value={data.state}
          onChange={(value) => onChange('state', value)}
          placeholder="MI"
          required
        />
        <TextInput
          label="ZIP Code"
          type="text"
          value={data.zip}
          onChange={(value) => onChange('zip', value)}
          placeholder="48184"
          required
        />
      </div>
    </div>
  );
}
