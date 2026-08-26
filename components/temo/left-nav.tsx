'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, MessageSquare, Bot, Workflow, Wrench, Settings,
  Brain, BookOpen, BarChart3, Bell, Network, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavItem = { path: string; icon: LucideIcon; label: string };

// Single source of truth for "every real page in the app" — reused by
// Command Deck's Quick Access hub so both surfaces show the identical,
// always-in-sync menu instead of two hand-maintained lists.
export const NAV_ITEMS: NavItem[] = [
  { path: '/', icon: Network, label: 'G-Brain' },
  { path: '/dashboard', icon: LayoutDashboard, label: 'Main Dashboard' },
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/missions', icon: Workflow, label: 'Missions' },
  { path: '/agents', icon: Bot, label: 'Agents' },
  { path: '/workflows', icon: Workflow, label: 'Workflows' },
  { path: '/knowledge', icon: BookOpen, label: 'Knowledge' },
  { path: '/memory', icon: Brain, label: 'Memory' },
  { path: '/tools', icon: Wrench, label: 'Tools' },
  { path: '/analytics', icon: BarChart3, label: 'Analytics' },
  { path: '/notifications', icon: Bell, label: 'Alerts' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export function LeftNav() {
  const pathname = usePathname();
  const [hovered, setHovered] = useState<string | null>(null);
  const isExpanded = hovered !== null;

  return (
    <motion.aside
      animate={{ width: isExpanded ? 240 : 72 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      onMouseEnter={() => setHovered('hover')}
      onMouseLeave={() => setHovered(null)}
      className="fixed left-4 top-20 bottom-4 z-30 flex flex-col overflow-hidden rounded-2xl border border-temo-titanium/20 bg-[rgba(6,20,32,0.4)] backdrop-blur-md"
    >
      <nav className="flex-1 space-y-1 px-2 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200',
                active
                  ? 'bg-temo-cyan/20 text-temo-cyan'
                  : 'text-temo-titanium hover:bg-temo-cyan/10 hover:text-temo-cyan',
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active-bar"
                  className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-temo-cyan shadow-[0_0_8px_#00F3FF]"
                />
              )}
              <Icon className="h-5 w-5 shrink-0" />
              <span className={cn('font-mono text-xs uppercase tracking-wider whitespace-nowrap', !isExpanded && 'opacity-0')}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </motion.aside>
  );
}
