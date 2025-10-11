# Project Templates

This directory contains project templates organized as actual file structures that can be copied when creating new projects.

## Structure

Each template is organized in its own directory:

```
templates/
├── index.ts                 # Template metadata and helpers
├── blank/                   # Minimal blank template
│   └── README.md
├── fastapi/                 # FastAPI Python backend
│   ├── main.py
│   ├── routes/
│   ├── requirements.txt
│   └── README.md
├── react/                   # React + Vite frontend
│   ├── src/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── README.md
├── go/                      # Go HTTP server
│   ├── main.go
│   └── README.md
├── rails/                   # Ruby on Rails MVC app
│   ├── app/
│   ├── config/
│   ├── db/
│   ├── bin/
│   ├── Gemfile
│   └── README.md
└── react-fastapi/           # Full-stack template
    ├── frontend/
    ├── backend/
    └── README.md
```

## Available Templates

### Blank
- **ID**: `blank`
- **Description**: Empty project with just a README
- **Files**: 1 file
- **Use case**: Starting from scratch

### FastAPI
- **ID**: `fastapi`
- **Description**: Python API with FastAPI + Uvicorn
- **Files**: 6 files
- **Use case**: Python REST API development
- **Includes**: Routes for items & users, Pydantic models

### React (Vite)
- **ID**: `react`
- **Description**: React SPA powered by Vite
- **Files**: 8 files
- **Use case**: Modern React frontend development
- **Includes**: TypeScript, HMR, optimized build

### Go API
- **ID**: `go`
- **Description**: Minimal Go HTTP server
- **Files**: 2 files
- **Use case**: Lightweight Go backend

### Ruby on Rails
- **ID**: `rails`
- **Description**: Full-featured Rails 7.1 app with MVC architecture
- **Files**: 26 files
- **Use case**: Ruby web application development
- **Includes**: Controllers, views, routes, database config, beautiful UI

### React + FastAPI
- **ID**: `react_fastapi`
- **Description**: Decoupled frontend (React) and backend (FastAPI)
- **Files**: 14 files
- **Use case**: Full-stack web application
- **Includes**: Separate frontend and backend directories

## Usage

### In Code

```typescript
import { TEMPLATE_METADATA, getTemplateById } from './templates';

// Get all templates
const allTemplates = TEMPLATE_METADATA;

// Get specific template
const railsTemplate = getTemplateById('rails');
console.log(railsTemplate?.directory); // 'rails'
console.log(railsTemplate?.defaultActiveFile); // 'README.md'
```

### Creating a New Project

To create a new project from a template:

1. Identify the template directory (e.g., `rails`)
2. Recursively copy all files from that directory
3. Open the `defaultActiveFile` in the editor
4. Run any necessary setup commands

## Adding New Templates

To add a new template:

1. Create a new directory under `templates/`
2. Add all template files in that directory
3. Update `index.ts` with the new template metadata:

```typescript
{
  id: 'my-template',
  label: 'My Template',
  description: 'Description of what it does',
  directory: 'my-template',
  defaultActiveFile: 'main.ts',
}
```

## File Organization Best Practices

- Use realistic file structures that match production apps
- Include configuration files (package.json, requirements.txt, etc.)
- Add README files with setup instructions
- Use modern, maintained dependencies
- Include .gitignore files where appropriate
- Keep templates minimal but functional

