# Relay: game design document

> This document was rebuilt from the build plan in `docs/PLAN.md`. The original design conversation was not available, so anything marked "assumption" is a working choice made during Phase 1 and is open to change.

## Pitch

Relay is a tower-climbing action game where one run belongs to many players. You carry the torch for 60 seconds, pick one upgrade for whoever comes next, and hand the run on through a link. The run keeps climbing after you leave, and you get told how far it went.

## Core loop

1. **Receive a run.** Open the app or a share link and you are dropped straight into a run someone else left for you, with their upgrades and their damage.
2. **Play 60 seconds.** Drag anywhere to move. The torchbearer attacks the nearest enemy automatically. Clear a floor's enemies to open the stairs and climb.
3. **Choose one upgrade from three.** The choice shapes the run for the next carrier. Later phases always pair a safe option with a risky one, and never offer a purely harmful one.
4. **Hand off.** The run goes to the next player, through a share link or the queue.
5. **Follow it.** A timeline shows who carried the run, the floors climbed and the emotes left behind. A notification arrives when the run reaches a new milestone or ends.

A run ends when a carrier dies. Score is the number of floors climbed by the whole chain.

## The 60-second segment (Phase 1 design)

- **Controls:** one thumb. Drag anywhere on screen and the torchbearer moves in the drag direction. Release to stop. Attacking is automatic.
- **Arena:** one portrait screen per floor (assumption). Each floor has pillars placed from the run seed.
- **Floors:** every floor has a kill quota. When it is met, stairs appear. Touching the stairs climbs to the next floor and heals a little. Higher floors spawn enemies faster and with more health.
- **Enemies (Phase 1):** the Grunt walks at you, the Dasher winds up and charges, the Spitter keeps its distance and shoots slow embers.
- **Timer:** 60 seconds. When it ends the action freezes and three upgrades are offered.
- **Death:** health reaching zero ends the run for everyone.
- **Upgrades (Phase 1, 10 total):** Sharp Embers, Quick Hands, Fleet Feet, Iron Heart, Split Shot, Piercing Flame, Long Reach, Second Wind, Flame Nova, Blood Torch. All are plain stat changes defined in `src/sim/data/upgrades.json`.
- **Feedback:** hit flashes, screen shake, synthesized sound and phone vibration.

In Phase 1 there is no backend. After choosing an upgrade you hand the run to yourself and play the next segment, which tests whether the minute is fun on its own.

## Modes

| Mode | What it is | Phase |
| --- | --- | --- |
| Open relay | Runs pass between strangers through a queue | 2 |
| Share link | `/r/<run id>` opens straight into play | 2 |
| Daily Relay | One shared seed and one global leaderboard per day | 3 |
| Friend chains | Private relays started from a link | 3 |
| Rescue runs | A queue of nearly dead runs with bonus rewards | 3 |

## Technical pillars

- **Deterministic simulation.** Seeded random numbers, a fixed 60 Hz timestep and state as one plain JSON object. A segment is fully described by its starting state and an input log, so the server can replay it to verify the result, and a run can be saved, resumed and handed off exactly.
- **Data-driven tuning.** Every number lives in a data file.
- **One codebase.** TypeScript, Phaser and Vite on the web, wrapped with Capacitor for iOS and Android.

## Monetization

Cosmetics only: torch skins and trails that travel with the run, a season pass, and extra daily handoffs. No purchasable power.

## Risks

| Risk | Why it matters | Response |
| --- | --- | --- |
| The minute is dull | The relay idea cannot rescue a dull core | Phase 1 gate: 7 of 10 strangers replay 3+ times, or change the core action |
| Waiting for a run | An empty queue kills the first session | Bot-played segments and bot-seeded runs |
| Griefing | A carrier can waste or sabotage a run | Safe/risky choices only, reputation score, rescue runs |
| Cheating | Faked segments ruin leaderboards | Server replays every input log with the same simulation code |
| Lost or duplicated runs | Breaks trust in the whole idea | Claim locks with expiry, idempotent submit, chain tests |
| The name | "Relay" is a common word | Check trademarks and store search before committing |
| Retention targets | The numbers are estimates, not benchmarks | Replace them with soft-launch data |

## Decisions that stay with the owner

- The name, after trademark and store-search checks
- Art direction and audio, or the budget to commission them
- Developer accounts for the Apple and Google stores, payments and push
- Prices for cosmetics and the season pass
- Soft-launch markets
- Whether each gate has truly been met
