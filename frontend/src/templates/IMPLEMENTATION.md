# Template System Implementation

## Overview

The project template system has been migrated from inline string constants to a file-based system using real template files on disk.

## How It Works

### 1. Template Files Structure

All templates are now organized as actual files in the `frontend/src/templates/` directory:

```
templates/
├── index.ts                 # Template loader and metadata
├── blank/                   # Blank template
│   └── README.md
├── fastapi/                 # FastAPI template
│   ├── main.py
│   ├── routes/
│   └── ...
├── react/                   # React template
│   ├── src/
│   ├── package.json
│   └── ...
├── go/                      # Go template
├── rails/                   # Rails template
└── react-fastapi/           # Full-stack template
```

### 2. Build-Time Loading with Vite

The `templates/index.ts` file uses Vite's `import.meta.glob()` to load all template files at build time:

```typescript
// Load all files from all template directories
const templateFiles = import.meta.glob('./**/*', { 
  as: 'raw',      // Import as raw text
  eager: true     // Load at build time, not runtime
});
```

This means:
- ✅ All template files are bundled into the JavaScript at build time
- ✅ No runtime file system access needed
- ✅ Works in the browser
- ✅ Fast - no network requests for templates

### 3. Template Metadata

Each template is defined by metadata in `TEMPLATE_METADATA`:

```typescript
{
  id: 'rails',
  label: 'Ruby on Rails',
  description: 'Full-featured Rails 7.1 app with MVC architecture',
  directory: 'rails',
  defaultActiveFile: 'README.md',
}
```

### 4. Building Templates

The `buildTemplates()` function:
1. Iterates through each template's metadata
2. Finds all files matching that template's directory
3. Removes the directory prefix to get relative paths
4. Builds a `Record<string, string>` of file paths to contents
5. Returns a `ProjectTemplate` array

### 5. Usage in Components

**NewProjectModal.tsx:**
```typescript
import { TEMPLATES } from '../templates/index';

// TEMPLATES contains all template metadata + files
{TEMPLATES.map(t => (
  <button onClick={() => setTemplateId(t.id)}>
    {t.label}
  </button>
))}
```

**App.tsx:**
```typescript
import { getTemplateById } from './templates/index';

// When creating a new project
const template = getTemplateById(templateId);
setProjectStates(prev => ({
  ...prev,
  [projectId]: {
    files: template.files,  // All template files as Record<string, string>
    activeFile: template.defaultActiveFile,
    ...
  }
}));
```

## Benefits

### Before (Inline Strings)
- ❌ Hard to maintain - templates were long string literals
- ❌ No syntax highlighting for template code
- ❌ Hard to test individual template files
- ❌ Difficult to add new templates
- ❌ Mixed concerns - template content in TypeScript files

### After (File-Based)
- ✅ Easy to maintain - templates are real files
- ✅ Full syntax highlighting and linting
- ✅ Can test/run template files directly
- ✅ Easy to add new templates (just add a directory)
- ✅ Separation of concerns - templates vs. code

## Adding a New Template

1. Create a new directory: `templates/my-template/`
2. Add all template files in that directory
3. Update `TEMPLATE_METADATA` in `templates/index.ts`:

```typescript
{
  id: 'my-template',
  label: 'My Template',
  description: 'What it does',
  directory: 'my-template',
  defaultActiveFile: 'main.ts',
}
```

4. Done! The build system will automatically load all files

## Technical Details

### Vite Glob Import

Vite's `import.meta.glob()` is processed at build time and replaced with:

```javascript
// This:
const files = import.meta.glob('./**/*', { as: 'raw', eager: true });

// Becomes (at build time):
const files = {
  './blank/README.md': '# New Project\n...',
  './fastapi/main.py': 'from fastapi import FastAPI\n...',
  './react/package.json': '{\n  "name": "react-app"\n...',
  // ... all files
};
```

### Type Safety

The `ProjectTemplate` type ensures type safety:

```typescript
export type ProjectTemplate = {
  id: string;
  label: string;
  description: string;
  files: Record<string, string>;  // File path -> content
  defaultActiveFile: string;
};
```

## Build Verification

Build succeeds with all templates loaded:
```bash
npm run build
# ✓ built in 1.63s
# dist/assets/index-CjoTMIpX.js   609.71 kB │ gzip: 134.86 kB
```

## Templates Included

1. **Blank** (1 file) - Empty project
2. **FastAPI** (6 files) - Python API
3. **React** (8 files) - React + Vite
4. **Go** (2 files) - Go HTTP server
5. **Rails** (26 files) - Full Rails MVC app
6. **React + FastAPI** (13 files) - Full-stack

**Total:** 56 template files ready to use!

