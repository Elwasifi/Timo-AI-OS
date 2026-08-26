import { create } from 'zustand';
import type { OrbState, VoiceSettings, VoiceLanguage } from '@/types';

interface VoiceStoreState {
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing: boolean;
  isThinking: boolean;
  isConnected: boolean;
  isMuted: boolean;
  /** When true, Temo ignores normal voice requests until woken — only a wake phrase is processed. See lib/voice/sleepWake.ts. */
  isSleeping: boolean;
  activeAgentId: string;
  transcript: string;
  interimTranscript: string;
  volume: number;
  orbState: OrbState;
  settings: VoiceSettings;
  sessionId: string | null;

  startListening: () => void;
  stopListening: () => void;
  startSpeaking: () => void;
  stopSpeaking: () => void;
  setThinking: (v: boolean) => void;
  setProcessing: (v: boolean) => void;
  setConnected: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  toggleMuted: () => void;
  setSleeping: (v: boolean) => void;
  setActiveAgent: (id: string) => void;
  setTranscript: (t: string) => void;
  setInterimTranscript: (t: string) => void;
  setVolume: (v: number) => void;
  setOrbState: (s: OrbState) => void;
  setSessionId: (id: string | null) => void;
  updateSettings: (partial: Partial<VoiceSettings>) => void;
  setSelectedVoice: (v: string) => void;
  setLanguage: (l: VoiceLanguage) => void;
  reset: () => void;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  selectedVoice: 'Aurora',
  speed: 1,
  pitch: 1,
  language: 'en-US',
  volume: 0.8,
  wakeWordEnabled: false,
  pushToTalk: true,
  autoTranscribe: true,
};

function deriveOrb(
  connected: boolean,
  listening: boolean,
  thinking: boolean,
  speaking: boolean
): OrbState {
  if (!connected) return 'disconnected';
  if (listening) return 'listening';
  if (thinking) return 'thinking';
  if (speaking) return 'speaking';
  return 'idle';
}

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  isListening: false,
  isSpeaking: false,
  isProcessing: false,
  isThinking: false,
  isConnected: true,
  isMuted: false,
  isSleeping: false,
  activeAgentId: 'temo',
  transcript: '',
  interimTranscript: '',
  volume: 0,
  orbState: 'idle',
  settings: DEFAULT_SETTINGS,
  sessionId: null,

  startListening: () =>
    set((s) => ({
      isListening: true,
      isSpeaking: false,
      isThinking: false,
      transcript: '',
      interimTranscript: '',
      orbState: deriveOrb(s.isConnected, true, false, false),
    })),

  stopListening: () =>
    set((s) => ({
      isListening: false,
      orbState: deriveOrb(s.isConnected, false, s.isThinking, s.isSpeaking),
    })),

  startSpeaking: () =>
    set((s) => ({
      isSpeaking: true,
      isListening: false,
      isThinking: false,
      orbState: deriveOrb(s.isConnected, false, false, true),
    })),

  stopSpeaking: () =>
    set((s) => ({
      isSpeaking: false,
      orbState: deriveOrb(s.isConnected, s.isListening, s.isThinking, false),
    })),

  setThinking: (v) =>
    set((s) => ({
      isThinking: v,
      orbState: deriveOrb(s.isConnected, s.isListening, v, s.isSpeaking),
    })),

  setProcessing: (v) => set({ isProcessing: v }),

  setConnected: (v) =>
    set((s) => ({
      isConnected: v,
      orbState: deriveOrb(v, s.isListening, s.isThinking, s.isSpeaking),
    })),

  setMuted: (v) => set({ isMuted: v }),
  toggleMuted: () => set((s) => ({ isMuted: !s.isMuted })),
  setSleeping: (v) => set({ isSleeping: v }),
  setActiveAgent: (activeAgentId) => set({ activeAgentId }),

  setTranscript: (t) => set({ transcript: t }),
  setInterimTranscript: (t) => set({ interimTranscript: t }),
  setVolume: (v) => set({ volume: v }),
  setOrbState: (orbState) => set({ orbState }),
  setSessionId: (id) => set({ sessionId: id }),

  updateSettings: (partial) =>
    set((s) => ({ settings: { ...s.settings, ...partial } })),

  setSelectedVoice: (selectedVoice) =>
    set((s) => ({ settings: { ...s.settings, selectedVoice } })),

  setLanguage: (language) =>
    set((s) => ({ settings: { ...s.settings, language } })),

  reset: () =>
    set({
      isListening: false,
      isSpeaking: false,
      isProcessing: false,
      isThinking: false,
      transcript: '',
      interimTranscript: '',
      volume: 0,
      orbState: deriveOrb(get().isConnected, false, false, false),
    }),
}));
