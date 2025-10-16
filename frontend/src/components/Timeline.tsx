import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageSquare, Loader, Box, ExternalLink, Settings, RefreshCcw } from 'lucide-react';
import { SiPython, SiNodedotjs, SiGo, SiRuby } from 'react-icons/si';
import type { Action, ExecResultAction } from '../types/run';

interface TimelineProps {
  actions: Action[];
  isEmpty: boolean;
  loading: boolean;
  onOpenFile?: (path: string) => void;
  refreshToken?: number;
}

export const Timeline: React.FC<TimelineProps> = ({ actions, isEmpty, loading, onOpenFile, refreshToken }) => {
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
                      <p className="text-sm whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{action.content}</p>
                    </div>
                  </div>
                );
              case 'system_notice':
                return (
                <div key={key} className="mr-4">
                  <div className="px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--vscode-surface)', color: 'var(--vscode-text)' }}>
                      <div className="text-sm prose prose-invert max-w-none break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{action.message || ''}</ReactMarkdown>
                      </div>
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
                  url?: string;
                  exit_code?: number;
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
                // Suppress generic completion line for 'think' tool; the actual thought is rendered via 'assistant_thought'
                if (action.toolName === 'think') {
                  return null;
                }
                if (action.toolName === 'sandbox_create') {
                  const info = (res as unknown as { runtime?: string; sandbox_id?: string; synthetic_runtime?: boolean; effective_runtime?: string }) || {};
                  const runtime = info?.runtime || (action as unknown as { arguments?: { runtime?: string } }).arguments?.runtime || 'auto';
                  return (
                    <div key={key} className="flex items-center gap-2 text-xs ml-4" style={{ color: 'var(--vscode-subtle)' }}>
                      <Box className="w-3 h-3" />
                      <span>Acquired sandbox</span>
                      <RuntimePill runtime={runtime} />
                    </div>
                  );
                }
                if (action.toolName === 'sandbox_show_preview' && res?.url) {
                  const origin = (() => { try { return new URL(res.url).host; } catch { return res.url; } })();
                  const previewLabel = (res as unknown as { label?: string; name?: string })?.label || (res as unknown as { label?: string; name?: string })?.name;
                  return (
                    <PreviewCard key={key} url={res.url} origin={origin} contextLabel={previewLabel} refreshToken={refreshToken} />
                  );
                }
                if (action.toolName === 'sandbox_run') {
                  const args = (action as unknown as { arguments?: { command?: string; cwd?: string; name?: string } }).arguments;
                  const status: 'running' | 'done' | 'failed' = typeof res?.exit_code === 'number' ? (res.exit_code === 0 ? 'done' : 'failed') : 'done';
                  return (
                    <div key={key} className="mr-4">
                      <MiniTerminal command={args?.command || ''} cwd={args?.cwd} status={status} output={((action as unknown as { logs?: string }).logs || '')} sandboxName={args?.name} />
                    </div>
                  );
                }
                if (action.toolName === 'edit_code' && res?.file_path && res.find_start_line && res.find_end_line) {
                  return (
                    <div key={key} className="text-xs text-purple-400">
                      <button
                        type="button"
                        onClick={() => onOpenFile?.(((res.file_path as unknown) as string).replace(/^\//,''))}
                        className="text-gray-300 underline-offset-2 hover:underline"
                        style={{ cursor: 'pointer' }}
                        title="Open file"
                      >
                        {res.file_path}
                      </button>{' '}
                      {res.find_start_line === res.find_end_line
                        ? `edited line ${res.find_start_line}`
                        : `edited lines ${res.find_start_line}-${res.find_end_line}`}
                    </div>
                  );
                }
                if (action.toolName === 'create_file' && res?.file_path) {
                  return (
                    <div key={key} className="text-xs text-green-400">
                      created{' '}
                      <button
                        type="button"
                        onClick={() => onOpenFile?.(((res.file_path as unknown) as string).replace(/^\//,''))}
                        className="text-gray-300 underline-offset-2 hover:underline"
                        style={{ cursor: 'pointer' }}
                        title="Open file"
                      >
                        {res.file_path}
                      </button>
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
              if (action.toolName === 'sandbox_set_env') {
                const info = (res as unknown as { env_keys?: string[]; name?: string }) || {};
                const keys = Array.isArray(info.env_keys) ? info.env_keys : [];
                const shown = keys.slice(0, 3).join(', ');
                const more = keys.length > 3 ? ` +${keys.length - 3} more` : '';
                return (
                  <div key={key} className="flex items-center gap-2 text-xs ml-4" style={{ color: 'var(--vscode-subtle)' }}>
                    <Settings className="w-3 h-3" />
                    <span>Set env for</span>
                    <span className="text-gray-300">{info.name || 'sandbox'}</span>
                    {keys.length > 0 ? (
                      <span>({shown}{more})</span>
                    ) : null}
                  </div>
                );
              }
                if (typeof res?.new_code !== 'undefined' || typeof res?.new_file_content !== 'undefined') return null;
                return (
                  <div key={key} className="text-xs" style={{ color: 'var(--vscode-subtle)' }}>Tool {action.toolName} completed</div>
                );
              }
              case 'tool_started':
                if ((action as unknown as { toolName?: string }).toolName === 'sandbox_run') {
                  const args = (action as unknown as { arguments?: { command?: string; cwd?: string; name?: string } }).arguments;
                  return (
                    <div key={key} className="mr-4">
                      <MiniTerminal command={args?.command || ''} cwd={args?.cwd} status="running" output={((action as unknown as { logs?: string }).logs || '')} sandboxName={args?.name} />
                    </div>
                  );
                }
                if ((action as unknown as { toolName?: string }).toolName === 'sandbox_create') {
                  const args = (action as unknown as { arguments?: { runtime?: string } }).arguments;
                  const runtime = args?.runtime || 'auto';
                  return (
                    <div key={key} className="flex items-center gap-2 text-xs ml-4" style={{ color: 'var(--vscode-subtle)' }}>
                      <Loader className="w-3 h-3 animate-spin" />
                      <span>Creating</span>
                      <RuntimePill runtime={runtime} />
                      <span>sandbox</span>
                    </div>
                  );
                }
                // Suppress generic running line for 'think' tool; we'll show only the thought content
                if ((action as unknown as { toolName?: string }).toolName === 'think') {
                  return null;
                }
                return (<div key={key} className="text-xs" style={{ color: 'var(--vscode-subtle)' }}>Running {action.toolName}...</div>);
              case 'assistant_thought':
                return (
                <div key={key} className="mr-4 px-2 text-xs" style={{ color: 'var(--vscode-muted)', fontStyle: 'italic', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                    {action.content || ''}
                  </div>
                );
              case 'final_answer': {
                const content = action.content || '';
                return (
                <div key={key} className="mr-4">
                  <div className="px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--vscode-surface)', color: 'var(--vscode-text)' }}>
                      <div
                        className="text-sm prose prose-invert max-w-none break-words"
                        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                );
              }
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


const getRuntimeIcon = (runtime: string) => {
  const lower = (runtime || '').toLowerCase();
  if (lower.startsWith('node')) return SiNodedotjs;
  if (lower.startsWith('python')) return SiPython;
  if (lower.startsWith('go')) return SiGo;
  if (lower.startsWith('ruby')) return SiRuby;
  return Box;
};

const RuntimePill: React.FC<{ runtime: string }> = ({ runtime }) => {
  const lower = (runtime || '').toLowerCase();
  const Icon = getRuntimeIcon(runtime);
  const label = lower || 'auto';
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm" style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)', border: '1px solid var(--vscode-panel-border)' }}>
      <Icon className="w-3 h-3" />
      <span>{label}</span>
    </span>
  );
};

const PreviewCard: React.FC<{ url: string; origin: string; contextLabel?: string; refreshToken?: number }> = ({ url, origin, contextLabel, refreshToken }) => {
  const [collapsed, setCollapsed] = React.useState(false);
  const [reloadCount, setReloadCount] = React.useState(0);
  const [timedOut, setTimedOut] = React.useState(false);

  // Ping the preview endpoint to detect sandbox timeouts (410)
  React.useEffect(() => {
    let aborted = false;
    const doProbe = async () => {
      try {
        // Prefer probing a health/ping endpoint when we can infer it
        let target = url;
        try {
          const u = new URL(url);
          target = `${u.origin}/ping`;
        } catch {
          // ignore URL parse errors and use raw url
        }
        const resp = await fetch(`/api/play/probe?url=${encodeURIComponent(target)}`);
        if (!aborted && resp.ok) {
          const data = await resp.json();
          const status = (data?.status as number | undefined) ?? null;
          if (status === 410) {
            setTimedOut(true);
            setCollapsed(true);
          }
        }
      } catch {
        // ignore network errors; keep current UI
      }
    };
    doProbe();
    return () => { aborted = true; };
  }, [url, refreshToken]);

  React.useEffect(() => {
    if (typeof refreshToken !== 'undefined') {
      setReloadCount(c => c + 1);
    }
  }, [refreshToken]);
  return (
    <div className="text-xs">
      <div className="mb-1" style={{ color: 'var(--vscode-subtle)' }}>Preview</div>
      <div style={{ border: '1px solid var(--vscode-panel-border)', borderRadius: 6, overflow: 'hidden', backgroundColor: 'var(--vscode-panel)' }}>
        <div className="flex items-center justify-between px-2 py-1" style={{ background: 'var(--vscode-surface)', borderBottom: '1px solid var(--vscode-panel-border)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 9999, background: '#ff5f57' }} />
            <button onClick={() => setCollapsed(v => !v)} title="Minimize" style={{ width: 10, height: 10, borderRadius: 9999, background: '#ffbd2e', border: 0, padding: 0 }} />
            <a href={url} title="Open in new tab" target="_blank" rel="noreferrer" style={{ width: 10, height: 10, borderRadius: 9999, background: '#28c840', display: 'inline-block' }} />
            <div className="ml-2 flex items-center gap-2 min-w-0" style={{ color: 'var(--vscode-text)' }}>
              <button
                type="button"
                onClick={() => setReloadCount(c => c + 1)}
                className="p-1 rounded hover:bg-opacity-10 hover:bg-white transition-colors"
                title="Refresh preview"
                aria-label="Refresh preview"
                style={{ color: 'var(--vscode-accent)' }}
              >
                <RefreshCcw className="w-3.5 h-3.5" />
              </button>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ maxWidth: 200 }}>{origin}</span>
              {contextLabel ? (
                <span className="px-1 py-0.5 rounded-sm" style={{ border: '1px solid var(--vscode-panel-border)', color: 'var(--vscode-subtle)', whiteSpace: 'nowrap' }}>{contextLabel}</span>
              ) : null}
              {timedOut ? (
                <span className="px-1 py-0.5 rounded-sm" style={{ border: '1px solid var(--vscode-panel-border)', color: 'var(--vscode-subtle)', whiteSpace: 'nowrap' }}>Sandbox timed out</span>
              ) : null}
            </div>
          </div>
          <a href={url} target="_blank" rel="noreferrer" className="p-1 rounded hover:bg-opacity-10 hover:bg-white transition-colors" style={{ color: 'var(--vscode-accent)' }} title="Open in new tab">
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
        {!collapsed && !timedOut && (
          <iframe key={`iframe-${reloadCount}`} src={url} title="Preview" style={{ width: '100%', height: 220, border: 'none', background: '#ffffff', colorScheme: 'light' }} />
        )}
        {(!collapsed && timedOut) && (
          <div className="p-3 text-xs" style={{ color: 'var(--vscode-subtle)', background: 'var(--vscode-panel)' }}>
            Sandbox timed out
          </div>
        )}
      </div>
    </div>
  );
};


const MiniTerminal: React.FC<{
  command: string;
  cwd?: string;
  status: 'running' | 'done' | 'failed';
  output?: string;
  sandboxName?: string;
}> = ({ command, cwd, status, output, sandboxName }) => {
  const [open, setOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLPreElement | null>(null);
  const tailText = React.useMemo(() => {
    const lines = (output || '').split('\n');
    return lines.slice(Math.max(0, lines.length - 2)).join('\n');
  }, [output]);

  React.useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, output]);

  const lineHeightPx = 16; // keep in sync with pre style

  return (
    <div className="text-xs" style={{ border: '1px solid var(--vscode-panel-border)', borderRadius: 6, overflow: 'hidden', background: 'var(--vscode-panel)' }}>
      <div className="flex items-center justify-between px-2 py-1" style={{ background: 'var(--vscode-surface)', borderBottom: '1px solid var(--vscode-panel-border)' }}>
        <div className="flex items-center gap-2">
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 9999, background: status === 'failed' ? '#ff5f57' : status === 'done' ? '#28c840' : '#ffbd2e' }} />
          <span style={{ color: 'var(--vscode-subtle)' }}>{cwd ? `${cwd} $` : '$'}</span>
          {sandboxName ? (
            <span className="ml-2 px-1 py-0.5 rounded-sm" style={{ border: '1px solid var(--vscode-panel-border)', color: 'var(--vscode-subtle)' }}>{sandboxName}</span>
          ) : null}
        </div>
        <button onClick={() => setOpen(v => !v)} className="px-2 py-0.5 rounded-sm" style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)', border: '1px solid var(--vscode-panel-border)' }}>
          {open ? 'Hide output' : 'Show output'}
        </button>
      </div>
      <pre className="m-0 p-2 font-mono whitespace-pre-wrap" style={{ color: 'var(--vscode-text)' }}>
        <code>{command}</code>
      </pre>
      {!open && Boolean(tailText) && (
        // Show the two-line live tail only while the command is running
        status === 'running' ? (
        <div style={{ borderTop: '1px dashed var(--vscode-panel-border)', position: 'relative' }} aria-live="polite">
          <div style={{ height: `${2 * lineHeightPx + 4}px`, overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
            <pre
              className="m-0 px-2 font-mono text-xs whitespace-pre-wrap"
              style={{
                color: 'var(--vscode-subtle)',
                lineHeight: `${lineHeightPx}px`,
                paddingTop: 2,
                paddingBottom: 2,
              }}
            >
              <code>{tailText}</code>
            </pre>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                height: 14,
                background: 'linear-gradient(180deg, var(--vscode-panel) 0%, rgba(0,0,0,0) 85%)',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
        ) : null
      )}
      {open && (
        <div style={{ borderTop: '1px dashed var(--vscode-panel-border)' }}>
          <pre ref={scrollRef} className="m-0 p-2 font-mono text-xs whitespace-pre-wrap" style={{ color: 'var(--vscode-subtle)', maxHeight: 240, overflow: 'auto' }}>
            <code>{output || ''}</code>
          </pre>
        </div>
      )}
    </div>
  );
};
