/**
 * TranscriptManager — accumulates interim and final transcripts from the
 * VoiceRecorder into a single clean string, handling duplicates and
 * trimming whitespace.
 */

export class TranscriptManager {
  private finalText = '';
  private interimText = '';

  reset(): void {
    this.finalText = '';
    this.interimText = '';
  }

  push(text: string, isFinal: boolean): void {
    const clean = text.trim();
    if (!clean) return;
    if (isFinal) {
      this.finalText = (this.finalText + ' ' + clean).trim();
      this.interimText = '';
    } else {
      this.interimText = clean;
    }
  }

  getFull(): string {
    return (this.finalText + ' ' + this.interimText).trim();
  }

  getFinal(): string {
    return this.finalText;
  }

  getInterim(): string {
    return this.interimText;
  }

  hasContent(): boolean {
    return this.getFull().length > 0;
  }
}
