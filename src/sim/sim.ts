/**
 * The deterministic simulation. Everything here is a pure function of (state, input, config).
 * No clock, no DOM, no Math.random, and no trig: only + - * / and Math.sqrt, so that every
 * JS engine produces bit-identical results and the server can verify a segment by replaying it.
 */
import { defaultConfig, type EnemyDef, type SimConfig } from './config';
import { rand, randInt, randRange } from './rng';
import type { Enemy, Input, RunState, SimEvent } from './types';
import { SIM_VERSION } from './version';

type Events = SimEvent[] | undefined;

interface Circle {
  x: number;
  y: number;
}

const defCache = new WeakMap<SimConfig, Map<string, EnemyDef>>();

export function enemyDef(cfg: SimConfig, type: string): EnemyDef {
  let map = defCache.get(cfg);
  if (!map) {
    map = new Map(cfg.enemies.map((d) => [d.id, d]));
    defCache.set(cfg, map);
  }
  const def = map.get(type);
  if (!def) throw new Error(`Unknown enemy type: ${type}`);
  return def;
}

/** Seconds to whole ticks, at least one. */
function ticks(cfg: SimConfig, seconds: number): number {
  return Math.max(1, Math.round(seconds * cfg.tuning.tickRate));
}

export function segmentTicks(cfg: SimConfig = defaultConfig): number {
  return ticks(cfg, cfg.tuning.segmentSeconds);
}

export function createRun(seed: number, cfg: SimConfig = defaultConfig): RunState {
  const t = cfg.tuning;
  const p = t.player;
  const state: RunState = {
    v: SIM_VERSION,
    seed: seed >>> 0,
    rng: seed | 0,
    tick: 0,
    segment: 0,
    segTick: 0,
    phase: 'play',
    floor: 0,
    kills: 0,
    floorKills: 0,
    floorSpawned: 0,
    floorQuota: 0,
    spawnTimer: 0,
    exit: null,
    pillars: [],
    player: {
      x: t.arena.width / 2,
      y: t.arena.height * 0.72,
      hp: p.maxHp,
      invuln: ticks(cfg, p.handoffInvulnSeconds),
      fireTimer: 0,
      novaTimer: ticks(cfg, t.nova.interval),
      ax: 0,
      ay: -1,
      stats: {
        maxHp: p.maxHp,
        moveSpeed: p.moveSpeed,
        damage: p.damage,
        fireCooldown: p.fireCooldown,
        projectiles: p.projectiles,
        pierce: p.pierce,
        projSpeed: p.projSpeed,
        range: p.range,
        regen: p.regen,
        novaDamage: p.novaDamage,
        healOnKill: p.healOnKill,
      },
    },
    enemies: [],
    shots: [],
    spits: [],
    drops: [],
    nextId: 1,
    offers: [],
    upgrades: [],
  };
  enterFloor(state, 1, cfg);
  return state;
}

function enterFloor(state: RunState, floor: number, cfg: SimConfig): void {
  const f = cfg.tuning.floor;
  const { width, height } = cfg.tuning.arena;
  state.floor = floor;
  state.floorKills = 0;
  state.floorSpawned = 0;
  state.floorQuota = Math.min(f.maxQuota, f.baseQuota + f.quotaPerFloor * (floor - 1));
  state.spawnTimer = ticks(cfg, f.firstSpawnDelay);
  state.exit = null;
  state.enemies = [];
  state.shots = [];
  state.spits = [];
  state.drops = [];
  state.pillars = [];

  const count = f.pillarsMin + randInt(state, f.pillarsMax - f.pillarsMin + 1);
  const gap = cfg.tuning.player.radius * 2 + 14;
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const r = randRange(state, f.pillarRadiusMin, f.pillarRadiusMax);
      const x = randRange(state, r + 34, width - r - 34);
      const y = randRange(state, r + 60, height - r - 60);
      if (dist(x, y, state.player.x, state.player.y) < r + 60) continue;
      let clear = true;
      for (const other of state.pillars) {
        if (dist(x, y, other.x, other.y) < r + other.r + gap) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      state.pillars.push({ x, y, r });
      break;
    }
  }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function clampToArena(o: Circle, r: number, cfg: SimConfig): void {
  const { width, height } = cfg.tuning.arena;
  if (o.x < r) o.x = r;
  else if (o.x > width - r) o.x = width - r;
  if (o.y < r) o.y = r;
  else if (o.y > height - r) o.y = height - r;
}

function pushOutOfPillars(o: Circle, r: number, state: RunState): void {
  for (const p of state.pillars) {
    const dx = o.x - p.x;
    const dy = o.y - p.y;
    const min = r + p.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    if (d === 0) {
      o.y = p.y - min;
    } else {
      o.x = p.x + (dx / d) * min;
      o.y = p.y + (dy / d) * min;
    }
  }
}

function insidePillar(x: number, y: number, r: number, state: RunState): boolean {
  for (const p of state.pillars) {
    if (dist(x, y, p.x, p.y) < r + p.r) return true;
  }
  return false;
}

/** True if the straight line between two points misses every pillar by at least `pad`. */
export function lineOfSight(ax: number, ay: number, bx: number, by: number, pad: number, state: RunState): boolean {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  for (const p of state.pillars) {
    let t = len2 > 0 ? ((p.x - ax) * ex + (p.y - ay) * ey) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = ax + ex * t - p.x;
    const dy = ay + ey * t - p.y;
    const r = p.r + pad;
    if (dx * dx + dy * dy < r * r) return false;
  }
  return true;
}

function hurtPlayer(state: RunState, amount: number, cfg: SimConfig, ev: Events): void {
  const p = state.player;
  if (p.invuln > 0 || amount <= 0) return;
  p.hp -= amount;
  p.invuln = ticks(cfg, cfg.tuning.player.invulnSeconds);
  ev?.push({ t: 'hurt', amount });
}

function healPlayer(state: RunState, amount: number): void {
  const p = state.player;
  p.hp = Math.min(p.stats.maxHp, p.hp + amount);
}

function spawnEnemy(state: RunState, cfg: SimConfig): void {
  const f = cfg.tuning.floor;
  const { width, height } = cfg.tuning.arena;

  let total = 0;
  for (const d of cfg.enemies) if (d.minFloor <= state.floor) total += d.weight;
  let roll = rand(state) * total;
  let def = cfg.enemies[0];
  for (const d of cfg.enemies) {
    if (d.minFloor > state.floor) continue;
    def = d;
    roll -= d.weight;
    if (roll < 0) break;
  }

  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const side = randInt(state, 4);
    const along = rand(state);
    if (side === 0) {
      x = along * width;
      y = def.radius;
    } else if (side === 1) {
      x = along * width;
      y = height - def.radius;
    } else if (side === 2) {
      x = def.radius;
      y = along * height;
    } else {
      x = width - def.radius;
      y = along * height;
    }
    if (
      dist(x, y, state.player.x, state.player.y) >= f.spawnMinPlayerDistance &&
      !insidePillar(x, y, def.radius, state)
    ) {
      break;
    }
  }

  const hp = Math.round(def.hp * (1 + f.hpScalePerFloor * (state.floor - 1)));
  const enemy: Enemy = {
    id: state.nextId++,
    type: def.id,
    x,
    y,
    hp,
    maxHp: hp,
    mode: 0,
    timer: def.behavior === 'spit' ? ticks(cfg, (def.shotCooldown ?? 2) / 2) : 0,
    vx: 0,
    vy: 0,
  };
  clampToArena(enemy, def.radius, cfg);
  pushOutOfPillars(enemy, def.radius, state);
  state.enemies.push(enemy);
  state.floorSpawned++;
}

function updatePlayer(state: RunState, input: Input, cfg: SimConfig): void {
  const p = state.player;
  const pt = cfg.tuning.player;
  const dt = 1 / cfg.tuning.tickRate;

  const len = Math.sqrt(input.mx * input.mx + input.my * input.my);
  if (len > pt.inputDeadzone) {
    const mag = Math.min(1, len / pt.inputFull);
    const speed = p.stats.moveSpeed * mag * dt;
    p.x += (input.mx / len) * speed;
    p.y += (input.my / len) * speed;
  }
  clampToArena(p, pt.radius, cfg);
  pushOutOfPillars(p, pt.radius, state);
  clampToArena(p, pt.radius, cfg);

  if (p.invuln > 0) p.invuln--;
  if (p.stats.regen > 0) healPlayer(state, p.stats.regen * dt);
}

function updateSpawning(state: RunState, cfg: SimConfig): void {
  const f = cfg.tuning.floor;
  if (state.floorSpawned >= state.floorQuota) return;
  if (state.spawnTimer > 0) {
    state.spawnTimer--;
    return;
  }
  const maxAlive = Math.min(f.maxAliveCap, f.baseMaxAlive + f.maxAlivePerFloor * (state.floor - 1));
  if (state.enemies.length >= maxAlive) return;
  spawnEnemy(state, cfg);
  let interval = f.spawnInterval;
  for (let i = 1; i < state.floor; i++) interval *= f.spawnIntervalDecay;
  state.spawnTimer = ticks(cfg, Math.max(f.minSpawnInterval, interval));
}

function updateAttack(state: RunState, cfg: SimConfig, ev: Events): void {
  const p = state.player;
  const pt = cfg.tuning.player;
  if (p.fireTimer > 0) p.fireTimer -= 1;
  if (p.fireTimer > 0) return;

  let target: Enemy | null = null;
  let best = Infinity;
  for (const e of state.enemies) {
    const d = dist(e.x, e.y, p.x, p.y) - enemyDef(cfg, e.type).radius;
    // Only aim at enemies the shot can actually reach.
    if (d < best && d <= p.stats.range && lineOfSight(p.x, p.y, e.x, e.y, pt.projRadius, state)) {
      best = d;
      target = e;
    }
  }
  if (!target) {
    p.fireTimer = 0;
    return;
  }

  const d = dist(target.x, target.y, p.x, p.y);
  if (d > 0) {
    p.ax = (target.x - p.x) / d;
    p.ay = (target.y - p.y) / d;
  }
  const n = Math.max(1, Math.round(p.stats.projectiles));
  const life = ticks(cfg, (p.stats.range * 1.1) / p.stats.projSpeed);
  const step = p.stats.projSpeed / cfg.tuning.tickRate;
  for (let i = 0; i < n; i++) {
    // Fan the shots out by tilting the aim along its perpendicular, which needs no trig.
    const k = (i - (n - 1) / 2) * pt.spread;
    let dx = p.ax - p.ay * k;
    let dy = p.ay + p.ax * k;
    const l = Math.sqrt(dx * dx + dy * dy);
    dx /= l;
    dy /= l;
    state.shots.push({
      x: p.x + dx * pt.radius,
      y: p.y + dy * pt.radius,
      vx: dx * step,
      vy: dy * step,
      life,
      damage: p.stats.damage,
      pierce: Math.round(p.stats.pierce),
      hit: [],
    });
  }
  p.fireTimer += p.stats.fireCooldown * cfg.tuning.tickRate;
  ev?.push({ t: 'shoot' });
}

function updateEnemies(state: RunState, cfg: SimConfig, ev: Events): void {
  const p = state.player;
  const pt = cfg.tuning.player;
  const f = cfg.tuning.floor;
  const dt = 1 / cfg.tuning.tickRate;
  const speedScale = Math.min(f.maxSpeedScale, 1 + f.speedScalePerFloor * (state.floor - 1));
  const damageScale = 1 + f.damageScalePerFloor * (state.floor - 1);

  for (const e of state.enemies) {
    const def = enemyDef(cfg, e.type);
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const ux = d > 0 ? dx / d : 0;
    const uy = d > 0 ? dy / d : 1;
    const walk = def.speed * speedScale * dt;

    if (def.behavior === 'dash') {
      if (e.mode === 0) {
        e.x += ux * walk;
        e.y += uy * walk;
        if (e.timer > 0) e.timer--;
        else if (d < (def.triggerRange ?? 0)) {
          e.mode = 1;
          e.timer = ticks(cfg, def.windup ?? 0.5);
          e.vx = ux;
          e.vy = uy;
          ev?.push({ t: 'windup', id: e.id });
        }
      } else if (e.mode === 1) {
        // Track the player for the first half of the windup, then commit to a direction.
        if (e.timer > ticks(cfg, def.windup ?? 0.5) / 2) {
          e.vx = ux;
          e.vy = uy;
        }
        if (--e.timer <= 0) {
          e.mode = 2;
          e.timer = ticks(cfg, def.dashTime ?? 0.4);
        }
      } else {
        const dash = (def.dashSpeed ?? 300) * dt;
        e.x += e.vx * dash;
        e.y += e.vy * dash;
        if (--e.timer <= 0) {
          e.mode = 0;
          e.timer = ticks(cfg, def.cooldown ?? 1);
        }
      }
    } else if (def.behavior === 'spit') {
      const keep = def.keepRange ?? 150;
      const slack = def.rangeSlack ?? 20;
      if (d > keep + slack) {
        e.x += ux * walk;
        e.y += uy * walk;
      } else if (d < keep - slack) {
        e.x -= ux * walk;
        e.y -= uy * walk;
      }
      if (e.timer > 0) e.timer--;
      else if (d < keep * 1.7) {
        const shotStep = (def.shotSpeed ?? 140) * dt;
        state.spits.push({
          x: e.x + ux * def.radius,
          y: e.y + uy * def.radius,
          vx: ux * shotStep,
          vy: uy * shotStep,
          r: def.shotRadius ?? 5,
          damage: (def.shotDamage ?? 8) * damageScale,
        });
        e.timer = ticks(cfg, def.shotCooldown ?? 2);
        ev?.push({ t: 'spit' });
      }
    } else {
      e.x += ux * walk;
      e.y += uy * walk;
    }
  }

  // Keep enemies from stacking on top of each other.
  const list = state.enemies;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const ra = enemyDef(cfg, a.type).radius;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const min = ra + enemyDef(cfg, b.type).radius;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      a.x -= (dx / d) * push;
      a.y -= (dy / d) * push;
      b.x += (dx / d) * push;
      b.y += (dy / d) * push;
    }
  }

  for (const e of list) {
    const def = enemyDef(cfg, e.type);
    clampToArena(e, def.radius, cfg);
    pushOutOfPillars(e, def.radius, state);
    if (dist(e.x, e.y, p.x, p.y) < def.radius + pt.radius) {
      hurtPlayer(state, def.contactDamage * damageScale, cfg, ev);
    }
  }
}

function updateShots(state: RunState, cfg: SimConfig, ev: Events): void {
  const projR = cfg.tuning.player.projRadius;
  const { width, height } = cfg.tuning.arena;
  let kept = 0;
  for (const s of state.shots) {
    s.x += s.vx;
    s.y += s.vy;
    s.life--;
    let alive = s.life > 0 && s.x > 0 && s.x < width && s.y > 0 && s.y < height;
    if (alive && insidePillar(s.x, s.y, projR, state)) alive = false;
    if (alive) {
      for (const e of state.enemies) {
        if (e.hp <= 0 || s.hit.includes(e.id)) continue;
        if (dist(s.x, s.y, e.x, e.y) >= enemyDef(cfg, e.type).radius + projR) continue;
        e.hp -= s.damage;
        s.hit.push(e.id);
        ev?.push({ t: 'hit', id: e.id, x: s.x, y: s.y });
        if (s.pierce <= 0) {
          alive = false;
          break;
        }
        s.pierce--;
      }
    }
    if (alive) state.shots[kept++] = s;
  }
  state.shots.length = kept;
}

function updateSpits(state: RunState, cfg: SimConfig, ev: Events): void {
  const p = state.player;
  const pr = cfg.tuning.player.radius;
  const { width, height } = cfg.tuning.arena;
  let kept = 0;
  for (const s of state.spits) {
    s.x += s.vx;
    s.y += s.vy;
    let alive = s.x > -s.r && s.x < width + s.r && s.y > -s.r && s.y < height + s.r;
    if (alive && insidePillar(s.x, s.y, s.r, state)) alive = false;
    if (alive && dist(s.x, s.y, p.x, p.y) < s.r + pr) {
      hurtPlayer(state, s.damage, cfg, ev);
      alive = false;
    }
    if (alive) state.spits[kept++] = s;
  }
  state.spits.length = kept;
}

function updateNova(state: RunState, cfg: SimConfig, ev: Events): void {
  const p = state.player;
  if (p.stats.novaDamage <= 0) return;
  if (p.novaTimer > 0) {
    p.novaTimer--;
    return;
  }
  const r = cfg.tuning.nova.radius;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    if (dist(e.x, e.y, p.x, p.y) < r + enemyDef(cfg, e.type).radius) {
      e.hp -= p.stats.novaDamage;
      ev?.push({ t: 'hit', id: e.id, x: e.x, y: e.y });
    }
  }
  p.novaTimer = ticks(cfg, cfg.tuning.nova.interval);
  ev?.push({ t: 'nova', x: p.x, y: p.y, r });
}

function removeDead(state: RunState, cfg: SimConfig, ev: Events): void {
  const dr = cfg.tuning.drops;
  let kept = 0;
  for (const e of state.enemies) {
    if (e.hp > 0) {
      state.enemies[kept++] = e;
      continue;
    }
    state.kills++;
    state.floorKills++;
    ev?.push({ t: 'kill', x: e.x, y: e.y, type: e.type });
    if (state.player.stats.healOnKill > 0) healPlayer(state, state.player.stats.healOnKill);
    if (rand(state) < dr.heartChance) {
      state.drops.push({ x: e.x, y: e.y, life: ticks(cfg, dr.lifetime) });
    }
  }
  state.enemies.length = kept;
}

function updateDrops(state: RunState, cfg: SimConfig, ev: Events): void {
  const p = state.player;
  const dr = cfg.tuning.drops;
  let kept = 0;
  for (const d of state.drops) {
    d.life--;
    if (dist(d.x, d.y, p.x, p.y) < dr.pickupRadius) {
      healPlayer(state, dr.heartHeal);
      ev?.push({ t: 'pickup' });
      continue;
    }
    if (d.life > 0) state.drops[kept++] = d;
  }
  state.drops.length = kept;
}

function updateFloor(state: RunState, cfg: SimConfig, ev: Events): void {
  const f = cfg.tuning.floor;
  const p = state.player;
  const { width, height } = cfg.tuning.arena;

  if (!state.exit && state.floorKills >= state.floorQuota) {
    let x = width / 2;
    let y = height / 2;
    for (let attempt = 0; attempt < 30; attempt++) {
      x = randRange(state, 40, width - 40);
      y = randRange(state, 70, height - 70);
      if (dist(x, y, p.x, p.y) >= 120 && !insidePillar(x, y, f.exitRadius + 8, state)) break;
    }
    const spot = { x, y };
    pushOutOfPillars(spot, f.exitRadius + 8, state);
    clampToArena(spot, f.exitRadius, cfg);
    state.exit = spot;
    ev?.push({ t: 'exit' });
    return;
  }

  if (state.exit && dist(state.exit.x, state.exit.y, p.x, p.y) < f.exitRadius + cfg.tuning.player.radius) {
    healPlayer(state, f.healOnClimb);
    enterFloor(state, state.floor + 1, cfg);
    ev?.push({ t: 'climb', floor: state.floor });
  }
}

function rollOffers(state: RunState, cfg: SimConfig): void {
  const pool = cfg.upgrades.map((u) => u.id);
  const n = Math.min(cfg.tuning.upgradeChoices, pool.length);
  state.offers = [];
  for (let i = 0; i < n; i++) {
    const j = i + randInt(state, pool.length - i);
    const picked = pool[j];
    pool[j] = pool[i];
    pool[i] = picked;
    state.offers.push(picked);
  }
}

/** Advance the run by one tick. Mutates `state`. Does nothing unless the run is in the play phase. */
export function step(state: RunState, input: Input, cfg: SimConfig = defaultConfig, ev?: SimEvent[]): void {
  if (state.phase !== 'play') return;

  updatePlayer(state, input, cfg);
  updateSpawning(state, cfg);
  updateAttack(state, cfg, ev);
  updateEnemies(state, cfg, ev);
  updateShots(state, cfg, ev);
  updateSpits(state, cfg, ev);
  updateNova(state, cfg, ev);
  removeDead(state, cfg, ev);
  updateDrops(state, cfg, ev);
  updateFloor(state, cfg, ev);

  state.tick++;
  state.segTick++;

  if (state.player.hp <= 0) {
    state.player.hp = 0;
    state.phase = 'dead';
    ev?.push({ t: 'dead' });
    return;
  }
  if (state.segTick >= segmentTicks(cfg)) {
    state.phase = 'upgrade';
    rollOffers(state, cfg);
    ev?.push({ t: 'segmentEnd' });
  }
}

/** Take one of the offered upgrades. Returns false if the choice is not valid right now. */
export function chooseUpgrade(state: RunState, index: number, cfg: SimConfig = defaultConfig): boolean {
  if (state.phase !== 'upgrade') return false;
  if (!Number.isInteger(index) || index < 0 || index >= state.offers.length) return false;
  const id = state.offers[index];
  const def = cfg.upgrades.find((u) => u.id === id);
  if (!def) return false;

  const stats = state.player.stats;
  for (const fx of def.effects) {
    if (fx.op === 'add') stats[fx.stat] += fx.value;
    else stats[fx.stat] *= fx.value;
  }
  if (def.heal) state.player.hp += def.heal;
  state.player.hp = Math.min(state.player.hp, stats.maxHp);

  state.upgrades.push(id);
  state.offers = [];
  state.phase = 'handoff';
  return true;
}

/** Start the next carrier's segment. Returns false unless the run is waiting for a handoff. */
export function beginSegment(state: RunState, cfg: SimConfig = defaultConfig): boolean {
  if (state.phase !== 'handoff') return false;
  state.segment++;
  state.segTick = 0;
  state.phase = 'play';
  state.player.invuln = Math.max(state.player.invuln, ticks(cfg, cfg.tuning.player.handoffInvulnSeconds));
  return true;
}
