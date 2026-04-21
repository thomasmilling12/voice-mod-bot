export class SpeakerStats {
  private speakStart: Map<string, number> = new Map();
  private totalMs: Map<string, number> = new Map();

  startSpeaking(userId: string): void {
    if (!this.speakStart.has(userId)) {
      this.speakStart.set(userId, Date.now());
    }
  }

  stopSpeaking(userId: string): void {
    const start = this.speakStart.get(userId);
    if (start === undefined) return;
    const elapsed = Date.now() - start;
    this.totalMs.set(userId, (this.totalMs.get(userId) ?? 0) + elapsed);
    this.speakStart.delete(userId);
  }

  getTotalMs(userId: string): number {
    return this.totalMs.get(userId) ?? 0;
  }

  getTopSpeaker(): string | null {
    let top: string | null = null;
    let max = 0;
    for (const [id, ms] of this.totalMs) {
      if (ms > max) { max = ms; top = id; }
    }
    return top;
  }

  getSortedSpeakers(): Array<{ userId: string; ms: number }> {
    return [...this.totalMs.entries()]
      .map(([userId, ms]) => ({ userId, ms }))
      .sort((a, b) => b.ms - a.ms);
  }

  formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }
}
