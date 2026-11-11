import { SIM_VERSION, cloneConfig, type RunState, type SegmentLog, type SimConfig } from '../sim';

const SAVE_KEY = 'relay.save';
const BEST_KEY = 'relay.best';
const TUNING_KEY = 'relay.tuning';

/** Tuning overrides as dotted paths into the config, for example "tuning.player.moveSpeed". */
export type Overrides = Record<string, number>;

export interface SaveData {
  v: number;
  overrides: Overrides;
  /** JSON of the run at the start of the current segment. With `log` it is what the server will verify. */
  segStart: string;
  log: SegmentLog;
  /** The run exactly as it was when saved. */
  state: RunState;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable. The game still plays, it just cannot resume later.
  }
}

export function loadSave(): SaveData | null {
  const save = read<SaveData>(SAVE_KEY);
  if (!save || save.v !== SIM_VERSION || !save.state || save.state.phase === 'dead') return null;
  return save;
}

export function storeSave(save: SaveData): void {
  write(SAVE_KEY, save);
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function loadBest(): number {
  return read<number>(BEST_KEY) ?? 0;
}

export function storeBest(floor: number): void {
  write(BEST_KEY, floor);
}

export function loadOverrides(): Overrides {
  return read<Overrides>(TUNING_KEY) ?? {};
}

export function storeOverrides(overrides: Overrides): void {
  write(TUNING_KEY, overrides);
}

export function getPath(cfg: SimConfig, path: string): number {
  let node: unknown = cfg;
  for (const key of path.split('.')) node = (node as Record<string, unknown>)?.[key];
  return node as number;
}

/** The default config with the given overrides applied. */
export function configWith(overrides: Overrides): SimConfig {
  const cfg = cloneConfig();
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split('.');
    let node = cfg as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1 && node; i++) node = node[keys[i]] as Record<string, unknown>;
    const last = keys[keys.length - 1];
    if (node && typeof node[last] === 'number' && Number.isFinite(value)) node[last] = value;
  }
  return cfg;
}
