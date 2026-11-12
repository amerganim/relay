# Relay

**Play the latest build:** https://amerganim.github.io/relay/

Carry the torch for 60 seconds, pick one upgrade, and pass the run on.

Relay is a mobile-first tower-climbing action game where one run is shared by many players. This repository holds the web client, the deterministic simulation and (from Phase 2) the handoff backend.

- Design: [docs/GDD.md](docs/GDD.md)
- Progress: [docs/ROADMAP.md](docs/ROADMAP.md)
- Original plan: [docs/PLAN.md](docs/PLAN.md)

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. On a desktop, use the arrow keys or WASD. On a phone, drag anywhere.

## Check it

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run build
```

```bash
npm run balance
```

`npm run balance` lets bots play hundreds of runs and prints how far they get and how each upgrade performs.

## Try a handoff locally

The game runs solo unless it is pointed at a relay backend. To pass a run between two browsers on your machine, start the in-memory relay server in one terminal:

```bash
npm run relay
```

and the client in another:

```bash
npm run dev:relay
```

Open the client in two different browsers (or one normal and one private window), start a run in one, and choose "Carry a run" in the other. The automated version of this is:

```bash
npm run test:e2e
```

The production backend is proposed in [docs/PHASE2_PROPOSAL.md](docs/PHASE2_PROPOSAL.md) and waits for approval.

## Tuning

Every gameplay number lives in `src/sim/data/`. To try values on a phone without a rebuild, open the hidden tuning panel: tap the floor label five times during a run, or add `?tune` to the URL.

## How it is built

The simulation in `src/sim/` is deterministic: seeded random numbers, a fixed 60 Hz timestep and state as one plain JSON object. A 60-second segment is fully described by its starting state and a short input log, which is what makes saving, resuming, handing off and server-side verification possible. The renderer in `src/client/` only reads that state.
