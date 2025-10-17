import React from 'react';
import { useAuth } from '../context/AuthContext';

const MENU_Z = 100001;

export const AccountMenu: React.FC = () => {
  const { accountMenuOpen, closeAccountMenu, isAuthenticated, user, logout } = useAuth();
  if (!accountMenuOpen || !isAuthenticated) return null;

  const displayName = user?.username || user?.name || 'Signed in';
  const accountLabel = (user?.accountType && user.accountType.trim()) || null;

  return (
    <div style={{ zIndex: MENU_Z }}>
      {/* click-away overlay */}
      <div className="fixed inset-0" onClick={closeAccountMenu} />

      {/* menu */}
      <div
        role="menu"
        aria-labelledby="vercel-status-button"
        id="account-menu"
        className="fixed w-72 rounded-xl bg-white shadow-2xl ring-1 ring-black/10 p-3 text-sm text-gray-900"
        style={{
          left: 8,
          bottom: `calc(var(--statusbar-height) + 8px)`,
        }}
      >
        <div className="flex items-start gap-3 p-2">
          <div className="h-10 w-10 rounded-full overflow-hidden ring-1 ring-black/10 bg-gray-100 flex items-center justify-center">
            {user?.avatar ? (
              <img src={user.avatar} alt="Avatar" className="h-10 w-10 object-cover" />
            ) : (
              <div
                className="h-10 w-10"
                style={{
                  background: 'linear-gradient(135deg, #22c1c3 0%, #7c3aed 50%, #ec4899 100%)',
                }}
                aria-hidden="true"
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-medium truncate text-gray-900" title={displayName}>{displayName}</div>
              {accountLabel ? (
                <span className="text-xs rounded-full bg-black text-white px-2 py-0.5">{accountLabel}</span>
              ) : null}
            </div>
            {user?.email ? (
              <div className="text-gray-700 truncate" title={user.email}>{user.email}</div>
            ) : null}
          </div>
        </div>

        <div className="mt-2 space-y-1">
          <a
            href="https://vercel.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-50 cursor-pointer text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
            role="menuitem"
          >
            <span>Vercel Homepage</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500" aria-hidden="true">
              <path d="M18 13V6h-7" />
              <path d="M6 18 18 6" />
            </svg>
          </a>
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 text-red-600 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
            role="menuitem"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountMenu;
