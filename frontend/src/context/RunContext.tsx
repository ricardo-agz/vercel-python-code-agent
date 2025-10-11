import React from 'react';
import type { Run, Action } from '../types/run';

interface RunContextValue {
  runs: Record<string, Run>;
  runOrder: string[];
  createRun: (runId: string, userPrompt: string, projectId?: string) => void;
  addAction: (runId: string, action: Action) => void;
  updateAction: (runId: string, actionId: string, updater: (prev: Action | undefined) => Action) => void;
  appendActionLog: (runId: string, actionId: string, line: string) => void;
  clearProjectRuns: (projectId: string) => void;
}

const RunContext = React.createContext<RunContextValue | undefined>(undefined);

interface RunState {
  runs: Record<string, Run>;
  order: string[];
}

function runReducer(state: RunState, action: { type: string; payload: unknown }): RunState {
  switch (action.type) {
    case 'create': {
      const { id, prompt, projectId } = action.payload as { id: string; prompt: string; projectId?: string };
      if (state.runs[id]) return state;
      return {
        runs: {
          ...state.runs,
          [id]: { id, userPrompt: prompt, projectId, actions: [] },
        },
        order: [...state.order, id],
      };
    }
    case 'addAction': {
      const { runId, newAction } = action.payload as { runId: string; newAction: Action };
      const existing = state.runs[runId];
      if (!existing) return state;
      return {
        runs: {
          ...state.runs,
          [runId]: { ...existing, actions: [...existing.actions, newAction] },
        },
        order: state.order,
      };
    }
    case 'updateAction': {
      const { runId, actionId, updater } = action.payload as {
        runId: string;
        actionId: string;
        updater: (prev: Action | undefined) => Action;
      };
      const existingRun = state.runs[runId];
      if (!existingRun) return state;
      const idx = existingRun.actions.findIndex(a => a.id === actionId);
      let updatedActions: Action[];
      if (idx === -1) {
        updatedActions = [...existingRun.actions, updater(undefined)];
      } else {
        const updated = updater(existingRun.actions[idx]);
        updatedActions = [...existingRun.actions];
        updatedActions[idx] = updated;
      }
      return {
        runs: { ...state.runs, [runId]: { ...existingRun, actions: updatedActions } },
        order: state.order,
      };
    }
    case 'appendActionLog': {
      const { runId, actionId, line } = action.payload as { runId: string; actionId: string; line: string };
      const existingRun = state.runs[runId];
      if (!existingRun) return state;
      const idx = existingRun.actions.findIndex(a => a.id === actionId);
      if (idx === -1) return state;
      const prev = existingRun.actions[idx] as any;
      const nextLogs: string = (prev.logs as string | undefined) ? `${prev.logs}${line}` : `${line}`;
      const updated = { ...(prev as object), logs: nextLogs } as Action;
      const updatedActions = [...existingRun.actions];
      updatedActions[idx] = updated;
      return { runs: { ...state.runs, [runId]: { ...existingRun, actions: updatedActions } }, order: state.order };
    }
    case 'clearProject': {
      const { projectId } = action.payload as { projectId: string };
      const newRuns: Record<string, Run> = {};
      const newOrder: string[] = [];
      for (const id of state.order) {
        const r = state.runs[id];
        if (!r) continue;
        if (r.projectId !== projectId) {
          newRuns[id] = r;
          newOrder.push(id);
        }
      }
      return { runs: newRuns, order: newOrder };
    }
    default:
      return state;
  }
}

export const RunProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = React.useReducer(runReducer, { runs: {}, order: [] } as RunState);

  const createRun = React.useCallback((runId: string, userPrompt: string, projectId?: string) => {
    dispatch({ type: 'create', payload: { id: runId, prompt: userPrompt, projectId } });
  }, []);

  const addAction = React.useCallback((runId: string, action: Action) => {
    dispatch({ type: 'addAction', payload: { runId, newAction: action } });
  }, []);

  const updateAction = React.useCallback(
    (
      runId: string,
      actionId: string,
      updater: (prev: Action | undefined) => Action,
    ) => {
      dispatch({ type: 'updateAction', payload: { runId, actionId, updater } });
    },
    [],
  );

  const appendActionLog = React.useCallback((runId: string, actionId: string, line: string) => {
    dispatch({ type: 'appendActionLog', payload: { runId, actionId, line } });
  }, []);

  const clearProjectRuns = React.useCallback((projectId: string) => {
    dispatch({ type: 'clearProject', payload: { projectId } });
  }, []);

  const value = React.useMemo<RunContextValue>(() => ({ runs: state.runs, runOrder: state.order, createRun, addAction, updateAction, appendActionLog, clearProjectRuns }), [state, createRun, addAction, updateAction, appendActionLog, clearProjectRuns]);

  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
};

export const useRuns = (): RunContextValue => {
  const ctx = React.useContext(RunContext);
  if (!ctx) throw new Error('useRuns must be used within RunProvider');
  return ctx;
}; 