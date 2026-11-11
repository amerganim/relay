import {
  InputRecorder,
  SIM_VERSION,
  beginSegment,
  chooseUpgrade,
  createRun,
  deserializeRun,
  hashState,
  quantizeInput,
  serializeRun,
  step,
  type Input,
  type Phase,
  type RunState,
  type SegmentLog,
  type SimConfig,
  type SimEvent,
} from '../sim';
import { clearSave, configWith, storeSave, type Overrides, type RelayInfo, type SaveData } from './storage';

const MAX_STEPS_PER_FRAME = 6;

/**
 * Owns the run and drives the simulation at a fixed timestep.
 * It knows nothing about rendering: the scene reads `state` and listens for events.
 */
export class Controller {
  cfg: SimConfig;
  overrides: Overrides;
  state: RunState | null = null;
  paused = true;
  /** Set when the current run came from the relay backend. */
  relay: RelayInfo | null = null;
  /** Fraction of a tick left over after the last step, for the renderer to interpolate with. */
  alpha = 0;

  onEvents: (events: SimEvent[]) => void = () => {};
  onPhase: (phase: Phase) => void = () => {};

  private recorder = new InputRecorder();
  private segStart = '';
  private accumulator = 0;
  private input: Input = { mx: 0, my: 0 };
  private events: SimEvent[] = [];
  private ticksSinceSave = 0;

  constructor(overrides: Overrides) {
    this.overrides = overrides;
    this.cfg = configWith(overrides);
  }

  get tickMs(): number {
    return 1000 / this.cfg.tuning.tickRate;
  }

  setOverrides(overrides: Overrides): void {
    this.overrides = overrides;
    this.cfg = configWith(overrides);
  }

  newRun(seed: number): void {
    this.relay = null;
    this.state = createRun(seed, this.cfg);
    this.startRecording();
    this.paused = false;
    this.save();
    this.onPhase(this.state.phase);
  }

  /** Start playing a run handed out by the relay backend. Relay runs always use the default tuning. */
  startFromGrant(stateJson: string, relay: RelayInfo): void {
    this.setOverrides({});
    this.relay = relay;
    this.state = deserializeRun(stateJson);
    this.startRecording();
    this.paused = false;
    this.save();
    this.onPhase(this.state.phase);
  }

  /** The finished segment as the server needs it: the input log and this client's own end-state hash. */
  segmentResult(): { log: SegmentLog; hash: string } | null {
    if (!this.state || this.state.phase === 'play' || this.state.phase === 'upgrade') return null;
    return { log: this.recorder.log, hash: hashState(this.state) };
  }

  resume(save: SaveData): void {
    this.setOverrides(save.overrides);
    this.relay = save.relay ?? null;
    this.state = save.state;
    this.segStart = save.segStart;
    this.recorder = new InputRecorder(save.log);
    this.accumulator = 0;
    this.paused = false;
    this.onPhase(this.state.phase);
  }

  /** Raw move vector from the pointer or keyboard, each component roughly in [-100, 100]. */
  setInput(mx: number, my: number): void {
    this.input = quantizeInput(mx, my);
  }

  /** Advance by real elapsed time. Runs zero or more fixed simulation ticks. */
  advance(deltaMs: number): void {
    const state = this.state;
    if (!state || this.paused || state.phase !== 'play') return;

    this.accumulator += Math.min(deltaMs, 100);
    let steps = 0;
    this.events.length = 0;
    while (this.accumulator >= this.tickMs && steps < MAX_STEPS_PER_FRAME && state.phase === 'play') {
      this.recorder.record(state.segTick, this.input);
      step(state, this.input, this.cfg, this.events);
      this.accumulator -= this.tickMs;
      steps++;
      this.ticksSinceSave++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    this.alpha = this.accumulator / this.tickMs;

    if (this.events.length) this.onEvents(this.events);
    // Reading phase through a call so TypeScript does not narrow it to 'play' from the guard above.
    const phase = this.phase();
    if (phase !== 'play') {
      this.input = { mx: 0, my: 0 };
      if (phase === 'dead') clearSave();
      else this.save();
      this.onPhase(phase);
    } else if (this.ticksSinceSave >= this.cfg.tuning.tickRate * 2) {
      this.save();
    }
  }

  phase(): Phase {
    return this.state ? this.state.phase : 'dead';
  }

  choose(index: number): boolean {
    if (!this.state || !chooseUpgrade(this.state, index, this.cfg)) return false;
    this.recorder.log.choice = index;
    this.save();
    this.onPhase(this.state.phase);
    return true;
  }

  nextSegment(): void {
    if (!this.state || !beginSegment(this.state, this.cfg)) return;
    this.startRecording();
    this.paused = false;
    this.save();
    this.onPhase(this.state.phase);
  }

  /** Forget the current run entirely, as after a leg has been handed to the relay. */
  clear(): void {
    this.state = null;
    this.relay = null;
    this.paused = true;
    clearSave();
  }

  save(): void {
    if (!this.state || this.state.phase === 'dead') return;
    this.ticksSinceSave = 0;
    storeSave({
      v: SIM_VERSION,
      overrides: this.overrides,
      segStart: this.segStart,
      log: this.recorder.log,
      state: this.state,
      relay: this.relay ?? undefined,
    });
  }

  private startRecording(): void {
    this.segStart = this.state ? serializeRun(this.state) : '';
    this.recorder = new InputRecorder();
    this.accumulator = 0;
  }
}
