'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  MessageSquare,
  Bot,
  Workflow,
  Wrench,
  Settings,
  Search,
  CornerDownLeft,
  Mic,
  Zap,
  Sparkles,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { voiceManager } from '@/lib/voice/voice-manager';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  action: () => void;
  keywords: string;
}

export function CommandPalette() {
  const open = useUIStore((s) => s.commandOpen);
  const setOpen = useUIStore((s) => s.setCommandOpen);
  const router = useRouter();
  const agents = useDashboardStore((s) => s.agents);
  const workflows = useDashboardStore((s) => s.workflows);
  const setRightSidebarOpen = useUIStore((s) => s.setRightSidebarOpen);
  const setVoiceDockOpen = useUIStore((s) => s.setVoiceDockOpen);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<CommandItem[]>(() => {
    const nav: CommandItem[] = [
      { id: 'nav-dashboard', label: 'Dashboard', group: 'Pages', icon: LayoutDashboard, keywords: 'dashboard home', action: () => go('/') },
      { id: 'nav-chat', label: 'Chat', group: 'Pages', icon: MessageSquare, keywords: 'chat message conversation', action: () => go('/chat') },
      { id: 'nav-agents', label: 'Agents', group: 'Pages', icon: Bot, keywords: 'agents ai specialists', action: () => go('/agents') },
      { id: 'nav-workflows', label: 'Workflows', group: 'Pages', icon: Workflow, keywords: 'workflows automation n8n', action: () => go('/workflows') },
      { id: 'nav-tools', label: 'Tools', group: 'Pages', icon: Wrench, keywords: 'tools capabilities', action: () => go('/tools') },
      { id: 'nav-settings', label: 'Settings', group: 'Pages', icon: Settings, keywords: 'settings config preferences', action: () => go('/settings') },
    ];

    const agentItems: CommandItem[] = agents.map((a) => ({
      id: `agent-${a.id}`,
      label: a.name,
      group: 'Agents',
      icon: iconForAgent(a.icon),
      keywords: `agent ${a.name} ${a.role}`,
      action: () => go('/agents'),
    }));

    const workflowItems: CommandItem[] = workflows.map((w) => ({
      id: `wf-${w.id}`,
      label: w.name,
      group: 'Workflows',
      icon: Workflow,
      keywords: `workflow ${w.name}`,
      action: () => go('/workflows'),
    }));

    const actions: CommandItem[] = [
      { id: 'act-voice', label: 'Start Voice Mode', group: 'Commands', icon: Mic, keywords: 'voice listen speak microphone', action: () => { setOpen(false); void voiceManager.startListening(); } },
      { id: 'act-newchat', label: 'New Chat', group: 'Commands', icon: MessageSquare, keywords: 'new chat start conversation', action: () => go('/chat') },
      { id: 'act-toggle-sidebar', label: 'Toggle Right Panel', group: 'Commands', icon: Zap, keywords: 'sidebar panel toggle', action: () => { setRightSidebarOpen(true); setOpen(false); } },
      { id: 'act-toggle-dock', label: 'Toggle Voice Dock', group: 'Commands', icon: Mic, keywords: 'dock voice toggle', action: () => { setVoiceDockOpen(true); setOpen(false); } },
    ];

    return [...nav, ...agentItems, ...workflowItems, ...actions];

    function go(href: string) {
      setOpen(false);
      router.push(href);
    }
  }, [agents, workflows, router, setOpen, setRightSidebarOpen, setVoiceDockOpen]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q)
    );
  }, [query, commands]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault();
        filtered[activeIndex].action();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, activeIndex, setOpen]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach((c) => {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    });
    return Array.from(map.entries());
  }, [filtered]);

  let flatIndex = 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl glass-strong shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-border/40 px-4">
              <Search className="h-4 w-4 text-primary" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages, agents, tools, commands, workflows..."
                className="flex-1 bg-transparent py-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <kbd className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                ESC
              </kbd>
            </div>

            <div className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2">
              {filtered.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No results for "{query}"
                </div>
              )}
              {grouped.map(([group, items]) => (
                <div key={group} className="mb-2">
                  <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </div>
                  {items.map((item) => {
                    const idx = flatIndex++;
                    const isActive = idx === activeIndex;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={item.action}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                          isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-white/5'
                        )}
                      >
                        <Icon className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-muted-foreground')} />
                        <span className="flex-1 text-left">{item.label}</span>
                        {isActive && <CornerDownLeft className="h-3.5 w-3.5 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function iconForAgent(icon: string): LucideIcon {
  const map: Record<string, LucideIcon> = { Sparkles, Globe, Workflow, Mic, Bot };
  return map[icon] ?? Sparkles;
}
