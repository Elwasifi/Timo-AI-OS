import { create } from 'zustand';
import { useDashboardStore } from '@/stores/dashboardStore';
import type {
  TaskRecord,
  TimelineEvent,
  ActivityFeedItem,
  RoutingResult,
  Agent,
} from '@/types';

interface OrchestrationState {
  // Live routing state
  currentRouting: RoutingResult | null;
  isRouting: boolean;
  activeAgentId: string;
  previousAgentId: string | null;
  // Active worker ID for Manager → Worker delegation (Level 3A pilot)
  activeWorkerId: string | null;

  // Task queue & history
  taskQueue: TaskRecord[];
  completedTasks: TaskRecord[];
  taskHistory: TaskRecord[];

  // Timeline for current task
  currentTimeline: TimelineEvent[];

  // Activity feed
  activityFeed: ActivityFeedItem[];

  // Actions
  setRouting: (r: RoutingResult | null) => void;
  setRoutingInProgress: (v: boolean) => void;
  setActiveAgent: (id: string) => void;
  addTimelineEvent: (e: TimelineEvent) => void;
  clearTimeline: () => void;
  addTask: (t: TaskRecord) => void;
  updateTask: (id: string, patch: Partial<TaskRecord>) => void;
  completeTask: (t: TaskRecord) => void;
  addActivity: (item: Omit<ActivityFeedItem, 'id' | 'timestamp'>) => void;
  updateAgentStatus: (agentId: string, status: Agent['status'], activity?: string) => void;
  setActiveWorker: (id: string | null) => void;
  clearActiveExecution: () => void;
}

export const useOrchestrationStore = create<OrchestrationState>((set, get) => ({
  currentRouting: null,
  isRouting: false,
  activeAgentId: 'temo',
  previousAgentId: null,
  activeWorkerId: null,
  taskQueue: [],
  completedTasks: [],
  taskHistory: [],
  currentTimeline: [],
  activityFeed: [
    { id: 'af-init', type: 'system', title: 'Crew online', detail: 'All 6 agents initialized and ready', timestamp: 0 },
  ],

  setRouting: (r) => set({ currentRouting: r }),

  setRoutingInProgress: (v) => set({ isRouting: v }),

  setActiveAgent: (id) =>
    set((s) => ({
      previousAgentId: s.activeAgentId,
      activeAgentId: id,
    })),

  addTimelineEvent: (e) =>
    set((s) => ({
      currentTimeline: [...s.currentTimeline, e],
    })),

  clearTimeline: () => set({ currentTimeline: [] }),

  addTask: (t) =>
    set((s) => ({
      taskQueue: [...s.taskQueue, t],
    })),

  updateTask: (id, patch) =>
    set((s) => ({
      taskQueue: s.taskQueue.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  completeTask: (t) =>
    set((s) => ({
      taskQueue: s.taskQueue.filter((q) => q.id !== t.id),
      completedTasks: [t, ...s.completedTasks].slice(0, 20),
      taskHistory: [t, ...s.taskHistory].slice(0, 50),
    })),

  addActivity: (item) =>
    set((s) => ({
      activityFeed: [
        { ...item, id: `af-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now() },
        ...s.activityFeed,
      ].slice(0, 30),
    })),

  updateAgentStatus: (agentId, status, activity) => {
    useDashboardStore.getState().updateAgentStatus(agentId, status, activity);
  },

  setActiveWorker: (id) => set({ activeWorkerId: id }),

  clearActiveExecution: () =>
    set((s) => {
      useDashboardStore.getState().updateAgentStatus(s.activeAgentId, 'available', 'Idle');
      if (s.activeWorkerId) {
        useDashboardStore.getState().updateAgentStatus(s.activeWorkerId, 'available', 'Idle');
      }
      return {
        activeAgentId: 'temo',
        activeWorkerId: null,
        isRouting: false,
      };
    }),
}));
