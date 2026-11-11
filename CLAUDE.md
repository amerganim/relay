# Relay

A mobile-first action game where a single run is passed between players. Each player gets 60 seconds, picks one upgrade, and hands the run on. See `docs/GDD.md` for the design and `docs/ROADMAP.md` for the phased plan and current progress.

## Rules

1. Keep the game simulation deterministic and separate from rendering: seeded random numbers, fixed timestep, state as one plain serializable object. The whole handoff system depends on this.
2. Keep every tuning value (speeds, spawn rates, upgrade numbers) in data files, never in code.
3. End every task with tests passing and a playable build deployed to the preview URL.
4. Make one feature per branch, with small commits and a short description of what to test by hand.
5. Ask before adding a dependency, a paid service or a database migration.
6. Never put secrets in the repo. Read keys from environment variables that the owner sets.

Check each library's current documentation before using it. Phaser, Vite, Supabase and Capacitor change often.

## Layout

- `src/sim/` is the deterministic simulation. It must not import Phaser, touch the DOM, read the clock, or call `Math.random`, `Math.sin`, `Math.cos`, `Math.atan2` or `Math.hypot` (trig results can differ between JS engines, and the server must replay runs bit-for-bit). Use `+ - * /` and `Math.sqrt` only.
- `src/sim/data/*.json` holds every tuning value: `tuning.json`, `enemies.json`, `upgrades.json`.
- `src/client/` is rendering, input, audio and UI. It reads simulation state and never writes it except through `step()` inputs.
- `src/relay/` is the handoff protocol (claim, submit, verify). It is shared by the client and the server functions and reuses `src/sim` for replay verification.
- `supabase/` holds the proposed schema and edge functions. Nothing there is applied until the owner approves it.
- `tests/` holds Vitest tests. `e2e/` holds Playwright tests.

## Commands

- `npm run dev` starts the dev server.
- `npm test` runs Vitest once.
- `npm run lint` runs ESLint. `npm run typecheck` runs the TypeScript compiler.
- `npm run build` typechecks and builds to `dist/`.
- `npm run balance` runs the headless bot simulator and prints upgrade win rates.

## Determinism checklist for simulation changes

- All randomness goes through `src/sim/rng.ts`, and the generator state lives inside the run state.
- Iterate arrays in index order. Never iterate object keys or Sets where order could matter.
- `step()` must give the same result for the same state and input on every machine. The replay test in `tests/replay.test.ts` and the golden hash in `tests/golden.test.ts` guard this. If a change alters the golden hash on purpose, bump `SIM_VERSION` in `src/sim/version.ts` and update the hash in the same commit.
