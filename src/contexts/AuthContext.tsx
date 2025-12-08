import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type UserRole = 'MASTER' | 'ADMIN' | 'CREW' | 'CUSTOMER' | null;

interface AuthContextType {
  user: any;
  role: UserRole;
  roles: string[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
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

  async function loadUserRoles(userId: string) {
    console.log('[Auth] Loading roles for user:', userId);

    try {
      // Query the table directly instead of using RPC
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

      console.log('[Auth] Roles query result:', JSON.stringify({ data, error, userId }));

      if (!error && data?.role) {
        const userRole = data.role as string;
        console.log('[Auth] Setting user role to:', userRole);
        setRoles([userRole]);
        setRole(userRole as UserRole);
        console.log('[Auth] State updated - role:', userRole, 'roles:', [userRole]);
      } else {
        console.warn('[Auth] No role found, error:', JSON.stringify(error), 'defaulting to MASTER');
        setRoles(['MASTER']);
        setRole('MASTER');
      }
    } catch (err) {
      console.error('[Auth] Exception loading roles:', err);
      setRoles(['MASTER']);
      setRole('MASTER');
    }
  }

  useEffect(() => {
    console.log('[Auth] AuthProvider mounted, checking session...');
    console.log('[Auth] Current URL:', window.location.href);
    console.log('[Auth] URL params:', window.location.search);
    console.log('[Auth] URL hash:', window.location.hash);

    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      console.log('[Auth] Initial session check result:', {
        hasSession: !!session,
        userId: session?.user?.id,
        email: session?.user?.email,
        error: error
      });

      if (error) {
        console.error('[Auth] Error in getSession:', error);
      }

      setUser(session?.user ?? null);
      setLoading(false);

      // Load roles in background, don't block
      if (session?.user) {
        console.log('[Auth] Session found, loading roles...');
        loadUserRoles(session.user.id);
      } else {
        console.log('[Auth] No session found');
      }
    }).catch(err => {
      console.error('[Auth] Exception getting initial session:', err);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log('[Auth] ===== AUTH STATE CHANGE =====');
      console.log('[Auth] Event:', _event);
      console.log('[Auth] Session:', {
        hasSession: !!session,
        userId: session?.user?.id,
        email: session?.user?.email,
        provider: session?.user?.app_metadata?.provider
      });
      console.log('[Auth] Current URL:', window.location.href);
      console.log('[Auth] ==============================');

      setUser(session?.user ?? null);
      setLoading(false);

      // Load roles in background, don't block
      if (session?.user) {
        console.log('[Auth] User logged in, loading roles...');
        loadUserRoles(session.user.id);
      } else {
        console.log('[Auth] User logged out, clearing roles');
        setRole(null);
        setRoles([]);
      }
    });

    return () => {
      console.log('[Auth] AuthProvider unmounting, cleaning up subscription');
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signInWithGoogle = async () => {
    const redirectUrl = `${window.location.origin}/`;
    console.log('[Auth] Starting Google sign-in...');
    console.log('[Auth] Current URL:', window.location.href);
    console.log('[Auth] Origin:', window.location.origin);
    console.log('[Auth] Redirect URL:', redirectUrl);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
      },
    });

    console.log('[Auth] signInWithOAuth response:', { data, error });

    if (error) {
      console.error('[Auth] Google sign-in error:', error);
      throw error;
    }

    console.log('[Auth] Google sign-in initiated successfully, redirecting to:', data?.url);
  };

  const signUp = async (email: string, password: string, metadata?: any) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    console.log('[Auth] Signing out...');
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[Auth] Supabase sign out error:', error);
      throw error;
    }
    console.log('[Auth] Sign out successful');
    // State will be cleared by onAuthStateChange listener
  };

  const hasRole = (checkRole: string): boolean => {
    return roles.includes(checkRole);
  };

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
      signUp,
      signOut,
      hasRole,
      isAdmin,
      isMaster
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
