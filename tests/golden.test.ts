import { expect, it } from 'vitest';
import { createRun, hashState } from '../src/sim';
import { playRunWithBot } from './helpers';

/**
 * A fixed seed played by the bot must always end in exactly this state.
 * If this fails, the simulation's results changed. That breaks saved runs and server verification,
 * so either undo the change or bump SIM_VERSION and update the hash in the same commit
 * (run `npx vitest run -u tests/golden.test.ts`).
 */
it('golden run: seed 20261111, two bot segments', () => {
  const state = createRun(20261111);
  playRunWithBot(state, 2);
  expect(`${state.phase} floor ${state.floor} kills ${state.kills} ${hashState(state)}`).toMatchInlineSnapshot(`"handoff floor 8 kills 77 7e7aa0b595e171f2"`);
});
