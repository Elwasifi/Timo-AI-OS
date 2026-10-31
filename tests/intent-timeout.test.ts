// M7-13e: the intent analyzer's LLM path used to `await route()` BEFORE its
// 4s timeout race existed, so a stalled provider_model_catalog read hung
// the entire chat pipeline ("what can you do?" sat on THINKING for 2+
// minutes with no "Trying <provider>" line). Guard: the whole attempt,
// route() included, is bounded.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/ai/router', () => ({
  route: vi.fn(() => new Promise(() => {})), // never resolves — the stalled catalog read
  classifyTask: vi.fn(() => ({})),
}));
vi.mock('@/lib/ai/ai-provider', () => ({
  chatWithFallback: vi.fn(),
}));

import { AIIntentAnalyzer, isGreeting } from '@/lib/crew/ai-intent-analyzer';
import { chatWithFallback } from '@/lib/ai/ai-provider';
import { useAuthStore } from '@/stores/authStore';

describe('AIIntentAnalyzer — stalled route()', () => {
  beforeEach(() => { vi.useFakeTimers(); useAuthStore.setState({ currentTenantId: 'client-tenant' }); });
  afterEach(() => vi.useRealTimers());

  it('falls back to the keyword result after ~4s instead of hanging forever', async () => {
    const p = new AIIntentAnalyzer().analyze('what can you do?'); // no domain keywords -> low confidence -> LLM path
    let settled = false;
    void p.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(3_900);
    expect(settled).toBe(false); // still inside the bound
    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(true);

    const intent = await p;
    expect(intent.category).toBe('general');
    expect(chatWithFallback).not.toHaveBeenCalled(); // route() never returned, so no provider call was made
  });
});

describe('isGreeting', () => {
  it('matches bare greetings / pleasantries (English + Arabic forms)', () => {
    for (const g of ['Hi', 'hi!', 'Hey', 'hello', 'Good morning', 'hamdellah', 'Alhamdulillah', 'ahlan', 'marhaba', 'thanks', 'Thank you', 'salam']) {
      expect(isGreeting(g), g).toBe(true);
    }
  });

  it('does not match a message that merely starts with a greeting or asks something real', () => {
    for (const g of ['hi, can you build me a landing page', 'what can you do?', 'hello world function in python', 'thanks, now deploy it']) {
      expect(isGreeting(g), g).toBe(false);
    }
  });
});

describe('AIIntentAnalyzer — tenant attribution (M7-13e)', () => {
  it('with no resolved tenant it stays on the keyword result and never calls route()/a provider (no silent use of the internal tenant keys)', async () => {
    useAuthStore.setState({ currentTenantId: null });
    const { route } = await import('@/lib/ai/router');
    vi.mocked(route).mockClear();
    const intent = await new AIIntentAnalyzer().analyze('what can you do?');
    expect(intent.category).toBe('general');
    expect(route).not.toHaveBeenCalled();
    expect(chatWithFallback).not.toHaveBeenCalled();
  });

  it('with a tenant it passes THAT tenant id to route() (not null)', async () => {
    vi.useFakeTimers();
    useAuthStore.setState({ currentTenantId: 'client-tenant' });
    const { route } = await import('@/lib/ai/router');
    vi.mocked(route).mockClear();
    const p = new AIIntentAnalyzer().analyze('what can you do?');
    await vi.advanceTimersByTimeAsync(4_500);
    await p;
    vi.useRealTimers();
    expect(vi.mocked(route).mock.calls[0][0]).toMatchObject({ tenantId: 'client-tenant' });
  });
});
