export class FarmAudio {
  private context: AudioContext | null = null;
  enabled = true;

  unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Gameplay remains available when audio is unavailable. */ }
  }

  play(kind: string) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const notes = ({ harvest: [523.25, 659.25, 783.99], plant: [392, 523.25], water: [587.33, 440], soil: [196], coin: [659.25, 880], celebrate: [392, 493.88, 587.33, 783.99], select: [440] } as Record<string, number[]>)[kind] ?? [392];
    notes.forEach((frequency, index) => {
      const ctx = this.context!;
      const start = ctx.currentTime + index * .065;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = kind === 'soil' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * .98, start + .2);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.045, start + .008);
      gain.gain.exponentialRampToValueAtTime(.001, start + .24);
      oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.start(start); oscillator.stop(start + .26);
    });
  }
}
