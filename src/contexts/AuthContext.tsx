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
      // Use RPC call instead of direct query to avoid hanging
      const { data, error } = await supabase.rpc('get_user_role', {
        user_id_input: userId
      });

      console.log('[Auth] Roles RPC result:', { data, error, userId });

      if (!error && data) {
        const userRole = data as string;
        console.log('[Auth] User role:', userRole);
        setRoles([userRole]);
        setRole(userRole as UserRole);
        console.log('[Auth] Role set to:', userRole);
      } else {
        console.warn('[Auth] No role found or error occurred:', error, 'defaulting to CUSTOMER');
        setRoles(['CUSTOMER']);
        setRole('CUSTOMER');
      }
    } catch (err) {
      console.error('[Auth] Exception loading roles:', err);
      setRoles(['CUSTOMER']);
      setRole('CUSTOMER');
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      console.log('[Auth] Initial session check:', session?.user?.id);
      setUser(session?.user ?? null);
      if (session?.user) {
        await loadUserRoles(session.user.id);
      }
      setLoading(false);
    }).catch(err => {
      console.error('[Auth] Error getting initial session:', err);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('[Auth] Auth state changed:', _event, session?.user?.id);
      setUser(session?.user ?? null);
      if (session?.user) {
        await loadUserRoles(session.user.id);
      } else {
        setRole(null);
        setRoles([]);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
    if (error) throw error;
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
