import React from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Play, Square, ExternalLink } from 'lucide-react';
import type * as monaco from 'monaco-editor';

type DiffEditorRef = monaco.editor.IStandaloneDiffEditor | null;

interface EditorPaneProps {
  code: string;
  setCode: (next: string) => void;
  proposedContent: string | null;
  onAcceptProposal: (newContent: string) => void;
  onRejectProposal: () => void;
  fileName?: string;
  onRun?: () => void;
  onStop?: () => void;
  running?: boolean;
  previewUrl?: string | null;
  onOpenPreview?: () => void;
}

export const EditorPane: React.FC<EditorPaneProps> = ({
  code,
  setCode,
  proposedContent,
  onAcceptProposal,
  onRejectProposal,
  fileName = 'main.js',
  onRun,
  onStop,
  running = false,
  previewUrl = null,
  onOpenPreview,
}) => {
  const diffEditorRef = React.useRef<DiffEditorRef>(null);

  const language = React.useMemo(() => {
    const name = (fileName || '').toLowerCase();
    const getExt = () => {
      if (name.endsWith('.d.ts')) return 'ts';
      const idx = name.lastIndexOf('.');
      return idx >= 0 ? name.slice(idx + 1) : '';
    };
    const ext = getExt();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'json':
        return 'json';
      case 'css':
        return 'css';
      case 'html':
      case 'htm':
        return 'html';
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'py':
        return 'python';
      case 'go':
        return 'go';
      case 'rs':
        return 'rust';
      case 'java':
        return 'java';
      case 'rb':
        return 'ruby';
      case 'php':
        return 'php';
      case 'sh':
      case 'bash':
        return 'shell';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'toml':
        return 'toml';
      case 'c':
        return 'c';
      case 'cpp':
      case 'cc':
      case 'cxx':
      case 'hpp':
      case 'hh':
        return 'cpp';
      case 'cs':
        return 'csharp';
      case 'kt':
      case 'kts':
        return 'kotlin';
      case 'swift':
        return 'swift';
      case 'sql':
        return 'sql';
      case 'txt':
        return 'plaintext';
      default:
        return 'plaintext';
    }
  }, [fileName]);

  const showRunButton = React.useMemo(() => {
    return language === 'javascript' || language === 'typescript' || language === 'python';
  }, [language]);

  return (
    <div className="flex-1 flex flex-col" style={{ width: '100%' }}>
      <div className="px-3 flex items-center justify-between" style={{ backgroundColor: 'var(--vscode-panel)', borderBottom: '1px solid var(--vscode-panel-border)', height: 'var(--header-height)' }}>
        <div className="text-sm font-medium m-0" style={{ color: 'var(--vscode-text)' }}>{fileName}</div>
        {showRunButton && (
          <div className="flex items-center gap-2">
            {previewUrl && (
              <button
                onClick={() => { if (onOpenPreview) onOpenPreview(); }}
                title="Open Preview"
                className="px-2 py-1 rounded-sm cursor-pointer flex items-center gap-1 text-sm"
                style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)' }}
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open</span>
              </button>
            )}
            {running ? (
              <button
                onClick={() => { if (onStop) onStop(); }}
                title="Stop"
                className="px-2 py-1 rounded-sm cursor-pointer flex items-center gap-1 text-sm"
                style={{ background: 'var(--vscode-danger)', color: '#ffffff' }}
              >
                <Square className="w-4 h-4" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                onClick={() => { if (onRun) onRun(); }}
                title="Run"
                className="px-2 py-1 rounded-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1 text-sm"
                style={{ background: 'var(--vscode-success)', color: '#ffffff' }}
                disabled={!showRunButton}
              >
                <Play className="w-4 h-4" />
                <span>Run</span>
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {proposedContent === null ? (
          <Editor
            height="100%"
            defaultLanguage={language}
            language={language}
            value={code}
            onChange={(value) => setCode(value || '')}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              roundedSelection: false,
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        ) : (
          <DiffEditor
            keepCurrentOriginalModel={true}
            keepCurrentModifiedModel={true}
            height="100%"
            original={code}
            modified={proposedContent || code}
            language={language}
            theme="vs-dark"
            onMount={(editor) => {
              diffEditorRef.current = editor as unknown as monaco.editor.IStandaloneDiffEditor;
              const originalEditor = diffEditorRef.current?.getOriginalEditor?.();
              const modifiedEditor = diffEditorRef.current?.getModifiedEditor?.();
              originalEditor?.updateOptions?.({ fontSize: 14 });
              modifiedEditor?.updateOptions?.({ fontSize: 14 });
              modifiedEditor?.layout?.();
            }}
            options={{
              renderSideBySide: false,
              readOnly: false,
              originalEditable: false,
              renderMarginRevertIcon: true,
              lineNumbers: 'on',
              minimap: { enabled: false },
              automaticLayout: true,
            }}
          />
        )}

        {proposedContent !== null && (
          <div
            className="absolute flex items-center gap-2 rounded shadow-lg"
            style={{
              bottom: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: 'var(--vscode-panel)',
              border: '1px solid var(--vscode-panel-border)',
              padding: '6px 10px',
              zIndex: 10,
            }}
          >
            <button
              onClick={() => onRejectProposal()}
              className="px-2 py-1 rounded-sm cursor-pointer text-sm"
              style={{ background: 'var(--vscode-danger)', color: '#ffffff' }}
              title="Reject all proposed changes"
            >
              Reject all
            </button>
            <button
              onClick={() => {
                if (diffEditorRef.current) {
                  const updatedCode = diffEditorRef.current.getModifiedEditor().getValue();
                  onAcceptProposal(updatedCode);
                } else if (proposedContent !== null) {
                  onAcceptProposal(proposedContent);
                }
              }}
              className="px-2 py-1 rounded-sm cursor-pointer text-sm"
              style={{ background: 'var(--vscode-success)', color: '#ffffff' }}
              title="Accept all proposed changes"
            >
              Accept all
            </button>
          </div>
        )}
      </div>
    </div>
  );
};


