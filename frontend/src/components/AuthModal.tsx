import React from 'react';
import { useAuth } from '../context/AuthContext';

export const AuthModal: React.FC = () => {
  const { modalOpen, closeModal, signInWithVercel } = useAuth();
  if (!modalOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center" role="dialog" aria-modal="true" style={{ zIndex: 100000 }}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={closeModal} />
      <div className="relative w-full max-w-lg mx-4 rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 p-8">
        <button
          aria-label="Close"
          onClick={closeModal}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 cursor-pointer"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="h-10 w-10 flex items-center justify-center">
            <svg viewBox="0 0 76 65" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-10 w-10">
              <path d="M37.59 0L75.18 65H0z" fill="black" />
            </svg>
          </div>
          <h2 className="mt-4 text-2xl font-semibold text-gray-900">Sign in to Vercel</h2>
          <p className="mt-2 text-base text-gray-600 leading-7 max-w-md">To use the app with free credits, you need to sign in with your Vercel account.</p>

          <div className="mt-4">
            <button
              onClick={signInWithVercel}
              className="inline-flex items-center gap-2 rounded-md bg-black px-3 py-2 text-white text-sm md:text-base hover:bg-gray-900 shadow-sm cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 76 65" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="shrink-0">
                <path d="M37.59 0L75.18 65H0z" fill="white" />
              </svg>
              <span>Sign in with Vercel</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


