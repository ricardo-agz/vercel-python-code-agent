import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Action } from '../types/run';
import { useRuns } from '../context/RunContext';
import { API_BASE } from '../constants';

interface UseChatProps {
  userId: string;
  input: string;
  currentTaskId: string | null;
  cancelling: boolean;
  project: Record<string, string>;
  proposals?: Record<string, string>;
  setInput: (input: string) => void;
  setLoading: (loading: boolean) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  setCancelling: (cancelling: boolean) => void;
  stream: { connect: (runId: string, streamToken: string) => void; resume: (runId: string, resumeToken: string, result: string) => void; disconnect: (runId: string) => void };
  model: string;
}

export const useChat = ({
  userId,
  input,
  currentTaskId,
  cancelling,
  project,
  proposals,
  setInput,
  setLoading,
  setCurrentTaskId,
  setCancelling,
  stream,
  model,
}: UseChatProps) => {
  const { isAuthenticated, openModal } = useAuth();
  const { runs, runOrder, createRun, addAction, updateAction } = useRuns();
  const sendPrompt = useCallback(async () => {
    if (!input.trim()) return;
    if (!isAuthenticated) {
      openModal();
      return;
    }
    setLoading(true);
    setInput('');

    // Build ordered message history with both user and assistant messages from prior runs
    const message_history = runOrder.flatMap((id) => {
      const run = runs[id];
      if (!run) return [] as { role: string; content: string }[];
      const messages: { role: string; content: string }[] = [];
      for (const a of run.actions) {
        if (a.kind === 'user_message') messages.push({ role: 'user', content: (a as Action & { content: string }).content });
        if (a.kind === 'final_answer') messages.push({ role: 'assistant', content: (a as Action & { content: string }).content });
      }
      return messages;
    });

    const res = await fetch(`${API_BASE}/runs`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        user_id : userId,
        query   : input,
        project : (() => {
          const merged: Record<string, string> = { ...project };
          if (proposals) {
            for (const [p, c] of Object.entries(proposals)) merged[p] = c;
          }
          return merged;
        })(),
        message_history,
        model,
      }),
    });

    if (res.ok) {
      const { task_id, stream_token } = await res.json();
      createRun(task_id, input);
      setCurrentTaskId(task_id);

      // store user message action
      const userAction: Action = {
        id: `user_${Date.now()}`,
        kind: 'user_message',
        status: 'done',
        content: input,
        timestamp: new Date().toISOString(),
      } as const;
      addAction(task_id, userAction);

      // Open SSE stream for this task; events are handled globally by useAgentStream → useAgentEvents
      stream.connect(task_id, stream_token);
    } else {
      console.error('enqueue failed');
      setLoading(false);
    }
  }, [input, isAuthenticated, openModal, userId, project, proposals, setInput, setLoading, createRun, addAction, setCurrentTaskId, runs, runOrder, stream, model]);

  const cancelCurrentTask = useCallback(() => {
    if (!currentTaskId || cancelling) return;
    setCancelling(true);
    // Stop the SSE stream first
    stream.disconnect(currentTaskId);
    // Mark any running actions as done to hide loaders
    const run = runs[currentTaskId];
    if (run) {
      for (const a of run.actions) {
        if (a.status === 'running') {
          updateAction(currentTaskId, a.id, (prev) => ({ ...(prev as Action), status: 'done' }) as Action);
        }
      }
    }
    // Add a system notice
    addAction(currentTaskId, {
      id: `cancel_${Date.now()}`,
      kind: 'system_notice',
      status: 'done',
      message: 'Task was cancelled.',
      timestamp: new Date().toISOString(),
    } as Action);
    // Clear UI state
    setCancelling(false);
    setLoading(false);
    setCurrentTaskId(null);
  }, [currentTaskId, cancelling, setCancelling, setLoading, setCurrentTaskId, stream, addAction, runs, updateAction]);

  return {
    sendPrompt,
    cancelCurrentTask,
  };
}; 