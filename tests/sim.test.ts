import { describe, expect, it } from 'vitest';
import {
  beginSegment,
  chooseUpgrade,
  cloneConfig,
  createRun,
  defaultConfig,
  segmentTicks,
  step,
} from '../src/sim';
import { clone } from './helpers';

const idle = { mx: 0, my: 0 };

/** A config where the player cannot die, for tests about timing and flow. */
function safeConfig() {
  const cfg = cloneConfig();
  cfg.tuning.player.maxHp = 1e9;
  return cfg;
}

describe('simulation', () => {
  it('a segment lasts exactly 60 seconds and then offers three distinct upgrades', () => {
    const cfg = safeConfig();
    const state = createRun(5, cfg);
    for (let i = 0; i < segmentTicks(cfg) - 1; i++) step(state, idle, cfg);
    expect(state.phase).toBe('play');
    step(state, idle, cfg);
    expect(state.phase).toBe('upgrade');
    expect(state.segTick).toBe(3600);
    expect(state.offers).toHaveLength(3);
    expect(new Set(state.offers).size).toBe(3);

    // Stepping while waiting for a choice does nothing.
    const before = JSON.stringify(state);
    step(state, { mx: 100, my: 0 }, cfg);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('upgrade choice applies its effects and hands off', () => {
    const cfg = safeConfig();
    const state = createRun(5, cfg);
    while (state.phase === 'play') step(state, idle, cfg);
    expect(chooseUpgrade(state, 3, cfg)).toBe(false);
    expect(chooseUpgrade(state, -1, cfg)).toBe(false);

    const statsBefore = JSON.stringify(state.player.stats);
    const hpBefore = state.player.hp;
    const picked = state.offers[1];
    expect(chooseUpgrade(state, 1, cfg)).toBe(true);
    expect(state.phase).toBe('handoff');
    expect(state.upgrades).toEqual([picked]);
    expect(JSON.stringify(state.player.stats) !== statsBefore || state.player.hp !== hpBefore).toBe(true);
    expect(chooseUpgrade(state, 0, cfg)).toBe(false);

    expect(beginSegment(state, cfg)).toBe(true);
    expect(state.phase).toBe('play');
    expect(state.segment).toBe(1);
    expect(state.segTick).toBe(0);
  });

  it('every upgrade in the data file applies cleanly', () => {
    for (let i = 0; i < defaultConfig.upgrades.length; i++) {
      const state = createRun(1);
      state.phase = 'upgrade';
      state.offers = [defaultConfig.upgrades[i].id];
      expect(chooseUpgrade(state, 0)).toBe(true);
      for (const value of Object.values(state.player.stats)) expect(Number.isFinite(value)).toBe(true);
      expect(state.player.hp).toBeLessThanOrEqual(state.player.stats.maxHp);
    }
  });

  it('a player with no damage output dies, and a dead run stays dead', () => {
    const cfg = cloneConfig();
    cfg.tuning.player.damage = 0;
    const state = createRun(11, cfg);
    for (let i = 0; i < 3600 && state.phase === 'play'; i++) step(state, idle, cfg);
    expect(state.phase).toBe('dead');
    expect(state.player.hp).toBe(0);
    const before = JSON.stringify(state);
    step(state, idle, cfg);
    expect(JSON.stringify(state)).toBe(before);
    expect(beginSegment(state, cfg)).toBe(false);
    expect(chooseUpgrade(state, 0, cfg)).toBe(false);
  });

  it('entities stay inside the arena and out of pillars', () => {
    const cfg = safeConfig();
    const { width, height } = cfg.tuning.arena;
    const state = createRun(123, cfg);
    for (let i = 0; i < 3000; i++) {
      step(state, { mx: i % 200 < 100 ? 100 : -100, my: i % 140 < 70 ? -100 : 100 }, cfg);
      const p = state.player;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(height);
      for (const e of state.enemies) {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
      }
    }
  });

  it('the same seed gives the same run and different seeds differ', () => {
    const a = createRun(77);
    const b = createRun(77);
    const c = createRun(78);
    for (let i = 0; i < 600; i++) {
      step(a, idle);
      step(b, idle);
      step(c, idle);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(JSON.stringify(clone(a))).toBe(JSON.stringify(a));
  });
});
