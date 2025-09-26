import { useCallback } from 'react';
import type { AgentEvent } from '../types';
import { useRuns } from '../context/RunContext';
import type { Action } from '../types/run';

interface UseAgentEventsProps {
  setLoading: (loading: boolean) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  setCancelling: (cancelling: boolean) => void;
  upsertProposal: (filePath: string, newContent: string) => void;
  onCreateFolder?: (folderPath: string) => void;
  onDeleteFolder?: (folderPath: string) => void;
  onRenameFolder?: (oldPath: string, newPath: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDeleteFile?: (filePath: string) => void;
}

export const useAgentEvents = ({
  setLoading,
  setCurrentTaskId,
  setCancelling,
  upsertProposal,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onRenameFile,
  onDeleteFile,
}: UseAgentEventsProps) => {
  const { runs, addAction, updateAction } = useRuns();

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.event_type) {
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
          const existing = runs[event.task_id]?.actions.find((a) => a.id === toolCall.id && a.kind === 'exec_request');
          const someOtherExecExists = runs[event.task_id]?.actions.some((a) => a.kind === 'exec_request' && a.id !== toolCall.id);
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
          const someOtherExecExists = runs[event.task_id]?.actions.some((a) => a.kind === 'exec_request' && a.id !== toolCall.id);
          if (someOtherExecExists) break;
          // If user already resolved this exec request, ignore duplicates that would re-open the prompt
          const existing = runs[event.task_id]?.actions.find((a) => a.id === toolCall.id && a.kind === 'exec_request');
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
          updateAction(event.task_id, toolCall.id, (prev) => ({
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
        // Clear any lingering running actions (e.g., exec_request) so UI hides modals/spinners
        const run = runs[event.task_id];
        if (run) {
          for (const a of run.actions) {
            if (a.status === 'running') {
              updateAction(event.task_id, a.id, (prev) => ({ ...(prev as Action), status: 'done' }) as Action);
            }
          }
        }
        setLoading(false);
        setCurrentTaskId(null);
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
        setLoading(false);
        setCancelling(false);
        setCurrentTaskId(null);
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
        setLoading(false);
        setCancelling(false);
        setCurrentTaskId(null);
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
    upsertProposal,
    onCreateFolder,
    onDeleteFolder,
    onRenameFolder,
    onRenameFile,
    onDeleteFile,
    addAction,
    updateAction,
    runs,
  ]);

  return handleEvent;
};


