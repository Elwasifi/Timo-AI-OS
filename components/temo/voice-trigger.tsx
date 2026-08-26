'use client';

import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, AlertTriangle } from 'lucide-react';
import { useVoiceStore } from '@/stores/voiceStore';
import { voiceManager } from '@/lib/voice/voice-manager';
import { cn } from '@/lib/utils';

/**
 * VoiceTrigger — the single shared voice control (M3-05, extracted for
 * reuse in M3-10 so Chat and Main Dashboard show identical listening/
 * thinking/speaking feedback instead of two independently-built versions).
 *
 * Idle: a clean mic-icon button, sized/positioned by the caller via
 * `size`/`anchorClassName`. Active: expands into a recording-bar with an
 * animated waveform, live transcript/status text, and — new in M3-10 — a
 * visible error state (recognition failure, empty transcript, AI call
 * failure) instead of failing silently. Wires the same VoiceManager
 * start/stop machinery every voice entry point in the app uses; never
 * touches the underlying Web Speech API engine itself.
 */
export function VoiceTrigger({
  size = 52,
  anchorClassName,
  expandedWidth = 280,
  hideIdleTrigger = false,
}: {
  /** Idle-state circle diameter in px. */
  size?: number;
  /** Positioning classes for the outer wrapper — caller controls placement. */
  anchorClassName?: string;
  /** Expanded recording-bar width in px. */
  expandedWidth?: number;
  /**
   * When true, renders nothing while idle — for callers that already have
   * their own mic button (e.g. Chat's InputBar) and only want this
   * component's recording-bar/error feedback once voice is actually active.
   */
  hideIdleTrigger?: boolean;
}) {
  const isListening = useVoiceStore((s) => s.isListening);
  const isThinking = useVoiceStore((s) => s.isThinking);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const transcript = useVoiceStore((s) => s.transcript);
  const interimTranscript = useVoiceStore((s) => s.interimTranscript);
  const lastError = useVoiceStore((s) => s.lastError);
  const isActive = isListening || isThinking || isSpeaking;

  const toggle = useCallback(() => {
    if (isListening) {
      void voiceManager.stopListening();
    } else {
      void voiceManager.startListening();
    }
  }, [isListening]);

  const statusLabel = isListening ? 'Listening…' : isThinking ? 'Processing…' : isSpeaking ? 'Speaking…' : 'Tap to speak';
  const displayText = transcript || interimTranscript;

  return (
    <div className={cn('relative z-20 flex items-center justify-center', anchorClassName)} style={{ height: size, width: size }}>
      <AnimatePresence mode="wait" initial={false}>
        {!isActive ? (
          hideIdleTrigger ? null : (
          <motion.button
            key="collapsed"
            type="button"
            onClick={toggle}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            aria-label="Start voice input"
            className="flex h-full w-full items-center justify-center rounded-full border border-temo-cyan/50 bg-temo-cyan/[0.08] text-temo-cyan shadow-[0_0_16px_rgba(0,243,255,0.22)] transition-all hover:border-temo-cyan/70 hover:bg-temo-cyan/[0.14] hover:shadow-[0_0_24px_rgba(0,243,255,0.35)]"
          >
            <Mic className="h-[18px] w-[18px]" />
          </motion.button>
          )
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, scale: 0.92, width: size }}
            animate={{ opacity: 1, scale: 1, width: expandedWidth }}
            exit={{ opacity: 0, scale: 0.92, width: size }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-full border border-temo-cyan/50 bg-[rgba(8,16,28,0.92)] px-3 py-2 shadow-[0_0_28px_rgba(0,243,255,0.28)] backdrop-blur-xl"
          >
            <button
              type="button"
              onClick={toggle}
              aria-label="Stop voice input"
              className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-temo-cyan/15 text-temo-cyan"
            >
              {isListening && (
                <motion.span
                  className="absolute inset-0 rounded-full border border-temo-cyan/60"
                  animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              <Mic className="h-3.5 w-3.5" />
            </button>

            {/* Listening-state waveform */}
            <div className="flex h-5 shrink-0 items-center gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <motion.span
                  key={i}
                  className="w-0.5 rounded-full bg-temo-cyan"
                  animate={
                    isListening
                      ? { height: [4, 16, 6, 20, 4] }
                      : isThinking
                        ? { height: [6, 10, 6] }
                        : { height: 10 }
                  }
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.08, ease: 'easeInOut' }}
                />
              ))}
            </div>

            <span className="min-w-0 flex-1 truncate text-[11px] text-temo-led/90">
              {displayText || statusLabel}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* M3-10: a real, visible error state — recognition failure, empty
          transcript, or AI call failure — instead of silent nothing.
          Rendered outside the idle/active AnimatePresence so it stays
          visible for a beat even after the control collapses back to idle. */}
      <AnimatePresence>
        {!isActive && lastError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-1/2 top-full mt-2 flex w-max max-w-[240px] -translate-x-1/2 items-start gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[10px] text-red-300"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{lastError}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
