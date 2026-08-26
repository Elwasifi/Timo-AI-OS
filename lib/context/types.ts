// Context Manager — shared types and interfaces.
// This layer sits between the user request and every AI agent, ensuring
// Memory, Tools, and RAG are consulted before the LLM generates a response.

import type { MemoryRecord, SearchResult, EpisodicEvent, RAGContext } from '@/lib/memory/types';
import type { ToolDefinition, ToolResultEnvelope } from '@/lib/tools/types';
import type { ChainResult } from '@/lib/tools/chain';
import type { Intent } from '@/types';

import type { ChatMessage } from '@/lib/ai/conversation-service';

// ---- Reasoning Priority (deterministic) ----

export const ReasoningPriority = {
  MEMORY: 1,    // If the answer exists in Memory, use it — never hallucinate
  TOOL: 2,      // If a Tool can answer, execute it — never guess
  RAG: 3,      // If Memory is partial, retrieve additional context
  LLM: 4,      // The LLM is the LAST step, not the first
} as const;

export type ReasoningPriorityLevel = typeof ReasoningPriority[keyof typeof ReasoningPriority];

// ---- Decision Flags ----

export interface ContextDecisions {
  needMemory: boolean;
  needSemanticSearch: boolean;
  needEpisodicMemory: boolean;
  needTimeline: boolean;
  needTool: boolean;
  needN8n: boolean;
  needGitHub: boolean;
  needWebSearch: boolean;
  needWorkflow: boolean;
  needMultipleTools: boolean;
  needNothing: boolean;
}

// ---- Tool Execution Record ----

export interface ToolExecutionRecord {
  toolId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: ToolResultEnvelope | ChainResult;
  success: boolean;
  durationMs: number;
  error?: string;
}

// ---- Reasoning Step (for timeline) ----

export interface ReasoningStep {
  id: string;
  label: string;
  detail: string;
  status: 'pending' | 'active' | 'completed' | 'error' | 'skipped';
  priority: ReasoningPriorityLevel;
  timestamp: number;
  durationMs?: number;
}

// ---- Assembled Context (what every agent receives) ----

export interface AssembledContext {
  // Original user input
  userInput: string;

  // Detected intent
  intent: Intent;

  // Memory results
  memories: SearchResult[];
  memoryConfidence: number;
  memoryUsed: boolean;

  // Episodic / timeline
  timelineEvents: EpisodicEvent[];
  timelineUsed: boolean;

  // RAG
  ragContext: RAGContext | null;
  ragUsed: boolean;

  // Tool results
  toolExecutions: ToolExecutionRecord[];
  toolsUsed: boolean;

  // Workflow results (subset of tools, surfaced for clarity)
  workflowUsed: boolean;

  // Knowledge graph relations
  knowledgeGraphRelations: string[];

  // Conversation history (recent messages for multi-turn context)
  conversationHistory: ChatMessage[];

  // System state
  systemState: {
    activeAgent: string;
    conversationId: string | null;
    agentCount: number;
  };

  // The final unified prompt built from all the above
  unifiedPrompt: string;

  // Metadata for developer panel (never shown in normal chat)
  metadata: ContextMetadata;
}

// ---- Metadata (developer panel only) ----

export interface ContextMetadata {
  intent: string;
  memorySearch: boolean;
  retrievedMemories: number;
  memoryClassification: string | null;
  memoryMatchScore: number;
  memoryDecisionReason: string | null;
  toolDecisionReason: string | null;
  llmSkipReason: string | null;
  toolsSelected: string[];
  toolsExecuted: string[];
  toolResults: number;
  workflowSelected: boolean;
  ragDocuments: number;
  promptSize: number;
  reasoningTimeline: ReasoningStep[];
  confidenceScore: number;
  finalAgent: string;
  reasoningPath: string;
  source: 'memory' | 'tool' | 'rag' | 'llm' | 'hybrid';
}

// ---- Context Manager Result (returned to coordinator) ----

export interface ContextManagerResult {
  context: AssembledContext;
  decisions: ContextDecisions;
  // If Memory confidence is high enough, this is the direct answer
  directAnswer: string | null;
  // If a tool produced the complete answer, this is it
  toolAnswer: string | null;
  // Whether the LLM should be called at all
  shouldCallLLM: boolean;
}

// ---- Memory Classification (deterministic, no LLM) ----

export interface MemoryClassification {
  type: 'short_term' | 'long_term' | 'episodic' | 'semantic';
  category: 'preference' | 'project' | 'general';
  label: string;
  confirmationMessage: string;
  tags: string[];
  importance: 'critical' | 'high' | 'medium' | 'low' | 'temporary';
}

// ---- Intent Detection (enriched beyond routing intent) ----

export interface DetectedIntent {
  routingIntent: Intent;
  // Does the user ask about something that might be in Memory?
  asksAboutMemory: boolean;
  // Does the user ask to list/show/run something that a tool can provide?
  asksForToolAction: boolean;
  // Specific tool category hints
  toolCategoryHint: 'n8n' | 'github' | 'files' | 'web' | 'memory' | 'none';
  // Does the user ask about past events / history?
  asksAboutTimeline: boolean;
  // Does the user ask to remember something?
  asksToRemember: boolean;
  // Confidence in the detection
  confidence: number;
}
