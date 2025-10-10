import React from 'react';

type NewProjectModalProps = {
  visible: boolean;
  defaultName: string;
  onClose: () => void;
  onCreate: (name: string) => void;
};

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ visible, defaultName, onClose, onCreate }) => {
  const [name, setName] = React.useState<string>('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (visible) {
      setName(defaultName || '');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible, defaultName]);

  if (!visible) return null;

  const handleSubmit = () => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    onCreate(trimmed);
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
            placeholder="My Project"
            className="w-full rounded-sm px-3 py-2"
            style={{ background: 'var(--vscode-contrast)', border: '1px solid var(--vscode-panel-border)', color: 'var(--vscode-text)' }}
          />
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
              disabled={!name.trim()}
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


