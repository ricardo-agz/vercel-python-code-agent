import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'
import { RunProvider } from './context/RunContext'
import { ProjectsProvider } from './context/ProjectsContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RunProvider>
        <ProjectsProvider>
          <App />
        </ProjectsProvider>
      </RunProvider>
    </AuthProvider>
  </StrictMode>,
)
