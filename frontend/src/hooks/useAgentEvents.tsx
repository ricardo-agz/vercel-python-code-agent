import { useCallback, useRef, useEffect } from 'react';
import type { AgentEvent } from '../types';
import { useRuns } from '../context/RunContext';
import type { Action } from '../types/run';

interface UseAgentEventsProps {
  setLoading: (loading: boolean) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  setCancelling: (cancelling: boolean) => void;
  // Allow updating UI state for background runs by project id
  setLoadingForProject?: (projectId: string, loading: boolean) => void;
  setCurrentTaskIdForProject?: (projectId: string, taskId: string | null) => void;
  upsertProposal: (filePath: string, newContent: string) => void;
  onCreateFolder?: (folderPath: string) => void;
  onDeleteFolder?: (folderPath: string) => void;
  onRenameFolder?: (oldPath: string, newPath: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDeleteFile?: (filePath: string) => void;
  onUpsertFile?: (filePath: string, content: string) => void;
  onSetPreviewUrl?: (url: string | null) => void;
  // Only affect UI states when the event belongs to the active run
  isActiveRun?: (taskId: string) => boolean;
}

export const useAgentEvents = ({
  setLoading,
  setCurrentTaskId,
  setCancelling,
  setLoadingForProject,
  setCurrentTaskIdForProject,
  upsertProposal,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onRenameFile,
  onDeleteFile,
  onUpsertFile,
  onSetPreviewUrl,
  isActiveRun,
}: UseAgentEventsProps) => {
  const { runs, addAction, updateAction, appendActionLog, setRunStatus } = useRuns();
  const runsRef = useRef(runs);
  useEffect(() => { runsRef.current = runs; }, [runs]);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.event_type) {
      case 'progress_update_tool_action_log': {
        const data = event.data as { id?: string; data?: string } | undefined;
        if (data?.id && typeof data.data === 'string') {
          appendActionLog(event.task_id, data.id, data.data);
        }
        break;
      }
      case 'run_log': {
        const logMsg = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
        console.log('run_log', logMsg);
        break;
      }
      case 'progress_update_tool_action_started': {
        const toolCall = event.data?.args?.[0];
        if (!toolCall) break;

        // If this is a code execution request we've already resolved (failed/done), ignore repeats
        if (toolCall.function.name === 'request_code_execution') {
          const existing = runsRef.current[event.task_id]?.actions.find((a) => a.id === toolCall.id && a.kind === 'exec_request');
          const someOtherExecExists = runsRef.current[event.task_id]?.actions.some((a) => a.kind === 'exec_request' && a.id !== toolCall.id);
          // Allow at most one exec request per run; ignore any new/different ones
          if (someOtherExecExists) break;
          if (existing && existing.status !== 'running') break;

          // Ensure single action per toolCall id; upsert to running
          updateAction(event.task_id, toolCall.id, (prev) => {
            const base: Action = (prev as Action) ?? {
              id: toolCall.id,
              kind: 'exec_request',
              status: 'running',
              timestamp: event.timestamp,
            } as Action;
            const responseOnReject = (base as unknown as { responseOnReject?: string }).responseOnReject;
            return {
              ...base,
              kind: 'exec_request',
              status: 'running',
              timestamp: event.timestamp,
              ...(responseOnReject ? { responseOnReject } : { responseOnReject: toolCall.function.arguments?.response_on_reject }),
            } as Action;
          });
          // Enter waiting state for execution approval
          setRunStatus(event.task_id, 'waiting_exec');
          break;
        }

        const startAction: Action = {
          id: toolCall.id,
          kind: 'tool_started',
          status: 'running',
          timestamp: event.timestamp,
          toolName: toolCall.function.name,
          arguments: toolCall.function.arguments,
        } as Action;
        addAction(event.task_id, startAction);
        // If tools are starting without exec gating, the run is actively streaming
        setRunStatus(event.task_id, 'streaming');
        break;
      }

      case 'progress_update_tool_action_completed': {
        const resp = event.data?.result;
        const toolCall = resp?.tool_call;
        if (!toolCall) break;

        if (toolCall.function.name === 'edit_code' && resp.output_data?.file_path) {
          const content = (resp.output_data.new_file_content ?? '') as string;
          upsertProposal(resp.output_data.file_path as string, content);
        }

        if (toolCall.function.name === 'create_file' && resp.output_data?.file_path) {
          const content = (resp.output_data.new_file_content ?? '') as string;
          upsertProposal(resp.output_data.file_path as string, content);
        }

        if (toolCall.function.name === 'create_folder' && resp.output_data?.created && resp.output_data?.folder_path) {
          onCreateFolder?.((resp.output_data.folder_path as string).replace(/^\//,''));
        }
        if (toolCall.function.name === 'delete_folder' && resp.output_data?.deleted && resp.output_data?.folder_path) {
          onDeleteFolder?.((resp.output_data.folder_path as string).replace(/\/$/,''));
        }
        if (toolCall.function.name === 'rename_folder' && resp.output_data?.renamed && resp.output_data?.old_path && resp.output_data?.new_path) {
          onRenameFolder?.(resp.output_data.old_path as string, resp.output_data.new_path as string);
        }
        if (toolCall.function.name === 'rename_file' && resp.output_data?.renamed && resp.output_data?.old_path && resp.output_data?.new_path) {
          onRenameFile?.(resp.output_data.old_path as string, resp.output_data.new_path as string);
        }
        if (toolCall.function.name === 'delete_file' && resp.output_data?.deleted && resp.output_data?.file_path) {
          onDeleteFile?.(resp.output_data.file_path as string);
        }

        if (toolCall.function.name === 'request_code_execution') {
          const someOtherExecExists = runsRef.current[event.task_id]?.actions.some((a) => a.kind === 'exec_request' && a.id !== toolCall.id);
          if (someOtherExecExists) break;
          // If user already resolved this exec request, ignore duplicates that would re-open the prompt
          const existing = runsRef.current[event.task_id]?.actions.find((a) => a.id === toolCall.id && a.kind === 'exec_request');
          if (existing && existing.status !== 'running') break;

          const resumeToken = resp.output_data?.resume_token as string | undefined;
          if (resumeToken) {
            // Ensure we have a starting exec_request action; if not, create one
            updateAction(event.task_id, toolCall.id, (prev) => {
              const base: Action = (prev as Action) ?? {
                id: toolCall.id,
                kind: 'exec_request',
                status: 'running',
                timestamp: event.timestamp,
              } as Action;
              const responseOnReject = (base as unknown as { responseOnReject?: string }).responseOnReject;
              return {
                ...base,
                kind: 'exec_request',
                status: base.status === 'running' ? 'running' : base.status, // don't force back to running if user already decided
                timestamp: event.timestamp,
                ...(responseOnReject ? { responseOnReject } : {}),
                resumeToken,
              } as Action;
            });
          }
        } else {
          updateAction(event.task_id, toolCall.id, (prev: Action | undefined) => ({
            ...(prev ?? {
              id: toolCall.id,
              kind: 'tool_completed',
              toolName: toolCall.function.name,
              timestamp: event.timestamp,
              status: 'done',
            }),
            kind: 'tool_completed',
            status: 'done',
            toolName: toolCall.function.name,
            result: resp.output_data,
            timestamp: event.timestamp,
            // preserve any streamed logs accumulated during the run
            ...(prev && (prev as unknown as { logs?: string }).logs ? { logs: (prev as unknown as { logs?: string }).logs } : {}),
          }) as Action);

          if (toolCall.function.name === 'think' && typeof resp.output_data === 'string') {
            const thoughtAction: Action = {
              id: `thought_${Date.now()}`,
              kind: 'assistant_thought',
              status: 'done',
              content: resp.output_data,
              timestamp: event.timestamp,
            } as Action;
            addAction(event.task_id, thoughtAction);
          }

          // Auto-resync project from sandbox_run file snapshot
          if (toolCall.function.name === 'sandbox_run') {
            // Surface preview URLs if included in output
            const prevUrl = resp.output_data?.preview_url as string | undefined;
            if (prevUrl) onSetPreviewUrl?.(prevUrl);

            if (!resp.output_data?.fs) break;
            try {
              const fs = resp.output_data.fs as {
                created?: string[];
                updated?: string[];
                deleted?: string[];
                data?: Array<{ path: string; encoding?: string; content?: string }>;
              };

              const created = new Set((fs.created || []).map(p => (p || '').replace(/^\.\//, '')));

              // Ensure all created files are present in the project tree immediately
              created.forEach((p) => {
                if (!p) return;
                onUpsertFile?.(p, '');
              });

              // Decode provided file contents and surface as proposals
              const dec = new TextDecoder('utf-8');
              (fs.data || []).forEach((entry) => {
                const p = (entry.path || '').replace(/^\.\//, '');
                if (!p) return;
                if (entry.encoding === 'base64' && typeof entry.content === 'string') {
                  try {
                    const bin = Uint8Array.from(atob(entry.content), c => c.charCodeAt(0));
                    const text = dec.decode(bin);
                    // Keep content as proposal; the actual project content is empty until user accepts
                    upsertProposal(p, text);
                  } catch {
                    // ignore decode errors
                  }
                }
              });

              // For deleted files, we do not remove immediately; this can be shown as a timeline entry
              if ((fs.deleted || []).length > 0) {
                const deletionNotice: Action = {
                  id: `deleted_${Date.now()}`,
                  kind: 'tool_completed',
                  status: 'done',
                  toolName: 'sandbox_run_fs_deleted',
                  result: { deleted: fs.deleted },
                  timestamp: event.timestamp,
                } as Action;
                addAction(event.task_id, deletionNotice);
              }
            } catch {
              // ignore snapshot parse errors
            }
          }

          // Preview URL via sandbox_show_preview
          if (toolCall.function.name === 'sandbox_show_preview') {
            const info = resp.output_data as { url?: string } | undefined;
            if (info?.url) onSetPreviewUrl?.(info.url);
          }
        }
        break;
      }

      case 'progress_update_tool_action_failed': {
        const toolCall = event.data?.args?.[0];
        if (!toolCall) break;

        updateAction(event.task_id, toolCall.id, (prev) => ({
          ...(prev ?? {
            id: toolCall.id,
            kind: 'tool_failed',
            toolName: toolCall.function.name,
            timestamp: event.timestamp,
          }),
          kind: 'tool_failed',
          status: 'failed',
          error: event.error,
        }) as Action);
        break;
      }

      case 'agent_output': {
        const content: string = event.data;
        const answerAction: Action = {
          id: `answer_${Date.now()}`,
          kind: 'final_answer',
          status: 'done',
          content,
          timestamp: event.timestamp,
        } as Action;
        addAction(event.task_id, answerAction);
        setRunStatus(event.task_id, 'done');
        // Clear any lingering running actions (e.g., exec_request) so UI hides modals/spinners
        const run = runsRef.current[event.task_id];
        if (run) {
          for (const a of run.actions) {
            if (a.status === 'running') {
              updateAction(event.task_id, a.id, (prev) => ({ ...(prev as Action), status: 'done' }) as Action);
            }
          }
          // Ensure background thread/project UI clears loading
          if (run.projectId) {
            setLoadingForProject?.(run.projectId, false);
            setCurrentTaskIdForProject?.(run.projectId, null);
          }
        }
        // Also clear active UI if this run is currently active
        if (!isActiveRun || isActiveRun(event.task_id)) {
          setLoading(false);
          setCurrentTaskId(null);
        }
        break;
      }

      case 'run_cancelled': {
        const notice: Action = {
          id: `cancel_${Date.now()}`,
          kind: 'system_notice',
          status: 'done',
          message: 'Task was cancelled.',
          timestamp: event.timestamp,
        } as Action;
        addAction(event.task_id, notice);
        setRunStatus(event.task_id, 'cancelled');
        // Clear any lingering running actions so UI hides loaders
        {
          const run = runsRef.current[event.task_id];
          if (run) {
            for (const a of run.actions) {
              if (a.status === 'running') {
                updateAction(event.task_id, a.id, (prev) => ({ ...(prev as Action), status: 'done' }) as Action);
              }
            }
            if (run.projectId) {
              setLoadingForProject?.(run.projectId, false);
              setCurrentTaskIdForProject?.(run.projectId, null);
            }
          }
        }
        if (!isActiveRun || isActiveRun(event.task_id)) {
          setLoading(false);
          setCancelling(false);
          setCurrentTaskId(null);
        }
        break;
      }

      case 'run_failed': {
        const err = (event.error ? String(event.error) : 'Failed to get agent response.');
        const notice: Action = {
          id: `fail_${Date.now()}`,
          kind: 'system_notice',
          status: 'done',
          message: `Failed to get agent response: ${err}`,
          timestamp: event.timestamp,
        } as Action;
        addAction(event.task_id, notice);
        setRunStatus(event.task_id, 'failed');
        // Mark any running actions as failed to avoid stale spinners
        {
          const run = runsRef.current[event.task_id];
          if (run) {
            for (const a of run.actions) {
              if (a.status === 'running') {
                updateAction(event.task_id, a.id, (prev) => ({ ...(prev as Action), status: 'failed' }) as Action);
              }
            }
            if (run.projectId) {
              setLoadingForProject?.(run.projectId, false);
              setCurrentTaskIdForProject?.(run.projectId, null);
            }
          }
        }
        if (!isActiveRun || isActiveRun(event.task_id)) {
          setLoading(false);
          setCancelling(false);
          setCurrentTaskId(null);
        }
        break;
      }

      default:
        // ignore
        break;
    }
  }, [
    setLoading,
    setCurrentTaskId,
    setCancelling,
    setLoadingForProject,
    setCurrentTaskIdForProject,
    upsertProposal,
    onCreateFolder,
    onDeleteFolder,
    onRenameFolder,
    onRenameFile,
    onDeleteFile,
    onUpsertFile,
    onSetPreviewUrl,
    appendActionLog,
    addAction,
    updateAction,
    isActiveRun,
    setRunStatus,
    // Deliberately exclude runs; use runsRef to avoid stale closures
  ]);

  return handleEvent;
};


