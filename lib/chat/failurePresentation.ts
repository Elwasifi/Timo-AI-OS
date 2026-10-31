// M7-13e: how the chat page presents a failed request, and whether it may
// offer "Retry". Extracted from app/chat/page.tsx into a plain .ts module so
// it is unit-testable (the repo's vitest setup has no JSX transform).
//
// The rule that matters: Retry re-sends the user's message through the full
// pipeline, and for a mission that means LAUNCHING THE MISSION AGAIN. So once
// the mission pipeline has started (the page learns this from the first
// onAcknowledgment / onMissionProgress event — onMissionProgress('Planning
// mission') fires before launchMission() writes anything), ANY later error —
// watchdog or not — must point the user at the Missions page and offer no
// Retry. Retry is only for plain-chat failures that happened before that.

/** How long a plain-chat request may show no sign of life before the page gives up on it. Above INTERACTIVE_DEADLINE_MS (lib/ai/ai-provider.ts, 30s) so the clean deadline error wins the race. */
export const CHAT_INACTIVITY_TIMEOUT_MS = 40_000;
/** Once a mission has started: planning emits no events and one task may take up to 90s per provider attempt. Every onMissionProgress event resets the timer. */
export const MISSION_INACTIVITY_TIMEOUT_MS = 5 * 60_000;

export class ChatWatchdogError extends Error {
  constructor(public readonly missionMode: boolean) {
    super(
      missionMode
        ? `This mission has shown no progress for ${MISSION_INACTIVITY_TIMEOUT_MS / 60_000} minutes.`
        : `No response from the AI for ${CHAT_INACTIVITY_TIMEOUT_MS / 1000} seconds.`,
    );
    this.name = 'ChatWatchdogError';
  }
}

export interface FailurePresentation {
  /** Markdown shown in the assistant bubble. */
  content: string;
  /** Whether the bubble may show a Retry button. */
  allowRetry: boolean;
}

export function presentChatFailure(err: unknown, missionStarted: boolean): FailurePresentation {
  const message = err instanceof Error ? err.message : 'AI request failed';

  if (missionStarted) {
    const lead = err instanceof ChatWatchdogError ? message : `The mission ran into a problem: ${message}`;
    return {
      content: `${lead}\n\nIt may still be running in the background — check the Missions page before starting it again.`,
      allowRetry: false,
    };
  }
  if (err instanceof ChatWatchdogError) {
    return {
      content: `${message} The provider may be slow or unreachable. You can retry, or check your provider keys in Settings.`,
      allowRetry: true,
    };
  }
  return {
    content: `I encountered an issue: ${message}\n\nPlease check your API key configuration in Settings.`,
    allowRetry: true,
  };
}
