"use client";

import React from 'react';
import App from './App';
import { AuthProvider } from '../context/AuthContext';
import { RunProvider } from '../context/RunContext';
import { ProjectsProvider } from '../context/ProjectsContext';

export default function Home() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return (
    <AuthProvider>
      <RunProvider>
        <ProjectsProvider>
          <App />
        </ProjectsProvider>
      </RunProvider>
    </AuthProvider>
  );
}
