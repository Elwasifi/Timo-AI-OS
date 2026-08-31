import { VoiceService } from '@/services/voiceService';
import { VoiceRecorder } from './voice-recorder';
import { VoicePlayer } from './voice-player';
import { TranscriptManager } from './transcript-manager';
import { cleanForSpeech } from './speech-cleaner';
import { detectSleepWakeCommand } from './sleepWake';
import { useVoiceStore } from '@/stores/voiceStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { crewCoordinator } from '@/lib/crew/crew-coordinator';
import { orchestrate } from '@/lib/swarm';
import { useAuthStore } from '@/stores/authStore';
import { getClientProfile } from '@/lib/governance/clientProfile';
import { logger } from '@/lib/utils/logger';
import type { VoiceSettings } from '@/types';

export type ReplyHandler = (response: string, transcript: string) => void;

type VoiceMode = 'push-to-talk' | 'continuous';

// M6-09: settings.pushToTalk already had a real, live Settings UI toggle
// ("Push to talk" / "Hold spacebar to speak") that persisted to the store —
// but nothing ever read it to actually switch VoiceManager's mode, which
// stayed hardcoded to 'push-to-talk' regardless. Continuous mode itself had
// no turn-detection at all: stopRecognitionAndProcess() was only ever
// called from push-to-talk branches, so a continuous session would just
// listen forever with nothing to submit a turn — not usable as
// "continuous" in any real sense. VAD_SILENCE_MS is a simple, free
// silence-timeout VAD built on SpeechRecognition's own transcript timing
// (no raw audio/AnalyserNode needed) — reset on every interim/final
// result, fires a turn submission if speech has genuinely paused.
const VAD_SILENCE_MS = 1500;

export class VoiceManager {
  private recorder = new VoiceRecorder();
  private player = new VoicePlayer();
  private transcript = new TranscriptManager();
  private replyHandler: ReplyHandler | null = null;
  private mode: VoiceMode = 'push-to-talk';
  private isProcessingVoice = false;
  private recognitionEnded = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while a continuous-mode hands-free conversation is meant to keep
   * going turn after turn — distinct from isListening, which is false
   * during the (silent, in-between) processing/speaking part of each turn.
   * Cleared on any explicit user stop so a finishing turn doesn't
   * auto-resume into a session the user already ended. */
  private continuousSessionActive = false;

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /** Resets the VAD's silence window — called on every transcript update
   * while in continuous mode. If speech genuinely pauses for VAD_SILENCE_MS,
   * the pending turn is submitted automatically. */
  private armSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.mode !== 'continuous' || this.isProcessingVoice) return;
      const pending = this.transcript.getFull().trim();
      if (pending.length === 0) return;
      logger.voiceDebug('VAD: silence detected, submitting turn');
      void this.stopRecognitionAndProcess();
    }, VAD_SILENCE_MS);
  }

  setReplyHandler(handler: ReplyHandler): void {
    this.replyHandler = handler;
  }

  setMode(mode: VoiceMode): void {
    this.mode = mode;
    logger.voiceDebug(`Mode set to ${mode}`);
  }

  private languageSynced = false;

  /**
   * M6-09: speech-recognition language and the client's chat-language
   * preference (lib/governance/clientProfile.ts, M3-06's "Egyptian Arabic,
   * not formal Modern Standard Arabic" directive used for AI responses)
   * were two completely unconnected settings — a client whose profile
   * prefers Arabic still got en-US speech recognition by default until
   * they separately, manually changed it in Settings -> Voice. Runs once
   * per session; never overrides a language the user has already actively
   * chosen (only nudges the untouched en-US default).
   */
  private async syncLanguageFromProfile(): Promise<void> {
    if (this.languageSynced) return;
    this.languageSynced = true;
    try {
      const tenantId = useAuthStore.getState().currentTenantId;
      const profile = await getClientProfile(tenantId);
      const store = useVoiceStore.getState();
      if (profile?.preferredLanguage === 'ar' && store.settings.language === 'en-US') {
        store.setLanguage('ar-EG');
        logger.voice('Voice recognition language auto-set to ar-EG from client profile');
      }
    } catch {
      // Non-fatal — recognition still works with whatever language is set.
    }
  }

  isRecognitionSupported(): boolean {
    return this.recorder.isSupported();
  }

  isSynthesisSupported(): boolean {
    return this.player.isSupported();
  }

  getAvailableVoices(): SpeechSynthesisVoice[] {
    return this.player.getVoices();
  }

  async connect(): Promise<void> {
    await this.syncLanguageFromProfile();
    const store = useVoiceStore.getState();
    await VoiceService.connect({ language: store.settings.language });
    store.setConnected(true);
    logger.voice('Voice connected');
  }

  async disconnect(): Promise<void> {
    this.stopAll();
    await VoiceService.disconnect();
    useVoiceStore.getState().setConnected(false);
    logger.voice('Voice disconnected');
  }

  /**
   * Start listening — begins speech recognition and shows live transcript.
   * In push-to-talk mode, stops automatically when the user stops speaking.
   * In continuous mode, keeps listening until explicitly stopped.
   */
  async startListening(): Promise<void> {
    if (this.isProcessingVoice) {
      logger.voiceWarn('Already processing voice, ignoring start');
      return;
    }

    const store = useVoiceStore.getState();
    if (!store.isConnected) await this.connect();

    // M6-09: sync from the real Settings -> Voice -> "Push to talk" toggle,
    // which persisted to the store but was never actually read here before.
    this.setMode(store.settings.pushToTalk ? 'push-to-talk' : 'continuous');
    if (this.mode === 'continuous') this.continuousSessionActive = true;

    // Stop any ongoing speech
    this.player.stop();
    store.stopSpeaking();

    const sessionId = await VoiceService.startSession();
    store.setSessionId(sessionId);
    await VoiceService.startListening();

    this.transcript.reset();
    this.recognitionEnded = false;
    this.clearSilenceTimer();
    store.startListening();
    store.setTranscript('');
    store.setInterimTranscript('');

    logger.voice('Listening started', { mode: this.mode, lang: store.settings.language });

    this.recorder.start(
      store.settings.language,
      (text, isFinal) => {
        this.transcript.push(text, isFinal);
        const full = this.transcript.getFull();
        const interim = this.transcript.getInterim();
        store.setTranscript(full);
        store.setInterimTranscript(interim);
        if (this.mode === 'continuous') this.armSilenceTimer();
        logger.voiceDebug(`Transcript ${isFinal ? 'final' : 'interim'}: "${text.slice(0, 40)}"`);

        // Auto-send in push-to-talk when we get a final result
        if (isFinal && this.mode === 'push-to-talk' && !this.isProcessingVoice) {
          const finalText = this.transcript.getFinal();
          if (finalText.trim().length > 0) {
            logger.voice('Auto-sending (push-to-talk final)');
            this.stopRecognitionAndProcess();
          }
        }
      },
      (error) => {
        logger.voiceWarn(`Recognition error: ${error}`);
        if (error === 'no-speech' || error === 'aborted') {
          // In push-to-talk, no-speech means the user didn't say anything
          if (error === 'no-speech' && this.mode === 'push-to-talk') {
            store.stopListening();
            store.reset();
            store.setError("Didn't catch that — try again.");
          }
          return;
        }
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          logger.error('Microphone permission denied');
          store.stopListening();
          store.reset();
          store.setError('Microphone access denied — allow microphone permission and try again.');
          return;
        }
        store.setError(`Voice recognition error: ${error}`);
        this.stopAll();
      },
      () => {
        // onend — recognition stopped naturally
        if (this.recognitionEnded) return;
        this.recognitionEnded = true;
        logger.voiceDebug('Recognition ended naturally');

        if (this.mode === 'push-to-talk' && !this.isProcessingVoice) {
          const finalText = this.transcript.getFinal();
          if (finalText.trim().length > 0) {
            this.stopRecognitionAndProcess();
          } else {
            store.stopListening();
            store.reset();
          }
        } else if (this.mode === 'continuous') {
          // In continuous mode, restart recognition if it ends unexpectedly
          // and we're still in listening state
          if (useVoiceStore.getState().isListening && !this.isProcessingVoice) {
            logger.voiceDebug('Restarting recognition (continuous mode)');
            this.recognitionEnded = false;
            setTimeout(() => this.restartRecognition(), 100);
          }
        }
      },
    );
  }

  private restartRecognition(): void {
    const store = useVoiceStore.getState();
    if (!store.isListening || this.isProcessingVoice) return;
    this.recorder.start(
      store.settings.language,
      (text, isFinal) => {
        this.transcript.push(text, isFinal);
        store.setTranscript(this.transcript.getFull());
        store.setInterimTranscript(this.transcript.getInterim());
        if (this.mode === 'continuous') this.armSilenceTimer();
      },
      (error) => {
        logger.voiceWarn(`Recognition restart error: ${error}`);
        if (error === 'no-speech' || error === 'aborted') return;
        this.stopAll();
      },
      () => {
        if (this.recognitionEnded) return;
        this.recognitionEnded = true;
        if (this.mode === 'continuous' && useVoiceStore.getState().isListening && !this.isProcessingVoice) {
          this.recognitionEnded = false;
          setTimeout(() => this.restartRecognition(), 100);
        }
      },
    );
  }

  /**
   * Stop listening manually (user clicked stop or mic button).
   */
  async stopListening(): Promise<void> {
    logger.voice('Stop listening requested');
    // M6-09: an explicit user stop always ends a continuous session — a
    // turn already in flight (below) must not auto-resume into listening
    // again once it finishes.
    this.continuousSessionActive = false;
    this.clearSilenceTimer();
    const finalText = this.transcript.getFinal();
    if (finalText.trim().length > 0 && !this.isProcessingVoice) {
      this.stopRecognitionAndProcess();
    } else {
      this.recorder.stop();
      useVoiceStore.getState().stopListening();
      useVoiceStore.getState().reset();
    }
  }

  /**
   * Stop recognition and process the collected transcript.
   */
  private async stopRecognitionAndProcess(): Promise<void> {
    if (this.isProcessingVoice) return;
    this.isProcessingVoice = true;
    this.clearSilenceTimer();

    this.recorder.stop();
    await VoiceService.stopListening();

    const store = useVoiceStore.getState();
    store.stopListening();

    // Capture the finalized transcript BEFORE the store is reset. Falls
    // back to the full (interim-included) transcript for the continuous-
    // mode VAD path: the browser may not have finalized the last fragment
    // yet when the silence timeout fires, even though real speech content
    // is there.
    const text = (this.transcript.getFinal() || this.transcript.getFull()).trim();
    logger.voice(`Processing voice input: "${text.slice(0, 60)}"`);

    if (!text) {
      store.reset();
      store.setError("Didn't catch any speech — try again.");
      this.isProcessingVoice = false;
      return;
    }

    // Sleep/wake is a local, instant state toggle — never routed through
    // orchestrate()/the Model Router, since it must work even while asleep
    // (when normal mission execution is deliberately suppressed below) and
    // shouldn't cost a provider call for a fixed phrase match.
    const command = detectSleepWakeCommand(text);
    if (command === 'sleep') {
      store.setSleeping(true);
      const reply = 'Going to sleep. Say "wake up Temo" to bring me back.';
      this.replyHandler?.(reply, text);
      await this.speak(reply);
      store.setThinking(false);
      store.reset();
      this.isProcessingVoice = false;
      return;
    }
    if (command === 'wake') {
      store.setSleeping(false);
      const reply = "I'm awake and ready.";
      this.replyHandler?.(reply, text);
      await this.speak(reply);
      store.setThinking(false);
      store.reset();
      this.isProcessingVoice = false;
      return;
    }
    if (store.isSleeping) {
      // Asleep and this wasn't a wake phrase — per the sleep contract,
      // Temo does not execute missions or respond while sleeping.
      store.reset();
      this.isProcessingVoice = false;
      return;
    }

    store.setThinking(true);

    try {
      // Ensure a conversation exists for persistence
      if (!crewCoordinator.getConversationId()) {
        await crewCoordinator.startConversation(text.slice(0, 40), 'temo');
      }

      // Route through the same unified orchestrate() pipeline used by text chat.
      // This ensures voice and text share the same decision engine, mission
      // pipeline, routing, Nova delegation, memory/tools, and agent execution path.
      const result = await orchestrate(text, {
        announce: true,
        stream: false,
        tenantId: useAuthStore.getState().currentTenantId ?? '00000000-0000-0000-0000-000000000001',
        isVoice: true,
      });

      const response = result.response;
      logger.voice(`Got response (pipeline=${result.pipeline}), length=${response.length}`);

      // Notify the chat UI — pass the captured transcript explicitly so the
      // UI can add the user message even though the voice store is about to reset.
      this.replyHandler?.(response, text);

      // Speak the response
      await this.speak(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Voice processing failed';
      logger.error(`Voice processing error: ${message}`);
      this.replyHandler?.(`I encountered an issue: ${message}`, text);
      // M3-10: surface real voice-flow failures through the shared store too
      // — pages with no replyHandler (Main Dashboard) previously had no way
      // to know a voice request failed at all.
      store.setError(message);
    } finally {
      store.setThinking(false);
      store.reset();
      this.isProcessingVoice = false;
    }

    // M6-09: real hands-free multi-turn conversation — without this,
    // "continuous" mode only ever completed exactly one turn before
    // falling silent, the same as push-to-talk. Only resumes if the user
    // hasn't explicitly stopped in the meantime (continuousSessionActive)
    // and nothing put the manager to sleep during this turn.
    if (this.mode === 'continuous' && this.continuousSessionActive && !useVoiceStore.getState().isSleeping) {
      setTimeout(() => {
        if (this.continuousSessionActive && !this.isProcessingVoice) void this.startListening();
      }, 300);
    }
  }

  async speak(text: string): Promise<void> {
    const store = useVoiceStore.getState();
    if (store.isMuted) {
      logger.voiceDebug('Speak skipped (muted)');
      store.reset();
      return;
    }

    const spokenText = cleanForSpeech(text);

    // M3-11: real DB-backed agents (agentRecordToRuntimeAgent()) all carried
    // the identical placeholder voice config { voiceName: 'Default', lang:
    // 'en-US', ... } — there is no real per-agent voice differentiation in
    // the live path today. Preferring that config here silently ignored the
    // user's own Settings → Voice selection on every real interaction (it
    // was "stored and ignored", confirmed live). store.settings always has
    // a real value (initialized to DEFAULT_SETTINGS, updated by Settings →
    // Voice), so the user's explicit choice is used directly.
    logger.voiceDebug(`Speaking: "${spokenText.slice(0, 50)}"`, { voice: store.settings.selectedVoice });

    store.startSpeaking();

    return new Promise((resolve) => {
      this.player.speak({
        text: spokenText,
        voiceName: store.settings.selectedVoice,
        lang: store.settings.language,
        rate: store.settings.speed,
        pitch: store.settings.pitch,
        volume: store.settings.volume,
        onEnd: () => {
          store.stopSpeaking();
          store.reset();
          resolve();
        },
        // M4-04: previously a silent resolve() — indistinguishable from a
        // normal completed reply. Speech synthesis failing (including the
        // new watchdog timeout in voice-player.ts) is a real, user-visible
        // event now, via the same error surface M3-10 built for the rest
        // of the voice flow.
        onError: () => {
          store.stopSpeaking();
          store.reset();
          store.setError("Voice playback didn't complete — try again.");
          resolve();
        },
      });
    });
  }

  /** Speak as a specific agent — used for voice preview from profiles. */
  async speakAsAgent(text: string, agentId: string): Promise<void> {
    const agent = useDashboardStore.getState().agents.find((a) => a.id === agentId);
    if (!agent) return;
    const store = useVoiceStore.getState();
    if (store.isMuted) return;

    const spokenText = cleanForSpeech(text);

    return new Promise((resolve) => {
      this.player.speak({
        text: spokenText,
        voiceName: agent.voice.voiceName,
        lang: agent.voice.lang,
        rate: agent.voice.rate,
        pitch: agent.voice.pitch,
        volume: store.settings.volume,
        onEnd: () => resolve(),
        onError: () => resolve(),
      });
    });
  }

  /** Interrupt — immediately stops everything (recognition + speech). */
  interrupt(): void {
    logger.voice('Interrupt triggered');
    this.player.stop();
    this.recorder.abort();
    VoiceService.interrupt();
    this.isProcessingVoice = false;
    useVoiceStore.getState().reset();
  }

  /** Resume — restarts listening after an interruption. */
  async resume(): Promise<void> {
    logger.voice('Resume triggered');
    await this.startListening();
  }

  stopAll(): void {
    this.continuousSessionActive = false;
    this.clearSilenceTimer();
    this.player.stop();
    this.recorder.abort();
    this.isProcessingVoice = false;
    useVoiceStore.getState().reset();
  }
}

export const voiceManager = new VoiceManager();
