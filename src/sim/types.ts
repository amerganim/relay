export type Phase = 'play' | 'upgrade' | 'handoff' | 'dead';

export interface PlayerStats {
  maxHp: number;
  moveSpeed: number;
  damage: number;
  fireCooldown: number;
  projectiles: number;
  pierce: number;
  projSpeed: number;
  range: number;
  regen: number;
  novaDamage: number;
  healOnKill: number;
  /** Chance for a shot to deal critMult times its damage. */
  critChance: number;
  /** Multiplier on all damage the player takes. */
  damageTaken: number;
  /** Damage dealt back to an enemy whose touch hurts the player. */
  thorns: number;
  /** Multiplier on projectile radius. */
  projSize: number;
  /** Added to the chance that a dead enemy drops a heart. */
  dropBonus: number;
  /** Added to the heal on every climb. */
  climbHeal: number;
  /** Multiplier on the time between novas. */
  novaRate: number;
}

export interface Player {
  x: number;
  y: number;
  hp: number;
  /** Ticks of invulnerability left. */
  invuln: number;
  /** Ticks until the next shot. */
  fireTimer: number;
  /** Ticks until the next nova. */
  novaTimer: number;
  /** Last aim direction (unit vector), for rendering. */
  ax: number;
  ay: number;
  stats: PlayerStats;
}

export interface Enemy {
  id: number;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Behavior state: 0 normal, 1 winding up, 2 dashing. */
  mode: number;
  /** Ticks left in the current mode or cooldown. */
  timer: number;
  vx: number;
  vy: number;
}

/** A player projectile. */
export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks left. */
  life: number;
  damage: number;
  pierce: number;
  /** Ids of enemies already hit, so a piercing shot hits each enemy once. */
  hit: number[];
  crit: boolean;
}

/** An enemy projectile. */
export interface Spit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
}

export interface Drop {
  x: number;
  y: number;
  /** Ticks left. */
  life: number;
}

export interface Pillar {
  x: number;
  y: number;
  r: number;
}

/** The whole run as one plain JSON-serializable object. */
export interface RunState {
  /** Simulation version that produced this state. */
  v: number;
  seed: number;
  rng: number;
  /** Total ticks played across all segments. */
  tick: number;
  /** Index of the current segment. One segment is one carrier's 60 seconds. */
  segment: number;
  /** Ticks played in the current segment. */
  segTick: number;
  phase: Phase;
  floor: number;
  kills: number;
  floorKills: number;
  floorSpawned: number;
  floorQuota: number;
  /** Ticks until the next enemy spawn. */
  spawnTimer: number;
  exit: { x: number; y: number } | null;
  pillars: Pillar[];
  player: Player;
  enemies: Enemy[];
  shots: Shot[];
  spits: Spit[];
  drops: Drop[];
  nextId: number;
  /** Upgrade ids on offer during the upgrade phase. */
  offers: string[];
  /** Upgrade ids taken so far, in order. */
  upgrades: string[];
}

/** One tick of player input: a move vector with integer components in [-100, 100]. */
export interface Input {
  mx: number;
  my: number;
}

/**
 * A recorded segment. `moves` is a flat list of [segTick, mx, my] triples, one per change of input.
 * `choice` is the index of the upgrade picked at the end, or -1 if the segment ended in death.
 */
export interface SegmentLog {
  moves: number[];
  choice: number;
}

/** Things that happened during a tick, for rendering and sound. Never part of the run state. */
export type SimEvent =
  | { t: 'shoot' }
  | { t: 'hit'; id: number; x: number; y: number; crit?: boolean }
  | { t: 'kill'; x: number; y: number; type: string; boss: boolean }
  | { t: 'explode'; x: number; y: number; r: number }
  | { t: 'hurt'; amount: number }
  | { t: 'spit' }
  | { t: 'windup'; id: number }
  | { t: 'nova'; x: number; y: number; r: number }
  | { t: 'pickup' }
  | { t: 'exit' }
  | { t: 'climb'; floor: number; boss: boolean }
  | { t: 'segmentEnd' }
  | { t: 'dead' };
