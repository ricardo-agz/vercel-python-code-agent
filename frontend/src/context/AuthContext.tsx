import React from 'react';
import { API_BASE } from '../constants';

export type VercelUser = {
  id: string;
  name?: string | null;
  username?: string | null;
  email?: string | null;
  avatar?: string | null;
  accountType?: string | null;
};

// We rely on an HttpOnly cookie set by the backend; no token is stored client-side.

type AuthContextValue = {
  isAuthenticated: boolean;
  user: VercelUser | null;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  signInWithVercel: () => Promise<void>;
  logout: () => Promise<void>;
  accountMenuOpen: boolean;
  openAccountMenu: () => void;
  closeAccountMenu: () => void;
};

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = React.useState<VercelUser | null>(null);
  const [modalOpen, setModalOpen] = React.useState<boolean>(false);
  const [accountMenuOpen, setAccountMenuOpen] = React.useState<boolean>(false);

  // On first load, ask backend for current session (via cookie)
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as { authenticated: boolean; user?: VercelUser };
        if (data.authenticated && data.user) {
          setUser(data.user);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // OAuth callback now handled server-side; after redirect back, /auth/me above populates user.

  const signInWithVercel = React.useCallback(async () => {
    const next = `${window.location.pathname}${window.location.search || ''}`;
    try {
      const res = await fetch(`${API_BASE}/auth/login?next=${encodeURIComponent(next)}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to start OAuth');
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (e) {
      console.error(e);
    }
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      // ignore network errors; still clear locally
    }
    setUser(null);
    setAccountMenuOpen(false);
  }, []);

  const value: AuthContextValue = React.useMemo(() => ({
    isAuthenticated: !!user,
    user,
    modalOpen,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
    signInWithVercel,
    logout,
    accountMenuOpen,
    openAccountMenu: () => setAccountMenuOpen(true),
    closeAccountMenu: () => setAccountMenuOpen(false),
  }), [user, modalOpen, accountMenuOpen, signInWithVercel, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}


