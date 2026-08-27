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

// M4-04: the Web Speech API's SpeechSynthesisUtterance is well-documented
// as occasionally never firing either onend or onerror (browser/OS/voice-
// engine dependent) — with nothing to bound that wait, the caller's
// promise (voice-manager.ts's speak()) hangs forever, isProcessingVoice
// never resets, and every subsequent voice attempt is silently ignored
// with zero error shown. Scaled to expected speech length (roughly a
// generous 2x a typical ~12 chars/sec TTS rate) with a floor for very
// short replies and a ceiling so a runaway text can't wedge the app for
// minutes.
const MIN_SPEAK_TIMEOUT_MS = 8_000;
const MAX_SPEAK_TIMEOUT_MS = 45_000;
function speakTimeoutFor(text: string): number {
  const estimated = (text.length / 12) * 1000 * 2;
  return Math.max(MIN_SPEAK_TIMEOUT_MS, Math.min(MAX_SPEAK_TIMEOUT_MS, estimated));
}

export class VoicePlayer {
  private synth: SpeechSynthesis | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
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

    const clearWatchdog = () => {
      if (this.watchdog) {
        clearTimeout(this.watchdog);
        this.watchdog = null;
      }
    };

    u.onstart = () => opts.onStart?.();
    u.onend = () => {
      clearWatchdog();
      opts.onEnd?.();
    };
    u.onerror = () => {
      clearWatchdog();
      opts.onError?.();
      opts.onEnd?.();
    };
    u.onboundary = (e) => opts.onBoundary?.(e.charIndex);

    this.utterance = u;
    this.synth.speak(u);

    // M4-04: neither onend nor onerror is guaranteed to fire — this
    // watchdog is the fallback that guarantees the caller's promise
    // always settles.
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (this.utterance !== u) return; // a newer utterance already took over
      this.stop();
      opts.onError?.();
      opts.onEnd?.();
    }, speakTimeoutFor(opts.text));
  }

  stop(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
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
