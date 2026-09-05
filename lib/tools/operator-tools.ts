// Internal Operator Mode tools — M1-09 (docs/BACKLOG-M1.md), per
// docs/GOVERNANCE.md Section 4. These are capabilities TEMO uses on Amro's
// own behalf (creating/modifying real external infrastructure), never on a
// client tenant's. Kept in their own file, own registry category
// ('operator'), and own naming convention (`operator.*` tool ids) so it's
// structurally obvious — to a human auditing this codebase, and to
// anything scanning the tool registry — which capabilities are
// operator-only versus tenant-facing.
//
// The actual isolation is NOT "this file exists" or "no client agent is
// configured to call this" — it's assertInternalTenant() inside the
// handler itself (lib/governance/internalTenant.ts), which runs before
// anything else and throws for any tenantId other than the internal one,
// including a missing tenantId. That's what makes reuse for a client
// tenant structurally impossible rather than just unintended: even if a
// future change accidentally wired this tool into a client-facing agent's
// permissions, every actual invocation attempt would still be rejected
// here, every time, regardless of how it was reached.
//
// First (and, for this pass, only) capability: create an n8n workflow from
// a natural-language description — the exact example named in the ticket.
// Reuses the real n8n integration (services/n8n) rather than duplicating
// it; the only new logic is drafting a minimal, safe node graph from the
// description via a single AI call.

import type { ToolDefinition, ToolHandler } from './types';
import { assertInternalTenant } from '@/lib/governance/internalTenant';
import { n8n, type N8nNode } from '@/services/n8n';
import { chatWithFallback } from '@/lib/ai/ai-provider';

const operatorCreateWorkflowTool: ToolDefinition = {
  id: 'operator.n8n.createWorkflowFromDescription',
  name: 'Create n8n Workflow From Description',
  description: 'Internal operator capability: drafts and creates a real n8n workflow from a plain-language description. Restricted to the internal operator tenant.',
  category: 'operator',
  permissions: ['n8n'],
  requiredParams: [
    { name: 'workflowName', type: 'string', description: 'Name for the new workflow', required: true },
    { name: 'description', type: 'string', description: 'Plain-language description of what the workflow should do', required: true },
  ],
  optionalParams: [],
  responseSchema: { type: 'object', fields: { workflowId: 'string', workflowName: 'string', nodeCount: 'number' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['temo'],
  requiresApproval: true,
  riskLevel: 'reversible',
  blastRadius: 'external',
};

// Deliberately constrained to a small, safe node vocabulary for this first
// pass — no HTTP Request / credential-requiring node types, so a drafted
// workflow can never accidentally need (or fail on) a secret it doesn't
// have. Expanding this vocabulary is a natural follow-up once the pattern
// is proven, not something to widen speculatively now.
const ALLOWED_NODE_TYPES = new Set([
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.set',
  'n8n-nodes-base.code',
  'n8n-nodes-base.if',
  'n8n-nodes-base.noOp',
]);

interface DraftedGraph {
  nodes: N8nNode[];
  connections: Record<string, unknown>;
}

async function draftWorkflowGraph(description: string): Promise<DraftedGraph> {
  const systemPrompt = `You design minimal n8n workflow node graphs from a plain-language description.
Only use these node types: ${Array.from(ALLOWED_NODE_TYPES).join(', ')}.
Every workflow must start with exactly one n8n-nodes-base.manualTrigger node.
Respond with ONLY a JSON object (no markdown, no backticks) of this exact shape:
{"nodes":[{"id":"1","name":"...","type":"n8n-nodes-base.manualTrigger","position":[0,0],"parameters":{}}, ...],"connections":{"<source node name>":{"main":[[{"node":"<target node name>","type":"main","index":0}]]}}}
Keep it small — 2 to 4 nodes is enough for almost any description. If the description doesn't clearly map to a safe workflow, still return a valid single-node manualTrigger-only workflow rather than guessing wildly.`;

  const result = await chatWithFallback(
    [{ role: 'user', content: description }],
    { systemPrompt, temperature: 0.2, maxTokens: 800, usageContext: { operation: 'operator_workflow_draft', tenantId: null } },
  );

  const cleaned = result.content.replace(/```json/g, '').replace(/```/g, '').trim();
  let parsed: DraftedGraph;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { nodes: [], connections: {} };
  }

  const validNodes = (parsed.nodes ?? []).filter((n) => n && ALLOWED_NODE_TYPES.has(n.type));
  if (validNodes.length === 0 || !validNodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger')) {
    // Safe fallback — never fail the whole capability over a malformed AI
    // response; a bare trigger node is a valid, harmless starting point
    // Amro can build on inside the n8n editor.
    return {
      nodes: [{ id: '1', name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
      connections: {},
    };
  }
  return { nodes: validNodes, connections: parsed.connections ?? {} };
}

const operatorCreateWorkflowHandler: ToolHandler = async (args, context) => {
  assertInternalTenant(context.tenantId);

  const workflowName = args.workflowName as string;
  const description = args.description as string;

  const graph = await draftWorkflowGraph(description);
  const workflow = await n8n.workflows.create({ name: workflowName, nodes: graph.nodes, connections: graph.connections });

  return { workflowId: workflow.id, workflowName: workflow.name, nodeCount: graph.nodes.length };
};

export function registerOperatorTools(register: (def: ToolDefinition, handler: ToolHandler) => void): void {
  register(operatorCreateWorkflowTool, operatorCreateWorkflowHandler);
}
