'use client';

import { useState, useRef, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, ArrowUp, Slash, FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

type InputBarProps = {
  onSend: (text: string) => void;
  onVoiceToggle?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** V1 simulation/R&D mode: missions run with no real external side effects. */
  simulationMode?: boolean;
  onToggleSimulation?: () => void;
};

export function InputBar({ onSend, onVoiceToggle, isStreaming, disabled, placeholder = 'Ask TEMO to accomplish a mission...', className, simulationMode, onToggleSimulation }: InputBarProps) {
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const isCommandMode = text.startsWith('/');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled || isStreaming) return;
    onSend(text.trim());
    setText('');
    setIsMultiLine(false);
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    setIsMultiLine(ta.scrollHeight > 52);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'relative flex items-end gap-3 rounded-2xl px-4 py-3 transition-all duration-200',
        'bg-[rgba(8,12,20,0.7)] backdrop-blur-xl',
        isFocused
          ? isCommandMode
            ? 'border border-temo-purple shadow-[0_0_15px_rgba(139,92,246,0.25)]'
            : 'border border-temo-cyan shadow-[0_0_15px_rgba(0,243,255,0.25)]'
          : 'border border-temo-cyan/20',
        className,
      )}
    >
      {/* M6-08: the attachment button here previously had no onClick at
          all — did nothing when clicked. Removed rather than wired: real
          file-attachment support (upload, storage, passing content into
          the AI request) is a genuine feature, not a cleanup-scope fix,
          and a button that looks functional but silently does nothing is
          worse than no button. */}
      {/* Simulation/R&D mode toggle — missions run with no real external side effects */}
      {onToggleSimulation && (
        <button
          type="button"
          onClick={onToggleSimulation}
          disabled={disabled}
          title={simulationMode ? 'Simulation mode ON — no real external actions will be taken' : 'Enable simulation mode (dry run, no real external actions)'}
          className={cn(
            'shrink-0 transition-colors',
            simulationMode ? 'text-temo-purple' : 'text-temo-titanium hover:text-temo-purple',
          )}
        >
          <FlaskConical className="h-5 w-5" />
        </button>
      )}

      {/* Center: expandable text area */}
      <textarea
        ref={taRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={disabled}
        rows={1}
        placeholder={placeholder}
        className={cn(
          'flex-1 resize-none bg-transparent font-sans text-sm text-temo-led placeholder:text-temo-titanium/50 focus:outline-none',
          isMultiLine ? 'max-h-40' : 'h-7',
        )}
      />

      {/* Command mode indicator */}
      <AnimatePresence>
        {isCommandMode && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex items-center gap-1 text-temo-purple"
          >
            <Slash className="h-3 w-3" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right: voice + send */}
      <div className="flex shrink-0 items-center gap-2">
        {onVoiceToggle && (
          <button
            type="button"
            onClick={onVoiceToggle}
            className="flex h-9 w-9 items-center justify-center rounded-full text-temo-titanium transition-colors hover:text-temo-cyan"
            disabled={disabled}
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
        <button
          type="submit"
          disabled={!text.trim() || disabled || isStreaming}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full transition-all active:scale-90',
            text.trim() && !disabled && !isStreaming
              ? 'bg-temo-cyan text-temo-void shadow-[0_0_15px_rgba(0,243,255,0.4)]'
              : 'bg-temo-cyan/20 text-temo-titanium',
          )}
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      </div>
    </form>
  );
}
