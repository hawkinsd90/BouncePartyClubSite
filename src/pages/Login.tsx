import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Lock, Loader2, Eye, EyeOff, X, Mail, AlertTriangle, Clock } from 'lucide-react';
import { notifySuccess, notifyError } from '../lib/notifications';
import { createLogger } from '../lib/logger';

const log = createLogger('Login');

// UX-only cooldown — not a security boundary. Backend rate limiting handles real enforcement.
const FAILED_ATTEMPT_THRESHOLD = 3;
const COOLDOWN_SECONDS = 30;

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

// Map raw Supabase/auth error messages to clear user-facing strings.
// Supabase does not return typed error codes for most auth errors, so we match on message text.
type AuthErrorKind = 'invalid_credentials' | 'email_not_confirmed' | 'rate_limited' | 'generic';

function classifyAuthError(msg: string): AuthErrorKind {
  const lower = msg.toLowerCase();
  if (
    lower.includes('email not confirmed') ||
    lower.includes('email_not_confirmed') ||
    lower.includes('not confirmed')
  ) return 'email_not_confirmed';
  if (
    lower.includes('rate limit') ||
    lower.includes('too many') ||
    lower.includes('429')
  ) return 'rate_limited';
  if (
    lower.includes('invalid login') ||
    lower.includes('invalid credentials') ||
    lower.includes('invalid email or password') ||
    lower.includes('wrong password') ||
    lower.includes('user not found') ||
    lower.includes('no user found')
  ) return 'invalid_credentials';
  return 'generic';
}

const ERROR_MESSAGES: Record<AuthErrorKind, string> = {
  invalid_credentials: 'Incorrect email or password. Please try again.',
  email_not_confirmed: '', // handled by dedicated UI block below
  rate_limited: 'Too many sign-in attempts. Please wait a few minutes and try again.',
  generic: 'Sign-in failed. Please check your credentials and try again.',
};

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  // Inline error string for generic/credential/rate-limit failures
  const [error, setError] = useState('');
  // Dedicated state for unconfirmed-email case — triggers its own UI block
  const [emailNotConfirmed, setEmailNotConfirmed] = useState(false);

  // Resend confirmation
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  // UX-only cooldown after repeated failures in the same browser session
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const from = (location.state as any)?.from?.pathname || '/';
  const prefillEmail = (location.state as any)?.prefillEmail || '';

  useEffect(() => {
    setIsIOS(isIOSDevice());
    if (prefillEmail) setEmail(prefillEmail);
  }, []);

  // Clean up cooldown timer on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldownSecondsLeft(COOLDOWN_SECONDS);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setCooldownSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(cooldownTimerRef.current!);
          cooldownTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const isCoolingDown = cooldownSecondsLeft > 0;

  const clearAuthState = () => {
    setError('');
    setEmailNotConfirmed(false);
    setResendSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCoolingDown) return;

    clearAuthState();
    setLoading(true);

    try {
      await signIn(email, password);
      // Reset failure counter on success
      setFailedAttempts(0);
      navigate(from, { replace: true });
    } catch (err: any) {
      const msg: string = err.message || '';
      const kind = classifyAuthError(msg);
      log.warn('Login failed', { kind, raw: msg });

      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);

      if (kind === 'email_not_confirmed') {
        setEmailNotConfirmed(true);
      } else if (kind === 'rate_limited') {
        // Platform is rate-limiting — always start cooldown regardless of local count
        setError(ERROR_MESSAGES.rate_limited);
        startCooldown();
      } else {
        setError(ERROR_MESSAGES[kind]);
        // After threshold consecutive failures, impose a local UX cooldown
        if (nextAttempts >= FAILED_ATTEMPT_THRESHOLD && !isCoolingDown) {
          startCooldown();
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!email) return;
    setResending(true);
    setResendSuccess(false);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      setResendSuccess(true);
      notifySuccess('Confirmation email resent. Check your inbox.', { duration: 8000 });
    } catch (err: any) {
      log.warn('Resend confirmation failed', err.message);
      notifyError(err.message || 'Failed to resend confirmation email. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const handleGoogleSignIn = async () => {
    log.info('Google sign-in button clicked');
    clearAuthState();
    setLoading(true);
    try {
      await signInWithGoogle(from !== '/' ? from : undefined);
    } catch (err: any) {
      log.error('Google sign-in failed', err);
      setError(err.message || 'Failed to sign in with Google');
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    log.info('Apple sign-in button clicked');
    clearAuthState();
    setLoading(true);
    try {
      await signInWithApple(from !== '/' ? from : undefined);
    } catch (err: any) {
      log.error('Apple sign-in failed', err);
      setError(err.message || 'Failed to sign in with Apple');
      setLoading(false);
    }
  };

  const submitDisabled = loading || isCoolingDown;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center py-4 sm:py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-8 relative border border-slate-100">
          <button
            onClick={() => navigate(-1)}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
            aria-label="Go back"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="text-center mb-4 sm:mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl mb-2 sm:mb-4 shadow-lg">
              <Lock className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              Sign In
            </h2>
            <p className="mt-2 sm:mt-3 text-base sm:text-lg text-slate-600">
              Welcome back!
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
            {/* Generic inline error banner */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {/* Cooldown banner */}
            {isCoolingDown && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  Please wait <span className="font-semibold">{cooldownSecondsLeft}s</span> before trying again.
                </p>
              </div>
            )}

            {/* Unconfirmed email block */}
            {emailNotConfirmed && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
                <Mail className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm flex-1">
                  <p className="font-semibold text-blue-900 mb-1">
                    Your email address is not confirmed yet.
                  </p>
                  <p className="text-blue-700 mb-3">
                    Check your inbox for the confirmation link we sent when you signed up, then come back here to sign in.
                  </p>
                  {resendSuccess ? (
                    <p className="text-green-700 font-medium text-xs">
                      Confirmation email sent — check your inbox.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendConfirmation}
                      disabled={resending || !email}
                      className="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      {resending ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        'Resend confirmation email'
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 sm:mb-2">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearAuthState();
                }}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base transition-all"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 sm:mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 pr-12 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-2"
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitDisabled}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-slate-400 disabled:to-slate-500 disabled:cursor-not-allowed text-white font-bold py-3 sm:py-4 px-4 rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-[1.02] disabled:transform-none flex items-center justify-center text-base min-h-[48px]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : isCoolingDown ? (
                `Wait ${cooldownSecondsLeft}s`
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="mt-4 sm:mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-slate-500">Or continue with</span>
              </div>
            </div>

            <div className="mt-3 sm:mt-4 space-y-2 sm:space-y-3">
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-300 hover:border-slate-400 hover:bg-slate-50 hover:shadow-lg text-slate-700 font-bold py-3 sm:py-4 px-4 rounded-xl transition-all shadow-md min-h-[48px]"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Google
              </button>

              {/* Apple Sign-In - Uncomment when backend is configured
              {isIOS && (
                <button
                  onClick={handleAppleSignIn}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 bg-black hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold py-3 sm:py-4 px-4 rounded-xl transition-all shadow-md hover:shadow-lg min-h-[48px]"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                  </svg>
                  Apple
                </button>
              )}
              */}
            </div>
          </div>

          <div className="mt-4 sm:mt-6 text-center space-y-2 sm:space-y-3">
            <div>
              <button
                type="button"
                onClick={() => navigate('/signup', { state: location.state })}
                className="text-blue-600 hover:text-blue-700 font-medium text-sm sm:text-base"
              >
                Don't have an account? Sign up
              </button>
            </div>
            <div>
              <button
                onClick={() => navigate('/forgot-password')}
                className="text-xs sm:text-sm text-slate-600 hover:text-slate-700 font-medium"
              >
                Forgot password?
              </button>
            </div>
            <div>
              <button
                onClick={() => navigate('/')}
                className="text-xs sm:text-sm text-slate-600 hover:text-slate-700"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
