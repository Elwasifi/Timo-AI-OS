// Built-in tool definitions and registration.
// n8n tools wrap the EXISTING n8n service layer — no direct API calls.
// Other tools (google, github, files, web, memory, voice) are registered
// with placeholder handlers that return a clear "not yet configured" message,
// ready to be swapped with real adapters (MCP, OAuth, local Python, etc.)
// without changing agent code.

import type { ToolDefinition, ToolHandler } from './types';
import { toolRegistry } from './registry';
import { n8n } from '@/services/n8n';
import { logger } from '@/lib/utils/logger';
import { memory } from '@/lib/memory/memoryService';

// ---- n8n Tools ----

const n8nListTool: ToolDefinition = {
  id: 'n8n.listWorkflows',
  name: 'List n8n Workflows',
  description: 'List all workflows from the connected n8n instance.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [],
  optionalParams: [],
  responseSchema: { type: 'array', fields: { id: 'string', name: 'string', active: 'boolean' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nListHandler: ToolHandler = async () => {
  return n8n.workflows.list();
};

const n8nCreateTool: ToolDefinition = {
  id: 'n8n.createWorkflow',
  name: 'Create n8n Workflow',
  description: 'Create a new workflow in n8n.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [{ name: 'name', type: 'string', description: 'Workflow name', required: true }],
  optionalParams: [{ name: 'nodes', type: 'array', description: 'Workflow nodes', required: false }, { name: 'connections', type: 'object', description: 'Node connections', required: false }],
  responseSchema: { type: 'object', fields: { id: 'string', name: 'string' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nCreateHandler: ToolHandler = async (args) => {
  return n8n.workflows.create({
    name: args.name as string,
    nodes: (args.nodes as never[]) ?? [],
    connections: (args.connections as Record<string, unknown>) ?? {},
  });
};

const n8nUpdateTool: ToolDefinition = {
  id: 'n8n.updateWorkflow',
  name: 'Update n8n Workflow',
  description: 'Update an existing n8n workflow by ID.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [{ name: 'id', type: 'string', description: 'Workflow ID', required: true }],
  optionalParams: [{ name: 'name', type: 'string', description: 'New name', required: false }, { name: 'nodes', type: 'array', description: 'Updated nodes', required: false }],
  responseSchema: { type: 'object', fields: { id: 'string', name: 'string' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nUpdateHandler: ToolHandler = async (args) => {
  return n8n.workflows.update(args.id as string, {
    name: args.name as string | undefined,
    nodes: args.nodes as never[] | undefined,
  });
};

const n8nDeleteTool: ToolDefinition = {
  id: 'n8n.deleteWorkflow',
  name: 'Delete n8n Workflow',
  description: 'Delete an n8n workflow by ID.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [{ name: 'id', type: 'string', description: 'Workflow ID', required: true }],
  optionalParams: [],
  responseSchema: { type: 'object', fields: { id: 'string', deleted: 'boolean' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['flow', 'temo'],
  requiresApproval: true,
};

const n8nDeleteHandler: ToolHandler = async (args) => {
  return n8n.workflows.delete(args.id as string);
};

const n8nTriggerTool: ToolDefinition = {
  id: 'n8n.triggerWorkflow',
  name: 'Trigger n8n Workflow',
  description: 'Trigger an n8n workflow by ID or name using its webhook URL. Automatically detects trigger type and routes to the correct execution mechanism.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [{ name: 'id', type: 'string', description: 'Workflow ID', required: true }],
  optionalParams: [{ name: 'input', type: 'object', description: 'Input data for the workflow', required: false }],
  responseSchema: { type: 'object', fields: { workflowId: 'string', triggerType: 'string', httpStatus: 'number', latencyMs: 'number' } },
  status: 'active',
  version: '2.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nTriggerHandler: ToolHandler = async (args) => {
  return n8n.executions.trigger(args.id as string, args.input as Record<string, unknown> | undefined);
};

const n8nTriggerByNameTool: ToolDefinition = {
  id: 'n8n.triggerWorkflowByName',
  name: 'Trigger n8n Workflow by Name',
  description: 'Trigger an n8n workflow by its name. Useful when the user says "Execute Workflow X" and X is the workflow name.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [{ name: 'name', type: 'string', description: 'Workflow name', required: true }],
  optionalParams: [{ name: 'input', type: 'object', description: 'Input data for the workflow', required: false }],
  responseSchema: { type: 'object', fields: { workflowId: 'string', triggerType: 'string', httpStatus: 'number' } },
  status: 'active',
  version: '2.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nTriggerByNameHandler: ToolHandler = async (args) => {
  return n8n.executions.triggerByName(args.name as string, args.input as Record<string, unknown> | undefined);
};

const n8nConvertTool: ToolDefinition = {
  id: 'n8n.convertToWebhook',
  name: 'Convert n8n Workflow to Webhook',
  description: 'Duplicate a manual-trigger workflow and replace its trigger with a webhook trigger. Returns the new webhook URL. Preserves all nodes, connections, and credentials.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [{ name: 'id', type: 'string', description: 'Workflow ID to convert', required: true }],
  optionalParams: [],
  responseSchema: { type: 'object', fields: { newWorkflowId: 'string', webhookUrl: 'string' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nConvertHandler: ToolHandler = async (args) => {
  return n8n.workflows.convertToWebhook(args.id as string);
};

const n8nSyncRegistryTool: ToolDefinition = {
  id: 'n8n.syncRegistry',
  name: 'Sync Workflow Registry',
  description: 'Synchronize the workflow metadata registry with the connected n8n instance. Detects trigger types, webhook paths, and activation state for all workflows.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [],
  optionalParams: [],
  responseSchema: { type: 'array', fields: { workflowId: 'string', triggerType: 'string' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nSyncRegistryHandler: ToolHandler = async () => {
  return n8n.workflows.syncRegistry();
};

const n8nActivateTool: ToolDefinition = {
  id: 'n8n.activateWorkflow',
  name: 'Activate n8n Workflow',
  description: 'Activate an n8n workflow by ID.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [{ name: 'id', type: 'string', description: 'Workflow ID', required: true }],
  optionalParams: [],
  responseSchema: { type: 'object', fields: { id: 'string', active: 'boolean' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nActivateHandler: ToolHandler = async (args) => {
  return n8n.workflows.activate(args.id as string);
};

const n8nExportTool: ToolDefinition = {
  id: 'n8n.exportWorkflow',
  name: 'Export n8n Workflow',
  description: 'Export an n8n workflow definition by ID.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [{ name: 'id', type: 'string', description: 'Workflow ID', required: true }],
  optionalParams: [],
  responseSchema: { type: 'object', fields: { id: 'string', name: 'string', nodes: 'array' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nExportHandler: ToolHandler = async (args) => {
  return n8n.workflows.export(args.id as string);
};

const n8nImportTool: ToolDefinition = {
  id: 'n8n.importWorkflow',
  name: 'Import n8n Workflow',
  description: 'Import a workflow definition into n8n.',
  category: 'n8n',
  permissions: ['n8n'],
  requiredParams: [{ name: 'name', type: 'string', description: 'Workflow name', required: true }],
  optionalParams: [{ name: 'nodes', type: 'array', description: 'Workflow nodes', required: false }, { name: 'connections', type: 'object', description: 'Node connections', required: false }],
  responseSchema: { type: 'object', fields: { id: 'string', name: 'string' } },
  status: 'active',
  version: '1.0.0',
  supportedAgents: ['flow', 'temo'],
};

const n8nImportHandler: ToolHandler = async (args) => {
  return n8n.workflows.import({
    name: args.name as string,
    nodes: (args.nodes as never[]) ?? [],
    connections: (args.connections as Record<string, unknown>) ?? {},
  });
};

// ---- Placeholder tools (future adapters) ----

function placeholderHandler(service: string): ToolHandler {
  return async () => {
    logger.n8nWarn(`Tool called for unconfigured service: ${service}`);
    return { message: `${service} adapter not yet configured. This tool is ready for future integration (MCP, OAuth, local runtime).` };
  };
}

const placeholderTools: { def: ToolDefinition }[] = [
  {
    def: {
      id: 'google.gmail.send', name: 'Send Gmail', description: 'Send an email via Gmail.',
      category: 'google', permissions: ['google'],
      requiredParams: [{ name: 'to', type: 'string', description: 'Recipient', required: true }, { name: 'subject', type: 'string', description: 'Email subject', required: true }, { name: 'body', type: 'string', description: 'Email body', required: true }],
      optionalParams: [],
      responseSchema: { type: 'object', fields: { sent: 'boolean' } },
      status: 'beta', version: '0.1.0', supportedAgents: ['echo', 'atlas', 'temo'],
    },
  },
  {
    def: {
      id: 'google.drive.upload', name: 'Upload to Drive', description: 'Upload a file to Google Drive.',
      category: 'google', permissions: ['google'],
      requiredParams: [{ name: 'filename', type: 'string', description: 'File name', required: true }, { name: 'content', type: 'string', description: 'File content', required: true }],
      optionalParams: [{ name: 'folder', type: 'string', description: 'Drive folder', required: false }],
      responseSchema: { type: 'object', fields: { fileId: 'string' } },
      status: 'beta', version: '0.1.0', supportedAgents: ['atlas', 'temo'],
    },
  },
  {
    def: {
      id: 'google.calendar.create', name: 'Create Calendar Event', description: 'Create a Google Calendar event.',
      category: 'google', permissions: ['google'],
      requiredParams: [{ name: 'title', type: 'string', description: 'Event title', required: true }, { name: 'start', type: 'string', description: 'Start time ISO', required: true }],
      optionalParams: [{ name: 'end', type: 'string', description: 'End time ISO', required: false }, { name: 'description', type: 'string', description: 'Event description', required: false }],
      responseSchema: { type: 'object', fields: { eventId: 'string' } },
      status: 'beta', version: '0.1.0', supportedAgents: ['atlas', 'temo'],
    },
  },
  {
    def: {
      id: 'github.createPR', name: 'Create GitHub PR', description: 'Create a pull request on GitHub.',
      category: 'github', permissions: ['github'],
      requiredParams: [{ name: 'repo', type: 'string', description: 'repo owner/name', required: true }, { name: 'title', type: 'string', description: 'PR title', required: true }, { name: 'head', type: 'string', description: 'Head branch', required: true }],
      optionalParams: [{ name: 'body', type: 'string', description: 'PR description', required: false }, { name: 'base', type: 'string', description: 'Base branch', required: false }],
      responseSchema: { type: 'object', fields: { prNumber: 'number', url: 'string' } },
      status: 'beta', version: '0.1.0', supportedAgents: ['nova', 'flow', 'temo'],
    },
  },
  {
    def: {
      id: 'github.commitFile', name: 'Commit File to GitHub', description: 'Commit a file to a GitHub repo.',
      category: 'github', permissions: ['github'],
      requiredParams: [{ name: 'repo', type: 'string', description: 'repo owner/name', required: true }, { name: 'path', type: 'string', description: 'File path', required: true }, { name: 'content', type: 'string', description: 'File content', required: true }, { name: 'message', type: 'string', description: 'Commit message', required: true }],
      optionalParams: [{ name: 'branch', type: 'string', description: 'Target branch', required: false }],
      responseSchema: { type: 'object', fields: { sha: 'string' } },
      status: 'beta', version: '0.1.0', supportedAgents: ['nova', 'flow', 'temo'],
    },
  },
  {
    def: {
      id: 'files.read', name: 'Read File', description: 'Read a file from local or mounted storage.',
      category: 'files', permissions: ['files'],
      requiredParams: [{ name: 'path', type: 'string', description: 'File path', required: true }],
      optionalParams: [],
      responseSchema: { type: 'object', fields: { content: 'string' } },
      status: 'beta', version: '0.1.0', supportedAgents: ['nova', 'flow', 'luna', 'temo'],
    },
  },
  {
    def: {
      id: 'files.write', name: 'Write File', description: 'Write content to a file.',
      category: 'files', permissions: ['files'],
      requiredParams: [{ name: 'path', type: 'string', description: 'File path', required: true }, { name: 'content', type: 'string', description: 'File content', required: true }],
      optionalParams: [],
      responseSchema: { type: 'object', fields: { written: 'boolean' } },
      status: 'beta', version: '0.1.0', supportedAgents: ['nova', 'flow', 'luna', 'temo'],
    },
  },
  {
    def: {
      id: 'web.search', name: 'Web Search', description: 'Search the web for real-time information.',
      category: 'web', permissions: ['web'],
      requiredParams: [{ name: 'query', type: 'string', description: 'Search query', required: true }],
      optionalParams: [{ name: 'maxResults', type: 'number', description: 'Max results', required: false }],
      responseSchema: { type: 'array', fields: { title: 'string', url: 'string' } },
      status: 'beta', version: '0.1.0', supportedAgents: ['atlas', 'echo', 'nova', 'luna', 'flow', 'temo'],
    },
  },
  {
    def: {
      id: 'voice.speak', name: 'Speak', description: 'Convert text to speech and play it.',
      category: 'voice', permissions: ['voice'],
      requiredParams: [{ name: 'text', type: 'string', description: 'Text to speak', required: true }],
      optionalParams: [],
      responseSchema: { type: 'object', fields: { spoken: 'boolean' } },
      status: 'active', version: '1.0.0', supportedAgents: ['temo'],
    },
  },
  {
    def: {
      id: 'voice.listen', name: 'Listen', description: 'Capture voice input and transcribe.',
      category: 'voice', permissions: ['voice'],
      requiredParams: [],
      optionalParams: [{ name: 'duration', type: 'number', description: 'Max seconds', required: false }],
      responseSchema: { type: 'object', fields: { transcript: 'string' } },
      status: 'active', version: '1.0.0', supportedAgents: ['temo'],
    },
  },
];

// ---- Registration ----

export function registerBuiltinTools(): void {
  toolRegistry.register(n8nListTool, n8nListHandler);
  toolRegistry.register(n8nCreateTool, n8nCreateHandler);
  toolRegistry.register(n8nUpdateTool, n8nUpdateHandler);
  toolRegistry.register(n8nDeleteTool, n8nDeleteHandler);
  toolRegistry.register(n8nTriggerTool, n8nTriggerHandler);
  toolRegistry.register(n8nTriggerByNameTool, n8nTriggerByNameHandler);
  toolRegistry.register(n8nConvertTool, n8nConvertHandler);
  toolRegistry.register(n8nSyncRegistryTool, n8nSyncRegistryHandler);
  toolRegistry.register(n8nActivateTool, n8nActivateHandler);
  toolRegistry.register(n8nExportTool, n8nExportHandler);
  toolRegistry.register(n8nImportTool, n8nImportHandler);

  // Memory Engine tools
  registerMemoryTools();

  for (const { def } of placeholderTools) {
    toolRegistry.register(def, placeholderHandler(def.id));
  }

  logger.n8n(`Built-in tools registered: ${toolRegistry.count()} total`);
}

// ---- Memory Engine Tools ----

function registerMemoryTools(): void {
  const memoryStoreTool: ToolDefinition = {
    id: 'memory.store',
    name: 'Store Memory',
    description: 'Store information in the memory engine. Automatically assesses importance and generates embeddings for semantic search.',
    category: 'memory',
    permissions: ['memory'],
    requiredParams: [
      { name: 'title', type: 'string', description: 'Memory title', required: true },
      { name: 'content', type: 'string', description: 'Memory content', required: true },
    ],
    optionalParams: [
      { name: 'type', type: 'string', description: 'Memory type: short_term, long_term, episodic, semantic', required: false },
      { name: 'tags', type: 'array', description: 'Tags for categorization', required: false },
      { name: 'importance', type: 'string', description: 'Importance: critical, high, medium, low, temporary', required: false },
      { name: 'agent', type: 'string', description: 'Agent ID storing this memory', required: false },
      { name: 'project', type: 'string', description: 'Project name', required: false },
    ],
    responseSchema: { type: 'object', fields: { id: 'string', type: 'string', importance: 'string' } },
    status: 'active',
    version: '1.0.0',
    supportedAgents: ['temo', 'flow', 'atlas', 'nova', 'luna', 'echo'],
  };

  const memorySearchTool: ToolDefinition = {
    id: 'memory.search',
    name: 'Search Memory',
    description: 'Search memories by keyword, semantic similarity, or hybrid mode. Returns ranked results with relevance scores.',
    category: 'memory',
    permissions: ['memory'],
    requiredParams: [{ name: 'query', type: 'string', description: 'Search query', required: true }],
    optionalParams: [
      { name: 'mode', type: 'string', description: 'Search mode: keyword, semantic, hybrid, tag, timeline', required: false },
      { name: 'type', type: 'string', description: 'Filter by memory type', required: false },
      { name: 'topK', type: 'number', description: 'Max results', required: false },
    ],
    responseSchema: { type: 'array', fields: { id: 'string', title: 'string', score: 'number' } },
    status: 'active',
    version: '1.0.0',
    supportedAgents: ['temo', 'flow', 'atlas', 'nova', 'luna', 'echo'],
  };

  const memoryRecallTool: ToolDefinition = {
    id: 'memory.recall',
    name: 'Recall Memory',
    description: 'Recall a specific memory by its ID.',
    category: 'memory',
    permissions: ['memory'],
    requiredParams: [{ name: 'id', type: 'string', description: 'Memory ID', required: true }],
    optionalParams: [],
    responseSchema: { type: 'object', fields: { id: 'string', title: 'string', content: 'string' } },
    status: 'active',
    version: '1.0.0',
    supportedAgents: ['temo', 'flow', 'atlas', 'nova', 'luna', 'echo'],
  };

  const memoryForgetTool: ToolDefinition = {
    id: 'memory.forget',
    name: 'Forget Memory',
    description: 'Delete a memory. Soft delete by default, permanent delete if specified.',
    category: 'memory',
    permissions: ['memory'],
    requiredParams: [{ name: 'id', type: 'string', description: 'Memory ID', required: true }],
    optionalParams: [{ name: 'permanent', type: 'boolean', description: 'Permanently delete (cannot be undone)', required: false }],
    responseSchema: { type: 'object', fields: { deleted: 'boolean' } },
    status: 'active',
    version: '1.0.0',
    supportedAgents: ['temo', 'flow', 'atlas', 'nova', 'luna', 'echo'],
    requiresApproval: true,
  };

  const memoryTimelineTool: ToolDefinition = {
    id: 'memory.timeline',
    name: 'Memory Timeline',
    description: 'Retrieve the episodic memory timeline — chronological list of important events.',
    category: 'memory',
    permissions: ['memory'],
    requiredParams: [],
    optionalParams: [
      { name: 'agent', type: 'string', description: 'Filter by agent', required: false },
      { name: 'project', type: 'string', description: 'Filter by project', required: false },
      { name: 'limit', type: 'number', description: 'Max events', required: false },
    ],
    responseSchema: { type: 'array', fields: { id: 'string', eventType: 'string', eventTitle: 'string' } },
    status: 'active',
    version: '1.0.0',
    supportedAgents: ['temo', 'flow', 'atlas', 'nova', 'luna', 'echo'],
  };

  const memoryLinkTool: ToolDefinition = {
    id: 'memory.link',
    name: 'Link Memories',
    description: 'Create a relationship between two memories in the knowledge graph.',
    category: 'memory',
    permissions: ['memory'],
    requiredParams: [
      { name: 'sourceId', type: 'string', description: 'Source memory ID', required: true },
      { name: 'targetId', type: 'string', description: 'Target memory ID', required: true },
    ],
    optionalParams: [{ name: 'linkType', type: 'string', description: 'Link type: relates_to, caused_by, part_of, etc.', required: false }],
    responseSchema: { type: 'object', fields: { id: 'string', sourceId: 'string', targetId: 'string' } },
    status: 'active',
    version: '1.0.0',
    supportedAgents: ['temo', 'flow', 'atlas', 'nova', 'luna', 'echo'],
  };

  const memorySummarizeTool: ToolDefinition = {
    id: 'memory.summarize',
    name: 'Summarize Memory',
    description: 'Generate a concise summary of a memory using AI.',
    category: 'memory',
    permissions: ['memory'],
    requiredParams: [{ name: 'id', type: 'string', description: 'Memory ID', required: true }],
    optionalParams: [],
    responseSchema: { type: 'object', fields: { id: 'string', summary: 'string' } },
    status: 'active',
    version: '1.0.0',
    supportedAgents: ['temo', 'flow', 'atlas', 'nova', 'luna', 'echo'],
  };

  const memoryUpdateTool: ToolDefinition = {
    id: 'memory.update',
    name: 'Update Memory',
    description: 'Update an existing memory\'s content, tags, or importance.',
    category: 'memory',
    permissions: ['memory'],
    requiredParams: [{ name: 'id', type: 'string', description: 'Memory ID', required: true }],
    optionalParams: [
      { name: 'title', type: 'string', description: 'New title', required: false },
      { name: 'content', type: 'string', description: 'New content', required: false },
      { name: 'tags', type: 'array', description: 'New tags', required: false },
      { name: 'importance', type: 'string', description: 'New importance level', required: false },
    ],
    responseSchema: { type: 'object', fields: { id: 'string', updated: 'boolean' } },
    status: 'active',
    version: '1.0.0',
    supportedAgents: ['temo', 'flow', 'atlas', 'nova', 'luna', 'echo'],
  };

  const memoryStoreHandler: ToolHandler = async (args, context) => {
    return memory.store({
      title: args.title as string,
      content: args.content as string,
      type: args.type as 'short_term' | 'long_term' | 'episodic' | 'semantic' | undefined,
      tags: args.tags as string[] | undefined,
      importance: args.importance as 'critical' | 'high' | 'medium' | 'low' | 'temporary' | undefined,
      agent: args.agent as string | undefined,
      project: args.project as string | undefined,
      tenantId: context.tenantId,
    });
  };

  const memorySearchHandler: ToolHandler = async (args, context) => {
    return memory.search({
      query: args.query as string,
      mode: args.mode as 'keyword' | 'semantic' | 'hybrid' | 'tag' | 'timeline' | undefined,
      type: args.type as 'short_term' | 'long_term' | 'episodic' | 'semantic' | undefined,
      topK: args.topK as number | undefined,
      tenantId: context.tenantId,
    });
  };

  const memoryRecallHandler: ToolHandler = async (args) => {
    return memory.recall(args.id as string);
  };

  const memoryForgetHandler: ToolHandler = async (args) => {
    return memory.forget(args.id as string, args.permanent as boolean | undefined);
  };

  const memoryTimelineHandler: ToolHandler = async (args) => {
    return memory.timeline({
      agent: args.agent as string | undefined,
      project: args.project as string | undefined,
      limit: args.limit as number | undefined,
    });
  };

  const memoryLinkHandler: ToolHandler = async (args) => {
    return memory.link(
      args.sourceId as string,
      args.targetId as string,
      args.linkType as 'relates_to' | 'caused_by' | 'part_of' | 'derived_from' | 'replaced_by' | 'supports' | 'contradicts' | undefined,
    );
  };

  const memorySummarizeHandler: ToolHandler = async (args) => {
    return memory.summarize(args.id as string);
  };

  const memoryUpdateHandler: ToolHandler = async (args) => {
    return memory.update(args.id as string, {
      title: args.title as string | undefined,
      content: args.content as string | undefined,
      tags: args.tags as string[] | undefined,
      importance: args.importance as 'critical' | 'high' | 'medium' | 'low' | 'temporary' | undefined,
    });
  };

  toolRegistry.register(memoryStoreTool, memoryStoreHandler);
  toolRegistry.register(memorySearchTool, memorySearchHandler);
  toolRegistry.register(memoryRecallTool, memoryRecallHandler);
  toolRegistry.register(memoryForgetTool, memoryForgetHandler);
  toolRegistry.register(memoryTimelineTool, memoryTimelineHandler);
  toolRegistry.register(memoryLinkTool, memoryLinkHandler);
  toolRegistry.register(memorySummarizeTool, memorySummarizeHandler);
  toolRegistry.register(memoryUpdateTool, memoryUpdateHandler);

  logger.n8n('Memory Engine tools registered');
}
