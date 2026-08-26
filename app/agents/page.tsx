'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Star, Volume2, MessageSquare, X, Check, Zap, Brain, Mic, Activity,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/temo/app-shell';
import { AgentAvatar, getAgentIcon } from '@/components/crew/agent-avatar';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { voiceManager } from '@/lib/voice/voice-manager';
import { crewManager } from '@/lib/crew/crew-manager';
import type { Agent, AgentStatus, AgentAnimationState } from '@/types';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; dot: string }> = {
  available: { label: 'Available', color: 'text-success', dot: 'bg-success' },
  busy: { label: 'Busy', color: 'text-warning', dot: 'bg-warning' },
  thinking: { label: 'Thinking', color: 'text-secondary', dot: 'bg-secondary' },
  speaking: { label: 'Speaking', color: 'text-primary', dot: 'bg-primary' },
  offline: { label: 'Offline', color: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};

function statusToAnimation(status: AgentStatus): AgentAnimationState {
  if (status === 'available') return 'idle';
  if (status === 'thinking') return 'thinking';
  if (status === 'speaking') return 'speaking';
  if (status === 'offline') return 'offline';
  return 'idle';
}

export default function AgentsPage() {
  const agents = useDashboardStore((s) => s.agents);
  const loadAgents = useDashboardStore((s) => s.loadAgents);
  const [selected, setSelected] = useState<Agent | null>(null);

  // Real agent_registry data, not the static seed array — Agent Management
  // creates/renames/deletes against the same registry via this same store
  // action, so this page reflects those changes on next mount/navigation.
  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display-lg text-headline-md font-bold tracking-tight text-primary-fixed-dim">AI Crew</h1>
            <p className="font-label-caps text-label-caps text-on-surface-variant uppercase">Your team of specialized AI agents</p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary-container/10 px-4 py-2.5 font-label-caps text-label-caps text-primary-fixed transition-all hover:bg-primary-container/20"
          >
            <Plus className="h-4 w-4" />
            New Agent
          </motion.button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} index={i} onClick={() => setSelected(agent)} />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected && <AgentProfileModal agent={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </AppShell>
  );
}

function AgentCard({ agent, index, onClick }: { agent: Agent; index: number; onClick: () => void }) {
  const animationState = statusToAnimation(agent.status);
  const statusConf = STATUS_CONFIG[agent.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      whileHover={{ y: -6 }}
      onClick={onClick}
      className="group relative cursor-pointer overflow-hidden rounded-2xl glass-panel p-5 transition-all"
    >
      <div
        className="absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl opacity-40 transition-opacity group-hover:opacity-60"
        style={{ backgroundColor: `${agent.color}20` }}
      />

      <div className="relative flex items-start gap-4">
        <AgentAvatar
          agentId={agent.id}
          iconName={agent.icon}
          imageUrl={agent.avatarUrl}
          color={agent.color}
          state={animationState}
          size={56}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-headline-md text-lg font-semibold text-on-surface">{agent.name}</h3>
            {agent.isFavorite && <Star className="h-3.5 w-3.5 fill-warning text-warning" />}
          </div>
          <p className="font-label-caps text-xs text-on-surface-variant uppercase">{agent.role}</p>
        </div>
      </div>

      <p className="relative mt-4 line-clamp-2 font-body-base text-sm text-on-surface-variant">{agent.description}</p>

      <div className="relative mt-4 flex flex-wrap gap-1.5">
        {agent.skills.slice(0, 3).map((skill) => (
          <span
            key={skill}
            className="rounded-md border border-primary/10 px-2 py-1 font-label-caps text-[10px] text-on-surface-variant"
          >
            {skill}
          </span>
        ))}
        {agent.skills.length > 3 && (
          <span className="rounded-md px-2 py-1 font-label-caps text-[10px] text-on-surface-variant">
            +{agent.skills.length - 3} more
          </span>
        )}
      </div>

      <div className="relative mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', statusConf.dot, agent.status === 'available' && 'animate-pulse')} />
          <span className={cn('font-label-caps text-xs font-medium', statusConf.color)}>{statusConf.label}</span>
        </div>
        <span className="font-data-point text-[10px] text-on-surface-variant">{agent.currentActivity}</span>
      </div>
    </motion.div>
  );
}

function AgentProfileModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const router = useRouter();
  const setActiveAgent = useVoiceStore((s) => s.setActiveAgent);
  const [isFavorite, setIsFavorite] = useState(agent.isFavorite);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const animationState = statusToAnimation(agent.status);
  const statusConf = STATUS_CONFIG[agent.status];

  const handleVoicePreview = async () => {
    if (isPlayingVoice) {
      voiceManager.interrupt();
      setIsPlayingVoice(false);
      return;
    }
    setIsPlayingVoice(true);
    await voiceManager.speakAsAgent(agent.personality.greeting.replace(/[*#]/g, ''), agent.id);
    setIsPlayingVoice(false);
  };

  const handleChat = () => {
    setActiveAgent(agent.id);
    onClose();
    router.push('/chat');
  };

  const handleFavorite = () => {
    setIsFavorite(!isFavorite);
    crewManager.toggleFavorite(agent.id);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-background/70 backdrop-blur-md" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto scrollbar-thin rounded-2xl glass-panel shadow-2xl"
      >
        {/* Header with gradient backdrop */}
        <div className="relative overflow-hidden rounded-t-2xl p-6">
          <div
            className="absolute inset-0 opacity-20"
            style={{ background: `radial-gradient(circle at 50% 0%, ${agent.color}, transparent 70%)` }}
          />
          <div
            className="absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl"
            style={{ backgroundColor: `${agent.color}20` }}
          />

          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-white/5 hover:text-on-surface"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative flex flex-col items-center gap-4">
            <AgentAvatar
              agentId={agent.id}
              iconName={agent.icon}
              imageUrl={agent.avatarUrl}
              color={agent.color}
              state={animationState}
              size={100}
            />
            <div className="text-center">
              <div className="flex items-center justify-center gap-2">
                <h2 className="font-display-lg text-2xl font-bold text-on-surface">{agent.name}</h2>
                <button onClick={handleFavorite} className="transition-transform hover:scale-110">
                  <Star
                    className={cn('h-4 w-4', isFavorite ? 'fill-warning text-warning' : 'text-on-surface-variant')}
                  />
                </button>
              </div>
              <p className="font-label-caps text-sm" style={{ color: agent.color }}>{agent.role}</p>
              <div className="mt-2 flex items-center justify-center gap-2">
                <span className={cn('h-2 w-2 rounded-full', statusConf.dot, 'animate-pulse')} />
                <span className={cn('font-label-caps text-xs font-medium', statusConf.color)}>{statusConf.label}</span>
                <span className="font-data-point text-xs text-on-surface-variant">· {agent.currentActivity}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleVoicePreview}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2.5 font-label-caps text-sm font-semibold transition-all',
                  isPlayingVoice
                    ? 'bg-destructive/20 text-destructive'
                    : 'border border-primary/10 text-on-surface hover:bg-primary/5'
                )}
              >
                {isPlayingVoice ? <Mic className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                {isPlayingVoice ? 'Stop' : 'Voice Preview'}
              </button>
              <button
                onClick={handleChat}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 font-label-caps text-sm font-semibold text-on-primary-container transition-transform hover:scale-105"
                style={{ backgroundColor: agent.color }}
              >
                <MessageSquare className="h-4 w-4" />
                Chat
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-6 p-6">
          <Section title="Biography" icon={Brain}>
            <p className="font-body-base text-sm leading-relaxed text-on-surface-variant">{agent.personality.bio}</p>
          </Section>

          <Section title="Personality" icon={Star}>
            <div className="flex flex-wrap gap-2">
              {agent.personality.traits.map((trait) => (
                <span
                  key={trait}
                  className="rounded-lg px-3 py-1.5 font-label-caps text-xs font-medium"
                  style={{ backgroundColor: `${agent.color}15`, color: agent.color }}
                >
                  {trait}
                </span>
              ))}
            </div>
            <p className="mt-3 font-body-base text-sm italic text-on-surface-variant">{agent.personality.tone}</p>
          </Section>

          <Section title="Skills" icon={Zap}>
            <div className="flex flex-wrap gap-2">
              {agent.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-md border border-primary/10 bg-white/[0.02] px-2.5 py-1.5 font-label-caps text-xs text-on-surface"
                >
                  {skill}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Capabilities" icon={Activity}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {agent.capabilities.map((cap) => (
                <div key={cap} className="flex items-center gap-2 font-data-point text-xs text-on-surface-variant">
                  <Check className="h-3 w-3" style={{ color: agent.color }} />
                  {cap}
                </div>
              ))}
            </div>
          </Section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Section title="Model" icon={Brain}>
              <p className="font-data-point text-sm font-medium text-on-surface">{agent.model}</p>
            </Section>
            <Section title="Voice" icon={Mic}>
              <div className="space-y-1">
                <p className="font-data-point text-sm font-medium text-on-surface">{agent.voice.voiceName}</p>
                <p className="font-data-point text-xs text-on-surface-variant">
                  {agent.voice.accent} · Rate {agent.voice.rate}x · Pitch {agent.voice.pitch}
                </p>
              </div>
            </Section>
          </div>

          <Section title="Workflow Endpoint" icon={Zap}>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    agent.workflow.workflowStatus === 'ready' && 'bg-success',
                    agent.workflow.workflowStatus === 'connected' && 'bg-primary',
                    agent.workflow.workflowStatus === 'pending' && 'bg-warning',
                    agent.workflow.workflowStatus === 'disabled' && 'bg-muted-foreground'
                  )}
                />
                <span className="font-label-caps text-sm font-medium text-on-surface capitalize">{agent.workflow.workflowStatus}</span>
                <span className={cn('font-label-caps text-xs', agent.workflow.enabled ? 'text-success' : 'text-on-surface-variant')}>
                  {agent.workflow.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <code className="block rounded-lg border border-primary/10 bg-black/40 px-3 py-2 font-data-point text-xs text-on-surface-variant">
                {agent.workflow.workflowEndpoint}
              </code>
            </div>
          </Section>

          <Section title="Memory" icon={Brain}>
            <div className="space-y-2">
              <div className="flex items-center gap-4 font-data-point text-xs text-on-surface-variant">
                <span>{agent.memory.conversationCount} conversations</span>
                <span>·</span>
                <span>Last: {agent.memory.lastInteraction}</span>
              </div>
              <p className="font-body-base text-sm text-on-surface">{agent.memory.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {agent.memory.topics.map((topic) => (
                  <span key={topic} className="rounded-md bg-white/[0.03] px-2 py-1 font-label-caps text-[10px] text-on-surface-variant">
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          </Section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-on-surface-variant" />
        <h3 className="font-label-caps text-sm font-semibold uppercase tracking-wider text-on-surface-variant">{title}</h3>
      </div>
      {children}
    </div>
  );
}
