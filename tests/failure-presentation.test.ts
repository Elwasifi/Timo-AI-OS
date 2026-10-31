// M7-13e: Retry re-sends the user's message through the full pipeline — for a
// mission that means launching the mission AGAIN. These pin the rule that
// once a mission has started, no failure of any kind exposes Retry.

import { describe, it, expect } from 'vitest';
import {
  presentChatFailure,
  ChatWatchdogError,
  CHAT_INACTIVITY_TIMEOUT_MS,
  MISSION_INACTIVITY_TIMEOUT_MS,
} from '@/lib/chat/failurePresentation';

describe('presentChatFailure', () => {
  it('a NON-watchdog error thrown after the mission started: Missions-page message, NO Retry', () => {
    const f = presentChatFailure(new Error('Mission task 3 failed: provider returned 500'), true);
    expect(f.allowRetry).toBe(false);
    expect(f.content).toContain('Missions page');
    expect(f.content).toContain('may still be running');
    expect(f.content).toContain('Mission task 3 failed');
  });

  it('a watchdog stall after the mission started: Missions-page message, NO Retry', () => {
    const f = presentChatFailure(new ChatWatchdogError(true), true);
    expect(f.allowRetry).toBe(false);
    expect(f.content).toContain('no progress');
    expect(f.content).toContain('Missions page');
  });

  it('even a non-Error throw after mission start never offers Retry', () => {
    expect(presentChatFailure('boom', true).allowRetry).toBe(false);
    expect(presentChatFailure(undefined, true).allowRetry).toBe(false);
  });

  it('plain-chat failures BEFORE any mission started may Retry (provider error and watchdog stall)', () => {
    expect(presentChatFailure(new Error('All AI providers are currently rate-limited.'), false).allowRetry).toBe(true);
    const stall = presentChatFailure(new ChatWatchdogError(false), false);
    expect(stall.allowRetry).toBe(true);
    expect(stall.content).toContain('40 seconds');
    expect(stall.content).not.toContain('Missions page');
  });

  it('time budgets: chat watchdog 40s, mission watchdog 5 min', () => {
    expect(CHAT_INACTIVITY_TIMEOUT_MS).toBe(40_000);
    expect(MISSION_INACTIVITY_TIMEOUT_MS).toBe(300_000);
  });
});
