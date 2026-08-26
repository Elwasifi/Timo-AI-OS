import type { Workflow } from '@/types';

const MOCK_WORKFLOWS: Workflow[] = [
  {
    id: 'w1',
    name: 'Daily Market Digest',
    status: 'running',
    lastRun: 'Running now',
    steps: 7,
    progress: 64,
  },
  {
    id: 'w2',
    name: 'Lead Enrichment Pipeline',
    status: 'idle',
    lastRun: '12 min ago',
    steps: 5,
    progress: 100,
  },
  {
    id: 'w3',
    name: 'Support Ticket Triage',
    status: 'paused',
    lastRun: 'Paused 1 hr ago',
    steps: 9,
    progress: 38,
  },
  {
    id: 'w4',
    name: 'Social Sentiment Scan',
    status: 'error',
    lastRun: 'Failed 2 hrs ago',
    steps: 6,
    progress: 72,
  },
];

export const WorkflowService = {
  async listWorkflows(): Promise<Workflow[]> {
    await delay(250);
    return MOCK_WORKFLOWS;
  },

  async runWorkflow(id: string): Promise<{ id: string; started: boolean }> {
    await delay(400);
    return { id, started: true };
  },

  async pauseWorkflow(id: string): Promise<{ id: string; paused: boolean }> {
    await delay(300);
    return { id, paused: true };
  },

  async getWorkflow(id: string): Promise<Workflow | undefined> {
    await delay(150);
    return MOCK_WORKFLOWS.find((w) => w.id === id);
  },
};

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
