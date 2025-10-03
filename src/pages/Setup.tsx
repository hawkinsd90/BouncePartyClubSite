import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Settings, Lock, Loader2, CheckCircle } from 'lucide-react';

export function Setup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);
  const [step, setStep] = useState<'check' | 'setup' | 'complete'>('check');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [adminData, setAdminData] = useState({
    email: 'admin@bouncepartyclub.com',
    password: 'admin123',
    confirmPassword: 'admin123'
  });

  const [twilioData, setTwilioData] = useState({
    accountSid: '',
    authToken: '',
    fromNumber: ''
  });

  useEffect(() => {
    checkSetupStatus();
  }, []);

  async function checkSetupStatus() {
    setLoading(true);
    try {
      const { data: users } = await supabase.rpc('get_admin_users');

      if (users && users.length > 0) {
        setSetupComplete(true);
        setStep('complete');
      } else {
        setStep('setup');
      }
    } catch (err) {
      console.error('Error checking setup:', err);
      setStep('setup');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup() {
    if (adminData.password !== adminData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (adminData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: adminData.email,
        password: adminData.password,
        options: {
          data: {
            role: 'ADMIN'
          },
          emailRedirectTo: undefined
        }
      });

      if (signUpError) {
        console.error('Sign up error:', signUpError);
        throw signUpError;
      }

      if (!authData.user) {
        throw new Error('Failed to create user. The user may already exist or email confirmation is required.');
      }

      const { error: roleError } = await supabase.from('user_roles').insert({
        user_id: authData.user.id,
        role: 'ADMIN'
      });

      if (roleError) {
        console.error('Role insert error:', roleError);
      }

      if (twilioData.accountSid && twilioData.authToken && twilioData.fromNumber) {
        const updates = [
          { key: 'twilio_account_sid', value: twilioData.accountSid },
          { key: 'twilio_auth_token', value: twilioData.authToken },
          { key: 'twilio_from_number', value: twilioData.fromNumber }
        ];

        for (const update of updates) {
          await supabase
            .from('admin_settings')
            .update({ value: update.value })
            .eq('key', update.key);
        }
      }

      await supabase.auth.signOut();

      setStep('complete');
      setSetupComplete(true);

      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err: any) {
      console.error('Setup error:', err);
      setError(err.message || 'Failed to complete setup. Check console for details.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Checking setup status...</p>
        </div>
      </div>
    );
  }

  if (step === 'complete') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-xl shadow-md p-8 text-center">
            <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Setup Complete!</h2>
            <p className="text-slate-600 mb-6">
              {setupComplete && !saving
                ? 'Your admin account is already configured. You can now sign in.'
                : 'Your admin account has been created successfully.'}
            </p>
            <div className="bg-slate-50 rounded-lg p-4 mb-6">
              <p className="text-sm font-medium text-slate-700 mb-2">Login Credentials:</p>
              <p className="text-sm text-slate-600">
                Email: {adminData.email}<br />
                Password: {adminData.password}
              </p>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <Settings className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Initial Setup</h1>
            <p className="text-slate-600">
              Create your admin account and configure SMS notifications
            </p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="space-y-8">
            <div>
              <div className="flex items-center mb-4">
                <Lock className="w-5 h-5 text-blue-600 mr-2" />
                <h2 className="text-xl font-bold text-slate-900">Admin Account</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={adminData.email}
                    onChange={(e) => setAdminData({ ...adminData, email: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={adminData.password}
                    onChange={(e) => setAdminData({ ...adminData, password: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    required
                    minLength={6}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={adminData.confirmPassword}
                    onChange={(e) => setAdminData({ ...adminData, confirmPassword: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    required
                    minLength={6}
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-8">
              <div className="mb-4">
                <h2 className="text-xl font-bold text-slate-900 mb-2">
                  SMS Notifications (Optional)
                </h2>
                <p className="text-sm text-slate-600">
                  You can skip this and configure it later in Admin Settings
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Twilio Account SID
                  </label>
                  <input
                    type="text"
                    value={twilioData.accountSid}
                    onChange={(e) => setTwilioData({ ...twilioData, accountSid: e.target.value })}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Twilio Auth Token
                  </label>
                  <input
                    type="password"
                    value={twilioData.authToken}
                    onChange={(e) => setTwilioData({ ...twilioData, authToken: e.target.value })}
                    placeholder="********************************"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Twilio Phone Number
                  </label>
                  <input
                    type="tel"
                    value={twilioData.fromNumber}
                    onChange={(e) => setTwilioData({ ...twilioData, fromNumber: e.target.value })}
                    placeholder="+15551234567"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Get your credentials from{' '}
                    <a
                      href="https://console.twilio.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 underline"
                    >
                      Twilio Console
                    </a>
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={handleSetup}
                disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  'Complete Setup'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
