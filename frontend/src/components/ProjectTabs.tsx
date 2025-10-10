import React from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';

export type ProjectTab = {
  id: string;
  name: string;
};

type ProjectTabsProps = {
  projects: ProjectTab[];
  activeProjectId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

const ProjectTabs: React.FC<ProjectTabsProps> = ({ projects, activeProjectId, onSelect, onAdd, onRename, onDelete }) => {
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState<string>('');
  const renameInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (renamingId) {
      requestAnimationFrame(() => renameInputRef.current?.focus());
    }
  }, [renamingId]);

  const commitRename = (id: string) => {
    const trimmed = (renameValue || '').trim();
    if (!trimmed) return;
    onRename(id, trimmed);
    setRenamingId(null);
    setRenameValue('');
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div
      className="hidden md:flex items-stretch justify-between select-none w-full"
      style={{
        height: 'var(--header-height)',
        backgroundColor: 'var(--vscode-panel)',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}
      role="tablist"
      aria-label="Projects"
    >
      <div className="flex-1 overflow-hidden">
        <div className="flex items-stretch h-full overflow-x-auto">
          {projects.map((p) => {
            const active = p.id === activeProjectId;
            return (
              <div
                key={p.id}
                className="flex h-full"
                style={{
                  borderRight: '1px solid var(--vscode-panel-border)',
                  boxShadow: active ? 'inset 0 -2px 0 var(--vscode-accent)' : 'none',
                }}
              >
                {renamingId === p.id ? (
                  <div className="px-3 h-full inline-flex items-center gap-2">
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(p.id);
                        if (e.key === 'Escape') cancelRename();
                      }}
                      className="text-sm px-2 py-1 rounded-sm"
                      style={{ background: 'var(--vscode-contrast)', border: '1px solid var(--vscode-panel-border)', color: 'var(--vscode-text)' }}
                      aria-label="Project name"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onSelect(p.id)}
                    className="px-3 h-full inline-flex items-center gap-2 text-sm"
                    title={p.name}
                    style={{
                      color: 'var(--vscode-text)',
                      background: 'transparent',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span className="truncate max-w-[16rem]">{p.name}</span>
                  </button>
                )}
                {active && (
                  <div className="flex items-center gap-1 px-2" aria-label="Project actions">
                    {renamingId === p.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => commitRename(p.id)}
                          disabled={!renameValue.trim()}
                          className="p-1 rounded hover:bg-white/5 disabled:opacity-50"
                          title="Save name"
                          aria-label="Save name"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          className="p-1 rounded hover:bg-white/5"
                          title="Cancel rename"
                          aria-label="Cancel rename"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }} className="p-1 rounded hover:bg-white/5" title="Rename project" aria-label="Rename project">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => onDelete(p.id)} className="p-1 rounded hover:bg-white/5" title="Delete project" aria-label="Delete project">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="pr-2 flex items-center h-full">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded"
          style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)', border: '1px solid var(--vscode-panel-border)' }}
          title="New project"
          aria-label="New project"
        >
          <Plus className="w-4 h-4" />
          <span>New</span>
        </button>
      </div>
    </div>
  );
};

export default ProjectTabs;


