'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/stores/uiStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { TopNav } from '@/components/temo/top-nav';
import { LeftNav } from '@/components/temo/left-nav';
import { RightContextPanel } from '@/components/temo/right-panel';
import { ShaderBackground, type ShaderType } from '@/components/kinetic/shader-background';
import { CommandPalette } from '@/components/layout/command-palette';

import { ToolDebugPanel } from '@/components/tools/tool-debug-panel';
import type { NavKey } from '@/types';

const ROUTE_MAP: Record<string, NavKey> = {
  '/': 'dashboard',
  '/chat': 'chat',
  '/missions': 'missions',
  '/agents': 'agents',
  '/workflows': 'workflows',
  '/tools': 'tools',
  '/settings': 'settings',
  '/validation': 'validation',
  '/knowledge': 'knowledge',
  '/memory': 'memory',
  '/analytics': 'analytics',
  '/notifications': 'notifications',
};

const ROUTE_SHADER: Record<string, ShaderType> = {
  '/': 'core',
  '/chat': 'core',
  '/agents': 'default',
  '/workflows': 'flow',
  '/missions': 'flow',
  '/tools': 'default',
  '/settings': 'default',
  '/validation': 'default',
  '/knowledge': 'default',
  '/memory': 'default',
  '/analytics': 'default',
  '/notifications': 'default',
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeKey = ROUTE_MAP[pathname] ?? 'dashboard';
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const orbState = useVoiceStore((s) => s.orbState);
  const shaderType = ROUTE_SHADER[pathname] ?? 'default';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setCommandOpen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rafId = 0;
    let lastX = 0;
    let lastY = 0;
    const handler = (e: MouseEvent) => {
      lastX = (e.clientX / window.innerWidth - 0.5) * 20;
      lastY = (e.clientY / window.innerHeight - 0.5) * 20;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        container.style.setProperty('--parallax-x', `${lastX}px`);
        container.style.setProperty('--parallax-y', `${lastY}px`);
        rafId = 0;
      });
    };
    window.addEventListener('mousemove', handler);
    return () => {
      window.removeEventListener('mousemove', handler);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative flex h-screen w-full overflow-hidden bg-temo-void">
      {/* ── Zone A/E: Cinematic Background Layers ── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <ShaderBackground type={shaderType} />

        {/* Hexagonal grid */}
        <div className="hex-grid absolute inset-0 opacity-30" />

        {/* Dot grid overlay */}
        <div className="dot-grid absolute inset-0 opacity-20" />

        {/* Ambient glow blobs with parallax */}
        <div
          className="ambient-glow"
          style={{
            top: '5%', left: '15%', width: '500px', height: '500px',
            background: 'radial-gradient(circle, rgba(0,243,255,0.08) 0%, transparent 70%)',
            transform: 'translate(var(--parallax-x, 0), var(--parallax-y, 0))',
            transition: 'transform 0.5s ease-out',
          }}
        />
        <div
          className="ambient-glow"
          style={{
            bottom: '5%', right: '10%', width: '600px', height: '600px',
            background: 'radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)',
            transform: 'translate(calc(-1 * var(--parallax-x, 0)), calc(-1 * var(--parallax-y, 0)))',
            transition: 'transform 0.5s ease-out',
          }}
        />
        <div
          className="ambient-glow"
          style={{
            top: '50%', left: '50%', width: '900px', height: '900px',
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, ${orbState !== 'disconnected' ? 'rgba(0,243,255,0.04)' : 'rgba(82,82,91,0.02)'} 0%, transparent 60%)`,
          }}
        />

        {/* Moving scanline */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute left-0 right-0 h-px"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(0,243,255,0.3), transparent)',
              animation: 'scanline-sweep 8s linear infinite',
            }}
          />
        </div>

        {/* Scanline overlay texture */}
        <div className="scanline-overlay absolute inset-0" />

        {/* Floating particles */}
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div
            key={`particle-${i}`}
            className="absolute h-1 w-1 rounded-full"
            style={{
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 100}%`,
              backgroundColor: i % 3 === 0 ? '#00F3FF' : i % 3 === 1 ? '#8B5CF6' : 'rgba(255,255,255,0.3)',
              boxShadow: `0 0 4px ${i % 3 === 0 ? '#00F3FF' : '#8B5CF6'}`,
            }}
            animate={{ y: [0, -30, 0], x: [0, 10, 0], opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 6 + i, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 }}
          />
        ))}
      </div>

      {/* ── Top Navigation (Zone A) ── */}
      <TopNav />

      {/* ── Left Navigation ── */}
      <LeftNav />

      {/* ── Main Content Area (Zones B, C, D) ── */}
      <main className="relative z-10 flex-1 overflow-hidden pl-24 pr-4 pt-20" style={{ marginRight: rightSidebarOpen ? '376px' : '16px' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeKey}
            initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -16, filter: 'blur(4px)' }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="h-full overflow-y-auto scrollbar-thin"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── Right Context Panel ── */}
      <RightContextPanel />

      {/* ── Overlays (preserved from existing architecture) ── */}
      <CommandPalette />
      <ToolDebugPanel />
    </div>
  );
}
