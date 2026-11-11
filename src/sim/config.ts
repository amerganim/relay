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
}

export interface UpgradeEffect {
  stat: keyof PlayerStats;
  op: 'add' | 'mul';
  value: number;
}

export interface UpgradeDef {
  id: string;
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
