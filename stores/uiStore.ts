import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  rightSidebarOpen: boolean;
  commandOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleRightSidebar: () => void;
  setRightSidebarOpen: (v: boolean) => void;
  setCommandOpen: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  rightSidebarOpen: true,
  commandOpen: false,
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setRightSidebarOpen: (v) => set({ rightSidebarOpen: v }),
  setCommandOpen: (v) => set({ commandOpen: v }),
}));
