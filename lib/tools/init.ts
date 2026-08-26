// Tool Engine initialization — registers built-in tools and connects
// the executor's event stream to the UI store. Called once at app startup.

import { registerBuiltinTools } from './builtin-tools';
import { toolExecutor } from './executor';
import { useToolStore } from '@/stores/toolStore';
import { logger } from '@/lib/utils/logger';

let initialized = false;

export function initToolEngine(): void {
  if (initialized) return;
  initialized = true;

  registerBuiltinTools();

  // Wire executor events → tool store (for timeline + debug panel)
  toolExecutor.onEvent((event) => {
    useToolStore.getState().recordEvent(event);
  });

  // We also need to capture results — wrap execute to record results
  const originalExecute = toolExecutor.execute.bind(toolExecutor);
  toolExecutor.execute = async (request) => {
    const result = await originalExecute(request);
    useToolStore.getState().recordResult(result);
    return result;
  };

  logger.n8n('Tool Calling Engine initialized');
}
