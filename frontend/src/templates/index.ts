// Template metadata and file loading system
export type ProjectTemplate = {
  id: string;
  label: string;
  description: string;
  files: Record<string, string>;
  defaultActiveFile: string;
};

// Metadata for each template
const TEMPLATE_METADATA = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Start from an empty project',
    directory: 'blank',
    defaultActiveFile: 'README.md',
  },
  {
    id: 'fastapi',
    label: 'FastAPI',
    description: 'Python API with FastAPI + Uvicorn',
    directory: 'fastapi',
    defaultActiveFile: 'main.py',
  },
  {
    id: 'next',
    label: 'Next.js',
    description: 'React framework with server-side rendering',
    directory: 'next',
    defaultActiveFile: 'src/app/page.tsx',
  },
  {
    id: 'go',
    label: 'Go API',
    description: 'Minimal Go HTTP server',
    directory: 'go',
    defaultActiveFile: 'main.go',
  },
  {
    id: 'rails',
    label: 'Ruby on Rails',
    description: 'Full-featured Rails 7.1 app with MVC architecture',
    directory: 'rails',
    defaultActiveFile: 'README.md',
  },
  {
    id: 'react_fastapi',
    label: 'React + FastAPI',
    description: 'Decoupled frontend (React) and backend (FastAPI)',
    directory: 'react-fastapi',
    defaultActiveFile: 'backend/main.py',
  },
];

// Use Vite's glob import to load all template files at build time
const templateFiles = import.meta.glob('./**/*', { 
  as: 'raw',
  eager: true 
});

// Build the templates object with files loaded from disk
function buildTemplates(): ProjectTemplate[] {
  const templates: ProjectTemplate[] = [];

  for (const meta of TEMPLATE_METADATA) {
    const files: Record<string, string> = {};
    const prefix = `./${meta.directory}/`;

    // Find all files for this template
    for (const [path, content] of Object.entries(templateFiles)) {
      if (path.startsWith(prefix) && path !== prefix) {
        // Remove the template directory prefix to get relative path
        const relativePath = path.slice(prefix.length);
        
        // Skip metadata files (but keep README.md for templates that use it)
        if (relativePath === 'index.ts') {
          continue;
        }
        
        files[relativePath] = content as string;
      }
    }

    templates.push({
      id: meta.id,
      label: meta.label,
      description: meta.description,
      files,
      defaultActiveFile: meta.defaultActiveFile,
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

