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
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    if (!error && data) {
      const userRoles = data.map(r => r.role);
      setRoles(userRoles);

      // Set primary role (highest in hierarchy)
      const roleHierarchy = ['MASTER', 'ADMIN', 'CREW', 'CUSTOMER'];
      const highestRole = roleHierarchy.find(r => userRoles.includes(r)) as UserRole;
      setRole(highestRole || 'CUSTOMER');
    } else {
      setRoles([]);
      setRole('CUSTOMER');
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await loadUserRoles(session.user.id);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
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
    setRole(null);
    setRoles([]);
    setUser(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Supabase sign out error:', error);
      throw error;
    }
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
