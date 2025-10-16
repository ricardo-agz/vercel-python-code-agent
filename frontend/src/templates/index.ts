// Template metadata and file loading system
export type ProjectTemplate = {
  id: string;
  label: string;
  description: string;
  files: Record<string, string>;
  defaultActiveFile: string;
  suggestions?: string[];
};

// Stacks: allow composing a frontend and backend into one project
export const FRONTEND_TEMPLATE_IDS = ['next_stack', 'react_stack'] as const;
export const BACKEND_TEMPLATE_IDS = ['express', 'fastapi', 'flask', 'hono'] as const;

// Metadata for each template
const TEMPLATE_METADATA = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Start from an empty project',
    directory: 'blank',
    defaultActiveFile: 'README.md',
    suggestions: [
      'Create a minimal HTTP API scaffold (FastAPI/Express/Go/Rails) and run',
      'Add /health and /time endpoints with basic request logging and run',
      'Implement /text/wordcount that accepts JSON and returns counts and run',
    ],
  },
  {
    id: 'fastapi',
    label: 'FastAPI',
    description: 'Python API with FastAPI + Uvicorn',
    directory: 'fastapi',
    defaultActiveFile: 'main.py',
    suggestions: [
      'Run this code.',
      'Add a FastAPI /todos API with in-memory CRUD (GET, POST, DELETE) and run',
      'Implement /math/fibonacci?n=20 that returns the sequence as JSON and run',
      'Add request logging middleware plus /health and /time endpoints and run',
    ],
  },
  {
    id: 'express',
    label: 'Express',
    description: 'Node.js API with Express',
    directory: 'express',
    defaultActiveFile: 'server.js',
    suggestions: [
      'Run this code.',
      'Add /todos API with in-memory CRUD (GET, POST, DELETE) and run',
      'Implement /math/fibonacci?n=20 that returns the sequence as JSON and run',
      'Add request logging middleware plus /health and /time endpoints and run',
    ],
  },
  {
    id: 'flask',
    label: 'Flask',
    description: 'Python API with Flask',
    directory: 'flask',
    defaultActiveFile: 'app.py',
    suggestions: [
      'Run this code.',
      'Add /todos API with in-memory CRUD (GET, POST, DELETE) and run',
      'Implement /math/fibonacci?n=20 that returns the sequence as JSON and run',
      'Add request logging middleware plus /health and /time endpoints and run',
    ],
  },
  {
    id: 'hono',
    label: 'Hono',
    description: 'TypeScript/JavaScript API with Hono',
    directory: 'hono',
    defaultActiveFile: 'server.ts',
    suggestions: [
      'Run this code.',
      'Add /todos API with in-memory CRUD (GET, POST, DELETE) and run',
      'Implement /math/fibonacci?n=20 that returns the sequence as JSON and run',
      'Add request logging middleware plus /health and /time endpoints and run',
    ],
  },
  {
    id: 'next',
    label: 'Next.js',
    description: 'React framework with server-side rendering',
    directory: 'next',
    defaultActiveFile: 'src/app/page.tsx',
    suggestions: [
      'Run this code.',
      'Add /api/todos route with in-memory CRUD (GET, POST, DELETE) and run',
      'Implement /api/math/fibonacci?n=20 returning JSON and render it on the page and run',
      'Add request logging plus /api/health and /api/time routes and run',
    ],
  },
  {
    id: 'next_stack',
    label: 'Next.js',
    description: 'Next.js frontend built to pair with a backend',
    directory: 'next_stack',
    defaultActiveFile: 'src/app/page.tsx',
  },
  {
    id: 'react',
    label: 'React (Vite)',
    description: 'React SPA powered by Vite + TypeScript',
    directory: 'react',
    defaultActiveFile: 'src/App.tsx',
    suggestions: [
      'Run this code.',
      'Add a simple todo list component with local state and run',
      'Fetch from a /api/health endpoint and render status and run',
    ],
  },
  {
    id: 'react_stack',
    label: 'React',
    description: 'React (Vite) frontend built to pair with a backend',
    directory: 'react_stack',
    defaultActiveFile: 'src/App.tsx',
  },
  {
    id: 'go',
    label: 'Go API',
    description: 'Minimal Go HTTP server',
    directory: 'go',
    defaultActiveFile: 'main.go',
    suggestions: [
      'Run this code.',
      'Add /todos API with in-memory CRUD (GET, POST, DELETE) and run',
      'Implement /math/fibonacci?n=20 that returns the sequence as JSON and run',
      'Add request logging middleware plus /health and /time endpoints and run',
    ],
  },
  {
    id: 'rails',
    label: 'Ruby on Rails',
    description: 'Full-featured Rails 7.1 app with MVC architecture',
    directory: 'rails',
    defaultActiveFile: 'README.md',
    suggestions: [
      'Run this code.',
      'Create a todo-app.',
      'Build a blog app with authentication where users can create, like, and comment on posts and follow other users.',
      'Create a fully functional Hacker News clone that actually looks like Hacker News.',
    ],
  },
  {
    id: 'react_fastapi',
    label: 'Next.js + FastAPI',
    description: 'Decoupled frontend (Next.js) and backend (FastAPI)',
    directory: 'react-fastapi',
    defaultActiveFile: 'backend/main.py',
    suggestions: [
      'Add FastAPI /todos and a Next.js page to list/add todos; connect API and run',
      'Implement FastAPI /math/fibonacci?n=20 and display results in Next.js and run',
      'Add FastAPI logging, /health, /time; add a Next.js status page and run',
    ],
  },
];

// Use Vite's glob import to load all template files at build time
// Text-like files are loaded as raw strings; binary image assets are loaded as URLs
const templateTextFiles = import.meta.glob('./**/*', {
  as: 'raw',
  eager: true,
});
const templateImageUrls = import.meta.glob('./**/*.{png,jpg,jpeg,gif,webp,bmp}', {
  as: 'url',
  eager: true,
});

// Build the templates object with files loaded from disk
function buildTemplates(): ProjectTemplate[] {
  const templates: ProjectTemplate[] = [];

  for (const meta of TEMPLATE_METADATA) {
    const files: Record<string, string> = {};
    const prefix = `./${meta.directory}/`;

    const isBinaryImage = (p: string) => /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(p);

    // Add image URLs first (so they are not overridden by raw loader)
    for (const [path, url] of Object.entries(templateImageUrls)) {
      if (path.startsWith(prefix) && path !== prefix) {
        const relativePath = path.slice(prefix.length);
        files[relativePath] = url as string; // store URL for binary images
      }
    }

    // Add raw files but skip binary images (handled above). SVGs remain raw (editable text)
    for (const [path, content] of Object.entries(templateTextFiles)) {
      if (!path.startsWith(prefix) || path === prefix) continue;
      const relativePath = path.slice(prefix.length);
      if (relativePath === 'index.ts') continue; // skip metadata index
      if (isBinaryImage(relativePath)) continue; // avoid corrupting binary assets
      files[relativePath] = content as string;
    }

    templates.push({
      id: meta.id,
      label: meta.label,
      description: meta.description,
      files,
      defaultActiveFile: meta.defaultActiveFile,
      suggestions: meta.suggestions,
    });
  }

  return templates;
}

// Export the built templates
export const TEMPLATES = buildTemplates();

// Get template by ID
export function getTemplateById(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

// -----------------------------
// Stack composition helpers
// -----------------------------

export function isStackId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('stack:');
}

function parseStackId(id: string): { frontendId: string; backendId: string } | null {
  if (!isStackId(id)) return null;
  const rest = id.slice('stack:'.length);
  const [frontendId, backendId] = rest.split('+');
  if (!frontendId || !backendId) return null;
  return { frontendId, backendId };
}

export function composeStack(frontendId: string, backendId: string): ProjectTemplate | undefined {
  const frontend = getTemplateById(frontendId);
  const backend = getTemplateById(backendId);
  if (!frontend || !backend) return undefined;

  const files: Record<string, string> = {};
  for (const [p, c] of Object.entries(frontend.files)) {
    files[`frontend/${p}`] = c as string;
  }
  for (const [p, c] of Object.entries(backend.files)) {
    files[`backend/${p}`] = c as string;
  }

  // No UI injection here; stack-specific frontends handle connectivity checks

  const backendDefault = `backend/${backend.defaultActiveFile}`;
  const frontendDefault = `frontend/${frontend.defaultActiveFile}`;
  const defaultActiveFile = (backendDefault in files)
    ? backendDefault
    : ((frontendDefault in files) ? frontendDefault : (Object.keys(files)[0] || 'README.md'));

  // For stacks, keep suggestions concise: prefer backend-only prompts
  const suggestions = backend.suggestions ? [...backend.suggestions] : (frontend.suggestions ? [...frontend.suggestions] : undefined);

  return {
    id: `stack:${frontend.id}+${backend.id}`,
    label: `${frontend.label} + ${backend.label}`,
    description: 'Custom stack (composed frontend and backend)',
    files,
    defaultActiveFile,
    suggestions,
  };
}

export function getStackById(id: string): ProjectTemplate | undefined {
  const parsed = parseStackId(id);
  if (!parsed) return undefined;
  return composeStack(parsed.frontendId, parsed.backendId);
}

