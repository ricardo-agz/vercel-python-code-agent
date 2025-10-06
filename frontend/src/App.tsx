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
};

const ResizableCenter: React.FC<ResizableCenterProps> = ({ code, setCode, proposals, clearProposal, activeFile, onRun, running, onStop, previewUrl, onOpenPreview, terminalLogs, onClearLogs }) => {
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
          proposedContent={proposals[activeFile] ?? null}
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
        />
      </div>
      <div
        onMouseDown={onMouseDown}
        className={`h-1 cursor-row-resize transition-colors`}
        style={{ backgroundColor: resizing ? 'var(--vscode-accent)' : 'var(--vscode-panel-border)', position: 'relative', zIndex: 99999 }}
      />
      <TerminalPane height={terminalHeight} logs={terminalLogs} onClear={onClearLogs} />
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

  const timelineActions = React.useMemo(() => {
    return runOrder.flatMap(id => runs[id]?.actions || []);
  }, [runOrder, runs]);

  // Map SSE events to UI actions and create the stream controller
  const handleAgentEvent = useAgentEvents({
    setLoading,
    setCurrentTaskId,
    setCancelling,
    upsertProposal,
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
  });
  const stream = useAgentStream({ onMessage: handleAgentEvent });

  // Initialize chat functionality
  const { sendPrompt, cancelCurrentTask } = useChat({
    userId: USER_ID,
    input,
    currentTaskId,
    cancelling,
    project: (() => {
      // If proposedChange targets the active file, include it in the sent project state so agent sees the un-applied proposal? We keep project as-is and only surface proposals in UI.
      return project;
    })(),
    proposals,
    setInput,
    setLoading,
    setCurrentTaskId,
    setCancelling,
    stream,
    model,
  });
  const handleRun = React.useCallback(() => {
    const merged: Record<string, string> = { ...project };
    // If a proposal exists for active file and is visible, prefer current editor content via code state
    merged[activeFile] = code;
    play.start({ userId: USER_ID, project: merged, entryPath: activeFile });
  }, [project, activeFile, code, play]);

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
    const output = play.logs || '';

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
      stream.resume(currentTaskId, resumeToken, rejectMsg);
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
          project={project}
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
          proposed={proposals}
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
    </>
  );
}

export default App;
