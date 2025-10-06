import React from 'react';
import Editor, { DiffEditor, useMonaco } from '@monaco-editor/react';
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
  onStatusChange?: (status: { line: number; column: number; language: string }) => void;
  // Triggered when user presses Cmd/Ctrl+K with a non-empty selection
  onRequestCodeFix?: (args: { fileName: string; startLine: number; endLine: number; selectedCode: string }) => void;
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
  onStatusChange,
  onRequestCodeFix,
}) => {
  const diffEditorRef = React.useRef<DiffEditorRef>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoInstance = useMonaco();

  // Create a Monaco theme that follows our CSS variables (Vercel dark)
  React.useEffect(() => {
    if (!monacoInstance) return;
    const defineTheme = (m: typeof monacoInstance) => {
      const css = getComputedStyle(document.documentElement);
      const val = (name: string, fallback: string) => (css.getPropertyValue(name).trim() || fallback);
      const bg = val('--vscode-bg', '#0a0a0a');
      const panel = val('--vscode-panel', '#0f0f0f');
      const border = val('--vscode-panel-border', '#1a1a1a');
      const text = val('--vscode-text', '#e6e6e6');
      const subtle = val('--vscode-subtle', '#8a8a8a');
      const selection = val('--vscode-selection', '#0b2a6b');
      const accent = val('--vscode-accent', '#0070f3');

      m.editor.defineTheme('vercel-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: '', foreground: text.replace('#','') },
        ],
        colors: {
          'editor.background': bg,
          'editor.foreground': text,
          'editorLineNumber.foreground': subtle,
          'editorLineNumber.activeForeground': text,
          'editorCursor.foreground': '#ffffff',
          'editor.selectionBackground': selection,
          'editor.inactiveSelectionBackground': selection + '80',
          'editor.lineHighlightBackground': '#ffffff08',
          'editorGutter.background': bg,
          'editorIndentGuide.background': '#222222',
          'editorIndentGuide.activeBackground': '#2a2a2a',
          'editorGroup.border': border,
          'editorWidget.background': panel,
          'editorWidget.border': border,
          'editorSuggestWidget.background': panel,
          'editorSuggestWidget.border': border,
          'editorSuggestWidget.foreground': text,
          'editorHoverWidget.background': panel,
          'editorHoverWidget.border': border,
          'editorBracketMatch.background': accent + '33',
          'editorBracketMatch.border': accent,
          'scrollbarSlider.background': '#262626',
          'scrollbarSlider.hoverBackground': '#2f2f2f',
          'scrollbarSlider.activeBackground': '#2f2f2f',
        },
      });
    };
    defineTheme(monacoInstance);
    monacoInstance.editor.setTheme('vercel-dark');
  }, [monacoInstance]);

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

  // Detect probable entrypoint types for nicer UX
  const entrypointKind = React.useMemo<
    | 'fastapi'
    | 'generic'
    | null
  >(() => {
    if (!fileName) return null;
    const name = fileName.toLowerCase();
    // Only consider runnable languages
    if (!showRunButton) return null;

    // FastAPI heuristic: common names and FastAPI imports or uvicorn run block
    if (name.endsWith('.py')) {
      const content = code || '';
      const likelyFastApi = /from\s+fastapi\s+import\s+fastapi|import\s+fastapi/i.test(content) || /uvicorn\.run\(/i.test(content) || /fastapi\s*\(/i.test(content);
      const commonEntrypointName = /(^|\/)main\.py$|(^|\/)app\.py$|(^|\/)server\.py$/i.test(name);
      if (likelyFastApi || commonEntrypointName) return 'fastapi';
      return 'generic';
    }

    // JS/TS entrypoints (generic)
    if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.ts') || name.endsWith('.tsx')) {
      return 'generic';
    }

    return null;
  }, [fileName, code, showRunButton]);

  // Notify status when language changes
  React.useEffect(() => {
    const editor = editorRef.current;
    const pos = editor?.getPosition();
    if (onStatusChange) {
      onStatusChange({ line: pos?.lineNumber || 1, column: pos?.column || 1, language });
    }
  }, [language, onStatusChange]);

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
                className={`px-2 py-1 rounded-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1 text-sm ${entrypointKind === 'fastapi' ? 'shimmer' : ''}`}
                style={
                  entrypointKind === 'fastapi'
                    ? { background: 'var(--vscode-accent)', color: '#ffffff' }
                    : { background: 'transparent', color: 'var(--vscode-accent)', border: '1px solid var(--vscode-accent)' }
                }
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
            theme="vercel-dark"
            beforeMount={(m) => {
              // Ensure theme exists before mounting to avoid white theme flashes
              const css = getComputedStyle(document.documentElement);
              const val = (name: string, fallback: string) => (css.getPropertyValue(name).trim() || fallback);
              const bg = val('--vscode-bg', '#0a0a0a');
              const panel = val('--vscode-panel', '#0f0f0f');
              const border = val('--vscode-panel-border', '#1a1a1a');
              const text = val('--vscode-text', '#e6e6e6');
              const subtle = val('--vscode-subtle', '#8a8a8a');
              const selection = val('--vscode-selection', '#0b2a6b');
              const accent = val('--vscode-accent', '#0070f3');
              m.editor.defineTheme('vercel-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [ { token: '', foreground: text.replace('#','') } ],
                colors: {
                  'editor.background': bg,
                  'editor.foreground': text,
                  'editorLineNumber.foreground': subtle,
                  'editorLineNumber.activeForeground': text,
                  'editorCursor.foreground': '#ffffff',
                  'editor.selectionBackground': selection,
                  'editor.inactiveSelectionBackground': selection + '80',
                  'editor.lineHighlightBackground': '#ffffff08',
                  'editorGutter.background': bg,
                  'editorIndentGuide.background': '#222222',
                  'editorIndentGuide.activeBackground': '#2a2a2a',
                  'editorGroup.border': border,
                  'editorWidget.background': panel,
                  'editorWidget.border': border,
                  'editorSuggestWidget.background': panel,
                  'editorSuggestWidget.border': border,
                  'editorSuggestWidget.foreground': text,
                  'editorHoverWidget.background': panel,
                  'editorHoverWidget.border': border,
                  'editorBracketMatch.background': accent + '33',
                  'editorBracketMatch.border': accent,
                  'scrollbarSlider.background': '#262626',
                  'scrollbarSlider.hoverBackground': '#2f2f2f',
                  'scrollbarSlider.activeBackground': '#2f2f2f',
                },
              });
            }}
            onMount={(editorInstance) => {
              editorRef.current = editorInstance as unknown as monaco.editor.IStandaloneCodeEditor;
              const update = () => {
                const pos = editorInstance.getPosition();
                if (pos && onStatusChange) onStatusChange({ line: pos.lineNumber, column: pos.column, language });
              };
              update();
              editorInstance.onDidChangeCursorPosition(update);
              editorInstance.onDidFocusEditorText(update);
              // Register Cmd/Ctrl+K to open Code Fix modal for current selection
              try {
                const ed = editorInstance as unknown as monaco.editor.IStandaloneCodeEditor;
                const keybinding = monacoInstance ? [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyK] : undefined;
                ed.addAction({
                  id: 'codefix.open',
                  label: 'Fix selected code (AI)',
                  keybindings: keybinding as number[] | undefined,
                  precondition: 'textInputFocus',
                  run: (codeEditor: monaco.editor.ICodeEditor) => {
                    const model = codeEditor.getModel();
                    const sel = codeEditor.getSelection();
                    if (!model || !sel) return;
                    const text = model.getValueInRange(sel);
                    if (!text || !String(text).trim()) return;
                    const startLine = sel.startLineNumber;
                    const endLine = sel.endLineNumber;
                    onRequestCodeFix?.({ fileName, startLine, endLine, selectedCode: String(text) });
                  },
                });
              } catch {
                // noop
              }
            }}
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
            theme="vercel-dark"
            beforeMount={(m) => {
              const css = getComputedStyle(document.documentElement);
              const val = (name: string, fallback: string) => (css.getPropertyValue(name).trim() || fallback);
              const bg = val('--vscode-bg', '#0a0a0a');
              const panel = val('--vscode-panel', '#0f0f0f');
              const border = val('--vscode-panel-border', '#1a1a1a');
              const text = val('--vscode-text', '#e6e6e6');
              const subtle = val('--vscode-subtle', '#8a8a8a');
              const selection = val('--vscode-selection', '#0b2a6b');
              const accent = val('--vscode-accent', '#0070f3');
              m.editor.defineTheme('vercel-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [ { token: '', foreground: text.replace('#','') } ],
                colors: {
                  'editor.background': bg,
                  'editor.foreground': text,
                  'editorLineNumber.foreground': subtle,
                  'editorLineNumber.activeForeground': text,
                  'editorCursor.foreground': '#ffffff',
                  'editor.selectionBackground': selection,
                  'editor.inactiveSelectionBackground': selection + '80',
                  'editor.lineHighlightBackground': '#ffffff08',
                  'editorGutter.background': bg,
                  'editorIndentGuide.background': '#222222',
                  'editorIndentGuide.activeBackground': '#2a2a2a',
                  'editorGroup.border': border,
                  'editorWidget.background': panel,
                  'editorWidget.border': border,
                  'editorSuggestWidget.background': panel,
                  'editorSuggestWidget.border': border,
                  'editorSuggestWidget.foreground': text,
                  'editorHoverWidget.background': panel,
                  'editorHoverWidget.border': border,
                  'editorBracketMatch.background': accent + '33',
                  'editorBracketMatch.border': accent,
                  'scrollbarSlider.background': '#262626',
                  'scrollbarSlider.hoverBackground': '#2f2f2f',
                  'scrollbarSlider.activeBackground': '#2f2f2f',
                },
              });
            }}
            onMount={(editor) => {
              diffEditorRef.current = editor as unknown as monaco.editor.IStandaloneDiffEditor;
              const originalEditor = diffEditorRef.current?.getOriginalEditor?.();
              const modifiedEditor = diffEditorRef.current?.getModifiedEditor?.();
              originalEditor?.updateOptions?.({ fontSize: 14 });
              modifiedEditor?.updateOptions?.({ fontSize: 14 });
              modifiedEditor?.layout?.();
              if (modifiedEditor) {
                const update = () => {
                  const pos = modifiedEditor.getPosition();
                  if (pos && onStatusChange) onStatusChange({ line: pos.lineNumber, column: pos.column, language });
                };
                update();
                modifiedEditor.onDidChangeCursorPosition(update);
                modifiedEditor.onDidFocusEditorText(update);
              }
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


