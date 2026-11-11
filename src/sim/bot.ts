/**
 * A simple deterministic bot. It is used by the replay tests, the balance simulator and,
 * from Phase 2, bot-played segments. It is a pure function of the run state.
 */
import { defaultConfig, type SimConfig } from './config';
import { quantizeInput } from './replay';
import { enemyDef, lineOfSight } from './sim';
import type { Input, RunState } from './types';

export interface BotOptions {
  /** 0 to 1. Lower values make the bot react to threats later, like a weaker player. */
  skill: number;
}

export function botInput(state: RunState, cfg: SimConfig = defaultConfig, opts: BotOptions = { skill: 1 }): Input {
  const p = state.player;
  const { width, height } = cfg.tuning.arena;
  let fx = 0;
  let fy = 0;

  let nearest = Infinity;
  let nearestVisible = false;
  let nx = 0;
  let ny = 0;
  for (const e of state.enemies) {
    const def = enemyDef(cfg, e.type);
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
    if (d < nearest) {
      nearest = d;
      nearestVisible = lineOfSight(p.x, p.y, e.x, e.y, cfg.tuning.player.projRadius, state);
      nx = -dx / d;
      ny = -dy / d;
    }
    const reach = (e.mode !== 0 ? 200 : 95 + def.radius) * (0.5 + 0.5 * opts.skill);
    if (d < reach) {
      const w = (reach - d) / reach;
      if (e.mode !== 0) {
        // Step sideways out of a dash line instead of backing straight along it.
        const side = dx * e.vy - dy * e.vx > 0 ? 1 : -1;
        fx += e.vy * side * w * 4;
        fy += -e.vx * side * w * 4;
      }
      fx += (dx / d) * w * w * 5;
      fy += (dy / d) * w * w * 5;
    }
  }

  for (const s of state.spits) {
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
    const reach = 80 * opts.skill;
    if (d < reach) {
      const w = (reach - d) / reach;
      const side = dx * s.vy - dy * s.vx > 0 ? 1 : -1;
      fx += s.vy * side * w * 2;
      fy += -s.vx * side * w * 2;
    }
  }

  if (state.exit) {
    const dx = state.exit.x - p.x;
    const dy = state.exit.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
    fx += (dx / d) * 1.5;
    fy += (dy / d) * 1.5;
  } else if (nearest < Infinity && (nearest > p.stats.range * 0.7 || !nearestVisible)) {
    // Close in on targets that are out of range or hiding behind a pillar.
    fx += nx * (nearestVisible ? 0.9 : 1.6);
    fy += ny * (nearestVisible ? 0.9 : 1.6);
  }

  if (p.hp < p.stats.maxHp * 0.7) {
    let best = Infinity;
    let hx = 0;
    let hy = 0;
    for (const d of state.drops) {
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      const dd = Math.sqrt(dx * dx + dy * dy) + 0.001;
      if (dd < best) {
        best = dd;
        hx = dx / dd;
        hy = dy / dd;
      }
    }
    if (best < Infinity) {
      fx += hx * 1.2;
      fy += hy * 1.2;
    }
  }

  const wall = 55;
  if (p.x < wall) fx += ((wall - p.x) / wall) * 2.5;
  if (p.x > width - wall) fx -= ((p.x - (width - wall)) / wall) * 2.5;
  if (p.y < wall) fy += ((wall - p.y) / wall) * 2.5;
  if (p.y > height - wall) fy -= ((p.y - (height - wall)) / wall) * 2.5;

  // Slide around pillars: push out a little, and steer along the tangent that best matches
  // where the bot already wants to go, so it never stalls against one.
  for (const pl of state.pillars) {
    const dx = p.x - pl.x;
    const dy = p.y - pl.y;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
    const reach = pl.r + 34;
    if (d < reach) {
      const w = (reach - d) / reach;
      const ux = dx / d;
      const uy = dy / d;
      const want = Math.sqrt(fx * fx + fy * fy);
      const side = -uy * fx + ux * fy >= 0 ? 1 : -1;
      fx += ux * w * 1.5 + -uy * side * w * (1 + want) * 1.5;
      fy += uy * w * 1.5 + ux * side * w * (1 + want) * 1.5;
    }
  }

  const len = Math.sqrt(fx * fx + fy * fy);
  if (len < 0.08) return { mx: 0, my: 0 };
  return quantizeInput((fx / len) * 100, (fy / len) * 100);
}

/** Pick an upgrade index for a bot: a simple deterministic spread based on the run's own numbers. */
export function botChoice(state: RunState): number {
  if (state.offers.length === 0) return -1;
  return (state.seed + state.segment * 7 + state.kills) % state.offers.length;
}
