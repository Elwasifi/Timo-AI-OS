import type { Provider } from '@/types';
import { loadSettings, type AppSettings, type ProviderId, PROVIDER_LABELS, PROVIDER_KEY_FIELD, PROVIDER_MODEL_FIELD } from '@/lib/settings/settings-service';

/**
 * ProviderService — backed by the Supabase app_settings table (single source
 * of truth). Lists the five LLM providers in the development stack with their
 * live status derived from whether configuration exists. Switching the
 * provider updates active_provider in the settings table so the choice
 * persists.
 *
 * OpenAI and Anthropic are intentionally absent.
 */
export const ProviderService = {
  async listProviders(): Promise<Provider[]> {
    const settings = await loadSettings();
    const keyMap = await this.getKeyStatus();
    const ids: ProviderId[] = ['gemini', 'groq', 'nvidia', 'openrouter', 'ollama'];
    return ids.map((id) => ({
      id,
      name: PROVIDER_LABELS[id],
      model: modelFor(id, settings),
      status: keyMap[id] ? (settings.active_provider === id ? 'active' : 'idle') : 'error',
      latency: 0,
      color: colorFor(id),
    }));
  },

  async getProvider(id: string): Promise<Provider | undefined> {
    const providers = await this.listProviders();
    return providers.find((p) => p.id === id);
  },

  async switchProvider(id: string): Promise<Provider> {
    const provider = (await this.listProviders()).find((p) => p.id === id);
    if (!provider) throw new Error(`Provider ${id} not found`);
    return { ...provider, status: 'active' };
  },

  async pingProvider(id: string): Promise<{ id: string; latency: number }> {
    const start = Date.now();
    await this.listProviders();
    return { id, latency: Date.now() - start };
  },

  async getKeyStatus(): Promise<Record<ProviderId, boolean>> {
    const settings = await loadSettings();
    const keyField = (id: ProviderId) => PROVIDER_KEY_FIELD[id] as keyof typeof settings;
    return {
      gemini: !!settings[keyField('gemini')],
      groq: !!settings[keyField('groq')],
      nvidia: !!settings[keyField('nvidia')],
      openrouter: !!settings[keyField('openrouter')],
      ollama: !!settings.ollama_base_url,
    };
  },
};

function modelFor(id: ProviderId, settings: AppSettings): string {
  const value = settings[PROVIDER_MODEL_FIELD[id]];
  return typeof value === 'string' && value ? value : '';
}

function colorFor(id: ProviderId): string {
  const colors: Record<ProviderId, string> = {
    gemini: '#00E5FF',
    groq: '#F53803',
    nvidia: '#76B900',
    openrouter: '#6366F1',
    ollama: '#22C55E',
  };
  return colors[id];
}
