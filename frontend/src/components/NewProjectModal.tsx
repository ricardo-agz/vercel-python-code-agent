import React from 'react';
import { TEMPLATES } from '../templates/index';

type NewProjectModalProps = {
  visible: boolean;
  defaultName: string;
  existingNames: string[];
  onClose: () => void;
  onCreate: (name: string, templateId: string) => void;
};

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ visible, defaultName, existingNames, onClose, onCreate }) => {
  const [name, setName] = React.useState<string>('');
  const [templateId, setTemplateId] = React.useState<string>('fastapi');
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (visible) {
      // Start with an empty value so the input shows only the placeholder suggestion
      setName('');
      setTemplateId('fastapi');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible, defaultName]);

  const placeholderName = React.useMemo(() => {
    const tmpl = TEMPLATES.find(t => t.id === templateId);
    const base = (tmpl?.label || defaultName || 'Project').trim();
    const existing = new Set((existingNames || []).map(s => (s || '').trim().toLowerCase()))
    if (!existing.has(base.toLowerCase())) return base;
    // Find the next available suffix: base 2, base 3, ...
    // Stop at a reasonable upper bound to avoid infinite loops in pathological cases
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${base} ${i}`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    // Fallback if all else fails
    return `${base} ${Date.now()}`;
  }, [templateId, existingNames, defaultName]);

  if (!visible) return null;

  const handleSubmit = () => {
    const trimmed = (name || '').trim();
    const finalName = trimmed || placeholderName;
    if (!finalName) return;
    onCreate(finalName, templateId);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 200000 }}>
      <div className="absolute inset-0" onClick={onClose} style={{ background: 'rgba(0,0,0,0.5)' }} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded shadow-lg overflow-hidden"
        style={{ background: 'var(--vscode-panel)', border: '1px solid var(--vscode-panel-border)' }}
      >
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}>
          <div className="text-sm font-medium" style={{ color: 'var(--vscode-text)' }}>
            Create new project
          </div>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <label className="text-xs" htmlFor="new-project-name" style={{ color: 'var(--vscode-muted)' }}>Project name</label>
          <input
            id="new-project-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder={placeholderName || 'My Project'}
            className="w-full rounded-sm px-3 py-2"
            style={{ background: 'var(--vscode-contrast)', border: '1px solid var(--vscode-panel-border)', color: 'var(--vscode-text)' }}
          />
          <div className="mt-2">
            <label className="text-xs" htmlFor="new-project-template" style={{ color: 'var(--vscode-muted)' }}>Template</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                  className={`text-left p-2 rounded-sm border cursor-pointer ${templateId === t.id ? 'ring-1' : ''}`}
                  style={{
                    background: templateId === t.id ? 'var(--vscode-surface)' : 'var(--vscode-contrast)',
                    borderColor: 'var(--vscode-panel-border)',
                    color: 'var(--vscode-text)'
                  }}
                >
                  <div className="text-sm font-medium">{t.label}</div>
                  {t.description ? (
                    <div className="text-xs" style={{ color: 'var(--vscode-muted)' }}>{t.description}</div>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--vscode-panel-border)' }}>
            <button
              onClick={onClose}
              className="px-3 py-1 rounded-sm cursor-pointer"
              style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-3 py-1 rounded-sm disabled:opacity-50 cursor-pointer"
              style={{ background: 'var(--vscode-accent)', color: '#ffffff' }}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewProjectModal;


