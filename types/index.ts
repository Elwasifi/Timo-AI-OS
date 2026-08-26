export type NavKey =
  | 'dashboard'
  | 'chat'
  | 'agents'
  | 'workflows'
  | 'tools'
  | 'settings'
  | 'devtools'
  | 'validation'
  | 'missions'
  | 'knowledge'
  | 'memory'
  | 'analytics'
  | 'notifications';

export interface NavItem {
  key: NavKey;
  label: string;
  icon: string;
  badge?: string;
}

export interface Conversation {
  id: string;
  title: string;
  agent: string;
  agentIcon: string;
  preview: string;
  timestamp: string;
  unread?: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  status: 'running' | 'idle' | 'error' | 'paused';
  lastRun: string;
  steps: number;
  progress: number;
}

export interface ConnectedService {
  id: string;
  name: string;
  icon: string;
  status: 'connected' | 'disconnected' | 'warning';
  category: string;
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  color: 'primary' | 'secondary' | 'success' | 'warning';
}

export interface ActivityItem {
  id: string;
  label: string;
  detail: string;
  time: string;
  type: 'chat' | 'workflow' | 'system' | 'voice';
}

export interface SystemStatus {
  label: string;
  value: string;
  status: 'healthy' | 'warning' | 'error';
  detail: string;
}

export interface Provider {
  id: string;
  name: string;
  model: string;
  status: 'active' | 'idle' | 'error';
  latency: number;
  color: string;
}

export interface SystemEvent {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  time: string;
}

export interface RunningTask {
  id: string;
  name: string;
  progress: number;
  agent: string;
  eta: string;
}

export interface SystemHealth {
  cpu: number;
  memory: number;
  network: number;
  apiCalls: number;
}

export type AgentStatus = 'available' | 'busy' | 'thinking' | 'offline' | 'speaking';

export type AgentAnimationState = 'idle' | 'speaking' | 'thinking' | 'listening' | 'offline';

export interface AgentVoiceConfig {
  voiceName: string;
  rate: number;
  pitch: number;
  lang: string;
  accent: string;
}

export interface AgentWorkflowConfig {
  workflowId: string;
  workflowEndpoint: string;
  workflowStatus: 'ready' | 'connected' | 'disabled' | 'pending';
  enabled: boolean;
}

export interface AgentMemory {
  conversationCount: number;
  lastInteraction: string;
  topics: string[];
  summary: string;
}

export interface AgentPersonality {
  traits: string[];
  tone: string;
  greeting: string;
  bio: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  icon: string;
  /** Real uploaded portrait URL, when set via Agent Management. Falls back to `icon` when null/undefined. */
  avatarUrl?: string | null;
  color: string;
  status: AgentStatus;
  description: string;
  personality: AgentPersonality;
  skills: string[];
  capabilities: string[];
  model: string;
  voice: AgentVoiceConfig;
  workflow: AgentWorkflowConfig;
  memory: AgentMemory;
  isFavorite: boolean;
  currentActivity: string;
  /** Stable organizational role identifier, independent of displayName */
  roleId?: string;
  /** Job title from the registry (aliases `role`) */
  jobTitle?: string;
  /** Hierarchy level metadata from the registry */
  hierarchyLevel?: 'chief' | 'manager' | 'worker';
  /** Who this agent reports to (parentId alias) */
  reportsTo?: string | null;
  /** Hierarchy level: chief (root), manager (department head), worker (future) */
  level?: 'chief' | 'manager' | 'worker';
  /** Parent agent ID in the hierarchy (null for chief/root) */
  parentId?: string | null;
  /** Child agent IDs (empty until workers are created) */
  childrenIds?: string[];
  /** Department ID from the registry */
  departmentId?: string | null;
  /** Routing priority — lower = higher priority */
  priority?: number;
  /** Tool IDs this agent can execute */
  tools?: string[];
  /** Whether this agent is active/enabled for routing */
  isActive?: boolean;
}

// ---- Intelligent Routing & Task Orchestration ----

export type TaskCategory =
  | 'code'
  | 'workflow'
  | 'business'
  | 'design'
  | 'content'
  | 'general'
  | 'clarification';

export type TaskStatus =
  | 'received'
  | 'analyzing'
  | 'routing'
  | 'dispatched'
  | 'thinking'
  | 'responding'
  | 'completed'
  | 'failed'
  | 'clarifying';

export interface Intent {
  category: TaskCategory;
  confidence: number;
  matchedKeywords: string[];
  reason: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
}

export interface AgentScore {
  agentId: string;
  agentName: string;
  canHandle: boolean;
  priority: number;
  confidence: number;
  estimatedDuration: number;
  reason: string;
}

export interface RoutingResult {
  taskId: string;
  input: string;
  intent: Intent;
  selectedAgentId: string;
  selectedAgentName: string;
  scores: AgentScore[];
  confidence: number;
  reason: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
  timestamp: number;
}

export interface TimelineEvent {
  id: string;
  taskId: string;
  label: string;
  detail: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  timestamp: number;
  order: number;
}

export interface TaskRecord {
  id: string;
  input: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  reason: string;
  confidence: number;
  status: TaskStatus;
  intent: Intent;
  timeline: TimelineEvent[];
  result: string;
  duration: number;
  createdAt: number;
  completedAt: number | null;
  execution: TaskExecution;
}

export interface TaskExecution {
  taskId: string;
  agentId: string;
  workflowId: string;
  workflowEndpoint: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface ActivityFeedItem {
  id: string;
  type: 'routing' | 'voice' | 'task' | 'error' | 'notification' | 'system';
  title: string;
  detail: string;
  agentId?: string;
  agentColor?: string;
  timestamp: number;
}

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'disconnected';

export type VoiceLanguage = 'en-US' | 'en-GB' | 'es-ES' | 'fr-FR' | 'de-DE' | 'ja-JP' | 'ar-SA' | 'ar-EG' | 'zh-CN';

export interface VoiceSettings {
  selectedVoice: string;
  speed: number;
  pitch: number;
  language: VoiceLanguage;
  volume: number;
  wakeWordEnabled: boolean;
  pushToTalk: boolean;
  autoTranscribe: boolean;
}

export interface VoiceState {
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing: boolean;
  isThinking: boolean;
  isConnected: boolean;
  isMuted: boolean;
  transcript: string;
  volume: number;
  orbState: OrbState;
  settings: VoiceSettings;
}

// ---- Gemini Live API abstraction (interfaces only, mock implementation) ----

export interface GeminiLiveConfig {
  apiKey?: string;
  model: string;
  voice?: string;
  language: VoiceLanguage;
  systemInstruction?: string;
}

export interface GeminiLiveEvent {
  type: 'transcript' | 'audio' | 'tool_call' | 'turn_complete' | 'error' | 'interrupted';
  data?: unknown;
}

export type GeminiLiveEventHandler = (event: GeminiLiveEvent) => void;

export interface IVoiceService {
  connect(config?: Partial<GeminiLiveConfig>): Promise<boolean>;
  disconnect(): Promise<void>;
  startSession(): Promise<string>;
  endSession(sessionId: string): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendAudio(audio: ArrayBuffer): Promise<void>;
  receiveAudio(): Promise<ArrayBuffer>;
  receiveTranscript(): Promise<string>;
  interrupt(): Promise<void>;
  resume(): Promise<void>;
  on(handler: GeminiLiveEventHandler): () => void;
  isConnected(): boolean;
}
