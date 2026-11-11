import { describe, expect, it } from 'vitest';
import {
  botInput,
  chooseUpgrade,
  cloneConfig,
  createRun,
  defaultConfig,
  enemyDef,
  isBossFloor,
  step,
  type RunState,
  type SimConfig,
} from '../src/sim';

const idle = { mx: 0, my: 0 };

function sturdy(): SimConfig {
  const cfg = cloneConfig();
  cfg.tuning.player.maxHp = 1e9;
  cfg.tuning.player.damage = 60;
  return cfg;
}

/** Bot plays until the run reaches `floor`, choosing the first upgrade whenever one is offered. */
function climbTo(state: RunState, floor: number, cfg: SimConfig, maxTicks = 200_000): void {
  for (let i = 0; i < maxTicks && state.floor < floor; i++) {
    if (state.phase === 'upgrade') {
      chooseUpgrade(state, 0, cfg);
      state.phase = 'play';
      state.segTick = 0;
    }
    step(state, botInput(state, cfg), cfg);
  }
}

describe('content', () => {
  it('has 30 upgrades, 8 regular enemies and 2 bosses', () => {
    expect(defaultConfig.upgrades).toHaveLength(30);
    expect(new Set(defaultConfig.upgrades.map((u) => u.id)).size).toBe(30);
    expect(defaultConfig.enemies.filter((e) => !e.boss)).toHaveLength(8);
    expect(defaultConfig.enemies.filter((e) => e.boss)).toHaveLength(2);
    for (const id of defaultConfig.tuning.floor.bosses) expect(enemyDef(defaultConfig, id).boss).toBe(true);
    for (const e of defaultConfig.enemies) {
      if (e.splitInto) expect(() => enemyDef(defaultConfig, e.splitInto!)).not.toThrow();
      if (e.summonType) expect(() => enemyDef(defaultConfig, e.summonType!)).not.toThrow();
    }
  });

  it('no upgrade is purely harmful: every one improves at least one stat', () => {
    const higherIsBetter: Record<string, boolean> = { fireCooldown: false, damageTaken: false, novaRate: false };
    for (const u of defaultConfig.upgrades) {
      const helps = u.effects.some((fx) => {
        const better = higherIsBetter[fx.stat] ?? true;
        const up = fx.op === 'add' ? fx.value > 0 : fx.value > 1;
        return up === better;
      });
      expect(helps || !!u.heal, u.id).toBe(true);
      if (u.kind === 'risky') {
        const hurts = u.effects.some((fx) => {
          const better = higherIsBetter[fx.stat] ?? true;
          const up = fx.op === 'add' ? fx.value > 0 : fx.value > 1;
          return up !== better;
        });
        expect(hurts, `${u.id} is marked risky but has no cost`).toBe(true);
      }
    }
  });

  it('every offer pairs a safe option with a risky one', () => {
    const kind = new Map(defaultConfig.upgrades.map((u) => [u.id, u.kind]));
    const cfg = sturdy();
    for (let seed = 1; seed <= 40; seed++) {
      const state = createRun(seed, cfg);
      state.segTick = 3599;
      step(state, idle, cfg);
      expect(state.phase).toBe('upgrade');
      expect(state.offers).toHaveLength(3);
      expect(new Set(state.offers).size).toBe(3);
      const kinds = state.offers.map((id) => kind.get(id));
      expect(kinds).toContain('safe');
      expect(kinds).toContain('risky');
    }
  });

  it('stacking any upgrade many times keeps every stat finite and inside its limits', () => {
    const limits = defaultConfig.tuning.statLimits as Record<string, number[]>;
    for (const u of defaultConfig.upgrades) {
      const state = createRun(1);
      for (let i = 0; i < 40; i++) {
        state.phase = 'upgrade';
        state.offers = [u.id];
        expect(chooseUpgrade(state, 0)).toBe(true);
      }
      for (const [key, value] of Object.entries(state.player.stats)) {
        expect(Number.isFinite(value), `${u.id} ${key}`).toBe(true);
        if (limits[key]) {
          expect(value).toBeGreaterThanOrEqual(limits[key][0]);
          expect(value).toBeLessThanOrEqual(limits[key][1]);
        }
      }
      expect(state.player.hp).toBeGreaterThanOrEqual(1);
      expect(state.player.hp).toBeLessThanOrEqual(state.player.stats.maxHp);
      // The run is still playable afterwards.
      state.phase = 'play';
      for (let i = 0; i < 600; i++) step(state, botInput(state));
      expect(Number.isFinite(state.player.x + state.player.y + state.player.hp)).toBe(true);
    }
  });

  it('boss floors arrive every fifth floor, alternate bosses, and can be cleared', () => {
    expect(isBossFloor(4)).toBe(false);
    expect(isBossFloor(5)).toBe(true);
    expect(isBossFloor(10)).toBe(true);

    const cfg = sturdy();
    const state = createRun(31, cfg);
    climbTo(state, 5, cfg);
    expect(state.floor).toBe(5);
    expect(state.enemies.map((e) => e.type)).toContain('warden');
    climbTo(state, 6, cfg);
    expect(state.floor).toBe(6);
    climbTo(state, 10, cfg);
    expect(state.enemies.map((e) => e.type)).toContain('matriarch');
    climbTo(state, 11, cfg);
    expect(state.floor).toBe(11);
  }, 60_000);

  it('every regular enemy type shows up by floor 9, and floors never get stuck', () => {
    const cfg = sturdy();
    const seen = new Set<string>();
    const state = createRun(77, cfg);
    let lastFloor = 1;
    let ticksOnFloor = 0;
    for (let i = 0; i < 300_000 && state.floor < 14; i++) {
      if (state.phase === 'upgrade') {
        chooseUpgrade(state, 0, cfg);
        state.phase = 'play';
        state.segTick = 0;
      }
      step(state, botInput(state, cfg), cfg);
      for (const e of state.enemies) seen.add(e.type);
      if (state.floor !== lastFloor) {
        lastFloor = state.floor;
        ticksOnFloor = 0;
      } else {
        ticksOnFloor++;
      }
      // Kills always add up: the floor counter can never exceed what was spawned.
      expect(state.floorKills).toBeLessThanOrEqual(state.floorSpawned);
      expect(ticksOnFloor, `stuck on floor ${state.floor}`).toBeLessThan(60 * 180);
    }
    expect(state.floor).toBe(14);
    for (const e of defaultConfig.enemies) expect(seen.has(e.id), e.id).toBe(true);
  }, 120_000);
});
