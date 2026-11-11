import { describe, expect, it } from 'vitest';
import {
  beginSegment,
  botInput,
  createRun,
  deserializeRun,
  hashState,
  replaySegment,
  serializeRun,
  step,
  validateLog,
} from '../src/sim';
import { clone, playRunWithBot, playSegmentWithBot } from './helpers';

describe('replay', () => {
  it('replaying a recorded input log reaches the identical end state', () => {
    for (const seed of [1, 42, 20261111]) {
      const live = createRun(seed);
      const segments = playRunWithBot(live, 4);
      expect(segments.length).toBeGreaterThan(0);

      // Replay each segment from its recorded start and chain them together.
      const replayed = deserializeRun(segments[0].start);
      segments.forEach((seg, i) => {
        if (i > 0) beginSegment(replayed);
        expect(serializeRun(replayed)).toBe(seg.start);
        replaySegment(replayed, seg.log);
      });

      expect(hashState(replayed)).toBe(hashState(live));
      expect(serializeRun(replayed)).toBe(serializeRun(live));
    }
  });

  it('a run saved as JSON mid-segment continues exactly', () => {
    const straight = createRun(7);
    const resumed = createRun(7);
    for (let i = 0; i < 1500; i++) {
      step(straight, botInput(straight));
    }
    for (let i = 0; i < 1500; i++) {
      step(resumed, botInput(resumed));
      if (i === 400 || i === 1111) {
        Object.assign(resumed, deserializeRun(serializeRun(resumed)));
      }
    }
    // A save and load in the middle changes nothing.
    const reloaded = deserializeRun(serializeRun(resumed));
    for (let i = 0; i < 1500; i++) {
      step(straight, botInput(straight));
      step(reloaded, botInput(reloaded));
    }
    expect(hashState(reloaded)).toBe(hashState(straight));
  });

  it('a tampered log does not reach the same state', () => {
    const live = createRun(99);
    const seg = playSegmentWithBot(live);
    const honest = replaySegment(deserializeRun(seg.start), seg.log);
    expect(hashState(honest)).toBe(hashState(live));

    const forged = { moves: seg.log.moves.slice(), choice: seg.log.choice };
    forged.moves[1] = forged.moves[1] === 100 ? -100 : 100;
    forged.moves[2] = 0;
    let forgedHash: string;
    try {
      forgedHash = hashState(replaySegment(deserializeRun(seg.start), forged));
    } catch {
      forgedHash = 'rejected';
    }
    expect(forgedHash).not.toBe(hashState(live));
  });

  it('rejects malformed logs', () => {
    expect(validateLog({ moves: [0, 10], choice: 0 })).not.toBeNull();
    expect(validateLog({ moves: [5, 0, 0, 5, 1, 1], choice: 0 })).not.toBeNull();
    expect(validateLog({ moves: [0, 500, 0], choice: 0 })).not.toBeNull();
    expect(validateLog({ moves: [0, 0.5, 0], choice: 0 })).not.toBeNull();
    expect(validateLog({ moves: [999999, 1, 1], choice: 0 })).not.toBeNull();
    expect(validateLog({ moves: [0, 100, -100, 9, 0, 0], choice: 2 })).toBeNull();
    const state = createRun(3);
    expect(() => replaySegment(clone(state), { moves: [], choice: 7 })).toThrow();
  });
});
