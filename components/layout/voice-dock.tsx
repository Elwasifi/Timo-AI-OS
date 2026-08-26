'use client';

import { useEffect, useState, memo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, MessageSquare, Volume2, VolumeX, Settings } from 'lucide-react';
import { VoiceOrb } from '@/components/temo/voice-orb';
import { useVoiceStore } from '@/stores/voiceStore';
import { useUIStore } from '@/stores/uiStore';
import { voiceManager } from '@/lib/voice/voice-manager';
import { cn } from '@/lib/utils';

export function VoiceDock() {
  const open = useUIStore((s) => s.voiceDockOpen);
  const router = useRouter();
  const orbState = useVoiceStore((s) => s.orbState);
  const isListening = useVoiceStore((s) => s.isListening);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const volume = useVoiceStore((s) => s.volume);
  const transcript = useVoiceStore((s) => s.transcript);
  const interimTranscript = useVoiceStore((s) => s.interimTranscript);
  const toggleMuted = useVoiceStore((s) => s.toggleMuted);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    setShowTranscript(isListening && !!transcript);
  }, [isListening, transcript]);

  const handleMic = () => {
    if (isListening) {
      void voiceManager.stopListening();
    } else {
      void voiceManager.startListening();
    }
  };

  const handleStop = () => {
    voiceManager.interrupt();
  };

  const displayText = transcript || interimTranscript;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2"
        >
          {/* Live transcript */}
          <AnimatePresence>
            {showTranscript && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute bottom-full left-1/2 mb-2 max-w-[70vw] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl glass-holo px-4 py-2 text-sm text-foreground shadow-xl"
              >
                {displayText}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Dock */}
          <div className="relative flex items-center gap-1.5 rounded-[1.5rem] glass-holo px-3 py-2.5 shadow-2xl">
            {/* Energy ring */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <motion.div
                className="h-16 w-16 rounded-full border border-primary/20"
                animate={{ scale: isListening ? [1, 1.3, 1] : [1, 1.08, 1], opacity: [0.15, 0.35, 0.15] }}
                transition={{ duration: isListening ? 1.5 : 3, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>

            {/* Left controls */}
            <DockButton icon={MessageSquare} label="Chat" onClick={() => router.push('/chat')} />
            <DockButton
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
              <VoiceOrb state={orbState} size={56} />
            </button>

            {/* Right controls */}
            <DockButton
              icon={Square}
              label="Stop"
              variant={isListening || orbState === 'speaking' || orbState === 'thinking' ? 'danger' : 'ghost'}
              onClick={handleStop}
            />
            <DockButton
              icon={Mic}
              label="Voice"
              variant={isListening ? 'primary' : 'ghost'}
              onClick={handleMic}
            />

            {/* Divider */}
            <div className="mx-0.5 h-7 w-px bg-border/40" />

            <DockButton icon={Settings} label="Settings" onClick={() => router.push('/settings')} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const DockButton = memo(function DockButton({
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
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
        variant === 'ghost' && 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
        variant === 'primary' && 'bg-primary/20 text-primary glow-sm-primary',
        variant === 'danger' && 'bg-destructive/20 text-destructive hover:bg-destructive/30'
      )}
    >
      <Icon className="h-4 w-4" />
    </motion.button>
  );
});
