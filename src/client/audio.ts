/** Tiny synthesized sound effects. No audio files, so the first load stays small. */
type SfxName =
  | 'shoot'
  | 'hit'
  | 'kill'
  | 'hurt'
  | 'spit'
  | 'windup'
  | 'nova'
  | 'pickup'
  | 'exit'
  | 'climb'
  | 'tick'
  | 'timeup'
  | 'pick'
  | 'dead'
  | 'start';

const MUTE_KEY = 'relay.muted';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private last = new Map<SfxName, number>();
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // Storage can be unavailable in private windows. Sound just starts unmuted.
    }
  }

  /** Must be called from a user gesture (tap or key) before any sound can play. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.3);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Ignore: the setting just will not persist.
    }
  }

  private tone(freq: number, to: number, dur: number, vol: number, type: OscillatorType = 'square', delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff: number): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  play(name: SfxName): void {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    // Avoid stacking the same sound many times within a frame or two.
    const now = this.ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < 0.04) return;
    this.last.set(name, now);

    switch (name) {
      case 'shoot':
        this.tone(720, 420, 0.05, 0.035, 'triangle');
        break;
      case 'hit':
        this.noise(0.05, 0.12, 2400);
        break;
      case 'kill':
        this.tone(420, 90, 0.16, 0.12, 'square');
        this.noise(0.12, 0.14, 1200);
        break;
      case 'hurt':
        this.tone(160, 50, 0.25, 0.3, 'sawtooth');
        this.noise(0.2, 0.25, 600);
        break;
      case 'spit':
        this.tone(300, 520, 0.08, 0.05, 'sine');
        break;
      case 'windup':
        this.tone(240, 720, 0.3, 0.07, 'sawtooth');
        break;
      case 'nova':
        this.tone(140, 50, 0.35, 0.18, 'sine');
        this.noise(0.3, 0.16, 900);
        break;
      case 'pickup':
        this.tone(660, 990, 0.12, 0.1, 'sine');
        break;
      case 'exit':
        this.tone(523, 523, 0.1, 0.1, 'triangle');
        this.tone(784, 784, 0.16, 0.1, 'triangle', 0.1);
        break;
      case 'climb':
        this.tone(392, 392, 0.09, 0.12, 'triangle');
        this.tone(523, 523, 0.09, 0.12, 'triangle', 0.08);
        this.tone(784, 784, 0.2, 0.12, 'triangle', 0.16);
        break;
      case 'tick':
        this.tone(880, 880, 0.05, 0.08, 'square');
        break;
      case 'timeup':
        this.tone(660, 330, 0.4, 0.14, 'triangle');
        break;
      case 'pick':
        this.tone(523, 523, 0.08, 0.12, 'triangle');
        this.tone(659, 659, 0.08, 0.12, 'triangle', 0.07);
        this.tone(1047, 1047, 0.22, 0.12, 'triangle', 0.14);
        break;
      case 'dead':
        this.tone(330, 40, 0.9, 0.25, 'sawtooth');
        this.noise(0.3, 0.3, 500);
        break;
      case 'start':
        this.tone(330, 660, 0.18, 0.1, 'triangle');
        break;
    }
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS Safari). Native haptics arrive with the Capacitor build in Phase 4.
  }
}
