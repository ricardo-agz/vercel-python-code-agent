import React from 'react';
import { MessageSquare, Loader } from 'lucide-react';
import type { Action, ExecResultAction } from '../types/run';

interface TimelineProps {
  actions: Action[];
  isEmpty: boolean;
  loading: boolean;
}

export const Timeline: React.FC<TimelineProps> = ({ actions, isEmpty, loading }) => {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  const isLongText = (text: string | undefined) => {
    if (!text) return false;
    const lines = text.split('\n');
    return lines.length > 18 || text.length > 4000;
  };
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {isEmpty ? (
        <div className="text-center py-24" style={{ color: 'var(--vscode-muted)' }}>
          <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">Ask me anything about your code!</p>
        </div>
      ) : (
        <>
          {actions.map((action, idx) => {
            const key = action.timestamp ? `${action.id}_${action.timestamp}` : `${action.id}_${idx}`;
            switch (action.kind) {
              case 'user_message':
                return (
                <div key={key} className="ml-4">
                  <div className="px-3 py-2 rounded-lg ml-auto" style={{ backgroundColor: 'var(--vscode-accent)', color: '#ffffff' }}>
                      <p className="text-sm whitespace-pre-wrap">{action.content}</p>
                    </div>
                  </div>
                );
              case 'system_notice':
                return (
                <div key={key} className="mr-4">
                  <div className="px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--vscode-surface)', color: 'var(--vscode-text)' }}>
                      <p className="text-sm whitespace-pre-wrap">{action.message || ''}</p>
                    </div>
                  </div>
                );
              case 'exec_result': {
                const execAction = action as ExecResultAction;
                const long = isLongText(execAction.output);
                const open = Boolean(expanded[action.id]);
                return (
                  <div key={key} className="mr-4">
                    <div className="relative rounded" style={{ background: 'var(--vscode-bg)', border: '1px solid var(--vscode-panel-border)' }}>
                      <pre
                        className="p-3 text-xs whitespace-pre-wrap font-mono"
                        style={{
                          color: 'var(--vscode-text)',
                          maxHeight: !open && long ? '200px' : undefined,
                          overflow: !open && long ? 'hidden' : 'auto',
                        }}
                      >
                        <code>{execAction.output || ''}</code>
                      </pre>
                      {!open && long && (
                        <div
                          className="absolute left-0 right-0"
                          style={{ bottom: '36px', height: '48px',
                            background: 'linear-gradient(180deg, rgba(15,15,15,0) 0%, rgba(15,15,15,1) 80%)' }}
                        />
                      )}
                      {long && (
                        <div className="flex items-center justify-end px-2 py-2">
                          <button
                            onClick={() => toggle(action.id)}
                            className="px-2 py-1 rounded-sm text-xs"
                            style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)' }}
                          >
                            {open ? 'Collapse' : 'Expand'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              case 'tool_completed': {
                const res = action.result as {
                  file_path?: string;
                  find_start_line?: number;
                  find_end_line?: number;
                  new_code?: string;
                  new_file_content?: string;
                  created?: boolean;
                  old_path?: string;
                  new_path?: string;
                  folder_path?: string;
                  deleted?: boolean;
                  removed_files?: number;
                  moved_files?: number;
                } | undefined;
                if (action.toolName === 'edit_code' && res?.file_path && res.find_start_line && res.find_end_line) {
                  return (
                    <div key={key} className="text-xs text-purple-400">
                      <span className="text-gray-300">{res.file_path}</span>{' '}
                      {res.find_start_line === res.find_end_line
                        ? `edited line ${res.find_start_line}`
                        : `edited lines ${res.find_start_line}-${res.find_end_line}`}
                    </div>
                  );
                }
                if (action.toolName === 'create_file' && res?.file_path) {
                  return (
                    <div key={key} className="text-xs text-green-400">
                      created {res.file_path}
                    </div>
                  );
                }
                if (action.toolName === 'rename_file' && res?.old_path && res?.new_path) {
                  return (
                    <div key={key} className="text-xs text-blue-400">
                      renamed <span className="text-gray-300">{res.old_path}</span> → <span className="text-gray-300">{res.new_path}</span>
                    </div>
                  );
                }
                if (action.toolName === 'delete_file' && res?.file_path) {
                  return (
                    <div key={key} className="text-xs text-red-400">
                      deleted {res.file_path}
                    </div>
                  );
                }
                if (action.toolName === 'create_folder' && res?.folder_path) {
                  return (
                    <div key={key} className="text-xs text-green-400">
                      created folder {res.folder_path}
                    </div>
                  );
                }
                if (action.toolName === 'delete_folder' && res?.folder_path) {
                  return (
                    <div key={key} className="text-xs text-red-400">
                      deleted folder {res.folder_path}{typeof res.removed_files === 'number' ? ` (${res.removed_files} files)` : ''}
                    </div>
                  );
                }
                if (action.toolName === 'rename_folder' && res?.old_path && res?.new_path) {
                  return (
                    <div key={key} className="text-xs text-blue-400">
                      renamed folder <span className="text-gray-300">{res.old_path}</span> → <span className="text-gray-300">{res.new_path}</span>{typeof res.moved_files === 'number' ? ` (${res.moved_files} files)` : ''}
                    </div>
                  );
                }
                if (typeof res?.new_code !== 'undefined' || typeof res?.new_file_content !== 'undefined') return null;
                return (
                  <div key={key} className="text-xs" style={{ color: 'var(--vscode-subtle)' }}>Tool {action.toolName} completed</div>
                );
              }
              case 'tool_started':
                return (
                <div key={key} className="text-xs" style={{ color: 'var(--vscode-subtle)' }}>Running {action.toolName}...</div>
                );
              case 'assistant_thought':
                return (
                <div key={key} className="mr-4 px-2 text-xs" style={{ color: 'var(--vscode-muted)', fontStyle: 'italic' }}>
                    {action.content || ''}
                  </div>
                );
              case 'final_answer':
                return (
                <div key={key} className="mr-4">
                  <div className="px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--vscode-surface)', color: 'var(--vscode-text)' }}>
                      <p className="text-sm whitespace-pre-wrap">{action.content || ''}</p>
                    </div>
                  </div>
                );
              default:
                return null;
            }
          })}
          {loading && (
            <div className="flex items-center gap-1 text-xs text-gray-500 ml-4">
              <Loader className="w-3 h-3 animate-spin" />
              <span>Thinking...</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};


