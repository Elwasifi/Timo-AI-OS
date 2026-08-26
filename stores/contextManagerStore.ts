// Context Manager Store — holds the latest context manager result for the
// developer panel. The developer panel reads from this store to show the
// reasoning timeline, retrieved memories, tool executions, etc.

import { create } from 'zustand';
import type { ContextManagerResult, ReasoningStep } from '@/lib/context/types';

interface ContextManagerState {
  lastResult: ContextManagerResult | null;
  reasoningSteps: ReasoningStep[];
  isRunning: boolean;

  setResult: (result: ContextManagerResult) => void;
  setRunning: (running: boolean) => void;
  clear: () => void;
}

export const useContextManagerStore = create<ContextManagerState>((set) => ({
  lastResult: null,
  reasoningSteps: [],
  isRunning: false,

  setResult: (result) =>
    set({
      lastResult: result,
      reasoningSteps: result.context.metadata.reasoningTimeline,
      isRunning: false,
    }),

  setRunning: (running) => set({ isRunning: running }),

  clear: () => set({ lastResult: null, reasoningSteps: [], isRunning: false }),
}));
