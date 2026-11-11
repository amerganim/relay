import {
  InputRecorder,
  beginSegment,
  botChoice,
  botInput,
  chooseUpgrade,
  defaultConfig,
  deserializeRun,
  serializeRun,
  step,
  type RunState,
  type SegmentLog,
  type SimConfig,
} from '../src/sim';

export interface RecordedSegment {
  /** JSON of the run at the start of the segment. */
  start: string;
  log: SegmentLog;
}

/** Let the bot play one full segment (including the upgrade choice) and record its inputs. */
export function playSegmentWithBot(state: RunState, cfg: SimConfig = defaultConfig, skill = 1): RecordedSegment {
  const start = serializeRun(state);
  const recorder = new InputRecorder();
  while (state.phase === 'play') {
    const input = botInput(state, cfg, { skill });
    recorder.record(state.segTick, input);
    step(state, input, cfg);
  }
  if (state.phase === 'upgrade') {
    recorder.log.choice = botChoice(state);
    chooseUpgrade(state, recorder.log.choice, cfg);
  }
  return { start, log: recorder.log };
}

/** Bot plays up to `segments` segments. Returns the recordings; `state` ends in handoff or dead. */
export function playRunWithBot(state: RunState, segments: number, cfg: SimConfig = defaultConfig): RecordedSegment[] {
  const out: RecordedSegment[] = [];
  for (let i = 0; i < segments; i++) {
    if (i > 0 && !beginSegment(state, cfg)) break;
    out.push(playSegmentWithBot(state, cfg));
    if (state.phase === 'dead') break;
  }
  return out;
}

export function clone(state: RunState): RunState {
  return deserializeRun(serializeRun(state));
}
