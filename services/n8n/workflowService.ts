// Workflow management API — list, get, create, update, delete, activate,
// deactivate, import, export, search. All methods proxy through n8nClient.

import { proxy } from './n8nClient';
import type { N8nWorkflow, ConvertResult, WorkflowRegistryEntry } from './types';

export const workflowService = {
  async list(): Promise<N8nWorkflow[]> {
    return proxy<N8nWorkflow[]>({ action: 'list-workflows' });
  },

  async get(id: string): Promise<N8nWorkflow> {
    return proxy<N8nWorkflow>({ action: 'get-workflow', workflowId: id });
  },

  async create(workflow: Partial<N8nWorkflow>): Promise<N8nWorkflow> {
    return proxy<N8nWorkflow>({ action: 'create-workflow', workflow });
  },

  async update(id: string, workflow: Partial<N8nWorkflow>): Promise<N8nWorkflow> {
    return proxy<N8nWorkflow>({ action: 'update-workflow', workflowId: id, workflow });
  },

  async delete(id: string): Promise<{ id: string; deleted: boolean }> {
    return proxy<{ id: string; deleted: boolean }>({ action: 'delete-workflow', workflowId: id });
  },

  async activate(id: string): Promise<N8nWorkflow> {
    return proxy<N8nWorkflow>({ action: 'activate-workflow', workflowId: id });
  },

  async deactivate(id: string): Promise<N8nWorkflow> {
    return proxy<N8nWorkflow>({ action: 'deactivate-workflow', workflowId: id });
  },

  async import(workflow: Partial<N8nWorkflow>): Promise<N8nWorkflow> {
    return proxy<N8nWorkflow>({ action: 'import-workflow', workflow });
  },

  async export(id: string): Promise<N8nWorkflow> {
    return proxy<N8nWorkflow>({ action: 'export-workflow', workflowId: id });
  },

  async search(tag: string): Promise<N8nWorkflow[]> {
    return proxy<N8nWorkflow[]>({ action: 'search-workflows', tag });
  },

  async convertToWebhook(workflowId: string): Promise<ConvertResult> {
    return proxy<ConvertResult>({ action: 'convert-to-webhook', workflowId });
  },

  async syncRegistry(): Promise<WorkflowRegistryEntry[]> {
    return proxy<WorkflowRegistryEntry[]>({ action: 'sync-registry' });
  },
};
