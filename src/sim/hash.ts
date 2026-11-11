import type { RunState } from './types';

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Canonical JSON text of a run. Key order is insertion order, which survives a JSON round trip. */
export function serializeRun(state: RunState): string {
  return JSON.stringify(state);
}

export function deserializeRun(json: string): RunState {
  return JSON.parse(json) as RunState;
}

/** A 16-hex-digit fingerprint of the full run state. Two states with the same hash are treated as identical. */
export function hashState(state: RunState): string {
  const text = serializeRun(state);
  const a = fnv1a(text, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a(text, 0x9747b28c).toString(16).padStart(8, '0');
  return a + b;
}
