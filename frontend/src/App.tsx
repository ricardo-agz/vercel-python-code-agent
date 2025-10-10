import React, { useState } from 'react';
import { useAgentStream } from './hooks/useAgentStream';
import { useAgentEvents } from './hooks/useAgentEvents';
import { useChat } from './hooks/useChat';
import type { Action } from './types/run';
import { useRuns } from './context/RunContext';
import { EditorPane } from './components/EditorPane';
import { Timeline } from './components/Timeline';
import { ExecRequestPrompt } from './components/ExecRequestPrompt';
import { ChatInput } from './components/ChatInput';
import { ModelPicker } from './components/ModelPicker';
import ThreePane from './components/ThreePane';
import { FileTree } from './components/FileTree';
import { TerminalPane } from './components/TerminalPane';
import { usePlay } from './hooks/usePlay';
import { AuthModal } from './components/AuthModal';
import { useAuth } from './context/AuthContext';
import StatusBar from './components/StatusBar';
import AccountMenu from './components/AccountMenu';
import { CodeFixModal } from './components/CodeFixModal';

type ResizableCenterProps = {
  code: string;
  setCode: (v: string) => void;
  proposals: Record<string, string>;
  clearProposal: (file: string) => void;
  activeFile: string;
  onRun: () => void;
  running: boolean;
  onStop: () => void;
  previewUrl?: string | null;
  onOpenPreview?: () => void;
  terminalLogs: string;
  onClearLogs: () => void;
  onRequestCodeFix?: (args: { fileName: string; startLine: number; endLine: number; selectedCode: string }) => void;
  isIgnored?: (path: string) => boolean;
};

const ResizableCenter: React.FC<ResizableCenterProps> = ({ code, setCode, proposals, clearProposal, activeFile, onRun, running, onStop, previewUrl, onOpenPreview, terminalLogs, onClearLogs, onRequestCodeFix, isIgnored }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [terminalHeight, setTerminalHeight] = React.useState<number>(200);
  const [resizing, setResizing] = React.useState<boolean>(false);
  const [status, setStatus] = React.useState<{ line: number; column: number; language: string }>({ line: 1, column: 1, language: 'plaintext' });

  const minTerminalHeight = 120;
  const minEditorHeight = 120;

  const onMouseDown = React.useCallback((e: React.MouseEvent) => {
    setResizing(true);
    e.preventDefault();
  }, []);

  const onMouseMove = React.useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const availableHeight = rect.height;
    const proposed = rect.bottom - e.clientY;
    const maxTerminal = Math.max(minTerminalHeight, availableHeight - minEditorHeight);
    const clamped = Math.min(Math.max(proposed, minTerminalHeight), maxTerminal);
    setTerminalHeight(clamped);
  }, []);

  const onMouseUp = React.useCallback(() => {
    setResizing(false);
  }, []);

  React.useEffect(() => {
    if (resizing) {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, onMouseMove, onMouseUp]);

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0 relative">
      <div className="flex-1 min-h-0 flex flex-col">
        <EditorPane
          code={code}
          setCode={(v) => setCode(v)}
          proposedContent={(isIgnored && isIgnored(activeFile)) ? null : (proposals[activeFile] ?? null)}
          onAcceptProposal={(newContent) => {
            setCode(newContent);
            clearProposal(activeFile);
          }}
          onRejectProposal={() => clearProposal(activeFile)}
          fileName={activeFile}
          onRun={onRun}
          onStop={onStop}
          running={running}
          previewUrl={previewUrl}
          onOpenPreview={onOpenPreview}
          onStatusChange={setStatus}
          onRequestCodeFix={onRequestCodeFix}
        />
      </div>
      {terminalLogs && terminalLogs.length > 0 ? (
        <>
          <div
            onMouseDown={onMouseDown}
            className={`h-1 cursor-row-resize transition-colors`}
            style={{ backgroundColor: resizing ? 'var(--vscode-accent)' : 'var(--vscode-panel-border)', position: 'relative', zIndex: 99999 }}
          />
          <TerminalPane height={terminalHeight} logs={terminalLogs} onClear={onClearLogs} />
        </>
      ) : null}
      <StatusBar line={status.line} column={status.column} language={status.language} />
      {resizing && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 99998, cursor: 'row-resize', background: 'transparent' }}
          onMouseDown={(e) => e.preventDefault()}
        />
      )}
    </div>
  );
};

const STARTER_PROJECT: Record<string, string> = {
  'main.py': `from fastapi import FastAPI
from routes import api_router

app = FastAPI(title="Demo API")

@app.get("/")
def root():
    return {"message": "Hello from FastAPI"}

app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
`,
  'routes/__init__.py': `from fastapi import APIRouter
from .items import router as items_router
from .users import router as users_router

api_router = APIRouter()
api_router.include_router(items_router, prefix="/items", tags=["items"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
`,
  'routes/items.py': `from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str
    price: float
    description: Optional[str] = None


router = APIRouter()

# Sample, read-only data suitable for stateless/serverless deployments
SAMPLE_ITEMS: List[Item] = [
    Item(id=1, name="Widget", price=9.99, description="A simple widget"),
    Item(id=2, name="Gadget", price=19.99, description="A useful gadget"),
    Item(id=3, name="Doohickey", price=4.50),
]


@router.get("/", response_model=List[Item])
def list_items(q: Optional[str] = Query(default=None)) -> List[Item]:
    items = SAMPLE_ITEMS
    if q:
        query = q.lower()
        return [i for i in items if query in i.name.lower()]
    return items


@router.get("/{item_id}", response_model=Item)
def get_item(item_id: int) -> Item:
    for item in SAMPLE_ITEMS:
        if item.id == item_id:
            return item
    raise HTTPException(status_code=404, detail="Item not found")
`,
  'routes/users.py': `from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel


class User(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None


router = APIRouter()

_users: List[User] = [
    User(id=1, username="alice", full_name="Alice Anderson"),
    User(id=2, username="bob", full_name="Bob Brown"),
]


@router.get("/me", response_model=User)
def read_me() -> User:
    return _users[0]


@router.get("/", response_model=List[User])
def list_users(limit: int = Query(default=50, ge=1, le=100)) -> List[User]:
    return _users[:limit]


@router.get("/{user_id}", response_model=User)
def get_user(user_id: int) -> User:
    for user in _users:
        if user.id == user_id:
            return user
    raise HTTPException(status_code=404, detail="User not found")
`,
  'requirements.txt': `fastapi==0.115.12
uvicorn[standard]==0.34.2
pydantic>=2
`,
  'README.md': `# Python in Vercel sandboxes in Python on Vercel (crazy)\n\nGo to 'main.py' and click the 'run' button at the top right.\n`,
};

// Generate a unique user ID for this session
const USER_ID = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Default patterns to hide from the diff view while still showing in the tree
const DEFAULT_DIFF_IGNORE_PATTERNS: string[] = [
  '__pycache__/',
  '*.pyc',
  '*.pyo',
  '*.pyd',
  '.DS_Store',
  'node_modules/',
  'vendor/',
  'Gemfile.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '*.log',
];

function App() {
  // Sandbox play hook for remote execution
  const play = usePlay();
  const { isAuthenticated, user, openModal } = useAuth();

  // Project: mapping of file path -> content
  const [project, setProject] = useState<Record<string, string>>(STARTER_PROJECT);
  const [activeFile, setActiveFile] = useState<string>('main.py');
  const [folders, setFolders] = useState<string[] | undefined>(undefined);
  const code = project[activeFile] ?? '';
  const setCode = (next: string) => setProject(prev => ({ ...prev, [activeFile]: next }));
  // Proposed changes per file from the agent
  const [proposals, setProposals] = useState<Record<string, string>>({});
  const upsertProposal = React.useCallback((filePath: string, newContent: string) => {
    setProposals(prev => ({ ...prev, [filePath]: newContent }));
  }, []);
  const clearProposal = React.useCallback((filePath: string) => {
    setProposals(prev => {
      const next = { ...prev };
      delete next[filePath];
      return next;
    });
  }, []);
  
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [model, setModel] = useState<string>('anthropic/claude-sonnet-4.5');
  // Sidebar resizing
  // Track if we're currently processing a code-execution decision
  const [executingCode, setExecutingCode] = useState(false);
  // Track which execution action is currently being processed so we can show a loader
  const [executionAction, setExecutionAction] = useState<'accept' | 'reject' | null>(null);

  // Track a pending exec approval that should resume the agent after sandbox completes
  const [pendingExecResume, setPendingExecResume] = useState<{
    runId: string;
    actionId: string;
    resumeToken: string;
  } | null>(null);

  // Deprecated with ThreePane; retained conceptually for potential future use

  // Runs context
  const { runs, runOrder, updateAction } = useRuns();
  // Code-fix modal state
  const [codeFix, setCodeFix] = useState<{
    fileName: string;
    startLine: number;
    endLine: number;
    selectedCode: string;
  } | null>(null);

  const openCodeFix = React.useCallback((args: { fileName: string; startLine: number; endLine: number; selectedCode: string }) => {
    setCodeFix(args);
  }, []);

  const closeCodeFix = React.useCallback(() => setCodeFix(null), []);

  // Declare placeholder for send function; assign later after hook is initialized
  const submitCodeFixRef = React.useRef<null | ((instruction: string) => Promise<void>)>(null);
  const submitCodeFix = React.useCallback(async (instruction: string) => {
    if (submitCodeFixRef.current) await submitCodeFixRef.current(instruction);
  }, []);

  const timelineActions = React.useMemo(() => {
    return runOrder.flatMap(id => runs[id]?.actions || []);
  }, [runOrder, runs]);

  // Build an ignore matcher from .agentignore + .gitignore and defaults
  const gitignoreText = project['.gitignore'] || '';
  const agentignoreText = project['.agentignore'] || '';
  const isPathIgnored = React.useMemo(() => {
    // Convert basic .gitignore-style patterns into predicate functions
    // Supported: trailing-slash folders, simple filenames, and basic * globs on basenames
    const sanitize = (s: string) => s.trim();
    const linesGit = gitignoreText
      ? gitignoreText.split(/\r?\n/).map(sanitize).filter(l => l && !l.startsWith('#'))
      : [];
    const linesAgent = agentignoreText
      ? agentignoreText.split(/\r?\n/).map(sanitize).filter(l => l && !l.startsWith('#'))
      : [];
    const patterns = [...DEFAULT_DIFF_IGNORE_PATTERNS, ...linesGit, ...linesAgent];

    const toPredicate = (pat: string) => {
      const pattern = pat.replace(/^\//, '').trim();
      if (!pattern) return () => false;

      // Directory pattern (e.g. node_modules/ or __pycache__/)
      if (pattern.endsWith('/')) {
        const dir = pattern.slice(0, -1);
        return (p: string) => {
          const n = (p || '').replace(/^\//, '');
          return n === dir || n.startsWith(dir + '/');
        };
      }

      // Simple filename (e.g. .DS_Store)
      if (!pattern.includes('*') && !pattern.includes('?')) {
        return (p: string) => {
          const n = (p || '').replace(/^\//, '');
          const base = n.split('/').pop() || n;
          return base === pattern;
        };
      }

      // Basic glob on basename (e.g. *.pyc, *.log)
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regexStr = '^' + pattern
        .split(/([*?])/)
        .map(tok => tok === '*' ? '.*' : tok === '?' ? '.' : escapeRegex(tok))
        .join('') + '$';
      const regex = new RegExp(regexStr);
      return (p: string) => {
        const n = (p || '').replace(/^\//, '');
        const base = n.split('/').pop() || n;
        return regex.test(base);
      };
    };

    const predicates = patterns.map(toPredicate);
    return (p: string) => predicates.some(fn => fn(p));
  }, [gitignoreText, agentignoreText]);

  // Filtered views for tree and sending
  const projectForTree = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const [p, c] of Object.entries(project)) {
      if (!isPathIgnored(p) || p === activeFile) out[p] = c;
    }
    return out;
  }, [project, isPathIgnored, activeFile]);
  const proposalsForTree = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const [p, c] of Object.entries(proposals)) {
      if (!isPathIgnored(p) || p === activeFile) out[p] = c;
    }
    return out;
  }, [proposals, isPathIgnored, activeFile]);

  const projectForSend = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const [p, c] of Object.entries(project)) {
      // Always keep ignore files themselves available
      if (!isPathIgnored(p) || p === '.gitignore' || p === '.agentignore') out[p] = c;
    }
    return out;
  }, [project, isPathIgnored]);
  const proposalsForSend = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const [p, c] of Object.entries(proposals)) {
      if (!isPathIgnored(p)) out[p] = c;
    }
    return out;
  }, [proposals, isPathIgnored]);

  // Map SSE events to UI actions and create the stream controller
  const handleAgentEvent = useAgentEvents({
    setLoading,
    setCurrentTaskId,
    setCancelling,
    upsertProposal: (filePath: string, newContent: string) => {
      if (!isPathIgnored(filePath)) upsertProposal(filePath, newContent);
    },
    onCreateFolder: (folderPath: string) => {
      setProject(prev => ({ ...prev }));
      setFolders(prev => Array.from(new Set([...(prev || []), folderPath.replace(/^\//,'')] )));
    },
    onDeleteFolder: (folderPath: string) => {
      const normalized = folderPath.replace(/\/$/,'');
      setProject(prev => {
        const next: Record<string,string> = {};
        for (const [p, c] of Object.entries(prev)) {
          if (p === normalized || p.startsWith(normalized + '/')) continue;
          next[p] = c;
        }
        return next;
      });
      setProposals(prev => {
        const next: Record<string,string> = {};
        for (const [p, c] of Object.entries(prev)) {
          if (p === normalized || p.startsWith(normalized + '/')) continue;
          next[p] = c;
        }
        return next;
      });
      setFolders(prev => (prev || []).filter(f => f !== normalized && !f.startsWith(normalized + '/')));
      if (activeFile === normalized || activeFile.startsWith(normalized + '/')) {
        const remaining = Object.keys(project).filter(p => !(p === normalized || p.startsWith(normalized + '/'))).sort();
        setActiveFile(remaining[0] || '');
      }
    },
    onRenameFolder: (oldPath: string, newPath: string) => {
      const normalizedOld = oldPath.replace(/\/$/,'');
      const normalizedNew = newPath.replace(/^\//,'');
      setProject(prev => {
        const next: Record<string,string> = {};
        for (const [p, c] of Object.entries(prev)) {
          if (p === normalizedOld || p.startsWith(normalizedOld + '/')) {
            const suffix = p.slice(normalizedOld.length);
            const np = (normalizedNew + suffix).replace(/^\//,'');
            next[np] = c;
          } else {
            next[p] = c;
          }
        }
        return next;
      });
      setProposals(prev => {
        const next: Record<string,string> = {};
        for (const [p, c] of Object.entries(prev)) {
          if (p === normalizedOld || p.startsWith(normalizedOld + '/')) {
            const suffix = p.slice(normalizedOld.length);
            const np = (normalizedNew + suffix).replace(/^\//,'');
            next[np] = c;
          } else {
            next[p] = c;
          }
        }
        return next;
      });
      setFolders(prev => {
        const base = prev || [];
        const updated = base.map(f => (f === normalizedOld || f.startsWith(normalizedOld + '/') ? (normalizedNew + f.slice(normalizedOld.length)).replace(/^\//,'') : f));
        if (!updated.includes(normalizedNew)) updated.push(normalizedNew);
        return Array.from(new Set(updated));
      });
      if (activeFile === normalizedOld || activeFile.startsWith(normalizedOld + '/')) {
        const suffix = activeFile.slice(normalizedOld.length);
        setActiveFile((normalizedNew + suffix).replace(/^\//,''));
      }
    },
    onRenameFile: (oldPath: string, newPath: string) => {
      setProject(prev => {
        const content = prev[oldPath] ?? '';
        const next = { ...prev };
        delete next[oldPath];
        next[newPath] = content;
        return next;
      });
      setProposals(prev => {
        if (!prev[oldPath]) return prev;
        const next = { ...prev } as Record<string,string>;
        const val = next[oldPath];
        delete next[oldPath];
        next[newPath] = val;
        return next;
      });
      if (activeFile === oldPath) setActiveFile(newPath);
    },
    onDeleteFile: (filePath: string) => {
      setProject(prev => {
        const next = { ...prev };
        delete next[filePath];
        return next;
      });
      setProposals(prev => {
        if (!prev[filePath]) return prev;
        const next = { ...prev } as Record<string,string>;
        delete next[filePath];
        return next;
      });
      if (activeFile === filePath) {
        const remaining = Object.keys(project).filter(p => p !== filePath).sort();
        setActiveFile(remaining[0] || '');
      }
    },
    onUpsertFile: (filePath: string, content: string) => {
      if (isPathIgnored(filePath)) return;
      setProject(prev => (prev[filePath] !== undefined ? prev : { ...prev, [filePath]: (content ?? '') }));
    },
    onSetPreviewUrl: (url: string | null) => {
      // Reuse the play.previewUrl slot to display the embedded preview panel
      // (The hook exposes setPreviewUrl for this purpose)
      (play as unknown as { setPreviewUrl?: (u: string | null) => void }).setPreviewUrl?.(url);
    },
  });
  const stream = useAgentStream({ onMessage: handleAgentEvent });

  // Initialize chat functionality
  const { sendPrompt, cancelCurrentTask } = useChat({
    userId: USER_ID,
    input,
    currentTaskId,
    cancelling,
    project: projectForSend,
    proposals: proposalsForSend,
    setInput,
    setLoading,
    setCurrentTaskId,
    setCancelling,
    stream,
    model,
  });

  // Initialize the submitCodeFix callback after sendPrompt is available
  React.useEffect(() => {
    submitCodeFixRef.current = async (instruction: string) => {
      const args = codeFix; // capture current
      if (!args) return;
      const systemPrompt = `Please update ${args.fileName} between lines ${args.startLine}-${args.endLine} according to the user's instruction. Only make minimal, precise edits within that range using the edit_code tool. Preserve style and indentation. Selected code snippet for reference (do not paste with line numbers):\n\n${args.selectedCode}`;
      setInput(`${instruction}\n\n${systemPrompt}`);
      setCodeFix(null);
      if (!loading) {
        if (!isAuthenticated) { openModal(); return; }
        await sendPrompt();
      }
    };
  }, [codeFix, setInput, loading, isAuthenticated, openModal, sendPrompt]);
  const handleRun = React.useCallback(() => {
    const merged: Record<string, string> = { ...project };
    // If a proposal exists for active file and is visible, prefer current editor content via code state
    merged[activeFile] = code;
    const filtered: Record<string, string> = {};
    for (const [p, c] of Object.entries(merged)) {
      // Always keep entry file and ignore control files
      if (p === activeFile || p === '.gitignore' || p === '.agentignore' || !isPathIgnored(p)) {
        filtered[p] = c;
      }
    }
    play.start({ userId: USER_ID, project: filtered, entryPath: activeFile });
  }, [project, activeFile, code, play, isPathIgnored]);

  const handleStop = React.useCallback(() => {
    play.stop();
  }, [play]);



  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;
    if (!isAuthenticated) { openModal(); return; }
    await sendPrompt();
  };

  const handleCancelTask = () => {
    if (currentTaskId && !cancelling) {
      cancelCurrentTask();
    }
  };

  // When sandbox run completes after an approved exec request, resume the agent with logs
  React.useEffect(() => {
    if (!pendingExecResume) return;
    if (play.status !== 'done' && play.status !== 'error') return;

    const { runId, actionId, resumeToken } = pendingExecResume;
    let output = play.logs || '';
    if (output.length > 100000) output = output.slice(-100000);

    // Resume agent via SSE with sandbox output
    stream.disconnect(runId);
    stream.resume(runId, resumeToken, output);

    // Add exec result action and mark request as completed/failed
    const resultAction: Action = {
      id: `exec_result_${Date.now()}`,
      kind: 'exec_result',
      status: 'done',
      output,
      timestamp: new Date().toISOString(),
    } as Action;
    updateAction(runId, resultAction.id, () => resultAction);
    updateAction(runId, actionId, prev => ({
      ...(prev as Action),
      status: play.status === 'done' ? 'done' : 'failed',
    }));

    setExecutingCode(false);
    setExecutionAction(null);
    setPendingExecResume(null);
  }, [play.status, pendingExecResume, play.logs, stream, updateAction]);

  const pendingExecRequest = React.useMemo(() => {
    if (!currentTaskId) return null;
    const run = runs[currentTaskId];
    if (!run || run.actions.length === 0) return null;
    for (let i = run.actions.length - 1; i >= 0; i -= 1) {
      const a = run.actions[i];
      if (a.kind === 'exec_request' && a.status === 'running') {
        return a as Action & { kind: 'exec_request' };
      }
    }
    return null;
  }, [runs, currentTaskId]);

  const handleRejectExecution = async () => {
    if (!pendingExecRequest || !currentTaskId) return;
    setExecutingCode(true);
    setExecutionAction('reject');

    const rejectMsg = (pendingExecRequest.responseOnReject) ?? 'Execution rejected.';

    // Resume agent via SSE if we have a resumeToken
    const resumeToken = pendingExecRequest.resumeToken;
    if (resumeToken) {
      // Close current SSE stream to avoid duplicate events during resume
      stream.disconnect(currentTaskId);
      const small = rejectMsg.length > 20000 ? rejectMsg.slice(-20000) : rejectMsg;
      stream.resume(currentTaskId, resumeToken, small);
    }

    // Update action locally
    updateAction(currentTaskId!, pendingExecRequest.id, prev => ({
      ...(prev as Action),
      status: 'failed',
    }));

    const noticeAction: Action = {
      id: `reject_${Date.now()}`,
      kind: 'system_notice',
      status: 'done',
      message: rejectMsg,
      timestamp: new Date().toISOString(),
    } as Action;
    updateAction(currentTaskId!, noticeAction.id, () => noticeAction);

    setExecutingCode(false);
    setExecutionAction(null);
    // Keep currentTaskId until run completes to avoid re-opening prompt prematurely
  };

  const handleAcceptExecution = async () => {
    if (!pendingExecRequest || !currentTaskId) return;
    setExecutingCode(true);
    setExecutionAction('accept');

    // Start sandbox run just like clicking the Run button
    const merged: Record<string, string> = { ...project };
    merged[activeFile] = code;
    play.start({ userId: USER_ID, project: merged, entryPath: activeFile });

    // Defer agent resume until sandbox completes; stash context
    const resumeToken = pendingExecRequest.resumeToken;
    if (resumeToken) {
      setPendingExecResume({ runId: currentTaskId, actionId: pendingExecRequest.id, resumeToken });
    }
    // Leave executing state true until play finishes
  };

  return (
    <>
    <ThreePane
      left={(
        <FileTree
          project={projectForTree}
          activeFile={activeFile}
          onSelect={setActiveFile}
          onCreateFile={(name) => {
            setProject(prev => ({ ...prev, [name]: '' }));
            setActiveFile(name);
          }}
          onCreateFolder={(folderPath) => {
            // Keep a folders list in component state via proposals map using a sentinel key
            setProject(prev => ({ ...prev })); // no-op to trigger rebuild; folders tracked separately below
            setFolders(prev => Array.from(new Set([...(prev || []), folderPath.replace(/^\//,'')] )));
          }}
          onRename={(oldPath, newPath) => {
            setProject(prev => {
              const content = prev[oldPath] ?? '';
              const next = { ...prev };
              delete next[oldPath];
              next[newPath] = content;
              return next;
            });
            if (activeFile === oldPath) setActiveFile(newPath);
          }}
          onDelete={(path) => {
            setProject(prev => {
              const next = { ...prev };
              delete next[path];
              return next;
            });
            if (activeFile === path) {
              const remaining = Object.keys(project).filter(p => p !== path).sort();
              setActiveFile(remaining[0] || '');
            }
          }}
          onMoveFile={(src, destDir) => {
            const fileName = src.split('/').pop() || src;
            const dest = destDir ? `${destDir.replace(/\/$/,'')}/${fileName}` : fileName;
            if (dest === src) return;
            setProject(prev => {
              const content = prev[src];
              const next = { ...prev };
              delete next[src];
              next[dest] = content ?? '';
              return next;
            });
            if (proposals[src]) {
              setProposals(prev => {
                const next = { ...prev };
                const val = next[src];
                delete next[src];
                next[dest] = val;
                return next;
              });
            }
            if (activeFile === src) setActiveFile(dest);
          }}
          onMoveFolder={(srcFolder, destDir) => {
            const normalizedSrc = srcFolder.replace(/\/$/,'');
            const dest = destDir ? destDir.replace(/\/$/,'') : '';
            if (dest === normalizedSrc || dest.startsWith(normalizedSrc + '/')) return; // prevent moving into self/child
            const srcBase = (normalizedSrc.split('/').pop() || normalizedSrc).replace(/^\//,'');
            const targetBase = dest ? `${dest}/${srcBase}` : srcBase;
            setProject(prev => {
              const next: Record<string,string> = {};
              for (const [p, c] of Object.entries(prev)) {
                if (p === normalizedSrc || p.startsWith(normalizedSrc + '/')) {
                  const suffix = p.slice(normalizedSrc.length);
                  const np = `${targetBase}${suffix}`.replace(/^\//,'');
                  next[np] = c;
                } else {
                  next[p] = c;
                }
              }
              return next;
            });
            setProposals(prev => {
              const next: Record<string,string> = {};
              for (const [p, c] of Object.entries(prev)) {
                if (p === normalizedSrc || p.startsWith(normalizedSrc + '/')) {
                  const suffix = p.slice(normalizedSrc.length);
                  const np = `${targetBase}${suffix}`.replace(/^\//,'');
                  next[np] = c;
                } else {
                  next[p] = c;
                }
              }
              return next;
            });
            setFolders(prev => {
              const base = prev || [];
              // Move folder and all its subfolders under dest, preserving the folder basename
              const moved = base.map(f => {
                if (f === normalizedSrc || f.startsWith(normalizedSrc + '/')) {
                  const suffix = f.slice(normalizedSrc.length);
                  return `${targetBase}${suffix}`.replace(/^\//,'');
                }
                return f;
              });
              if (!moved.includes(targetBase)) moved.push(targetBase);
              return Array.from(new Set(moved.map(s => s.replace(/^\//,''))));
            });
            if (activeFile === normalizedSrc || activeFile.startsWith(normalizedSrc + '/')) {
              const suffix = activeFile.slice(normalizedSrc.length);
              setActiveFile(`${targetBase}${suffix}`.replace(/^\//,''));
            }
          }}
          proposed={proposalsForTree}
          folders={folders}
          onRenameFolder={(oldPath, newPath) => {
            const normalizedOld = oldPath.replace(/\/$/,'');
            const normalizedNew = newPath.replace(/^\//,'');
            // Move files under folder
            setProject(prev => {
              const next: Record<string,string> = {};
              for (const [p, c] of Object.entries(prev)) {
                if (p === normalizedOld || p.startsWith(normalizedOld + '/')) {
                  const suffix = p.slice(normalizedOld.length);
                  const np = (normalizedNew + suffix).replace(/^\//,'');
                  next[np] = c;
                } else {
                  next[p] = c;
                }
              }
              return next;
            });
            // Proposals under folder
            setProposals(prev => {
              const next: Record<string,string> = {};
              for (const [p, c] of Object.entries(prev)) {
                if (p === normalizedOld || p.startsWith(normalizedOld + '/')) {
                  const suffix = p.slice(normalizedOld.length);
                  const np = (normalizedNew + suffix).replace(/^\//,'');
                  next[np] = c;
                } else {
                  next[p] = c;
                }
              }
              return next;
            });
            // Folders list
            setFolders(prev => {
              const base = prev || [];
              const updated = base.map(f => (f === normalizedOld || f.startsWith(normalizedOld + '/') ? (normalizedNew + f.slice(normalizedOld.length)).replace(/^\//,'') : f));
              if (!updated.includes(normalizedNew)) updated.push(normalizedNew);
              return Array.from(new Set(updated));
            });
            // Active file path update
            if (activeFile === normalizedOld || activeFile.startsWith(normalizedOld + '/')) {
              const suffix = activeFile.slice(normalizedOld.length);
              setActiveFile((normalizedNew + suffix).replace(/^\//,''));
            }
          }}
          onDeleteFolder={(folderPath) => {
            const normalized = folderPath.replace(/\/$/,'');
            setProject(prev => {
              const next: Record<string,string> = {};
              for (const [p, c] of Object.entries(prev)) {
                if (p === normalized || p.startsWith(normalized + '/')) continue;
                next[p] = c;
              }
              return next;
            });
            setProposals(prev => {
              const next: Record<string,string> = {};
              for (const [p, c] of Object.entries(prev)) {
                if (p === normalized || p.startsWith(normalized + '/')) continue;
                next[p] = c;
              }
              return next;
            });
            setFolders(prev => (prev || []).filter(f => f !== normalized && !f.startsWith(normalized + '/')));
            if (activeFile === normalized || activeFile.startsWith(normalized + '/')) {
              const remaining = Object.keys(project).filter(p => !(p === normalized || p.startsWith(normalized + '/'))).sort();
              setActiveFile(remaining[0] || '');
            }
          }}
        />
      )}
      center={(
        <ResizableCenter
          code={code}
          setCode={setCode}
          proposals={proposals}
          clearProposal={clearProposal}
          activeFile={activeFile}
          onRun={handleRun}
          running={Boolean(play.sandboxId) && (play.status === 'running' || play.status === 'starting')}
          onStop={handleStop}
          previewUrl={play.previewUrl}
          onOpenPreview={play.openPreview}
          terminalLogs={play.logs}
          onClearLogs={play.clear}
          isIgnored={isPathIgnored}
        // When editor requests a code fix open modal
        onRequestCodeFix={openCodeFix}
        />
      )}
      right={(
        <>
          <Timeline
            actions={timelineActions}
            isEmpty={timelineActions.length === 0}
            loading={loading || timelineActions.some(a => a.status === 'running')}
          />
          <div className="px-4 py-2">
            <ModelPicker value={model} onChange={setModel} />
          </div>
          <ExecRequestPrompt
            visible={!!pendingExecRequest}
            executing={executingCode}
            executionAction={executionAction}
            onAccept={handleAcceptExecution}
            onReject={handleRejectExecution}
          />
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSendMessage}
            sendDisabled={loading}
            showCancel={!!currentTaskId}
            onCancel={handleCancelTask}
            cancelling={cancelling}
            suggestions={
              timelineActions.length === 0
                ? [
                    'Add a FastAPI /todos API with in-memory CRUD (GET, POST, DELETE) and run',
                    'Implement /math/fibonacci?n=20 that returns the sequence as JSON and run',
                    'Add request logging middleware plus /health and /time endpoints and run',
                    'Create a /text/wordcount endpoint that accepts text in JSON and returns counts and run',
                  ]
                : undefined
            }
          />
          <div className="px-4 py-2 text-xs text-gray-500">
            {isAuthenticated ? (
              <span>Signed in{user?.username ? ` as @${user.username}` : ''}</span>
            ) : null}
          </div>
        </>
      )}
    />
    <AuthModal />
    <AccountMenu />
    <CodeFixModal
      visible={!!codeFix}
      fileName={codeFix?.fileName || ''}
      startLine={codeFix?.startLine || 0}
      endLine={codeFix?.endLine || 0}
      selectedCode={codeFix?.selectedCode || ''}
      onClose={closeCodeFix}
      onSubmit={submitCodeFix}
    />
    </>
  );
}

export default App;
