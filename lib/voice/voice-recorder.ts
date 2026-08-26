/**
 * VoiceRecorder — wraps the browser SpeechRecognition API (when available)
 * and exposes a clean callback-based interface for live transcription.
 *
 * Falls back gracefully when SpeechRecognition is unavailable — the caller
 * can still type or use the mock pipeline.
 */

type TranscriptCallback = (text: string, isFinal: boolean) => void;
type ErrorCallback = (error: string) => void;
type EndCallback = () => void;

// Minimal type defs for the webkit SpeechRecognition API (not in lib.dom).
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class VoiceRecorder {
  private recognition: SpeechRecognitionLike | null = null;
  private supported: boolean;

  constructor() {
    this.supported = getRecognitionCtor() !== null;
  }

  isSupported(): boolean {
    return this.supported;
  }

  start(lang: string, onTranscript: TranscriptCallback, onError: ErrorCallback, onEnd: EndCallback): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      onError('Speech recognition not supported in this browser');
      return;
    }

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: SpeechRecognitionEventLike) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        onTranscript(result[0].transcript, result.isFinal);
      }
    };

    rec.onerror = (e: { error: string }) => {
      onError(e.error);
    };

    rec.onend = () => {
      onEnd();
    };

    try {
      rec.start();
      this.recognition = rec;
    } catch {
      onError('Failed to start recognition');
    }
  }

  stop(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
  }

  abort(): void {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
  }
}
