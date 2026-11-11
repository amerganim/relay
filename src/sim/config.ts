import tuning from './data/tuning.json';
import enemies from './data/enemies.json';
import upgrades from './data/upgrades.json';
import type { PlayerStats } from './types';

export type Tuning = typeof tuning;

export interface EnemyDef {
  id: string;
  name: string;
  behavior: string;
  hp: number;
  speed: number;
  radius: number;
  contactDamage: number;
  minFloor: number;
  weight: number;
  /** Bosses never appear in the random spawn pool. They arrive on boss floors. */
  boss?: boolean;
  /** On death, spawn this many of another enemy type. */
  splitInto?: string;
  splitCount?: number;
  // bomb
  fuse?: number;
  blastRadius?: number;
  blastDamage?: number;
  // dash
  triggerRange?: number;
  windup?: number;
  dashSpeed?: number;
  dashTime?: number;
  cooldown?: number;
  // spit
  keepRange?: number;
  rangeSlack?: number;
  shotCooldown?: number;
  shotSpeed?: number;
  shotDamage?: number;
  shotRadius?: number;
  /** Seconds a shooter shows its aim line before firing. */
  aimTime?: number;
  shotCount?: number;
  shotSpread?: number;
  // bosses
  burstCooldown?: number;
  summonType?: string;
  summonCount?: number;
  summonEvery?: number;
  summonCap?: number;
}

export interface UpgradeEffect {
  stat: keyof PlayerStats;
  op: 'add' | 'mul';
  value: number;
}

export interface UpgradeDef {
  id: string;
  /** Risky upgrades trade a clear strength for a clear cost. None is purely harmful. */
  kind: 'safe' | 'risky';
  name: string;
  desc: string;
  effects: UpgradeEffect[];
  heal?: number;
}

export interface SimConfig {
  tuning: Tuning;
  enemies: EnemyDef[];
  upgrades: UpgradeDef[];
}

export const defaultConfig: SimConfig = {
  tuning,
  enemies: enemies as EnemyDef[],
  upgrades: upgrades as UpgradeDef[],
};

/** A deep copy that is safe to mutate, for the tuning panel and tests. */
export function cloneConfig(cfg: SimConfig = defaultConfig): SimConfig {
  return JSON.parse(JSON.stringify(cfg)) as SimConfig;
}
