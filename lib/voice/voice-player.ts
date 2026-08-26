/**
 * VoicePlayer — wraps the browser SpeechSynthesis API to "speak" Temo's
 * responses out loud. Picks the best matching system voice for the
 * configured language and exposes start/stop/interrupt controls plus a
 * volume callback for waveform visualization.
 */

type SpeakCallback = () => void;
type BoundaryCallback = (charIndex: number) => void;

export interface SpeakOptions {
  text: string;
  voiceName?: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onStart?: SpeakCallback;
  onEnd?: SpeakCallback;
  onError?: SpeakCallback;
  onBoundary?: BoundaryCallback;
}

export class VoicePlayer {
  private synth: SpeechSynthesis | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private supported: boolean;

  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.supported) {
      this.synth = window.speechSynthesis;
    }
  }

  isSupported(): boolean {
    return this.supported;
  }

  getVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    return this.synth.getVoices();
  }

  private pickVoice(lang: string, preferred?: string): SpeechSynthesisVoice | null {
    const voices = this.getVoices();
    if (voices.length === 0) return null;
    if (preferred) {
      const match = voices.find((v) => v.name === preferred);
      if (match) return match;
    }
    const langMatch = voices.find((v) => v.lang === lang);
    if (langMatch) return langMatch;
    const prefix = lang.split('-')[0];
    return voices.find((v) => v.lang.startsWith(prefix)) ?? voices[0] ?? null;
  }

  speak(opts: SpeakOptions): void {
    if (!this.synth) {
      // No synthesis available — fire onEnd immediately so the flow continues.
      opts.onEnd?.();
      return;
    }

    this.stop();

    const u = new SpeechSynthesisUtterance(opts.text);
    const voice = this.pickVoice(opts.lang, opts.voiceName);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = opts.lang;
    }
    u.rate = opts.rate;
    u.pitch = opts.pitch;
    u.volume = opts.volume;

    u.onstart = () => opts.onStart?.();
    u.onend = () => opts.onEnd?.();
    u.onerror = () => {
      opts.onError?.();
      opts.onEnd?.();
    };
    u.onboundary = (e) => opts.onBoundary?.(e.charIndex);

    this.utterance = u;
    this.synth.speak(u);
  }

  stop(): void {
    if (this.synth && this.synth.speaking) {
      this.synth.cancel();
    }
    this.utterance = null;
  }

  pause(): void {
    this.synth?.pause();
  }

  resume(): void {
    this.synth?.resume();
  }

  isSpeaking(): boolean {
    return this.synth?.speaking ?? false;
  }
}
