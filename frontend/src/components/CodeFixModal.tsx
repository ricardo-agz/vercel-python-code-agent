import React from 'react';
import { API_BASE } from '../constants';
import { Loader } from 'lucide-react';

type CodeFixModalProps = {
  visible: boolean;
  fileName: string;
  startLine: number;
  endLine: number;
  selectedCode: string;
  onClose: () => void;
  onSubmit: (instruction: string, modelOverride?: string) => void;
  currentModel: string;
  loading?: boolean;
};

export const CodeFixModal: React.FC<CodeFixModalProps> = ({
  visible,
  fileName,
  startLine,
  endLine,
  onClose,
  onSubmit,
  currentModel,
  loading = false,
}) => {
  const [instruction, setInstruction] = React.useState<string>('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [models, setModels] = React.useState<string[]>([]);
  const [modelOpen, setModelOpen] = React.useState<boolean>(false);
  const [selectedModel, setSelectedModel] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (!visible) return;
    setInstruction('');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && !loading) {
        const val = inputRef.current?.value?.trim() || '';
        if (val) {
          e.preventDefault();
          onSubmit(val, selectedModel);
        }
      }
    };
    requestAnimationFrame(() => inputRef.current?.focus());
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible, onClose, onSubmit, loading, selectedModel]);

  // Load models once when visible
  React.useEffect(() => {
    if (!visible) return;
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/models`, { credentials: 'include' });
        const data = await res.json();
        if (mounted && Array.isArray(data.models)) setModels(data.models);
      } catch {
        if (mounted) setModels([]);
      }
    })();
    return () => { mounted = false; };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed left-1/2" style={{ top: '56px', transform: 'translateX(-50%)', zIndex: 200000 }}>
      <div
        className="flex items-center gap-3 rounded shadow-lg"
        style={{
          background: 'var(--vscode-panel)',
          border: '1px solid var(--vscode-panel-border)',
          width: 'min(720px, 92vw)',
          padding: '10px 12px',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Edit selected code"
          className="flex-1"
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--vscode-text)',
            fontSize: '14px',
          }}
          disabled={loading}
        />
        <div className="relative">
          <button
            type="button"
            onClick={() => !loading && setModelOpen((v) => !v)}
            className="text-xs rounded-sm cursor-pointer"
            style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)', padding: '4px 8px', border: '1px solid var(--vscode-panel-border)' }}
            title="Choose model"
            disabled={loading}
          >
            {selectedModel || 'Auto'} ▾
          </button>
          {modelOpen && (
            <div
              className="absolute right-0 mt-1 rounded shadow-lg overflow-auto"
              style={{ background: 'var(--vscode-panel)', border: '1px solid var(--vscode-panel-border)', maxHeight: '240px', minWidth: '240px', zIndex: 10 }}
            >
              <button
                className="w-full text-left px-3 py-2 text-xs cursor-pointer"
                style={{ background: 'transparent', color: 'var(--vscode-text)' }}
                onClick={() => { setSelectedModel(undefined); setModelOpen(false); }}
              >
                Auto (use {currentModel})
              </button>
              {models.map((m) => (
                <button
                  key={m}
                  className="w-full text-left px-3 py-2 text-xs cursor-pointer"
                  style={{ background: 'transparent', color: 'var(--vscode-text)', borderTop: '1px solid var(--vscode-panel-border)' }}
                  onClick={() => { setSelectedModel(m); setModelOpen(false); }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => !loading && instruction.trim() && onSubmit(instruction.trim(), selectedModel)}
          disabled={!instruction.trim() || loading}
          className="text-xs rounded-sm disabled:opacity-50 cursor-pointer"
          style={{ background: 'var(--vscode-accent)', color: '#ffffff', padding: '6px 10px' }}
        >
          {loading ? 'Generating…' : 'Submit'}
        </button>
        <button
          onClick={onClose}
          className="rounded-sm cursor-pointer"
          title="Close"
          style={{ background: 'transparent', border: 'none', color: 'var(--vscode-subtle)', padding: '2px 6px' }}
        >
          ×
        </button>
      </div>
      <div className="mt-1 text-[11px] flex items-center gap-2" style={{ color: 'var(--vscode-muted)' }}>
        {loading && <Loader className="w-3 h-3 animate-spin" />}
        <span>
          {loading ? 'Generating…' : (fileName ? `${fileName}` : '')}{!loading && fileName ? ' — ' : ''}{!loading ? `Ln ${startLine}${endLine !== startLine ? `–${endLine}` : ''}` : ''}
        </span>
      </div>
    </div>
  );
};

export default CodeFixModal;
