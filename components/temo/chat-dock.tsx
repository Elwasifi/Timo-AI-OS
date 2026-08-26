'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, ChevronDown, ChevronUp, Sparkles, Copy, Check, Volume2, RotateCcw, Zap, ArrowRight, CheckCircle2, Loader2, type LucideIcon } from 'lucide-react';
import { InputBar } from '@/components/temo/input-bar';
import { Markdown } from '@/components/markdown';
import { AgentAvatar } from '@/components/crew/agent-avatar';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { voiceManager } from '@/lib/voice/voice-manager';
import { getAgentGreeting } from '@/lib/crew/agent-responses';
import { crewCoordinator } from '@/lib/crew/crew-coordinator';
import { orchestrate } from '@/lib/swarm';
import { useAuthStore } from '@/stores/authStore';
import type { AgentAnimationState, TimelineEvent } from '@/types';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  agentName?: string;
  agentColor?: string;
  agentIcon?: string;
  time: string;
  streaming?: boolean;
  isRouting?: boolean;
  routingFrom?: string;
  routingTo?: string;
  confidence?: number;
}

function agentAnimationState(agentId: string): AgentAnimationState {
  const store = useVoiceStore.getState();
  if (store.activeAgentId !== agentId) return 'idle';
  if (store.isListening) return 'listening';
  if (store.isThinking) return 'thinking';
  if (store.isSpeaking) return 'speaking';
  return 'idle';
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatDock() {
  const agents = useDashboardStore((s) => s.agents);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const activeAgentId = useVoiceStore((s) => s.activeAgentId);
  const setActiveAgent = useVoiceStore((s) => s.setActiveAgent);
  const isListening = useVoiceStore((s) => s.isListening);

  const currentTimeline = useOrchestrationStore((s) => s.currentTimeline);
  const isRouting = useOrchestrationStore((s) => s.isRouting);
  const setRouting = useOrchestrationStore((s) => s.setRouting);
  const setRoutingInProgress = useOrchestrationStore((s) => s.setRoutingInProgress);
  const clearTimeline = useOrchestrationStore((s) => s.clearTimeline);
  const completeTask = useOrchestrationStore((s) => s.completeTask);
  const addTimelineEvent = useOrchestrationStore((s) => s.addTimelineEvent);
  const addActivity = useOrchestrationStore((s) => s.addActivity);

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'intro',
      role: 'assistant',
      content: getAgentGreeting('temo'),
      agentId: 'temo',
      agentName: 'Temo',
      agentColor: '#00E5FF',
      agentIcon: 'Sparkles',
      time: '',
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [simulationMode, setSimulationMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? agents[0];

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    crewCoordinator.init(agents);
  }, [agents]);

  useEffect(() => {
    voiceManager.setReplyHandler((response, transcript) => {
      const trimmed = transcript.trim();
      if (!trimmed || !response) return;

      const agent = agents.find((a) => a.id === useVoiceStore.getState().activeAgentId) ?? agents[0];
      const userMsgId = `v-u-${Date.now()}`;
      const assistantMsgId = `v-a-${Date.now() + 1}`;

      setMessages((m) => {
        const last = m[m.length - 1];
        if (last && last.role === 'user' && last.content === trimmed) return m;
        return [
          ...m,
          { id: userMsgId, role: 'user' as const, content: trimmed, time: nowTime() },
          {
            id: assistantMsgId,
            role: 'assistant' as const,
            content: response,
            agentId: agent.id,
            agentName: agent.name,
            agentColor: agent.color,
            agentIcon: agent.icon,
            time: nowTime(),
            confidence: 1,
          },
        ];
      });
    });

    crewCoordinator.setCallbacks({
      onTimeline: (taskId, label, detail, status) => {
        addTimelineEvent({
          id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          taskId,
          label,
          detail,
          status: status ?? 'completed',
          timestamp: Date.now(),
          order: useOrchestrationStore.getState().currentTimeline.length,
        });
      },
      onActivity: (item) => addActivity(item),
      onAgentStatus: (agentId, status, activity) => {
        useDashboardStore.setState((s) => ({
          agents: s.agents.map((a) =>
            a.id === agentId ? { ...a, status, currentActivity: activity ?? a.currentActivity } : a
          ),
        }));
      },
      onWorkerActive: (workerId) => {
        useOrchestrationStore.getState().setActiveWorker(workerId);
      },
      onRoutingAnnouncement: (text, _fromId, toId) => {
        useOrchestrationStore.getState().setActiveAgent(toId);
        useVoiceStore.getState().setActiveAgent(toId);
        if (!useVoiceStore.getState().isMuted) {
          voiceManager.speak(text);
        }
      },
      onTaskComplete: (task) => completeTask(task),
      onStreamDelta: (agentId, delta, full) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.streaming && m.role === 'assistant'
              ? { ...m, content: full, agentId: m.agentId || agentId }
              : m
          )
        );
      },
    });
  }, []);

  const send = async (text: string) => {
    if (!text.trim() || isStreaming || isRouting) return;

    const userMsg: Message = {
      id: `u${Date.now()}`,
      role: 'user',
      content: text,
      time: nowTime(),
    };
    setMessages((m) => [...m, userMsg]);

    if (!crewCoordinator.getConversationId()) {
      await crewCoordinator.startConversation(text.slice(0, 40), 'temo');
    }

    clearTimeline();
    setRoutingInProgress(true);

    addTimelineEvent({
      id: `tl-${Date.now()}-think`,
      taskId: `task-${Date.now()}`,
      label: 'Thinking',
      detail: 'Analyzing request',
      status: 'active',
      timestamp: Date.now(),
      order: 0,
    });
    useOrchestrationStore.getState().updateAgentStatus('temo', 'thinking', 'Analyzing request');

    const routingMsgId = `r${Date.now()}`;
    setMessages((m) => [
      ...m,
      {
        id: routingMsgId,
        role: 'assistant',
        content: '',
        agentId: 'temo',
        agentName: 'Temo',
        agentColor: '#00E5FF',
        agentIcon: 'Sparkles',
        time: nowTime(),
        isRouting: true,
        routingFrom: 'temo',
        routingTo: '',
        streaming: true,
      },
    ]);

    const replyId = `a${Date.now()}`;
    setMessages((m) => [
      ...m.filter((msg) => msg.id !== routingMsgId),
      {
        id: replyId,
        role: 'assistant',
        content: '',
        agentId: '',
        agentName: 'Temo',
        agentColor: '#00E5FF',
        agentIcon: 'Sparkles',
        time: nowTime(),
        streaming: true,
        confidence: 0,
      },
    ]);

    setIsStreaming(true);

    try {
      const result = await orchestrate(text, {
        announce: true,
        stream: true,
        tenantId: useAuthStore.getState().currentTenantId ?? '00000000-0000-0000-0000-000000000001',
        isSimulation: simulationMode,
      });
      const routing = result.routing;
      const response = result.response;

      if (!routing) {
        setRoutingInProgress(false);
        addTimelineEvent({
          id: `tl-${Date.now()}-done`,
          taskId: `task-${Date.now()}`,
          label: 'Completed',
          detail: 'Response delivered',
          status: 'completed',
          timestamp: Date.now(),
          order: 1,
        });
        useOrchestrationStore.getState().updateAgentStatus('temo', 'speaking', 'Delivering response');
        setMessages((m) =>
          m.map((msg) => (msg.id === replyId ? { ...msg, content: response, streaming: false } : msg))
        );
        setIsStreaming(false);
        if (!isMuted && response) voiceManager.speak(response);
        useOrchestrationStore.getState().updateAgentStatus('temo', 'available', 'Idle');
        setTimeout(() => clearTimeline(), 4000);
        return;
      }

      const targetAgent = agents.find((a) => a.id === routing.selectedAgentId);

      useOrchestrationStore.getState().setActiveAgent(routing.selectedAgentId);
      useOrchestrationStore.getState().updateAgentStatus('temo', 'available', 'Delegated');
      useOrchestrationStore.getState().updateAgentStatus(routing.selectedAgentId, 'thinking', 'Processing request');

      addTimelineEvent({
        id: `tl-${Date.now()}-route`,
        taskId: `task-${Date.now()}`,
        label: 'Routing',
        detail: `Temo → ${routing.selectedAgentName}`,
        status: 'completed',
        timestamp: Date.now(),
        order: 1,
      });
      addTimelineEvent({
        id: `tl-${Date.now()}-proc`,
        taskId: `task-${Date.now()}`,
        label: 'Processing',
        detail: `${routing.selectedAgentName} working`,
        status: 'active',
        timestamp: Date.now(),
        order: 2,
      });

      setMessages((m) =>
        m.map((msg) =>
          msg.id === replyId
            ? {
                ...msg,
                agentId: routing.selectedAgentId,
                agentName: routing.selectedAgentName,
                agentColor: targetAgent?.color ?? '#00E5FF',
                agentIcon: targetAgent?.icon ?? 'Sparkles',
                confidence: routing.confidence,
              }
            : msg
        )
      );

      setRouting(routing);
      setRoutingInProgress(false);

      addTimelineEvent({
        id: `tl-${Date.now()}-speak`,
        taskId: `task-${Date.now()}`,
        label: 'Speaking',
        detail: 'Delivering response',
        status: 'active',
        timestamp: Date.now(),
        order: 3,
      });
      useOrchestrationStore.getState().updateAgentStatus(routing.selectedAgentId, 'speaking', 'Delivering response');

      setMessages((m) =>
        m.map((msg) => (msg.id === replyId ? { ...msg, content: response, streaming: false } : msg))
      );
      setIsStreaming(false);

      if (!isMuted && response) voiceManager.speak(response);

      addTimelineEvent({
        id: `tl-${Date.now()}-done`,
        taskId: `task-${Date.now()}`,
        label: 'Completed',
        detail: 'Response delivered',
        status: 'completed',
        timestamp: Date.now(),
        order: 4,
      });
      useOrchestrationStore.getState().updateAgentStatus(routing.selectedAgentId, 'available', 'Idle');
      useOrchestrationStore.getState().setActiveAgent('temo');
      setTimeout(() => clearTimeline(), 4000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI request failed';
      setMessages((m) =>
        m.map((msg) =>
          msg.id === replyId
            ? { ...msg, content: `I encountered an issue: ${message}\n\nPlease check your API key configuration in Settings.`, streaming: false }
            : msg
        )
      );
      setIsStreaming(false);
      setRoutingInProgress(false);
    }
  };

  const handleMic = useCallback(() => {
    if (isListening) {
      void voiceManager.stopListening();
    } else {
      void voiceManager.startListening();
    }
  }, [isListening]);

  return (
    <div className="w-full">
      {/* Collapsed toggle button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onClick={() => setIsOpen(true)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-temo-cyan/30 bg-[rgba(8,12,20,0.85)] px-4 backdrop-blur-xl shadow-[0_0_20px_rgba(0,243,255,0.15)] transition-all hover:border-temo-cyan/50 hover:shadow-[0_0_25px_rgba(0,243,255,0.25)]"
            aria-label="Open chat"
          >
            <MessageSquare className="h-5 w-5 text-temo-cyan" />
            <span className="font-sans text-sm font-medium text-temo-led">Open Temo Chat</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Expanded chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex w-full flex-col rounded-2xl border border-temo-cyan/25 bg-[rgba(8,12,20,0.88)] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.5),0_0_20px_rgba(0,243,255,0.08)]"
            style={{ maxHeight: 'calc(100vh - 8rem)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-temo-cyan/15 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-temo-cyan/30">
                  <Sparkles className="h-3.5 w-3.5 text-temo-cyan" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-sans text-sm font-bold text-temo-led">Temo Chat</span>
                  <div
                    className="flex items-center gap-1.5 rounded-full border px-2 py-0.5"
                    style={{ borderColor: `${activeAgent.color}40`, backgroundColor: `${activeAgent.color}10` }}
                  >
                    <AgentAvatar
                      agentId={activeAgent.id}
                      iconName={activeAgent.icon}
                      color={activeAgent.color}
                      state="idle"
                      size={16}
                    />
                    <span className="font-mono text-[10px]" style={{ color: activeAgent.color }}>
                      {activeAgent.name}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-temo-titanium transition-colors hover:text-temo-cyan"
                aria-label="Close chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {messages.map((m) => (
                    <DockMessageBubble
                      key={m.id}
                      message={m}
                      agents={agents}
                      onSpeak={voiceManager.speak.bind(voiceManager)}
                      isMuted={isMuted}
                    />
                  ))}
                </AnimatePresence>
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Timeline strip */}
            <AnimatePresence>
              {currentTimeline.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden px-4"
                >
                  <DockTimelineStrip events={currentTimeline} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input bar with mic */}
            <div className="border-t border-temo-cyan/15 p-3">
              <InputBar
                onSend={send}
                onVoiceToggle={handleMic}
                isStreaming={isStreaming || isRouting}
                placeholder="Tell Temo what you need..."
                simulationMode={simulationMode}
                onToggleSimulation={() => setSimulationMode((v) => !v)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const DockMessageBubble = memo(function DockMessageBubble({
  message,
  agents,
  onSpeak,
  isMuted,
}: {
  message: Message;
  agents: { id: string; name: string; color: string; icon: string }[];
  onSpeak: (text: string) => void;
  isMuted: boolean;
}) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="group flex flex-row-reverse gap-2"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-temo-cyan/15 text-temo-cyan">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="max-w-[80%] space-y-0.5 items-end">
          <div className="rounded-2xl bg-temo-cyan/10 rounded-tr-sm px-3 py-2">
            <span className="text-xs leading-relaxed text-temo-led">{message.content}</span>
          </div>
        </div>
      </motion.div>
    );
  }

  const color = message.agentColor ?? '#00E5FF';
  const iconName = message.agentIcon ?? 'Sparkles';
  const animState = agentAnimationState(message.agentId ?? 'temo');

  if (message.isRouting) {
    const fromAgent = agents.find((a) => a.id === message.routingFrom);
    const toAgent = agents.find((a) => a.id === message.routingTo);

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 py-1"
      >
        {fromAgent && (
          <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
            <AgentAvatar agentId={fromAgent.id} iconName={fromAgent.icon} color={fromAgent.color} state="speaking" size={28} />
          </motion.div>
        )}
        <div className="relative flex h-px flex-1 items-center">
          <motion.div
            className="h-px flex-1 rounded-full"
            style={{ background: `linear-gradient(90deg, ${fromAgent?.color ?? '#00E5FF'}, ${toAgent?.color ?? '#7B61FF'})` }}
            initial={{ scaleX: 0, originX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: toAgent?.color ?? '#7B61FF', boxShadow: `0 0 6px ${toAgent?.color ?? '#7B61FF'}` }}
            initial={{ left: '0%' }}
            animate={{ left: '100%' }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />
        </div>
        {toAgent ? (
          <AgentAvatar agentId={toAgent.id} iconName={toAgent.icon} color={toAgent.color} state="thinking" size={28} />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-temo-titanium" />
        )}
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="group flex gap-2">
      <div className="shrink-0">
        <AgentAvatar agentId={message.agentId ?? 'temo'} iconName={iconName} color={color} state={animState} size={28} />
      </div>
      <div className="max-w-[80%] space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-temo-led">{message.agentName}</span>
          {message.confidence !== undefined && message.confidence > 0 && (
            <span className="rounded-full px-1 py-0.5 text-[8px] font-medium" style={{ backgroundColor: `${color}20`, color }}>
              {Math.round(message.confidence * 100)}%
            </span>
          )}
        </div>
        <div className="rounded-2xl rounded-tl-sm bg-white/[0.03] border border-temo-cyan/10 px-3 py-2">
          <div className="text-xs leading-relaxed text-temo-led">
            <Markdown content={message.content} />
          </div>
        </div>
        {!message.streaming && message.content && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <DockAction icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} onClick={copy} color={color} />
            {!isMuted && <DockAction icon={Volume2} label="Speak" onClick={() => onSpeak(message.content)} color={color} />}
            <DockAction icon={RotateCcw} label="Retry" onClick={() => {}} color={color} />
          </div>
        )}
      </div>
    </motion.div>
  );
});

const DockTimelineStrip = memo(function DockTimelineStrip({ events }: { events: TimelineEvent[] }) {
  const hasActive = events.some((e) => e.status === 'active');
  if (!hasActive) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-temo-cyan/15 bg-temo-cyan/[0.03] px-2.5 py-1.5 mb-2">
      <Zap className="h-3 w-3 shrink-0 text-temo-cyan" />
      <div className="flex items-center gap-1 overflow-x-auto">
        {events.map((e, i) => (
          <div key={e.id} className="flex shrink-0 items-center gap-1">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              className={cn(
                'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide',
                e.status === 'completed' && 'text-temo-mint/70',
                e.status === 'active' && 'bg-temo-cyan/10 text-temo-cyan',
                e.status === 'pending' && 'text-temo-titanium/50',
                e.status === 'error' && 'text-destructive',
              )}
            >
              {e.status === 'completed' && <CheckCircle2 className="h-2 w-2" />}
              {e.status === 'active' && <Loader2 className="h-2 w-2 animate-spin" />}
              <span>{e.label}</span>
            </motion.div>
            {i < events.length - 1 && <ArrowRight className="h-2 w-2 text-temo-titanium/30" />}
          </div>
        ))}
      </div>
    </div>
  );
});

function DockAction({
  icon: Icon,
  label,
  onClick,
  color,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[9px] text-temo-titanium transition-colors hover:bg-white/5"
      onMouseEnter={(e) => (e.currentTarget.style.color = color)}
      onMouseLeave={(e) => (e.currentTarget.style.color = '')}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </button>
  );
}
