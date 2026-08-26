import { create } from 'zustand';
import type { SystemEvent, RunningTask, SystemHealth } from '@/types';

interface SystemState {
  events: SystemEvent[];
  tasks: RunningTask[];
  health: SystemHealth;
  addEvent: (e: Omit<SystemEvent, 'id' | 'time'>) => void;
  updateTaskProgress: (id: string, progress: number) => void;
  tickHealth: () => void;
}

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const useSystemStore = create<SystemState>((set) => ({
  events: [
    { id: 'e1', message: 'Gemini Live API handshake successful', type: 'success', time: '09:42' },
    { id: 'e2', message: 'n8n workflow engine registered', type: 'info', time: '09:41' },
    { id: 'e3', message: 'Anthropic latency degraded (188ms)', type: 'warning', time: '09:38' },
    { id: 'e4', message: 'Daily Market Digest workflow started', type: 'info', time: '09:36' },
    { id: 'e5', message: 'Social Sentiment Scan failed at step 5', type: 'error', time: '07:52' },
  ],

  tasks: [
    { id: 't1', name: 'Daily Market Digest', progress: 64, agent: 'Nova', eta: '~2 min' },
    { id: 't2', name: 'Revenue synthesis', progress: 88, agent: 'Temo', eta: '< 1 min' },
    { id: 't3', name: 'Competitor scan', progress: 22, agent: 'Atlas', eta: '~6 min' },
  ],

  health: {
    cpu: 34,
    memory: 58,
    network: 71,
    apiCalls: 1284,
  },

  addEvent: (e) =>
    set((s) => ({
      events: [{ ...e, id: `e${Date.now()}`, time: now() }, ...s.events].slice(0, 20),
    })),

  updateTaskProgress: (id, progress) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, progress } : t)),
    })),

  tickHealth: () =>
    set((s) => ({
      health: {
        cpu: clamp(s.health.cpu + rand(-6, 6)),
        memory: clamp(s.health.memory + rand(-4, 4)),
        network: clamp(s.health.network + rand(-8, 8)),
        apiCalls: s.health.apiCalls + Math.floor(Math.random() * 12),
      },
    })),
}));

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function clamp(n: number) {
  return Math.max(5, Math.min(95, n));
}
