import { defaultConfig, type SimConfig } from './config';
import { chooseUpgrade, segmentTicks, step } from './sim';
import type { Input, RunState, SegmentLog } from './types';

const MAX_INPUT = 100;

/** Clamp and round a raw move vector to the integer range the simulation accepts. */
export function quantizeInput(mx: number, my: number): Input {
  const q = (v: number) => Math.max(-MAX_INPUT, Math.min(MAX_INPUT, Math.round(v))) || 0;
  return { mx: q(mx), my: q(my) };
}

/** Records one segment's inputs as a compact list of changes. */
export class InputRecorder {
  readonly log: SegmentLog;
  private lastX = 0;
  private lastY = 0;

  constructor(existing?: SegmentLog) {
    this.log = existing ?? { moves: [], choice: -1 };
    const m = this.log.moves;
    if (m.length >= 3) {
      this.lastX = m[m.length - 2];
      this.lastY = m[m.length - 1];
    }
  }

  /** Call once per tick, before stepping, with the tick's index within the segment. */
  record(segTick: number, input: Input): void {
    if (input.mx === this.lastX && input.my === this.lastY) return;
    this.log.moves.push(segTick, input.mx, input.my);
    this.lastX = input.mx;
    this.lastY = input.my;
  }
}

/** Returns a reason if the log is malformed, or null if it is well formed. */
export function validateLog(log: SegmentLog, cfg: SimConfig = defaultConfig): string | null {
  if (!log || !Array.isArray(log.moves) || !Number.isInteger(log.choice)) return 'malformed log';
  const m = log.moves;
  if (m.length % 3 !== 0) return 'moves length is not a multiple of 3';
  if (m.length / 3 > segmentTicks(cfg)) return 'too many moves';
  let last = -1;
  for (let i = 0; i < m.length; i += 3) {
    const tick = m[i];
    if (!Number.isInteger(tick) || tick <= last || tick >= segmentTicks(cfg)) return 'bad tick order';
    last = tick;
    for (const v of [m[i + 1], m[i + 2]]) {
      if (!Number.isInteger(v) || v < -MAX_INPUT || v > MAX_INPUT) return 'input out of range';
    }
  }
  return null;
}

/**
 * Play a recorded segment from `state` (which must be at the start of a segment, in the play phase)
 * to its end, including the upgrade choice. Mutates and returns `state`.
 * The client, the tests and the server all use this same function.
 */
export function replaySegment(state: RunState, log: SegmentLog, cfg: SimConfig = defaultConfig): RunState {
  const problem = validateLog(log, cfg);
  if (problem) throw new Error(`Invalid segment log: ${problem}`);
  if (state.phase !== 'play' || state.segTick !== 0) throw new Error('State is not at the start of a segment');

  const m = log.moves;
  const input: Input = { mx: 0, my: 0 };
  let i = 0;
  while (state.phase === 'play') {
    while (i < m.length && m[i] <= state.segTick) {
      input.mx = m[i + 1];
      input.my = m[i + 2];
      i += 3;
    }
    step(state, input, cfg);
  }
  if (state.phase === 'upgrade') {
    if (!chooseUpgrade(state, log.choice, cfg)) throw new Error('Invalid upgrade choice');
  } else if (log.choice !== -1) {
    throw new Error('Upgrade choice given for a segment that ended in death');
  }
  return state;
}
