/** Seeded random numbers (mulberry32). The generator state lives in the run state so a run can be saved and resumed exactly. */
export interface RngHolder {
  rng: number;
}

export function nextU32(s: RngHolder): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform in [0, 1). */
export function rand(s: RngHolder): number {
  return nextU32(s) / 4294967296;
}

/** Uniform integer in [0, n). */
export function randInt(s: RngHolder, n: number): number {
  return Math.floor(rand(s) * n);
}

/** Uniform in [a, b). */
export function randRange(s: RngHolder, a: number, b: number): number {
  return a + rand(s) * (b - a);
}
