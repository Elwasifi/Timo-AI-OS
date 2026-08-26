// Tool Execution Store — tracks live tool executions for the UI timeline
// and the developer debug panel.

import { create } from 'zustand';
import type { ToolExecutionEvent, ToolResultEnvelope } from '@/lib/tools/types';

interface ToolExecutionRecord {
  requestId: string;
  toolId: string;
  agentId: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  events: ToolExecutionEvent[];
  result?: ToolResultEnvelope;
  startedAt: number;
  durationMs?: number;
}

interface ToolStoreState {
  executions: ToolExecutionRecord[];
  recentResults: ToolResultEnvelope[];
  debugPanelOpen: boolean;

  recordEvent: (event: ToolExecutionEvent) => void;
  recordResult: (result: ToolResultEnvelope) => void;
  toggleDebugPanel: () => void;
  clear: () => void;
}

export const useToolStore = create<ToolStoreState>((set) => ({
  executions: [],
  recentResults: [],
  debugPanelOpen: false,

  recordEvent: (event) =>
    set((s) => {
      const existing = s.executions.find((e) => e.requestId === event.requestId);
      if (existing) {
        return {
          executions: s.executions.map((e) =>
            e.requestId === event.requestId
              ? {
                  ...e,
                  events: [...e.events, event],
                  status: event.type === 'success' ? 'success' : event.type === 'error' ? 'error' : event.type === 'cancel' ? 'cancelled' : 'running',
                }
              : e
          ),
        };
      }
      const record: ToolExecutionRecord = {
        requestId: event.requestId,
        toolId: event.toolId,
        agentId: event.agentId,
        status: 'running',
        events: [event],
        startedAt: event.timestamp,
      };
      return { executions: [record, ...s.executions].slice(0, 100) };
    }),

  recordResult: (result) =>
    set((s) => ({
      recentResults: [result, ...s.recentResults].slice(0, 50),
      executions: s.executions.map((e) =>
        e.requestId === result.requestId
          ? { ...e, result, status: result.ok ? 'success' : 'error', durationMs: result.durationMs }
          : e
      ),
    })),

  toggleDebugPanel: () => set((s) => ({ debugPanelOpen: !s.debugPanelOpen })),
  clear: () => set({ executions: [], recentResults: [] }),
}));
