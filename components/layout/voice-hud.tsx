'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, MessageSquare, Volume2, VolumeX, Settings, ChevronDown } from 'lucide-react';
import { VoiceOrb } from '@/components/temo/voice-orb';
import { useVoiceStore } from '@/stores/voiceStore';
import { voiceManager } from '@/lib/voice/voice-manager';
import { cn } from '@/lib/utils';

const STATE_LABELS: Record<string, string> = {
  idle: 'Tap to speak',
  listening: 'Listening…',
  thinking: 'Processing…',
  speaking: 'Speaking…',
  disconnected: 'Offline',
};

export function VoiceHud() {
  const router = useRouter();
  const orbState = useVoiceStore((s) => s.orbState);
  const isListening = useVoiceStore((s) => s.isListening);
  const isThinking = useVoiceStore((s) => s.isThinking);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const transcript = useVoiceStore((s) => s.transcript);
  const interimTranscript = useVoiceStore((s) => s.interimTranscript);
  const toggleMuted = useVoiceStore((s) => s.toggleMuted);

  const [expanded, setExpanded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowTranscript(isListening && (!!transcript || !!interimTranscript));
  }, [isListening, transcript, interimTranscript]);

  // Close popover when clicking outside
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [expanded]);

  const handleMic = useCallback(() => {
    if (isListening) {
      void voiceManager.stopListening();
    } else {
      void voiceManager.startListening();
    }
  }, [isListening]);

  const handleStop = useCallback(() => {
    voiceManager.interrupt();
  }, []);

  const isActive = isListening || isThinking || isSpeaking;
  const displayText = transcript || interimTranscript;

  return (
    <div className="relative flex items-center" ref={popoverRef}>
      {/* Compact orb button — idle→wake interaction */}
      <div className="flex items-center gap-2 rounded-full border border-temo-cyan/20 bg-white/[0.02] py-1 pl-1 pr-3 transition-all hover:border-temo-cyan/40">
        {/* Voice orb — click to wake/listen */}
        <button
          onClick={handleMic}
          aria-label={isListening ? 'Stop listening' : 'Start listening'}
          className="relative flex items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
        >
          <VoiceOrb state={orbState} size={32} />
        </button>

        {/* Status text */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5"
        >
          <span
            className={cn(
              'font-mono text-[10px] uppercase tracking-wider transition-colors',
              isActive ? 'text-temo-cyan' : 'text-temo-titanium',
            )}
          >
            {STATE_LABELS[orbState] ?? 'Standby'}
          </span>
          <ChevronDown className={cn('h-3 w-3 text-temo-titanium/50 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {/* Expanded popover with full controls */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-12 z-50 w-72 rounded-2xl border border-temo-cyan/20 bg-[rgba(8,12,20,0.92)] p-4 shadow-2xl backdrop-blur-xl"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(0,243,255,0.08)' }}
          >
            {/* Live transcript */}
            <AnimatePresence>
              {showTranscript && displayText && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-3 overflow-hidden rounded-lg border border-temo-cyan/10 bg-temo-cyan/5 px-3 py-2"
                >
                  <p className="text-xs text-temo-led">{displayText}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Orb + controls */}
            <div className="flex items-center justify-center gap-2">
              <HudButton icon={MessageSquare} label="Chat" onClick={() => { router.push('/chat'); setExpanded(false); }} />

              <HudButton
                icon={isMuted ? VolumeX : Volume2}
                label={isMuted ? 'Unmute' : 'Mute'}
                variant={isMuted ? 'danger' : 'ghost'}
                onClick={toggleMuted}
              />

              {/* Center orb */}
              <button
                onClick={handleMic}
                aria-label={isListening ? 'Stop listening' : 'Start listening'}
                className="relative flex items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
              >
                <VoiceOrb state={orbState} size={48} />
              </button>

              <HudButton
                icon={Square}
                label="Stop"
                variant={isActive ? 'danger' : 'ghost'}
                onClick={handleStop}
              />
              <HudButton
                icon={Mic}
                label="Voice"
                variant={isListening ? 'primary' : 'ghost'}
                onClick={handleMic}
              />
            </div>

            {/* Divider + settings */}
            <div className="mt-3 flex items-center gap-2">
              <div className="h-px flex-1 bg-temo-cyan/10" />
              <HudButton icon={Settings} label="Settings" onClick={() => { router.push('/settings'); setExpanded(false); }} />
              <div className="h-px flex-1 bg-temo-cyan/10" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HudButton({
  icon: Icon,
  label,
  variant = 'ghost',
  onClick,
}: {
  icon: typeof Mic;
  label: string;
  variant?: 'ghost' | 'primary' | 'danger';
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
        variant === 'ghost' && 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
        variant === 'primary' && 'bg-primary/20 text-primary',
        variant === 'danger' && 'bg-destructive/20 text-destructive hover:bg-destructive/30',
      )}
    >
      <Icon className="h-4 w-4" />
    </motion.button>
  );
}
