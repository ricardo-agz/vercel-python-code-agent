export type ProjectTemplate = {
  id: string;
  label: string;
  description?: string;
  files: Record<string, string>;
  defaultActiveFile: string;
};

const FASTAPI_TEMPLATE_FILES: Record<string, string> = {
  'main.py': `from fastapi import FastAPI
from routes import api_router

app = FastAPI(title="Demo API")

@app.get("/")
def root():
    return {"message": "Hello from FastAPI"}

app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
`,
  'routes/__init__.py': `from fastapi import APIRouter
from .items import router as items_router
from .users import router as users_router

api_router = APIRouter()
api_router.include_router(items_router, prefix="/items", tags=["items"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
`,
  'routes/items.py': `from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str
    price: float
    description: Optional[str] = None


router = APIRouter()

# Sample, read-only data suitable for stateless/serverless deployments
SAMPLE_ITEMS: List[Item] = [
    Item(id=1, name="Widget", price=9.99, description="A simple widget"),
    Item(id=2, name="Gadget", price=19.99, description="A useful gadget"),
    Item(id=3, name="Doohickey", price=4.50),
]


@router.get("/", response_model=List[Item])
def list_items(q: Optional[str] = Query(default=None)) -> List[Item]:
    items = SAMPLE_ITEMS
    if q:
        query = q.lower()
        return [i for i in items if query in i.name.lower()]
    return items


@router.get("/{item_id}", response_model=Item)
def get_item(item_id: int) -> Item:
    for item in SAMPLE_ITEMS:
        if item.id == item_id:
            return item
    raise HTTPException(status_code=404, detail="Item not found")
`,
  'routes/users.py': `from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel


class User(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None


router = APIRouter()

_users: List[User] = [
    User(id=1, username="alice", full_name="Alice Anderson"),
    User(id=2, username="bob", full_name="Bob Brown"),
]


@router.get("/me", response_model=User)
def read_me() -> User:
    return _users[0]


@router.get("/", response_model=List[User])
def list_users(limit: int = Query(default=50, ge=1, le=100)) -> List[User]:
    return _users[:limit]


@router.get("/{user_id}", response_model=User)
def get_user(user_id: int) -> User:
    for user in _users:
        if user.id == user_id:
            return user
    raise HTTPException(status_code=404, detail="User not found")
`,
  'requirements.txt': `fastapi==0.115.12
uvicorn[standard]==0.34.2
pydantic>=2
`,
  'README.md': `# FastAPI Starter\n\nOpen 'main.py' and click the Run button. The preview will appear once the server starts.\n`,
};

const REACT_TEMPLATE_FILES: Record<string, string> = {
  'package.json': `{
  "name": "react-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 5173"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.7",
    "@types/react-dom": "^18.3.2",
    "@vitejs/plugin-react": "^4.3.2",
    "typescript": "^5.6.3",
    "vite": "^5.4.8"
  }
}
`,
  '.gitignore': `node_modules/\n*.log\ndist/\n`,
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
  </html>
`,
  'src/main.tsx': `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
`,
  'src/App.tsx': `import React from 'react'

export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>React + Vite</h1>
      <p>Edit src/App.tsx and save to test HMR.</p>
    </div>
  )
}
`,
  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
`,
  'vite.config.ts': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 }
})
`,
  'README.md': `# React Starter (Vite)\n\nRun dev server with npm run dev.\n`,
};

const GO_TEMPLATE_FILES: Record<string, string> = {
  'main.go': `package main

import (
    "fmt"
    "net/http"
    "os"
)

func main() {
    port := os.Getenv("PORT")
    if port == "" { port = "8080" }
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "Hello from Go API")
    })
    fmt.Printf("Listening on :%s\n", port)
    _ = http.ListenAndServe(":"+port, nil)
}
`,
  'README.md': `# Go API Starter\n\nThis is a minimal Go HTTP server.\n`,
};

const RAILS_TEMPLATE_FILES: Record<string, string> = {
  'Gemfile': `source 'https://rubygems.org'\n\ngem 'rails', '~> 7.1'\n`,
  'README.md': `# Ruby on Rails Starter (auto-bootstrap)\n\nThis template will auto-generate a minimal Rails app on first run and start the server.\n\n- Entry: 'server.rb' (click Run)\n- Port: 4567 (matches sandbox preview defaults)\n- Flags: skips DB, assets, mailers, tests, etc. for fast startup\n`,
};

const REACT_FASTAPI_FILES: Record<string, string> = {
  // Frontend
  'frontend/package.json': REACT_TEMPLATE_FILES['package.json'],
  'frontend/.gitignore': REACT_TEMPLATE_FILES['.gitignore'],
  'frontend/index.html': REACT_TEMPLATE_FILES['index.html'],
  'frontend/src/main.tsx': REACT_TEMPLATE_FILES['src/main.tsx'],
  'frontend/src/App.tsx': REACT_TEMPLATE_FILES['src/App.tsx'],
  'frontend/tsconfig.json': REACT_TEMPLATE_FILES['tsconfig.json'],
  'frontend/vite.config.ts': REACT_TEMPLATE_FILES['vite.config.ts'],
  // Backend
  'backend/main.py': FASTAPI_TEMPLATE_FILES['main.py'],
  'backend/routes/__init__.py': FASTAPI_TEMPLATE_FILES['routes/__init__.py'],
  'backend/routes/items.py': FASTAPI_TEMPLATE_FILES['routes/items.py'],
  'backend/routes/users.py': FASTAPI_TEMPLATE_FILES['routes/users.py'],
  'backend/requirements.txt': FASTAPI_TEMPLATE_FILES['requirements.txt'],
  'README.md': `# Full-stack: React (frontend) + FastAPI (backend)\n\nOpen 'backend/main.py' and click Run to start the API.\nFrontend is under ./frontend (use npm install && npm run dev).\n`,
};

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Start from an empty project',
    files: { 'README.md': '# New Project\n\nStart building your app here.\n' },
    defaultActiveFile: 'README.md',
  },
  {
    id: 'fastapi',
    label: 'FastAPI',
    description: 'Python API with FastAPI + Uvicorn',
    files: FASTAPI_TEMPLATE_FILES,
    defaultActiveFile: 'main.py',
  },
  {
    id: 'react',
    label: 'React (Vite)',
    description: 'React SPA powered by Vite',
    files: REACT_TEMPLATE_FILES,
    defaultActiveFile: 'src/App.tsx',
  },
  {
    id: 'go',
    label: 'Go API',
    description: 'Minimal Go HTTP server',
    files: GO_TEMPLATE_FILES,
    defaultActiveFile: 'main.go',
  },
  {
    id: 'rails',
    label: 'Ruby on Rails',
    description: 'Minimal Rails app; auto-bootstraps on first run',
    files: RAILS_TEMPLATE_FILES,
    defaultActiveFile: 'server.rb',
  },
  {
    id: 'react_fastapi',
    label: 'React + FastAPI',
    description: 'Decoupled frontend (React) and backend (FastAPI)',
    files: REACT_FASTAPI_FILES,
    defaultActiveFile: 'backend/main.py',
  },
];

export function getTemplateById(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}


