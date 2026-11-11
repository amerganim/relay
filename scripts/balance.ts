/**
 * Headless balance simulator. Bots play many runs and the script reports how far they get
 * and which upgrades are over- or under-performing.
 *
 *   npm run balance            500 runs at full bot skill
 *   npm run balance -- 2000 0.6   2000 runs at 60% bot skill
 */
import {
  beginSegment,
  botInput,
  chooseUpgrade,
  createRun,
  defaultConfig,
  randInt,
  step,
} from '../src/sim';

const runs = Number(process.argv[2] ?? 500);
const skill = Number(process.argv[3] ?? 1);
const maxSegments = 12;

interface Result {
  floor: number;
  segments: number;
  dead: boolean;
  upgrades: string[];
}

function playRun(seed: number): Result {
  const state = createRun(seed);
  // Upgrade picks are random here (not botChoice) so every upgrade gets an even sample.
  const picker = { rng: seed ^ 0x5bd1e995 };
  for (let s = 0; s < maxSegments; s++) {
    if (s > 0) beginSegment(state);
    while (state.phase === 'play') step(state, botInput(state, defaultConfig, { skill }));
    if (state.phase === 'dead') break;
    chooseUpgrade(state, randInt(picker, state.offers.length));
  }
  return { floor: state.floor, segments: state.segment + 1, dead: state.phase === 'dead', upgrades: state.upgrades };
}

const results: Result[] = [];
const started = Date.now();
for (let i = 0; i < runs; i++) results.push(playRun(1000 + i));
const elapsed = (Date.now() - started) / 1000;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sorted = results.map((r) => r.floor).sort((a, b) => a - b);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

console.log(`\n${runs} runs, bot skill ${skill}, ${elapsed.toFixed(1)}s`);
console.log(`floor reached: mean ${mean(sorted).toFixed(1)}, p10 ${pct(0.1)}, median ${pct(0.5)}, p90 ${pct(0.9)}`);
console.log(`segments survived: mean ${mean(results.map((r) => r.segments)).toFixed(2)} of ${maxSegments}`);

console.log('\ndeaths by segment:');
for (let s = 1; s <= maxSegments; s++) {
  const reached = results.filter((r) => r.segments >= s).length;
  const died = results.filter((r) => r.dead && r.segments === s).length;
  if (reached === 0) break;
  console.log(`  segment ${String(s).padStart(2)}: ${String(died).padStart(4)} of ${String(reached).padStart(4)} died (${((100 * died) / reached).toFixed(0)}%)`);
}

const overall = mean(results.map((r) => r.floor));
console.log('\nupgrade        runs   mean floor   vs average');
const rows = defaultConfig.upgrades.map((u) => {
  const withIt = results.filter((r) => r.upgrades.includes(u.id));
  return { id: u.id, n: withIt.length, floor: mean(withIt.map((r) => r.floor)) };
});
rows.sort((a, b) => b.floor - a.floor);
for (const row of rows) {
  const ratio = overall > 0 ? row.floor / overall : 0;
  const flag = ratio > 2 ? '  <-- more than twice the average' : ratio < 0.5 ? '  <-- less than half the average' : '';
  console.log(`${row.id.padEnd(15)}${String(row.n).padStart(4)}   ${row.floor.toFixed(1).padStart(8)}   ${ratio.toFixed(2).padStart(8)}x${flag}`);
}

// Upgrade pairs: a combination is flagged when runs holding both get more than twice as far as average.
const pairs = new Map<string, number[]>();
for (const r of results) {
  const owned = [...new Set(r.upgrades)].sort();
  for (let i = 0; i < owned.length; i++) {
    for (let j = i + 1; j < owned.length; j++) {
      const key = `${owned[i]} + ${owned[j]}`;
      const list = pairs.get(key) ?? [];
      list.push(r.floor);
      pairs.set(key, list);
    }
  }
}
const minSample = Math.max(8, Math.floor(runs / 100));
const ranked = [...pairs]
  .filter(([, floors]) => floors.length >= minSample)
  .map(([key, floors]) => ({ key, n: floors.length, ratio: overall > 0 ? mean(floors) / overall : 0 }))
  .sort((a, b) => b.ratio - a.ratio);
const broken = ranked.filter((p) => p.ratio > 2);
console.log(`\nupgrade pairs with at least ${minSample} runs: ${ranked.length}`);
console.log(broken.length ? 'pairs more than twice the average:' : 'no pair is more than twice the average. strongest five:');
for (const p of (broken.length ? broken : ranked.slice(0, 5))) {
  console.log(`  ${p.key.padEnd(34)} ${String(p.n).padStart(4)} runs  ${p.ratio.toFixed(2)}x`);
}
