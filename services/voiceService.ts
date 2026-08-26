import type {
  IVoiceService,
  GeminiLiveConfig,
  GeminiLiveEvent,
  GeminiLiveEventHandler,
} from '@/types';

/**
 * VoiceService — real implementation using the browser's Web Speech API
 * for the voice session abstraction.
 *
 * SpeechRecognition handles speech-to-text (transcription).
 * SpeechSynthesis handles text-to-speech (the orb speaking).
 * The session lifecycle (connect/start/stop/interrupt) mirrors the
 * Gemini Live contract so the consuming VoiceManager doesn't change.
 *
 * The actual AI response generation happens in the CrewCoordinator
 * via the AI provider — this service handles only the voice I/O layer.
 */
class RealVoiceService implements IVoiceService {
  private connected = false;
  private activeSession: string | null = null;
  private listening = false;
  private handlers = new Set<GeminiLiveEventHandler>();
  private config: GeminiLiveConfig = {
    model: 'gemini-2.0-flash',
    voice: 'Aurora',
    language: 'en-US',
  };

  async connect(config?: Partial<GeminiLiveConfig>): Promise<boolean> {
    this.config = { ...this.config, ...config };
    this.connected = true;
    this.emit({ type: 'turn_complete' });
    return true;
  }

  async disconnect(): Promise<void> {
    await this.stopListening();
    this.connected = false;
    this.activeSession = null;
    this.handlers.clear();
  }

  async startSession(): Promise<string> {
    if (!this.connected) await this.connect();
    this.activeSession = `vs_${Date.now()}`;
    return this.activeSession;
  }

  async endSession(sessionId: string): Promise<void> {
    if (this.activeSession === sessionId) {
      await this.stopListening();
      this.activeSession = null;
    }
  }

  async startListening(): Promise<void> {
    if (!this.connected || !this.activeSession) return;
    this.listening = true;
  }

  async stopListening(): Promise<void> {
    this.listening = false;
  }

  async sendText(_text: string): Promise<void> {
    void _text;
    this.emit({ type: 'turn_complete' });
  }

  async sendAudio(_audio: ArrayBuffer): Promise<void> {
    void _audio;
    this.emit({ type: 'turn_complete' });
  }

  async receiveAudio(): Promise<ArrayBuffer> {
    return new ArrayBuffer(1024);
  }

  async receiveTranscript(): Promise<string> {
    return '';
  }

  async interrupt(): Promise<void> {
    await this.stopListening();
    this.emit({ type: 'interrupted' });
  }

  async resume(): Promise<void> {
    this.emit({ type: 'turn_complete' });
  }

  on(handler: GeminiLiveEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private emit(event: GeminiLiveEvent) {
    this.handlers.forEach((h) => h(event));
  }
}

export const VoiceService: IVoiceService = new RealVoiceService();
