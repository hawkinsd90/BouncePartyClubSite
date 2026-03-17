import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createLogger } from '../lib/logger';

const log = createLogger('Auth');

// In-tab guard that prevents a second drain call if onAuthStateChange fires twice
// rapidly (e.g., token refresh + SIGNED_IN in the same tab). This is a UX guard only —
// the real cross-tab and retry idempotency guarantee is the unique index on
// (user_id, consent_batch_id, consent_type) in user_consent_log.
const drainingUserIds = new Set<string>();

type UserRole = 'MASTER' | 'ADMIN' | 'CREW' | 'CUSTOMER' | null;

interface AuthContextType {
  user: any;
  role: UserRole;
  roles: string[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (destinationPath?: string) => Promise<void>;
  signInWithApple: (destinationPath?: string) => Promise<void>;
  signUp: (email: string, password: string, metadata?: any) => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (checkRole: string) => boolean;
  isAdmin: boolean;
  isMaster: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Drains pending_consent from user_metadata for the signed-in session.
  // pending_consent is attached at signUp time so it is available the moment SIGNED_IN
  // fires (confirmation-required path) or on the initial session load (immediate-session
  // path where the direct write in SignUp.tsx failed transiently).
  // drainingUserIds is an in-tab duplicate-fire guard only. The real cross-tab and retry
  // idempotency guarantee is the unique index on (user_id, consent_batch_id, consent_type)
  // in user_consent_log.
  function drainPendingConsent(session: NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>) {
    const userId = session.user.id;

    if (!session.user?.user_metadata?.pending_consent) return;

    if (drainingUserIds.has(userId)) {
      log.debug('drainPendingConsent: already in flight for user, skipping', userId);
      return;
    }

    drainingUserIds.add(userId);

    (async () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-consent?action=drain-pending`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({}),
        });
        const json = await res.json().catch(() => ({}));
        log.debug('drainPendingConsent: drain result', json);
      } catch (err: any) {
        log.warn('drainPendingConsent: request failed', err.message);
      } finally {
        drainingUserIds.delete(userId);
      }
    })();
  }

  async function loadUserRoles(userId: string) {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data?.role) {
        const userRole = data.role as string;
        setRoles([userRole]);
        setRole(userRole as UserRole);
      } else {
        setRoles([]);
        setRole(null);
      }
    } catch (err) {
      log.error('Exception loading roles', err);
      setRoles([]);
      setRole(null);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        log.error('Error in getSession', error);
      }

      setUser(session?.user ?? null);
      setLoading(false);

      if (session?.user) {
        loadUserRoles(session.user.id);
        drainPendingConsent(session);
      }
    }).catch(err => {
      log.error('Exception getting initial session', err);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);

      if (_event === 'SIGNED_IN' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname);
      }

      if (_event === 'SIGNED_IN' && session?.access_token) {
        drainPendingConsent(session);
      }

      if (session?.user) {
        loadUserRoles(session.user.id);
      } else {
        setRole(null);
        setRoles([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signInWithGoogle = async (destinationPath?: string) => {
    const redirectTo = destinationPath
      ? `${window.location.origin}/?next=${encodeURIComponent(destinationPath)}`
      : `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
  };

  const signInWithApple = async (destinationPath?: string) => {
    const redirectTo = destinationPath
      ? `${window.location.origin}/?next=${encodeURIComponent(destinationPath)}`
      : `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo },
    });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, metadata?: any) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const hasRole = (checkRole: string): boolean => roles.includes(checkRole);

  const isAdmin = hasRole('ADMIN') || hasRole('MASTER');
  const isMaster = hasRole('MASTER');

  return (
    <AuthContext.Provider value={{
      user,
      role,
      roles,
      loading,
      signIn,
      signInWithGoogle,
      signInWithApple,
      signUp,
      signOut,
      hasRole,
      isAdmin,
      isMaster,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
