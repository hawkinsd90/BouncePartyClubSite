import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { UserPlus, Loader2, Eye, EyeOff, ArrowLeft, AlertTriangle } from 'lucide-react';
import { notifySuccess, notifyError, notifyWarning } from '../lib/notifications';
import { AddressAutocomplete } from '../components/order/AddressAutocomplete';
import { useCustomerProfile } from '../contexts/CustomerProfileContext';

const MAX_PROFILE_WAIT_MS = 8000;
const PROFILE_POLL_INTERVAL_MS = 500;

async function waitForCustomerProfile(userId: string): Promise<boolean> {
  const deadline = Date.now() + MAX_PROFILE_WAIT_MS;

  while (Date.now() < deadline) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (data?.id) return true;

    await new Promise(r => setTimeout(r, PROFILE_POLL_INTERVAL_MS));
  }

  return false;
}

export function SignUp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useCustomerProfile();

  const from = (location.state as any)?.from?.pathname || '/';

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailAlreadyExists, setEmailAlreadyExists] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    businessName: '',
  });
  const [addressData, setAddressData] = useState<any>(null);
  const [addressInput, setAddressInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (formData.password && formData.confirmPassword) {
      if (formData.password !== formData.confirmPassword) {
        setErrors(prev => ({ ...prev, confirmPassword: 'Passwords do not match' }));
      } else {
        setErrors(prev => {
          const next = { ...prev };
          delete next.confirmPassword;
          return next;
        });
      }
    }
  }, [formData.password, formData.confirmPassword]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email address';
    }
    if (!formData.phone.trim()) newErrors.phone = 'Phone is required';
    else if (formData.phone.replace(/\D/g, '').length !== 10) {
      newErrors.phone = 'Phone number must be 10 digits';
    }
    if (!formData.password) newErrors.password = 'Password is required';
    else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);

    try {
      // Direct call (not AuthContext.signUp) because we need authData.user.id
      // immediately to poll for the customer row. AuthContext.signUp returns void.
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            phone: formData.phone,
            business_name: formData.businessName || null,
          },
        },
      });

      if (authError) throw authError;

      if (!authData.user) {
        throw new Error('Account creation failed — no user returned from auth.');
      }

      // Supabase silently returns the existing user when email confirmation is
      // disabled and the email is already registered. Detect this by checking
      // whether the user was created more than 10 seconds ago.
      const createdAt = new Date(authData.user.created_at).getTime();
      const isExistingUser = Date.now() - createdAt > 10_000;
      if (isExistingUser) {
        setEmailAlreadyExists(true);
        setErrors(prev => ({ ...prev, email: 'An account with this email already exists.' }));
        setLoading(false);
        return;
      }

      const userId = authData.user.id;

      const profileReady = await waitForCustomerProfile(userId);

      if (!profileReady) {
        notifyError(
          'Your account was created, but we could not finish setting up your profile. Please sign in — your profile will load automatically.'
        );
        navigate('/login', { state: { from: { pathname: from } }, replace: true });
        return;
      }

      if (formData.businessName) {
        await supabase
          .from('customers')
          .update({ business_name: formData.businessName })
          .eq('user_id', userId);
      }

      if (addressData?.line1 && addressData?.city && addressData?.state && addressData?.zip) {
        const { data: session } = await supabase.auth.getSession();
        if (session?.session?.access_token) {
          const res = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-signup-address`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${session.session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                line1: addressData.line1,
                line2: addressData.line2 || null,
                city: addressData.city,
                state: addressData.state,
                zip: addressData.zip,
                lat: addressData.lat || null,
                lng: addressData.lng || null,
              }),
            }
          );

          if (!res.ok) {
            notifyWarning(
              'Your account was created, but we couldn\'t save your default address right now. You can add it later.',
              { duration: 8000 }
            );
          }
        }
      }

      await refreshProfile();

      notifySuccess('Account created! Welcome to Bounce Party Club.');
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error('[SignUp] Sign up error:', err);
      notifyError(err.message || 'Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    let processed = value;

    if (field === 'phone') {
      const digits = value.replace(/\D/g, '');
      if (digits.length > 10) return;
      if (digits.length >= 6) {
        processed = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
      } else if (digits.length >= 3) {
        processed = `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
      } else {
        processed = digits;
      }
    }

    setFormData(prev => ({ ...prev, [field]: processed }));
    if (field === 'email') setEmailAlreadyExists(false);
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleAddressSelect = (address: any) => {
    setAddressData({
      line1: address.street,
      line2: '',
      city: address.city,
      state: address.state,
      zip: address.zip,
      lat: address.lat,
      lng: address.lng,
      formatted_address: address.formatted_address,
    });
    setAddressInput(address.formatted_address || '');
  };

  const isPasswordMismatch =
    formData.password && formData.confirmPassword && formData.password !== formData.confirmPassword;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 py-6 sm:py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 lg:p-8 border border-slate-100">
          <button
            onClick={() => navigate('/login', { state: location.state })}
            className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4 sm:mb-6 transition-colors text-sm sm:text-base"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Sign In
          </button>

          <div className="text-center mb-6 sm:mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl mb-3 sm:mb-4 shadow-lg">
              <UserPlus className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              Create Account
            </h2>
            <p className="mt-2 sm:mt-3 text-base sm:text-lg text-slate-600">
              Join Bounce Party Club today
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  First Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                  className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 border-2 ${errors.firstName ? 'border-red-300' : 'border-slate-300'} rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-base`}
                  placeholder="John"
                />
                {errors.firstName && (
                  <p className="text-red-600 text-sm mt-1">{errors.firstName}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Last Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                  className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 border-2 ${errors.lastName ? 'border-red-300' : 'border-slate-300'} rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-base`}
                  placeholder="Doe"
                />
                {errors.lastName && (
                  <p className="text-red-600 text-sm mt-1">{errors.lastName}</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Email Address *
              </label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 border-2 ${errors.email ? 'border-red-300' : 'border-slate-300'} rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-base`}
                placeholder="you@example.com"
              />
              {emailAlreadyExists ? (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-amber-900 mb-1">An account with this email already exists.</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => navigate('/login', { state: { from: { pathname: from }, prefillEmail: formData.email } })}
                        className="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
                      >
                        Sign in to your account
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('/forgot-password', { state: { prefillEmail: formData.email } })}
                        className="inline-flex items-center px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-50 text-amber-800 text-xs font-semibold rounded-lg transition-colors"
                      >
                        Forgot your password?
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {errors.email && (
                    <p className="text-red-600 text-sm mt-1">{errors.email}</p>
                  )}
                  {!errors.email && formData.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email) && (
                    <p className="text-green-600 text-sm mt-1">Valid email address</p>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Phone Number *
              </label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 border-2 ${errors.phone ? 'border-red-300' : 'border-slate-300'} rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-base`}
                placeholder="(123) 456-7890"
              />
              {errors.phone && (
                <p className="text-red-600 text-sm mt-1">{errors.phone}</p>
              )}
              {!errors.phone && formData.phone && formData.phone.replace(/\D/g, '').length === 10 && (
                <p className="text-green-600 text-sm mt-1">Valid phone number</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Business Name (Optional)
              </label>
              <input
                type="text"
                value={formData.businessName}
                onChange={(e) => handleChange('businessName', e.target.value)}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-base"
                placeholder="Leave blank if booking as an individual"
              />
            </div>

            <div className="border-t border-slate-200 pt-4 sm:pt-6">
              <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-3 sm:mb-4">
                Default Address (Optional)
              </h3>
              <p className="text-sm text-slate-600 mb-3 sm:mb-4">
                Save time on future bookings by adding your address now
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Street Address
                  </label>
                  <AddressAutocomplete
                    value={addressInput}
                    onChange={setAddressInput}
                    onSelect={handleAddressSelect}
                    placeholder="123 Main St, Detroit, MI 48197"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Start typing and select from suggestions
                  </p>
                </div>

                {addressData && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                    <p className="text-sm font-medium text-blue-900 mb-1">Selected Address:</p>
                    <p className="text-sm text-blue-700">
                      {addressData.line1}
                      {addressData.line2 && `, ${addressData.line2}`}
                      <br />
                      {addressData.city}, {addressData.state} {addressData.zip}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4 sm:pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={formData.password}
                      onChange={(e) => handleChange('password', e.target.value)}
                      className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 pr-12 border-2 ${errors.password ? 'border-red-300' : 'border-slate-300'} rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-base`}
                      placeholder="••••••••"
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-2"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-red-600 text-sm mt-1">{errors.password}</p>
                  )}
                  {!errors.password && formData.password && (
                    <p className="text-slate-500 text-xs mt-1">
                      {formData.password.length < 6
                        ? `${6 - formData.password.length} more character${6 - formData.password.length === 1 ? '' : 's'} needed`
                        : 'Password meets requirements'
                      }
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Confirm Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      value={formData.confirmPassword}
                      onChange={(e) => handleChange('confirmPassword', e.target.value)}
                      className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 pr-12 border-2 ${
                        isPasswordMismatch || errors.confirmPassword ? 'border-red-300' : 'border-slate-300'
                      } rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-base`}
                      placeholder="••••••••"
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-2"
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {isPasswordMismatch && (
                    <p className="text-red-600 text-sm mt-1">Passwords do not match</p>
                  )}
                  {!isPasswordMismatch && formData.confirmPassword && formData.password === formData.confirmPassword && (
                    <p className="text-green-600 text-sm mt-1">Passwords match</p>
                  )}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !!isPasswordMismatch}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-slate-400 disabled:to-slate-500 disabled:cursor-not-allowed text-white font-bold py-3 sm:py-4 px-4 rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-[1.02] disabled:transform-none flex items-center justify-center min-h-[48px] text-base sm:text-lg"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div className="mt-4 sm:mt-6 text-center">
            <p className="text-sm sm:text-base text-slate-600">
              Already have an account?{' '}
              <button
                onClick={() => navigate('/login', { state: location.state })}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Sign in
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
