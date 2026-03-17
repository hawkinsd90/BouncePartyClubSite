import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { UserPlus, Loader2, Eye, EyeOff, ArrowLeft, AlertTriangle, Mail, Shield, CheckCircle2 } from 'lucide-react';
import { notifySuccess, notifyError } from '../lib/notifications';
import { AddressAutocomplete } from '../components/order/AddressAutocomplete';
import { useCustomerProfile } from '../contexts/CustomerProfileContext';
import { createLogger } from '../lib/logger';

const log = createLogger('SignUp');

const MAX_PROFILE_WAIT_MS = 8000;
const PROFILE_POLL_INTERVAL_MS = 500;

const TERMS_VERSION = '1.0';
const PRIVACY_VERSION = '1.0';

async function waitForCustomerProfile(userId: string): Promise<boolean> {
  const deadline = Date.now() + MAX_PROFILE_WAIT_MS;
  let attempt = 0;

  log.debug(`waitForCustomerProfile: starting poll for user ${userId}`);

  while (Date.now() < deadline) {
    attempt++;

    const { data, error } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      log.warn(`waitForCustomerProfile: query error on attempt ${attempt}`, error.message);
    }

    if (data?.id) {
      log.debug(`waitForCustomerProfile: customer row found on attempt ${attempt}`);
      return true;
    }

    await new Promise(r => setTimeout(r, PROFILE_POLL_INTERVAL_MS));
  }

  log.warn(`waitForCustomerProfile: timed out after ${attempt} attempts for user ${userId}`);
  return false;
}

interface ConsentResult {
  success: boolean;
  inserted: number;
  skipped: number;
  safe_to_clear_pending: boolean;
}

async function recordConsent(
  accessToken: string,
  batchId: string,
  consents: Array<{ type: string; version: string; consented: boolean }>
): Promise<ConsentResult> {
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-consent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        batch_id: batchId,
        consents,
        source: 'signup',
        user_agent_hint: navigator.userAgent.slice(0, 200),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      log.warn('recordConsent: edge function returned error', json.error ?? res.status);
      return { success: false, inserted: 0, skipped: 0, safe_to_clear_pending: false };
    }
    log.debug('recordConsent: consent recorded server-side', { inserted: json.inserted, skipped: json.skipped });
    return {
      success: true,
      inserted: json.inserted ?? 0,
      skipped: json.skipped ?? 0,
      safe_to_clear_pending: json.safe_to_clear_pending === true,
    };
  } catch (err: any) {
    log.warn('recordConsent: network error', err.message);
    return { success: false, inserted: 0, skipped: 0, safe_to_clear_pending: false };
  }
}


export function SignUp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useCustomerProfile();

  const from = (location.state as any)?.from?.pathname || '/';

  const [loading, setLoading] = useState(false);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailAlreadyExists, setEmailAlreadyExists] = useState(false);
  const [emailUnconfirmed, setEmailUnconfirmed] = useState(false);
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

  const [consentTerms, setConsentTerms] = useState(false);
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentMarketingEmail, setConsentMarketingEmail] = useState(false);
  const [consentMarketingSms, setConsentMarketingSms] = useState(false);

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
    if (!consentTerms) {
      newErrors.consentTerms = 'You must agree to the Terms of Service to create an account';
    }
    if (!consentPrivacy) {
      newErrors.consentPrivacy = 'You must agree to the Privacy Policy to create an account';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    log.debug('handleSubmit: form submitted');

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const consentBatchId = crypto.randomUUID();

      const consentPayload = [
        { type: 'terms_of_service', version: TERMS_VERSION, consented: consentTerms },
        { type: 'privacy_policy', version: PRIVACY_VERSION, consented: consentPrivacy },
        { type: 'marketing_email', version: '1.0', consented: consentMarketingEmail },
        { type: 'marketing_sms', version: '1.0', consented: consentMarketingSms },
      ];

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            phone: formData.phone,
            business_name: formData.businessName || null,
            address_line1: addressData?.line1 || null,
            address_line2: addressData?.line2 || null,
            address_city: addressData?.city || null,
            address_state: addressData?.state || null,
            address_zip: addressData?.zip || null,
            address_lat: addressData?.lat || null,
            address_lng: addressData?.lng || null,
            // pending_consent is stored atomically inside the signUp call so it is bound
            // to account creation at the Auth layer. This is intentionally preferred over a
            // separate privileged metadata-write endpoint (e.g. save-pending-consent), which
            // would require unauthenticated write access and cannot prove caller ownership.
            // Trade-off: existing-user classification happens after signUp returns, so on a
            // duplicate signup attempt Supabase may merge pending_consent into the existing
            // account's metadata. The isExistingUser block below exits early without draining
            // consent, preventing direct row insertion. The batch_id unique index prevents
            // re-insertion if the same batch_id has already been drained from a prior signup.
            pending_consent: {
              batch_id: consentBatchId,
              consents: consentPayload,
              source: 'signup',
              user_agent_hint: navigator.userAgent.slice(0, 200),
            },
          },
        },
      });

      if (authError) {
        log.error('supabase.auth.signUp error', authError);
        throw authError;
      }

      if (!authData.user) {
        throw new Error('Account creation failed — no user returned from auth.');
      }

      const identities = authData.user.identities;
      const createdAt = new Date(authData.user.created_at).getTime();
      const ageMs = Date.now() - createdAt;
      const isExistingByIdentities = Array.isArray(identities) && identities.length === 0;
      const isExistingByAge = ageMs > 10_000;
      const isExistingUser = isExistingByIdentities || isExistingByAge;

      // Existing-user responses must never trigger direct consent persistence.
      // This early return prevents writing consent rows for accounts we did not just create,
      // covering both the confirmed-existing and unconfirmed-existing-user cases.
      if (isExistingUser) {
        const isConfirmed = !!authData.user.email_confirmed_at;
        log.debug('handleSubmit: existing user detected', { isConfirmed });

        if (isConfirmed) {
          setEmailAlreadyExists(true);
        } else {
          setEmailUnconfirmed(true);
        }
        setErrors(prev => ({ ...prev, email: ' ' }));
        setLoading(false);
        return;
      }

      const userId = authData.user.id;
      const emailConfirmationRequired = !authData.session;

      if (authData.session?.access_token) {
        log.debug('recordConsent: session available — recording consent directly');
        const consentResult = await recordConsent(authData.session.access_token, consentBatchId, consentPayload);
        // pending_consent is only cleared after the edge function confirms row persistence
        // (safe_to_clear_pending === true). If the write fails or returns false, the metadata
        // is intentionally preserved so the drain path in onAuthStateChange can recover it
        // on the next SIGNED_IN event.
        if (consentResult.safe_to_clear_pending) {
          const { error: clearError } = await supabase.auth.updateUser({
            data: { pending_consent: null },
          });
          if (clearError) {
            log.warn('recordConsent: rows persisted but metadata clear failed — drain path will handle it on next SIGNED_IN', clearError.message);
          } else {
            log.debug('recordConsent: consent persisted and pending_consent cleared from metadata', { inserted: consentResult.inserted, skipped: consentResult.skipped });
          }
        } else {
          log.warn('recordConsent: write did not confirm persistence — leaving pending_consent in metadata for drain recovery on next SIGNED_IN');
        }
      } else {
        log.debug('recordConsent: no session (email confirmation required) — pending_consent stored atomically in signUp metadata, drain will fire on first SIGNED_IN');
      }

      if (emailConfirmationRequired) {
        log.debug('handleSubmit: email confirmation required — navigating to login');
        notifySuccess(
          'Account created! Check your email for a confirmation link, then sign in.',
          { duration: 10000 }
        );
        navigate('/login', { state: { from: { pathname: from } }, replace: true });
        return;
      }

      log.debug('handleSubmit: polling for customer profile');
      const profileReady = await waitForCustomerProfile(userId);

      if (!profileReady) {
        log.warn('handleSubmit: customer profile not ready after timeout. Redirecting to login.');
        notifyError(
          'Your account was created, but we could not finish setting up your profile. Please sign in — your profile will load automatically.'
        );
        navigate('/login', { state: { from: { pathname: from } }, replace: true });
        return;
      }

      log.debug('handleSubmit: refreshing customer profile context');
      await refreshProfile();

      notifySuccess('Account created! Welcome to Bounce Party Club.');
      navigate(from, { replace: true });
    } catch (err: any) {
      log.error('handleSubmit unhandled error', err);
      const msg: string = err.message || '';
      if (msg.toLowerCase().includes('rate limit') || err.status === 429) {
        notifyError('Too many signup attempts. Please wait a few minutes and try again.');
      } else {
        notifyError(msg || 'Failed to create account. Please try again.');
      }
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
    if (field === 'email') {
      setEmailAlreadyExists(false);
      setEmailUnconfirmed(false);
    }
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleResendConfirmation = async () => {
    setResendingConfirmation(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: formData.email,
      });
      if (error) throw error;
      notifySuccess('Confirmation email resent. Check your inbox.', { duration: 8000 });
    } catch (err: any) {
      notifyError(err.message || 'Failed to resend confirmation email. Please try again.');
    } finally {
      setResendingConfirmation(false);
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
              ) : emailUnconfirmed ? (
                <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
                  <Mail className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-blue-900 mb-1">Your account exists but email is not confirmed yet.</p>
                    <p className="text-blue-700 mb-2">Check your inbox for the confirmation link, or resend it below.</p>
                    <button
                      type="button"
                      onClick={handleResendConfirmation}
                      disabled={resendingConfirmation}
                      className="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      {resendingConfirmation ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        'Resend confirmation email'
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {errors.email && errors.email.trim() && (
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

            <div className="border-t border-slate-200 pt-4 sm:pt-6 space-y-4">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                  Terms &amp; Privacy
                </h3>
              </div>

              <div className="space-y-3">
                <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-xl border-2 transition-colors ${consentTerms ? 'border-blue-300 bg-blue-50' : errors.consentTerms ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={consentTerms}
                      onChange={e => {
                        setConsentTerms(e.target.checked);
                        if (e.target.checked) {
                          setErrors(prev => { const n = { ...prev }; delete n.consentTerms; return n; });
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                  <span className="text-sm text-slate-700 leading-snug">
                    I agree to the{' '}
                    <a
                      href="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 font-medium underline"
                      onClick={e => e.stopPropagation()}
                    >
                      Terms of Service
                    </a>
                    {' '}
                    <span className="text-red-500 font-semibold">*</span>
                    <span className="text-xs text-slate-500 block mt-0.5">Required to create an account</span>
                  </span>
                  {consentTerms && <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5 ml-auto" />}
                </label>
                {errors.consentTerms && (
                  <p className="text-red-600 text-xs mt-1 ml-1">{errors.consentTerms}</p>
                )}

                <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-xl border-2 transition-colors ${consentPrivacy ? 'border-blue-300 bg-blue-50' : errors.consentPrivacy ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={consentPrivacy}
                      onChange={e => {
                        setConsentPrivacy(e.target.checked);
                        if (e.target.checked) {
                          setErrors(prev => { const n = { ...prev }; delete n.consentPrivacy; return n; });
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                  <span className="text-sm text-slate-700 leading-snug">
                    I have read and agree to the{' '}
                    <a
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 font-medium underline"
                      onClick={e => e.stopPropagation()}
                    >
                      Privacy Policy
                    </a>
                    {' '}
                    <span className="text-red-500 font-semibold">*</span>
                    <span className="text-xs text-slate-500 block mt-0.5">Required to create an account</span>
                  </span>
                  {consentPrivacy && <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5 ml-auto" />}
                </label>
                {errors.consentPrivacy && (
                  <p className="text-red-600 text-xs mt-1 ml-1">{errors.consentPrivacy}</p>
                )}
              </div>

              <div className="border-t border-dashed border-slate-200 pt-3 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Optional — Marketing &amp; Promotions
                </p>

                <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-xl border-2 transition-colors ${consentMarketingEmail ? 'border-slate-300 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={consentMarketingEmail}
                      onChange={e => setConsentMarketingEmail(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                  <span className="text-sm text-slate-600 leading-snug">
                    Send me email promotions, seasonal offers, and Bounce Party Club news
                    <span className="text-xs text-slate-400 block mt-0.5">Optional — you can unsubscribe anytime</span>
                  </span>
                </label>

                <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-xl border-2 transition-colors ${consentMarketingSms ? 'border-slate-300 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={consentMarketingSms}
                      onChange={e => setConsentMarketingSms(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                  <span className="text-sm text-slate-600 leading-snug">
                    Send me SMS text promotions and special offers
                    <span className="text-xs text-slate-400 block mt-0.5">Optional — standard message rates apply. Reply STOP to opt out anytime</span>
                  </span>
                </label>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Booking confirmations, order updates, and service notifications are separate from promotional messages and are not affected by these preferences.
              </p>
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
