'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, Bell, Settings, Activity } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useSystemStore } from '@/stores/systemStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { VoiceHud } from '@/components/layout/voice-hud';
import { cn } from '@/lib/utils';

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const isDashboard = pathname === '/';
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);
  const health = useSystemStore((s) => s.health);
  const agents = useDashboardStore((s) => s.agents);
  const orbState = useVoiceStore((s) => s.orbState);
  const isSleeping = useVoiceStore((s) => s.isSleeping);
  const [time, setTime] = useState('');

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    update();
    const t = setInterval(update, 10000);
    return () => clearInterval(t);
  }, []);

  const activeAgents = agents.filter((a) => a.status !== 'offline').length;
  const cpuUsage = health.cpu;
  const memUsage = health.memory;

  const missionStatus =
    isSleeping ? 'TEMO SLEEPING' :
    orbState === 'listening' ? 'LISTENING' :
    orbState === 'thinking' ? 'PROCESSING' :
    orbState === 'speaking' ? 'SPEAKING' : 'TEMO ONLINE';

  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex h-16 items-center justify-between border-b border-temo-cyan/20 bg-[rgba(8,12,20,0.6)] px-6 backdrop-blur-md">
      {/* Left: Logo + telemetry */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-temo-cyan/30">
            <span className="material-symbols-outlined text-base text-temo-cyan">auto_awesome</span>
          </div>
          <span className="font-sans text-sm font-bold tracking-tight text-temo-led">TEMO AI OS</span>
        </div>

        {/* Telemetry strip */}
        <div className="hidden items-center gap-4 md:flex">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-temo-cyan" />
            <span className="font-mono text-[11px] text-temo-titanium">CPU {Math.round(cpuUsage)}%</span>
          </div>
          <span className="font-mono text-[11px] text-temo-titanium">MEM {Math.round(memUsage)}%</span>
          <span className="font-mono text-[11px] text-temo-titanium">AGENTS {activeAgents}</span>
          <span className={cn('font-mono text-[11px] font-bold', isSleeping ? 'text-temo-titanium/50' : orbState === 'idle' ? 'text-temo-titanium' : 'text-temo-cyan')}>
            {missionStatus}
          </span>
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <button
          onClick={() => setCommandOpen(true)}
          className="group flex h-9 items-center gap-2 rounded-lg border border-temo-cyan/10 bg-white/[0.02] px-3 transition-all hover:border-temo-cyan/30"
        >
          <Search className="h-4 w-4 text-temo-titanium transition-colors group-hover:text-temo-cyan" />
          <span className="hidden font-mono text-xs text-temo-titanium md:inline">Search...</span>
          <kbd className="hidden rounded border border-temo-cyan/10 px-1 py-0.5 font-mono text-[10px] text-temo-titanium md:inline">⌘K</kbd>
        </button>

        {/* Notifications */}
        <button
          onClick={() => router.push('/notifications')}
          title="Notifications"
          aria-label="Notifications"
          className="relative text-temo-titanium transition-colors hover:text-temo-cyan"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-temo-cyan shadow-[0_0_4px_#00F3FF]" />
        </button>

        {/* Settings */}
        <button
          onClick={() => router.push('/settings')}
          title="Settings"
          aria-label="Settings"
          className="text-temo-titanium transition-colors hover:text-temo-cyan"
        >
          <Settings className="h-5 w-5" />
        </button>

        {/* Time */}
        <span className="hidden font-mono text-[11px] text-temo-titanium lg:inline">{time}</span>

        {/* Voice HUD — compact orb + popover controls (hidden on dashboard where ChatDock has mic) */}
        {!isDashboard && <VoiceHud />}
      </div>
    </header>
  );
}
