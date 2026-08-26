'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Sparkles,
  Mic,
  Paperclip,
  Plus,
  Copy,
  Check,
  RotateCcw,
  Trash2,
  Volume2,
  Zap,
  Brain,
  ArrowRight,
  CheckCircle2,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { AppShell } from '@/components/temo/app-shell';
import { InputBar } from '@/components/temo/input-bar';
import { Markdown } from '@/components/markdown';
import { AgentAvatar, getAgentIcon } from '@/components/crew/agent-avatar';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { voiceManager } from '@/lib/voice/voice-manager';
import { getAgentGreeting } from '@/lib/crew/agent-responses';
import { crewCoordinator } from '@/lib/crew/crew-coordinator';
import { ConversationService, type MessageRecord } from '@/lib/ai/conversation-service';
import { orchestrate } from '@/lib/swarm';
import { useAuthStore } from '@/stores/authStore';
import type { AgentAnimationState, TimelineEvent, ActivityFeedItem } from '@/types';
import { ClientTime } from '@/components/temo/client-time';
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

// M1-05: chat conversation persistence. crewCoordinator.currentConversationId
// is an in-memory field with no persistence of its own, and the page always
// started fresh with just the intro greeting — a refresh silently lost the
// conversation even though ConversationService already wrote every message
// to conversations/messages for real (crew-coordinator.ts's persistMessage()).
// The gap was purely the client-side lifecycle: nothing loaded history on
// mount, and nothing remembered which conversation was active across a
// refresh. Scoped to the current tenant so switching tenants in one browser
// (or a shared machine) doesn't resume a different tenant's conversation.
function conversationStorageKey(tenantId: string): string {
  return `temo:activeConversationId:${tenantId}`;
}

function agentAnimationState(agentId: string): AgentAnimationState {
  const store = useVoiceStore.getState();
  if (store.activeAgentId !== agentId) return 'idle';
  if (store.isListening) return 'listening';
  if (store.isThinking) return 'thinking';
  if (store.isSpeaking) return 'speaking';
  return 'idle';
}

export default function ChatPage() {
  const agents = useDashboardStore((s) => s.agents);
  const loadAgents = useDashboardStore((s) => s.loadAgents);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isListening = useVoiceStore((s) => s.isListening);
  const activeAgentId = useVoiceStore((s) => s.activeAgentId);
  const setActiveAgent = useVoiceStore((s) => s.setActiveAgent);

  const currentTimeline = useOrchestrationStore((s) => s.currentTimeline);
  const isRouting = useOrchestrationStore((s) => s.isRouting);
  const setRouting = useOrchestrationStore((s) => s.setRouting);
  const setRoutingInProgress = useOrchestrationStore((s) => s.setRoutingInProgress);
  const clearTimeline = useOrchestrationStore((s) => s.clearTimeline);
  const completeTask = useOrchestrationStore((s) => s.completeTask);
  const addTimelineEvent = useOrchestrationStore((s) => s.addTimelineEvent);
  const addActivity = useOrchestrationStore((s) => s.addActivity);

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
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [simulationMode, setSimulationMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? agents[0];

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    crewCoordinator.init(agents);
  }, [agents]);

  // M1-05: resume the tenant's most recent open conversation on mount
  // instead of always starting fresh. Runs once agents are loaded (needed
  // to resolve each stored message's agentName/color/icon for display) and
  // a tenant is known. hasLoadedConversation guards against re-running when
  // `agents` reference changes after the initial load.
  const hasLoadedConversation = useRef(false);
  useEffect(() => {
    if (hasLoadedConversation.current || agents.length === 0) return;
    const tenantId = useAuthStore.getState().currentTenantId;
    if (!tenantId) return;
    hasLoadedConversation.current = true;

    const toMessage = (row: MessageRecord): Message => {
      const agent = row.agent_id ? agents.find((a) => a.id === row.agent_id) : undefined;
      return {
        id: row.id,
        role: row.role === 'system' ? 'assistant' : row.role,
        content: row.content,
        agentId: row.agent_id ?? undefined,
        agentName: agent?.name,
        agentColor: agent?.color,
        agentIcon: agent?.icon,
        time: new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        confidence: row.confidence ?? undefined,
      };
    };

    (async () => {
      const storageKey = conversationStorageKey(tenantId);
      let conversationId = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;

      if (!conversationId) {
        // No locally-remembered conversation (fresh browser/device) — fall
        // back to the tenant's most recently updated one, if any. RLS
        // (conversations_tenant_select) already scopes this to the caller's
        // own tenant, so no explicit tenant filter is needed here.
        const recent = await ConversationService.getConversations(1);
        conversationId = recent[0]?.id ?? null;
      }
      if (!conversationId) return;

      const rows = await ConversationService.getMessages(conversationId);
      if (rows.length === 0) return; // stale/foreign/deleted id — keep the fresh intro

      crewCoordinator.setConversationId(conversationId);
      if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, conversationId);
      setMessages(rows.map(toMessage));
    })().catch((e) => console.error('[chat] resume conversation failed:', e));
  }, [agents]);

  // Wire callbacks once
  useEffect(() => {
    // Voice reply handler — when voice manager gets a response, add it to chat.
    // The transcript is captured before the voice store resets and passed
    // explicitly to prevent empty or duplicate user messages.
    voiceManager.setReplyHandler((response, transcript) => {
      const trimmed = transcript.trim();
      if (!trimmed || !response) return;

      const agent = agents.find((a) => a.id === useVoiceStore.getState().activeAgentId) ?? agents[0];
      const userMsgId = `v-u-${Date.now()}`;
      const assistantMsgId = `v-a-${Date.now() + 1}`;

      setMessages((m) => {
        // Prevent duplicate user messages with the same transcript
        const last = m[m.length - 1];
        if (last && last.role === 'user' && last.content === trimmed) {
          return m;
        }
        return [
          ...m,
          {
            id: userMsgId,
            role: 'user' as const,
            content: trimmed,
            time: nowTime(),
          },
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
      onTaskComplete: (task) => {
        completeTask(task);
      },
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
    setInput('');

    // Ensure a conversation is active for persistence. A new conversation's
    // id is written to localStorage immediately (M1-05) — not just held in
    // crewCoordinator's in-memory field — so it survives a refresh right
    // after the very first message, not only on subsequent visits.
    if (!crewCoordinator.getConversationId()) {
      const newId = await crewCoordinator.startConversation(text.slice(0, 40), 'temo');
      const tenantId = useAuthStore.getState().currentTenantId;
      if (newId && tenantId && typeof window !== 'undefined') {
        window.localStorage.setItem(conversationStorageKey(tenantId), newId);
      }
    }

    // Clear previous timeline and start routing
    clearTimeline();
    setRoutingInProgress(true);

    // Emit Thinking event to G-Brain
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

    // Add routing message (Temo analyzing)
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

    // Remove routing message and add the specialist's response placeholder
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

    // Run the unified orchestrator — the single entry point for all AI execution
    try {
      const result = await orchestrate(text, {
        announce: true,
        stream: true,
        tenantId: useAuthStore.getState().currentTenantId ?? '00000000-0000-0000-0000-000000000001',
        isSimulation: simulationMode,
        // M3-02: the mission pipeline has no other progress signal until it
        // fully completes (unlike the simple pipeline, which already
        // streams live timeline events) — post an immediate, real
        // acknowledgment message as soon as we know a mission was picked,
        // instead of leaving the user looking at just a typing indicator
        // for however long the mission takes.
        onDecision: (pipeline) => {
          if (pipeline !== 'mission') return;
          setMessages((m) => [
            ...m,
            {
              id: `ack${Date.now()}`,
              role: 'assistant',
              content: "Got it — this needs a full mission, so I'm breaking it down and getting to work. I'll follow up here with the result.",
              agentId: 'temo',
              agentName: 'Temo',
              agentColor: '#00E5FF',
              agentIcon: 'Sparkles',
              time: nowTime(),
            },
          ]);
        },
      });
      const routing = result.routing;
      const response = result.response;

      // Mission pipeline may not return routing info — use Temo as default
      if (!routing) {
        setRoutingInProgress(false);
        // Emit Completed for Temo-only response
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
          m.map((msg) =>
            msg.id === replyId
              ? { ...msg, content: response, streaming: false }
              : msg
          )
        );
        setIsStreaming(false);
        if (!isMuted && response) {
          voiceManager.speak(response);
        }
        useOrchestrationStore.getState().updateAgentStatus('temo', 'available', 'Idle');
        setTimeout(() => clearTimeline(), 4000);
        return;
      }

      const targetAgent = agents.find((a) => a.id === routing.selectedAgentId);

      // Update orchestration store so G-Brain reflects the selected agent
      useOrchestrationStore.getState().setActiveAgent(routing.selectedAgentId);
      useOrchestrationStore.getState().updateAgentStatus('temo', 'available', 'Delegated');
      useOrchestrationStore.getState().updateAgentStatus(routing.selectedAgentId, 'thinking', 'Processing request');

      // Emit Routing event to timeline
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

      // Update routing message destination
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

      // Emit Speaking event
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

      // Finalize the message with the complete response
      setMessages((m) =>
        m.map((msg) =>
          msg.id === replyId
            ? { ...msg, content: response, streaming: false }
            : msg
        )
      );
      setIsStreaming(false);

      if (!isMuted && response) {
        voiceManager.speak(response);
      }

      // Emit Completed event and auto-clear timeline after 4s
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

  const clearChat = () => {
    clearTimeline();
    setRouting(null);
    setActiveAgent('temo');
    setMessages([
      {
        id: 'intro-temo',
        role: 'assistant',
        content: getAgentGreeting('temo'),
        agentId: 'temo',
        agentName: 'Temo',
        agentColor: '#00E5FF',
        agentIcon: 'Sparkles',
        time: nowTime(),
      },
    ]);
  };

  const QUICK_PROMPTS = [
    'I need a landing page',
    'Build a REST API',
    'Create an n8n workflow',
    'Write a marketing strategy',
    'Write a YouTube script',
  ];

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-temo-led">Chat</h1>
            <p className="font-mono text-xs text-temo-titanium">Temo routes your request to the right specialist automatically</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/40 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
              aria-label="Clear chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <div
              className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all"
              style={{
                borderColor: `${activeAgent.color}40`,
                backgroundColor: `${activeAgent.color}10`,
              }}
            >
              <AgentAvatar
                agentId={activeAgent.id}
                iconName={activeAgent.icon}
                imageUrl={activeAgent.avatarUrl}
                color={activeAgent.color}
                state="idle"
                size={28}
              />
              <span className="font-medium">{activeAgent.name}</span>
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin rounded-2xl temo-glass p-4">
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <MessageBubble
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

        {/* Live timeline (shows during routing) */}
        <AnimatePresence>
          {currentTimeline.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <TimelineStrip events={currentTimeline} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => send(p)}
                disabled={isStreaming || isRouting}
                className="rounded-full border border-border/40 bg-white/[0.02] px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-40"
              >
                {p}
              </button>
            ))}
          </div>
          <InputBar
            onSend={send}
            onVoiceToggle={() => {
              // M3-05: this used to redirect to /settings instead of
              // activating voice input — reuse the same VoiceManager
              // start/stop toggle every other voice entry point in the
              // app already uses (components/layout/voice-hud.tsx).
              if (isListening) {
                void voiceManager.stopListening();
              } else {
                void voiceManager.startListening();
              }
            }}
            isStreaming={isStreaming || isRouting}
            placeholder="Tell Temo what you need..."
            simulationMode={simulationMode}
            onToggleSimulation={() => setSimulationMode((v) => !v)}
          />
        </div>
      </div>
    </AppShell>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  agents,
  onSpeak,
  isMuted,
}: {
  message: Message;
  agents: { id: string; name: string; color: string; icon: string; avatarUrl?: string | null }[];
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
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="group flex flex-row-reverse gap-3"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="max-w-[75%] space-y-1 items-end">
          <div className="flex items-center justify-end gap-2">
            <span className="text-[10px] text-muted-foreground">{message.time}</span>
            <span className="text-xs font-medium text-foreground">You</span>
          </div>
          <div className="rounded-2xl bg-primary/10 text-foreground rounded-tr-sm px-4 py-2.5">
            <span className="text-sm leading-relaxed">{message.content}</span>
          </div>
        </div>
      </motion.div>
    );
  }

  const color = message.agentColor ?? '#00E5FF';
  const iconName = message.agentIcon ?? 'Sparkles';
  const animState = agentAnimationState(message.agentId ?? 'temo');
  const bubbleAgent = agents.find((a) => a.id === message.agentId);

  // Routing message — animated handoff from Temo to specialist
  if (message.isRouting) {
    const fromAgent = agents.find((a) => a.id === message.routingFrom);
    const toAgent = agents.find((a) => a.id === message.routingTo);

    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="flex items-center gap-3 py-2"
      >
        {fromAgent && (
          <motion.div
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <AgentAvatar
              agentId={fromAgent.id}
              iconName={fromAgent.icon}
              imageUrl={fromAgent.avatarUrl}
              color={fromAgent.color}
              state="speaking"
              size={36}
            />
          </motion.div>
        )}

        {/* Animated connection line */}
        <div className="relative flex h-px flex-1 items-center">
          <motion.div
            className="h-px flex-1 rounded-full"
            style={{ background: `linear-gradient(90deg, ${fromAgent?.color ?? '#00E5FF'}, ${toAgent?.color ?? '#7B61FF'})` }}
            initial={{ scaleX: 0, originX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute h-2 w-2 rounded-full"
            style={{ backgroundColor: toAgent?.color ?? '#7B61FF', boxShadow: `0 0 8px ${toAgent?.color ?? '#7B61FF'}` }}
            initial={{ left: '0%' }}
            animate={{ left: '100%' }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />
        </div>

        {toAgent ? (
          <motion.div
            initial={{ scale: 0.8, opacity: 0.5 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.4, type: 'spring', stiffness: 200 }}
          >
            <AgentAvatar
              agentId={toAgent.id}
              iconName={toAgent.icon}
              imageUrl={toAgent.avatarUrl}
              color={toAgent.color}
              state="thinking"
              size={36}
            />
          </motion.div>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}

        {message.confidence !== undefined && toAgent && (
          <div className="flex flex-col items-start">
            <span className="text-xs font-medium" style={{ color: toAgent.color }}>
              {toAgent.name} {Math.round(message.confidence * 100)}%
            </span>
            <span className="text-[10px] text-muted-foreground">Routing...</span>
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex gap-3"
    >
      <div className="shrink-0">
        <AgentAvatar
          agentId={message.agentId ?? 'temo'}
          iconName={iconName}
          imageUrl={bubbleAgent?.avatarUrl}
          color={color}
          state={animState}
          size={36}
        />
      </div>
      <div className="max-w-[75%] space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{message.agentName}</span>
          {message.confidence !== undefined && message.confidence > 0 && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {Math.round(message.confidence * 100)}%
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">{message.time}</span>
        </div>
        <div className="rounded-2xl glass text-foreground rounded-tl-sm px-4 py-2.5">
          {message.streaming && !message.content ? <TypingIndicator color={color} /> : <Markdown content={message.content} />}
        </div>

        {!message.streaming && message.content && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <ActionButton icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} onClick={copy} color={color} />
            {!isMuted && (
              <ActionButton icon={Volume2} label="Speak" onClick={() => onSpeak(message.content)} color={color} />
            )}
            <ActionButton icon={RotateCcw} label="Regenerate" onClick={() => {}} color={color} />
          </div>
        )}
      </div>
    </motion.div>
  );
});

// M3-02: a streaming assistant bubble with no content yet previously
// rendered as an empty box — visually indistinguishable from a frozen/
// broken page. This gives the user an immediate, visible acknowledgment
// the instant the bubble is created (0ms — no LLM round trip required),
// which real content then replaces as soon as the first tokens arrive.
function TypingIndicator({ color }: { color: string }) {
  return (
    <div className="flex items-center gap-1 py-0.5" aria-label="Temo is responding">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

const TimelineStrip = memo(function TimelineStrip({ events }: { events: TimelineEvent[] }) {
  const hasActive = events.some((e) => e.status === 'active');
  if (!hasActive) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-temo-cyan/15 bg-temo-cyan/[0.03] px-3 py-1.5">
      <Zap className="h-3 w-3 shrink-0 text-temo-cyan" />
      <div className="flex items-center gap-1 overflow-x-auto">
        {events.map((e, i) => (
          <div key={e.id} className="flex shrink-0 items-center gap-1">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                e.status === 'completed' && 'text-temo-mint/70',
                e.status === 'active' && 'bg-temo-cyan/10 text-temo-cyan',
                e.status === 'pending' && 'text-muted-foreground/50',
                e.status === 'error' && 'text-destructive'
              )}
            >
              {e.status === 'completed' && <CheckCircle2 className="h-2 w-2" />}
              {e.status === 'active' && <Loader2 className="h-2 w-2 animate-spin" />}
              <span>{e.label}</span>
            </motion.div>
            {i < events.length - 1 && <ArrowRight className="h-2 w-2 text-muted-foreground/30" />}
          </div>
        ))}
      </div>
    </div>
  );
});

function ActionButton({
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
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-white/5"
      onMouseEnter={(e) => (e.currentTarget.style.color = color)}
      onMouseLeave={(e) => (e.currentTarget.style.color = '')}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

