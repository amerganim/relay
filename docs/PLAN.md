# Relay: Claude Code build plan

Nov 11, 2026 · @Amer

This is the original plan as written. `docs/ROADMAP.md` is the working copy with progress ticked off.

## How to use this plan

Give Claude Code one phase at a time, and do not start the next phase until you have checked the gate yourself. Each phase below has a goal, a task list, a gate and a starter prompt to paste in. Durations are estimates for one person working with Claude Code.

| Phase | Goal | Estimate | Gate |
| --- | --- | --- | --- |
| 0. Setup | Repo, tooling and auto-deploy | 2 days | Blank game loads from a public URL on your phone |
| 1. Core prototype | The 60-second run is fun alone | 2 weeks | 7 of 10 strangers replay 3+ times |
| 2. Handoff | Runs pass between real players | 3 weeks | 15-handoff chains with no lost runs |
| 3. Content and modes | Enough depth for daily play | 3 weeks | Closed test of 100+ players hits retention target |
| 4. Mobile and polish | Store-ready apps and payments | 3 weeks | Builds accepted into TestFlight and Play internal testing |
| 5. Soft launch | Tune on real players, then release | 4 weeks | Soft-launch targets met, global release shipped |
| 6. Live operations | Seasons and weekly tuning | Ongoing | Reviewed each season |

## Recommended stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Game client | TypeScript, Phaser, Vite | One codebase runs in the browser and inside the app wrapper |
| Mobile apps | Capacitor around the web build | No second codebase for iOS and Android |
| Backend | Supabase (Postgres, auth, edge functions) | Run state is plain rows, and anonymous sign-in is built in |
| Web hosting | Cloudflare Pages | Share links must open fast worldwide |
| Analytics and errors | PostHog and Sentry | Retention funnels and crash reports |
| Tests | Vitest for game logic, Playwright for flows | Claude Code can run both without a device |

Tell Claude Code to check each library's current documentation before using it, because these tools change often.

## Rules to put in CLAUDE.md

1. Keep the game simulation deterministic and separate from rendering: seeded random numbers, fixed timestep, state as one plain serializable object. The whole handoff system depends on this.
2. Keep every tuning value (speeds, spawn rates, upgrade numbers) in data files, never in code.
3. End every task with tests passing and a playable build deployed to the preview URL.
4. Make one feature per branch, with small commits and a short description of what to test by hand.
5. Ask before adding a dependency, a paid service or a database migration.
6. Never put secrets in the repo. Read keys from environment variables that you set yourself.

## Phase 0: Setup

The goal is a deploy pipeline that puts every change on a public URL within minutes, before any game code exists.

- Create the repo with Vite, TypeScript and Phaser, plus linting and Vitest
- Add CI that runs tests and deploys a preview on every push
- Write CLAUDE.md with the rules above
- Write docs/GDD.md: the Relay pitch, core loop, modes and risks from our earlier design
- Write docs/ROADMAP.md from this plan, so Claude Code can tick items off

Gate: a blank game canvas loads from the preview URL on your phone in under 3 seconds.

```
Read docs/GDD.md and docs/ROADMAP.md. Set up Phase 0: scaffold the project,
add tests and CI, and deploy a preview. Stop when the gate is met and tell me
how to check it on my phone.
```

## Phase 1: Core prototype

The goal is a 60-second run that people replay with no handoff, no accounts and no backend. This is the most important phase, because the relay idea cannot rescue a dull minute.

- Simulation core: seeded random numbers, fixed timestep, serializable state
- Drag to move, auto-attack, three enemy types
- One tower biome with procedurally generated floors
- 60-second timer, then a choice of one upgrade from three (10 upgrades total)
- Feedback: hit flashes, screen shake, sound, phone vibration
- Save and resume: a run can be stored as JSON and continued exactly
- A test that replays a recorded input log and reaches the identical end state
- A hidden tuning panel for speed, spawn rate and damage

Gate: ten people who do not know you play it on their own phones. At least seven play three or more runs in a row without being asked. If the gate fails, stay in this phase and change the core action.

```
Build Phase 1 from docs/ROADMAP.md. Start with the deterministic simulation
core and its replay test before any rendering. Deploy after each task and
tell me what to try. Keep all tuning values in data files.
```

## Phase 2: Handoff system

The goal is a run that passes between real players through a link, without ever being lost, duplicated or faked.

- Database tables for players, runs, segments and emotes
- Anonymous sign-in on first play, with an optional upgrade to a real account later
- Claim a run: a lock that expires after five minutes if the player leaves
- Submit a segment: the client sends the seed and input log, and the server replays it to verify the result
- Share links: /r/<run id> opens straight into play, with a preview image for chat apps
- Run queue that decides which waiting run a player receives
- Bot-played segments, so early players never wait for a run
- Run timeline screen: who carried it, floors climbed, emotes left
- In-app inbox and web push for "your run reached floor N"
- Playwright test: two simulated players complete a full handoff

Gate: 20 testers on a mix of phones and desktop browsers complete a chain of 15 or more handoffs. No run is lost, duplicated or stuck.

```
Build Phase 2 from docs/ROADMAP.md. Propose the database schema and the
claim/submit API first and wait for my approval. Server-side replay
verification must reuse the Phase 1 simulation code, not a copy.
```

## Phase 3: Content, modes and anti-griefing

The goal is enough variety and fairness that players return daily for weeks.

- Expand to 30 upgrades, 8 enemy types and 2 bosses
- Handoff choices always pair a safe option with a risky one, never a purely harmful one
- Daily Relay: one shared seed, one global leaderboard
- Friend chains: private relays started from a link
- Rescue runs: a queue of nearly dead runs with bonus rewards
- Reputation score that influences which runs a player receives
- First-time tutorial under 30 seconds, played on a bot-seeded run
- Headless balance simulator: bots play thousands of runs and report broken upgrade combinations

Gate: a closed test with 100 or more players shows day-1 retention of at least 35% and a median chain of 8 or more handoffs. Treat both numbers as starting targets and adjust them once you have data.

```
Build Phase 3 from docs/ROADMAP.md. Build the headless balance simulator
first, then add content in batches of five upgrades, running the simulator
after each batch and reporting any build that wins more than twice as often
as the average.
```

## Phase 4: Mobile packaging, monetization and polish

The goal is store-ready iOS and Android apps that share one codebase and one set of links with the web version.

- Wrap the web build with Capacitor for iOS and Android
- Deep links: a share link opens the app if installed and the browser if not
- Native push notifications and haptics
- Installable web app (PWA) for browser players
- Cosmetics shop: torch skins and trails that travel with the run
- Season pass and extra daily handoffs, with no purchasable power
- Payments through store billing on mobile and a card processor on web
- Performance: 60 frames per second on a mid-range Android phone, first load under 2 MB
- Accessibility: colorblind-safe palette, reduced-motion setting, one-handed play
- Text moved into language files, ready for translation
- Privacy policy, account deletion and age-rating answers

Gate: builds are accepted into TestFlight and Google Play internal testing, and a share link opens into play in under 3 seconds on a mobile connection.

```
Build Phase 4 from docs/ROADMAP.md. I will create the store, payment and
push accounts and set the keys as environment variables. List exactly which
accounts and keys you need before you start.
```

## Phase 5: Soft launch and first release

The goal is to tune the game on a few thousand real players in one or two small markets, then release everywhere.

- Launch on web and Android in one or two small markets
- Dashboard for the five numbers below
- Weekly loop: read the dashboard, change one thing, measure for a week
- Load test at ten times the expected peak
- Store listings, screenshots, a 20-second trailer and a press page
- Release checklist, staged rollout and a tested rollback
- Global release on web, Android and iOS

| Number to watch | Target before global release |
| --- | --- |
| Day-1 retention | 40% or higher |
| Day-7 retention | 15% or higher |
| New players brought in per player through links | 0.3 or higher |
| Share link opened to first input | 80% or higher |
| Wait for a run to be picked up | Under 10 minutes at the median |

These targets are my estimates of a healthy casual game, not measured benchmarks for Relay. Replace them once the soft launch gives you real numbers.

Gate: the targets hold for two weeks in a row, the load test passes, and the global release is live.

```
Build the Phase 5 dashboard and load test from docs/ROADMAP.md. Then each
week, read the metrics export I give you, name the weakest number, and
propose one change with the result you expect.
```

## Phase 6: Live operations

After release, the work becomes a steady rhythm of tuning, seasons and one larger feature each quarter.

| Rhythm | What ships | Claude Code's part |
| --- | --- | --- |
| Every pull request | Nothing breaks | Run tests and the replay check, and block the merge on failure |
| Weekly | Balance patch and new Daily Relay modifiers | Run the balance simulator, triage crash reports, draft the patch |
| Every 6 weeks | A season: one new biome, 8 to 10 upgrades, a cosmetics set | Build content from your design notes and update language files |
| Quarterly | One larger feature | Plan it with you, then build it behind a feature flag |

Candidates for the quarterly feature, in the order I would try them:

1. Run replays: watch the whole chain as a one-minute highlight reel, made for sharing.
2. Crews: standing groups with a shared weekly chain and leaderboard.
3. Custom towers: players design a floor and see how far strangers get.

Remove any feature that has not improved retention or sharing after two seasons. A small game that stays simple is easier to keep healthy.

## Decisions that stay with you, and risks

Claude Code can build all of this, but six decisions need you.

- The name: "Relay" is a common word, so check trademarks and store search before committing
- Art direction and audio, or the budget to commission them
- Developer accounts for the Apple and Google stores, payments and push
- Prices for cosmetics and the season pass
- Soft-launch markets
- Whether each gate has truly been met
