import React, { useState } from 'react';
import JSZipLib from 'jszip';
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
import ProjectTabs, { type ProjectTab } from './components/ProjectTabs';
import NewProjectModal from './components/NewProjectModal';
import { getTemplateById, getStackById, TEMPLATES } from './templates/index';
import { loadPersistedState, savePersistedState, type PersistedState, type PersistedProjectState } from './lib/persistence';
import { getProjectChatThreads, setCurrentChatThread, startNewChatThread, upsertCurrentChatThread, mergeThreadIntoRuns, upsertThreadById, deleteChatThread, type PersistedChatThread, MAX_THREADS_PER_PROJECT } from './lib/persistence';
import { History as HistoryIcon, Plus, X } from 'lucide-react';

type ResizableCenterProps = {
  code: string;
  setCode: (v: string) => void;
  proposals: Record<string, string>;
  clearProposal: (file: string) => void;
  activeFile: string;
  onSelectFile: (path: string) => void;
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

const ResizableCenter: React.FC<ResizableCenterProps> = ({ code, setCode, proposals, clearProposal, activeFile, onSelectFile, onRun, running, onStop, previewUrl, onOpenPreview, terminalLogs, onClearLogs, onRequestCodeFix, isIgnored }) => {
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
          proposedFiles={React.useMemo(() => {
            const list: string[] = [];
            for (const k of Object.keys(proposals)) {
              if (!isIgnored || !isIgnored(k)) list.push(k);
            }
            // Ensure the current file is included if it has a proposal but is ignored by filters
            if (proposals[activeFile] !== undefined && !list.includes(activeFile)) list.push(activeFile);
            return list.sort((a,b) => a.localeCompare(b));
          }, [proposals, isIgnored, activeFile])}
          onNavigateProposedFile={(path) => onSelectFile((path || '').replace(/^\//,''))}
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

// Default template contents moved to templates.ts

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

  // Persisted state (projects + code) storage
  const persisted = React.useMemo<PersistedState | null>(() => loadPersistedState(), []);

  // Multi-project state
  const initialProjectId = React.useMemo(() => (persisted?.activeProjectId || `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`), [persisted]);
  const [projects, setProjects] = useState<ProjectTab[]>(() => (persisted?.projects?.length ? persisted.projects : [{ id: initialProjectId, name: 'Project 1' }]));
  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    const candidate = persisted?.activeProjectId || initialProjectId;
    const exists = (persisted?.projects || [{ id: initialProjectId, name: 'Project 1' }]).some(p => p.id === candidate);
    return exists ? candidate : (persisted?.projects?.[0]?.id || initialProjectId);
  });
  const [showNewProject, setShowNewProject] = useState<boolean>(false);

  type ProjectState = {
    files: Record<string, string>;
    proposals: Record<string, string>;
    activeFile: string;
    folders?: string[];
    expandedFolders: string[];
    input: string;
    loading: boolean;
    cancelling: boolean;
    model: string;
    codeFix: { fileName: string; startLine: number; endLine: number; selectedCode: string } | null;
    activeThreadId: string | null;
    templateId: string;
  };

  const defaultTemplateId = 'fastapi';
  const defaultTemplate = getTemplateById(defaultTemplateId) || TEMPLATES[0];
  const [projectStates, setProjectStates] = useState<Record<string, ProjectState>>(() => {
    if (persisted?.projectStates && Object.keys(persisted.projectStates).length) {
      const out: Record<string, ProjectState> = {};
      for (const [id, s] of (Object.entries(persisted.projectStates) as [string, PersistedProjectState][])) {
        const files = (s && s.files) ? s.files : (defaultTemplate.files);
        let activeFile = s?.activeFile;
        if (!activeFile || !(activeFile in files)) {
          const first = Object.keys(files)[0];
          activeFile = first || defaultTemplate.defaultActiveFile;
        }
        const inferredTemplateId = s?.templateId ?? (() => {
          try {
            const fileNames = Object.keys(files || {});
            if (fileNames.includes('main.py')) return 'fastapi';
            if (fileNames.includes('main.go')) return 'go';
            if (fileNames.some(f => f.startsWith('src/app/') || f === 'next.config.ts')) return 'next';
            if (fileNames.some(f => f.startsWith('backend/')) && fileNames.some(f => f.startsWith('src/app/'))) return 'react_fastapi';
            if (fileNames.some(f => f.startsWith('config/') && f.endsWith('.rb'))) return 'rails';
          } catch {
            /* ignore errors during template inference */
          }
          return defaultTemplateId;
        })();
        out[id] = {
          files,
          proposals: {},
          activeFile,
          folders: s?.folders,
          expandedFolders: Array.isArray(s?.expandedFolders) ? (s?.expandedFolders as string[]) : [],
          input: '',
          loading: false,
          cancelling: false,
          model: s?.model || 'anthropic/claude-sonnet-4.5',
          codeFix: null,
          activeThreadId: null,
          templateId: inferredTemplateId,
        };
      }
      // Ensure every project has a state
      for (const p of (persisted?.projects || [])) {
        if (!out[p.id]) {
          out[p.id] = {
            files: defaultTemplate.files,
            proposals: {},
            activeFile: defaultTemplate.defaultActiveFile,
            folders: undefined,
            expandedFolders: [],
            input: '',
            loading: false,
            cancelling: false,
            model: 'anthropic/claude-sonnet-4.5',
            codeFix: null,
            activeThreadId: null,
            templateId: defaultTemplateId,
          };
        }
      }
      return out;
    }
    return {
      [initialProjectId]: {
        files: defaultTemplate.files,
        proposals: {},
        activeFile: defaultTemplate.defaultActiveFile,
        folders: undefined,
        expandedFolders: [],
        input: '',
        loading: false,
        cancelling: false,
        model: 'anthropic/claude-sonnet-4.5',
        codeFix: null,
        activeThreadId: null,
        templateId: defaultTemplateId,
      },
    } as Record<string, ProjectState>;
  });

  // Save to localStorage whenever projects or code change
  React.useEffect(() => {
    // Only persist essential, non-ephemeral fields
    const projectStatesToPersist: Record<string, PersistedProjectState> = {};
    for (const [id, st] of Object.entries(projectStates)) {
      projectStatesToPersist[id] = {
        files: st.files,
        activeFile: st.activeFile,
        folders: st.folders,
        expandedFolders: st.expandedFolders,
        model: st.model,
        templateId: st.templateId,
      };
    }
    const activeIdSafe = projects.some(p => p.id === activeProjectId) ? activeProjectId : (projects[0]?.id || '');
    const toSave: PersistedState = {
      version: 1,
      projects,
      activeProjectId: activeIdSafe,
      projectStates: projectStatesToPersist,
    };
    savePersistedState(toSave);
  }, [projects, activeProjectId, projectStates]);

  // Empty projects state flag (used for conditional rendering)
  const isNoProjects = projects.length === 0;
  const activeState = projectStates[activeProjectId] || ({
    files: {},
    proposals: {},
    activeFile: '',
    folders: undefined,
    expandedFolders: [],
    input: '',
    loading: false,
    cancelling: false,
    model: 'anthropic/claude-sonnet-4.5',
    codeFix: null,
    activeThreadId: null,
    templateId: defaultTemplateId,
  } as ProjectState);
  const project = activeState.files;
  const proposals = activeState.proposals;
  const activeFile = activeState.activeFile;
  const folders = activeState.folders;
  const expandedFolders = activeState.expandedFolders;
  const input = activeState.input;
  const cancelling = activeState.cancelling;
  const model = activeState.model;
  const codeFix = activeState.codeFix;
  const activeThreadId = activeState.activeThreadId;
  const nextProjectName = React.useMemo(() => `Project ${projects.length + 1}`, [projects.length]);

  const setProject = (updater: (prev: Record<string, string>) => Record<string, string>) => {
    setProjectStates(prev => ({
      ...prev,
      [activeProjectId]: { ...prev[activeProjectId], files: updater(prev[activeProjectId].files) },
    }));
  };
  const setProposals = React.useCallback((updater: (prev: Record<string, string>) => Record<string, string>) => {
    setProjectStates(prev => ({
      ...prev,
      [activeProjectId]: { ...prev[activeProjectId], proposals: updater(prev[activeProjectId].proposals) },
    }));
  }, [activeProjectId]);
  const setActiveFile = (file: string) => {
    setProjectStates(prev => ({ ...prev, [activeProjectId]: { ...prev[activeProjectId], activeFile: file } }));
  };
  const setFolders = (updater: (prev: string[] | undefined) => string[] | undefined) => {
    setProjectStates(prev => ({ ...prev, [activeProjectId]: { ...prev[activeProjectId], folders: updater(prev[activeProjectId].folders) } }));
  };
  const setExpandedFolders = (paths: string[]) => {
    setProjectStates(prev => ({ ...prev, [activeProjectId]: { ...prev[activeProjectId], expandedFolders: paths } }));
  };
  const setInput = React.useCallback((next: string) => {
    setProjectStates(prev => ({ ...prev, [activeProjectId]: { ...prev[activeProjectId], input: next } }));
  }, [activeProjectId]);
  const setLoading = React.useCallback((next: boolean) => {
    setProjectStates(prev => ({ ...prev, [activeProjectId]: { ...prev[activeProjectId], loading: next } }));
  }, [activeProjectId]);
  const setCancelling = React.useCallback((next: boolean) => {
    setProjectStates(prev => ({ ...prev, [activeProjectId]: { ...prev[activeProjectId], cancelling: next } }));
  }, [activeProjectId]);
  const setModel = (next: string) => {
    setProjectStates(prev => ({ ...prev, [activeProjectId]: { ...prev[activeProjectId], model: next } }));
  };
  const setCodeFix = React.useCallback((next: ProjectState['codeFix']) => {
    setProjectStates(prev => ({ ...prev, [activeProjectId]: { ...prev[activeProjectId], codeFix: next } }));
  }, [activeProjectId]);
  const setActiveThreadId = React.useCallback((threadId: string | null) => {
    setProjectStates(prev => ({ ...prev, [activeProjectId]: { ...prev[activeProjectId], activeThreadId: threadId } }));
  }, [activeProjectId]);

  const code = project[activeFile] ?? '';
  const setCode = (next: string) => setProject(prev => ({ ...prev, [activeFile]: next }));
  const upsertProposal = React.useCallback((filePath: string, newContent: string) => {
    setProposals(prev => ({ ...prev, [filePath]: newContent }));
  }, [setProposals]);
  const clearProposal = React.useCallback((filePath: string) => {
    setProposals(prev => {
      const next = { ...prev } as Record<string,string>;
      delete next[filePath];
      return next;
    });
  }, [setProposals]);
  
  // input/loading/cancelling/model now scoped per project
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
  const { runs, runOrder, updateAction, mergeProjectRuns, setRunStatus } = useRuns();

  // ---------------- Chat persistence / history ----------------
  const [chatThreads, setChatThreads] = useState<PersistedChatThread[]>(() => getProjectChatThreads(activeProjectId));
  const [showChatHistory, setShowChatHistory] = useState<boolean>(false);
  const chatHistoryRef = React.useRef<HTMLDivElement | null>(null);

  // Close chat history when clicking outside of its container
  React.useEffect(() => {
    if (!showChatHistory) return;
    const handleDocMouseDown = (e: MouseEvent) => {
      const root = chatHistoryRef.current;
      if (root && !root.contains(e.target as Node)) {
        setShowChatHistory(false);
      }
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleDocMouseDown);
    };
  }, [showChatHistory]);

  // Keep a memo of last human message timestamps to avoid flicker (only refresh list when a thread's last human time changes)
  const lastHumanAtByThreadRef = React.useRef<Record<string, string | undefined>>({});

  // When project changes, load its threads and merge all into memory (do not clear to avoid dropping active streams)
  React.useEffect(() => {
    const threads = getProjectChatThreads(activeProjectId);
    setChatThreads(threads);
    if (threads && threads.length > 0) {
      for (const t of threads) {
        const { runs: scopedRuns, order } = mergeThreadIntoRuns(activeProjectId, t);
        mergeProjectRuns(activeProjectId, scopedRuns, order, t.id);
      }
      // Set active thread to most recent if none selected
      if (!activeState.activeThreadId) {
        setProjectStates(prev => ({
          ...prev,
          [activeProjectId]: { ...prev[activeProjectId], activeThreadId: threads[0]?.id || `${activeProjectId}_default` },
        }));
      }
    } else {
      // Ensure we have a default active thread id even with no threads
      setProjectStates(prev => ({
        ...prev,
        [activeProjectId]: { ...prev[activeProjectId], activeThreadId: `${activeProjectId}_default` },
      }));
    }
  }, [activeProjectId, mergeProjectRuns, activeState.activeThreadId]);

  // As runs change for this project, persist per-thread so background chats are saved too
  // Only refresh the thread list if lastHumanAt changed (i.e., a user_message), to prevent flicker during logs/tool updates
  React.useEffect(() => {
    // Group runs by thread within the active project
    const grouped: Record<string, { runs: Record<string, typeof runs[string]>; order: string[] }> = {};
    for (const id of runOrder) {
      const r = runs[id];
      if (!r || r.projectId !== activeProjectId) continue;
      const tid = r.threadId || `${activeProjectId}_default`;
      if (!grouped[tid]) grouped[tid] = { runs: {}, order: [] };
      grouped[tid].runs[id] = r;
      grouped[tid].order.push(id);
    }
    // If nothing yet, ensure at least a default thread exists to keep UX consistent
    if (Object.keys(grouped).length === 0) {
      upsertCurrentChatThread(activeProjectId, {}, []);
      // Do not refresh list; no user message
      return;
    }
    // Upsert all threads
    for (const [threadId, data] of Object.entries(grouped)) {
      upsertThreadById(activeProjectId, threadId, data.runs, data.order);
    }
    // Compute lastHumanAt map for this project from grouped data
    const newMap: Record<string, string | undefined> = {};
    for (const [tid, data] of Object.entries(grouped)) {
      let latest = 0;
      for (const rid of data.order) {
        const run = data.runs[rid];
        if (!run) continue;
        for (const a of run.actions) {
          if (a.kind === 'user_message' && a.timestamp) {
            const t = Date.parse(a.timestamp);
            if (!Number.isNaN(t) && t > latest) latest = t;
          }
        }
      }
      newMap[tid] = latest > 0 ? new Date(latest).toISOString() : undefined;
    }
    // Decide whether to refresh the UI list
    const prevMap = lastHumanAtByThreadRef.current;
    let changed = false;
    const keys = new Set([...Object.keys(prevMap), ...Object.keys(newMap)]);
    for (const k of keys) {
      if (prevMap[k] !== newMap[k]) { changed = true; break; }
    }
    lastHumanAtByThreadRef.current = newMap;
    if (changed) {
      setChatThreads(getProjectChatThreads(activeProjectId));
    }
  }, [runs, runOrder, activeProjectId]);

  // (moved below after stream is created)

  const openCodeFix = React.useCallback((args: { fileName: string; startLine: number; endLine: number; selectedCode: string }) => {
    setCodeFix(args);
  }, [setCodeFix]);

  const closeCodeFix = React.useCallback(() => setCodeFix(null), [setCodeFix]);

  // Declare placeholder for send function; assign later after hook is initialized
  const submitCodeFixRef = React.useRef<null | ((instruction: string) => Promise<void>)>(null);
  const submitCodeFix = React.useCallback(async (instruction: string) => {
    if (submitCodeFixRef.current) await submitCodeFixRef.current(instruction);
  }, []);

  const timelineActions = React.useMemo(() => {
    return runOrder
      .map(id => runs[id])
      .filter((r): r is typeof runs[string] => Boolean(r))
      .filter(run => (run.projectId || undefined) === activeProjectId && (activeThreadId ? run.threadId === activeThreadId : true))
      .flatMap(run => run.actions || []);
  }, [runOrder, runs, activeProjectId, activeThreadId]);

  // Only show thinking spinner for the latest run in the active thread
  const threadRunIds = React.useMemo(() => {
    return runOrder.filter(id => {
      const r = runs[id];
      if (!r) return false;
      if (r.projectId !== activeProjectId) return false;
      const tid = r.threadId || `${activeProjectId}_default`;
      return tid === (activeThreadId || `${activeProjectId}_default`);
    });
  }, [runOrder, runs, activeProjectId, activeThreadId]);

  const latestRunId = threadRunIds.length > 0 ? threadRunIds[threadRunIds.length - 1] : null;

  // (thinking state derived later after stream is initialized)

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
          if (n === dir || n.startsWith(dir + '/')) return true; // root-level
          // match anywhere: "/dir/" occurrence in the path
          return n.split('/').includes(dir);
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
        if (regex.test(base)) return true; // basename match
        // Also allow pattern to match any full segment for safety (e.g., *.log won't, but foo* might)
        return n.split('/').some(seg => regex.test(seg));
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
  const isActiveRun = React.useCallback((taskId: string) => taskId === latestRunId, [latestRunId]);
  const handleAgentEvent = useAgentEvents({
    setLoading,
    setCancelling,
    setLoadingForProject: (projectId: string, next: boolean) => {
      setProjectStates(prev => ({ ...prev, [projectId]: { ...(prev[projectId] || activeState), loading: next } }));
    },
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
    onRefreshPreview: () => {
      setPreviewRefreshToken((t) => t + 1);
    },
    isActiveRun,
  });
  const stream = useAgentStream({ onMessage: handleAgentEvent });

  // Derive thinking from final answer presence and basic run lifecycle
  const latestRun = latestRunId ? runs[latestRunId] : undefined;
  const latestRunStatus = latestRun?.status;
  const latestRunConnected = latestRunId ? stream.isConnected(latestRunId) : false;
  const latestRunHasFinalAnswer = Boolean(latestRun?.actions?.some(a => a.kind === 'final_answer'));
  const isThinking = Boolean(
    latestRunId && !latestRunHasFinalAnswer && (
      latestRunConnected ||
      latestRunStatus === 'waiting_exec'
    )
  );

  // Token to force refresh of preview iframes
  const [previewRefreshToken, setPreviewRefreshToken] = useState<number>(0);

  // Initialize chat functionality
  const { sendPrompt, cancelCurrentTask } = useChat({
    userId: USER_ID,
    input,
    cancelling,
    project: projectForSend,
    proposals: proposalsForSend,
    projectId: activeProjectId,
    threadId: activeThreadId || `${activeProjectId}_default`,
    setInput,
    setLoading,
    setCancelling,
    stream,
    model,
  });

  // Ensure code-fix submit is bound to the sendPrompt
  React.useEffect(() => {
    submitCodeFixRef.current = async (instruction: string) => {
      setInput(`Fix the following code:\n\n${instruction}`);
      await sendPrompt();
    };
  }, [sendPrompt, setInput]);

  // Initialize the submitCodeFix callback after sendPrompt is available
  React.useEffect(() => {
    submitCodeFixRef.current = async (instruction: string) => {
      const args = codeFix; // capture current
      if (!args) return;
      const systemPrompt = `Please update ${args.fileName} between lines ${args.startLine}-${args.endLine} according to the user's instruction. Only make minimal, precise edits within that range using the edit_code tool. Preserve style and indentation. Selected code snippet for reference (do not paste with line numbers):\n\n${args.selectedCode}`;
      setInput(`${instruction}\n\n${systemPrompt}`);
      setCodeFix(null);
      if (!isThinking) {
        if (!isAuthenticated) { openModal(); return; }
        await sendPrompt();
      }
    };
  }, [codeFix, setInput, isThinking, isAuthenticated, openModal, sendPrompt, setCodeFix]);
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
    if (!input.trim() || isThinking) return;
    if (!isAuthenticated) { openModal(); return; }
    await sendPrompt();
  };

  const handleCancelTask = () => {
    // Cancel only if the latest run is the active thinking one
    if (latestRunId && isThinking && !cancelling) {
      cancelCurrentTask(latestRunId);
    }
  };

  const handleNewChat = React.useCallback(() => {
    const newThread = startNewChatThread(activeProjectId);
    setChatThreads(getProjectChatThreads(activeProjectId));
    setActiveThreadId(newThread.id);
    // Reset UI state for this project to focus on new chat
    setInput('');
    setLoading(false);
    setCancelling(false);
  }, [activeProjectId, setInput, setLoading, setCancelling, setActiveThreadId]);

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
    setRunStatus(runId, 'streaming');

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
  }, [play.status, pendingExecResume, play.logs, stream, updateAction, setRunStatus]);

  const pendingExecRequest = React.useMemo(() => {
    if (!latestRunId) return null;
    const run = runs[latestRunId];
    if (!run || run.actions.length === 0) return null;
    for (let i = run.actions.length - 1; i >= 0; i -= 1) {
      const a = run.actions[i];
      if (a.kind === 'exec_request' && a.status === 'running') {
        return a as Action & { kind: 'exec_request' };
      }
    }
    return null;
  }, [runs, latestRunId]);

  const handleRejectExecution = async () => {
    if (!pendingExecRequest || !latestRunId) return;
    setExecutingCode(true);
    setExecutionAction('reject');

    const rejectMsg = (pendingExecRequest.responseOnReject) ?? 'Execution rejected.';

    // Resume agent via SSE if we have a resumeToken
    const resumeToken = pendingExecRequest.resumeToken;
    if (resumeToken) {
      // Close current SSE stream to avoid duplicate events during resume
      stream.disconnect(latestRunId);
      const small = rejectMsg.length > 20000 ? rejectMsg.slice(-20000) : rejectMsg;
      stream.resume(latestRunId, resumeToken, small);
    }

    // Update action locally
    updateAction(latestRunId!, pendingExecRequest.id, prev => ({
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
    updateAction(latestRunId!, noticeAction.id, () => noticeAction);

    setExecutingCode(false);
    setExecutionAction(null);
    // Keep run state until completion to avoid re-opening prompt prematurely
  };

  const handleAcceptExecution = async () => {
    if (!pendingExecRequest || !latestRunId) return;
    setExecutingCode(true);
    setExecutionAction('accept');

    // Start sandbox run just like clicking the Run button
    const merged: Record<string, string> = { ...project };
    merged[activeFile] = code;
    play.start({ userId: USER_ID, project: merged, entryPath: activeFile });

    // Defer agent resume until sandbox completes; stash context
    const resumeToken = pendingExecRequest.resumeToken;
    if (resumeToken) {
      setPendingExecResume({ runId: latestRunId, actionId: pendingExecRequest.id, resumeToken });
    }
    // Leave executing state true until play finishes
  };

  return (
    <>
      {/* Top header is provided via ThreePane.header; remove any duplicate header here */}
      <ThreePane
        header={(
          <ProjectTabs
            projects={projects}
            activeProjectId={activeProjectId}
            onSelect={(id) => {
              if (id === activeProjectId) return;
              // Stop any running play session on switch
              if (play.status === 'running' || play.status === 'starting') {
                play.stop();
              }
              setActiveProjectId(id);
            }}
            onAdd={() => {
              setShowNewProject(true);
            }}
            onRename={(id, name) => {
              if (!name || !name.trim()) return;
              setProjects(prev => prev.map(p => (p.id === id ? { ...p, name: name.trim() } : p)));
            }}
            onClone={(id) => {
              const source = projects.find(p => p.id === id);
              if (!source) return;
              const srcState = projectStates[id];
              const existing = new Set(projects.map(p => (p.name || '').trim().toLowerCase()));
              const base = (source.name || 'Project').trim();
              const tryName = (n: number) => (n === 1 ? `${base} Copy` : `${base} Copy ${n}`);
              let nameCandidate = tryName(1);
              for (let i = 1; i < 1000 && existing.has(nameCandidate.trim().toLowerCase()); i += 1) {
                nameCandidate = tryName(i + 1);
              }
              const newId = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
              setProjects(prev => [...prev, { id: newId, name: nameCandidate }]);
              if (srcState) {
                setProjectStates(prev => ({
                  ...prev,
                  [newId]: {
                    files: { ...(srcState.files || {}) },
                    proposals: {},
                    activeFile: srcState.activeFile,
                    folders: srcState.folders,
                    expandedFolders: Array.isArray(srcState.expandedFolders) ? [...srcState.expandedFolders] : [],
                    input: '',
                    loading: false,
                    cancelling: false,
                    model: srcState.model,
                    codeFix: null,
                    activeThreadId: null,
                    templateId: srcState.templateId,
                  },
                }));
              }
              setActiveProjectId(newId);
            }}
            onDelete={(id) => {
              if (!window.confirm('Delete this project? This cannot be undone in this session.')) return;
              const wasLast = projects.length === 1 && projects[0]?.id === id;
              setProjects(prev => prev.filter(p => p.id !== id));
              setProjectStates(prev => {
                const next = { ...prev } as Record<string, ProjectState>;
                delete next[id];
                return next;
              });
              if (wasLast) {
                setActiveProjectId('');
                setShowNewProject(true);
              } else if (activeProjectId === id) {
                const remaining = projects.filter(p => p.id !== id);
                const nextActive = remaining[0]?.id;
                if (nextActive) setActiveProjectId(nextActive);
              }
            }}
            onDownload={async () => {
              try {
                const zip = new JSZipLib();
                const rootName = (projects.find(p => p.id === activeProjectId)?.name || 'project').replace(/\s+/g, '_');
                const folder = zip.folder(rootName);
                // Include all current project files; proposals are suggestions only
                Object.entries(project).forEach(([path, content]) => {
                  const normalized = (path || '').replace(/^\//,'');
                  if (!normalized) return;
                  folder.file(normalized, content ?? '');
                });
                const blob = await zip.generateAsync({ type: 'blob' });
                const a = document.createElement('a');
                const url = URL.createObjectURL(blob);
                a.href = url;
                a.download = `${rootName}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              } catch (e) {
                console.error('Failed to download ZIP', e);
              }
            }}
          />
        )}
      left={(
        isNoProjects ? (
          <div className="p-4 text-sm" style={{ color: 'var(--vscode-muted)' }}>
            No project. Create a new one to get started.
          </div>
        ) : (
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
              expandedPaths={expandedFolders}
              onExpandedChange={setExpandedFolders}
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
        )
      )}
      center={(
        isNoProjects ? (
          <div className="flex-1 flex items-center justify-center">
            <button
              onClick={() => setShowNewProject(true)}
              className="px-3 py-1 rounded-sm"
              style={{ background: 'var(--vscode-accent)', color: '#ffffff', border: '1px solid var(--vscode-panel-border)' }}
            >
              Create new project
            </button>
          </div>
        ) : (
          <ResizableCenter
            code={code}
            setCode={setCode}
            proposals={proposals}
            clearProposal={clearProposal}
            activeFile={activeFile}
            onSelectFile={setActiveFile}
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
        )
      )}
      right={(
        isNoProjects ? (
          <div className="p-4 text-sm" style={{ color: 'var(--vscode-muted)' }} />
        ) : (
          <>
            <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}>
              <button
                onClick={handleNewChat}
                className="w-8 h-8 rounded-sm flex items-center justify-center"
                style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)', border: '1px solid var(--vscode-panel-border)' }}
                title="Start a new chat"
              >
                <Plus className="w-4 h-4" />
              </button>
              <div className="relative">
                {/* Container ref to detect outside clicks and close chat history */}
                <div ref={chatHistoryRef} className="contents">
                <button
                  onClick={() => setShowChatHistory(v => !v)}
                  className="w-8 h-8 rounded-sm flex items-center justify-center"
                  style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)', border: '1px solid var(--vscode-panel-border)' }}
                  title={`Show chat history (keeps up to ${MAX_THREADS_PER_PROJECT})`}
                >
                  <HistoryIcon className="w-4 h-4" />
                </button>
                {showChatHistory && (
                  <div className="absolute z-10 mt-2 p-2 rounded-sm w-64" style={{ background: 'var(--vscode-panel)', border: '1px solid var(--vscode-panel-border)' }}>
                    {chatThreads.length === 0 ? (
                      <div className="text-xs" style={{ color: 'var(--vscode-muted)' }}>No previous chats</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {chatThreads.map((t) => (
                          <div key={t.id} className={`flex items-center gap-2 group`}>
                            <button
                              className={`flex-1 text-left px-2 py-1 rounded-sm text-xs ${activeThreadId === t.id ? 'ring-1' : ''}`}
                              style={{ background: 'var(--vscode-contrast)', color: 'var(--vscode-text)', border: '1px solid var(--vscode-panel-border)' }}
                              title={new Date(t.createdAt).toLocaleString()}
                              onClick={() => {
                                const chosen = setCurrentChatThread(activeProjectId, t.id);
                                if (chosen) {
                                  const { runs: scopedRuns, order } = mergeThreadIntoRuns(activeProjectId, chosen);
                                  mergeProjectRuns(activeProjectId, scopedRuns, order, chosen.id);
                                  // Do not refresh chatThreads list here to avoid flicker; just set active
                                  setActiveThreadId(chosen.id);
                                  setShowChatHistory(false);
                                }
                              }}
                            >
                              {t.title || `Chat`}
                            </button>
                            <button
                              className="w-6 h-6 flex items-center justify-center rounded-sm opacity-70 group-hover:opacity-100 cursor-pointer"
                              style={{ background: 'var(--vscode-surface)', color: 'var(--vscode-text)', border: '1px solid var(--vscode-panel-border)' }}
                              title="Delete chat"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Delete from persistence
                                deleteChatThread(activeProjectId, t.id);
                                const nextList = getProjectChatThreads(activeProjectId);
                                setChatThreads(nextList);
                                // If we just deleted the active thread, select next available or default
                                if (activeThreadId === t.id) {
                                  const fallback = nextList[0]?.id || `${activeProjectId}_default`;
                                  setActiveThreadId(fallback);
                                  const chosen = nextList.find(x => x.id === fallback);
                                  if (chosen) {
                                    const { runs: scopedRuns, order } = mergeThreadIntoRuns(activeProjectId, chosen);
                                    mergeProjectRuns(activeProjectId, scopedRuns, order, chosen.id);
                                  }
                                }
                              }}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>
            </div>
            <Timeline
              actions={timelineActions}
              isEmpty={timelineActions.length === 0}
              loading={isThinking}
            refreshToken={previewRefreshToken}
              onOpenFile={(path) => {
                const normalized = (path || '').replace(/^\//,'');
                if (!normalized) return;
                if (!project[normalized]) {
                  // If the file exists only as a proposal, open it (to view with proposedContent)
                  if (proposals[normalized] !== undefined) {
                    setProject(prev => ({ ...prev, [normalized]: prev[normalized] ?? '' }));
                  } else {
                    // Otherwise do nothing
                  }
                }
                setActiveFile(normalized);
              }}
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
              sendDisabled={isThinking}
              showCancel={!!latestRunId && isThinking}
              onCancel={handleCancelTask}
              cancelling={cancelling}
              suggestions={(() => {
                if (timelineActions.length > 0 || activeState.loading) return undefined;
                const tid = (projectStates[activeProjectId]?.templateId || defaultTemplateId);
                const tmpl = getTemplateById(tid) || getStackById(tid);
                const list = (tmpl?.suggestions && tmpl.suggestions.length > 0)
                  ? tmpl!.suggestions
                  : [
                      'Create a minimal HTTP API scaffold (FastAPI/Express/Go/Rails) and run',
                      'Add /health and /time endpoints with basic request logging and run',
                      'Implement /text/wordcount that accepts JSON and returns counts and run',
                    ];
                return list;
              })()}
            />
            <div className="px-4 py-2 text-xs text-gray-500">
              {isAuthenticated ? (
                <span>Signed in{user?.username ? ` as @${user.username}` : ''}</span>
              ) : null}
            </div>
          </>
        )
      )}
    />
    <AuthModal />
    <AccountMenu />
    <NewProjectModal
      visible={showNewProject}
      defaultName={nextProjectName}
      existingNames={projects.map(p => p.name)}
      onClose={() => setShowNewProject(false)}
      onCreate={(name, templateId) => {
        const id = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
        setProjects(prev => [...prev, { id, name }]);
        const t = getTemplateById(templateId) || getStackById(templateId) || defaultTemplate;
        setProjectStates(prev => ({
          ...prev,
          [id]: {
            files: t.files,
            proposals: {},
            activeFile: t.defaultActiveFile,
            folders: undefined,
            expandedFolders: [],
            input: '',
            loading: false,
            cancelling: false,
            model: 'anthropic/claude-sonnet-4.5',
            codeFix: null,
          activeThreadId: null,
          templateId,
          },
        }));
        setActiveProjectId(id);
        setShowNewProject(false);
      }}
    />
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
