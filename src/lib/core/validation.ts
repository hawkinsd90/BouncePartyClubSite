export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const phoneRegex = /^\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})$/;
export const zipRegex = /^\d{5}(-\d{4})?$/;

export function validateEmail(email: string): ValidationResult {
  if (!email) {
    return { isValid: false, error: 'Email is required' };
  }
  if (!emailRegex.test(email)) {
    return { isValid: false, error: 'Please enter a valid email address' };
  }
  return { isValid: true };
}

export function validatePhone(phone: string): ValidationResult {
  if (!phone) {
    return { isValid: false, error: 'Phone number is required' };
  }

  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length !== 10) {
    return { isValid: false, error: 'Please enter a 10-digit phone number' };
  }

  return { isValid: true };
}

export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length === 0) return '';
  if (cleaned.length <= 3) return `(${cleaned}`;
  if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
  return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
}

export function validateZipCode(zip: string): ValidationResult {
  if (!zip) {
    return { isValid: false, error: 'ZIP code is required' };
  }
  if (!zipRegex.test(zip)) {
    return { isValid: false, error: 'Please enter a valid ZIP code (e.g., 48122)' };
  }
  return { isValid: true };
}

export function validateRequired(value: string, fieldName: string): ValidationResult {
  if (!value || value.trim() === '') {
    return { isValid: false, error: `${fieldName} is required` };
  }
  return { isValid: true };
}

export function validateMinMax(value: number, min: number, max: number, fieldName: string): ValidationResult {
  if (value < min) {
    return { isValid: false, error: `${fieldName} must be at least ${min}` };
  }
  if (value > max) {
    return { isValid: false, error: `${fieldName} cannot exceed ${max}` };
  }
  return { isValid: true };
}

export function validateDateRange(startDate: string, endDate: string): ValidationResult {
  if (!startDate) {
    return { isValid: false, error: 'Start date is required' };
  }
  if (!endDate) {
    return { isValid: false, error: 'End date is required' };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (start < today) {
    return { isValid: false, error: 'Start date cannot be in the past' };
  }

  if (end < start) {
    return { isValid: false, error: 'End date must be after start date' };
  }

  return { isValid: true };
}

export function validateCustomAmount(amount: string, min: number, max: number): ValidationResult {
  if (!amount) {
    return { isValid: false, error: 'Amount is required' };
  }

  const numAmount = parseFloat(amount);

  if (isNaN(numAmount)) {
    return { isValid: false, error: 'Please enter a valid amount' };
  }

  if (numAmount < min) {
    return { isValid: false, error: `Minimum amount is $${min.toFixed(2)}` };
  }

  if (numAmount > max) {
    return { isValid: false, error: `Maximum amount is $${max.toFixed(2)}` };
  }

  return { isValid: true };
}
