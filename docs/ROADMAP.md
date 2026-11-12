# Relay roadmap

The working copy of `docs/PLAN.md`. Tick an item when it is built, tested and deployed. A gate is only ticked by the owner.

Legend: `[x]` done, `[~]` built but waiting on something (noted next to it), `[ ]` not started.

## Phase 0: Setup

- [x] Create the repo with Vite, TypeScript and Phaser, plus linting and Vitest
- [x] Add CI that runs tests and deploys on every push to `main` (GitHub Pages: https://amerganim.github.io/relay/)
- [ ] Per-branch preview deploys on Cloudflare Pages (needs the owner's Cloudflare account and token)
- [x] Write CLAUDE.md with the rules
- [x] Write docs/GDD.md
- [x] Write docs/ROADMAP.md

**Gate (owner):** [ ] a blank game canvas loads from the preview URL on your phone in under 3 seconds.

## Phase 1: Core prototype

- [x] Simulation core: seeded random numbers, fixed timestep, serializable state (`src/sim/`)
- [x] Drag to move, auto-attack, three enemy types (Grunt, Dasher, Spitter)
- [x] One tower biome with procedurally generated floors
- [x] 60-second timer, then a choice of one upgrade from three (10 upgrades total)
- [x] Feedback: hit flashes, screen shake, sound, phone vibration
- [x] Save and resume: a run is stored as JSON and continued exactly
- [x] A test that replays a recorded input log and reaches the identical end state (`tests/replay.test.ts`)
- [x] A hidden tuning panel for speed, spawn rate and damage (tap the floor label five times, or add `?tune` to the URL)
- [x] Headless balance simulator, pulled forward from Phase 3 (`npm run balance`)

**Gate (owner):** [ ] ten people who do not know you play it on their own phones. At least seven play three or more runs in a row without being asked. If the gate fails, stay in this phase and change the core action.

## Phase 2: Handoff system

The handoff rules are built and tested against an in-memory store and a local server (`npm run relay` plus `npm run dev:relay`). The production backend waits on the owner: see `docs/PHASE2_PROPOSAL.md`.

- [~] Database tables for players, runs, segments and emotes (proposed in `supabase/migrations/0001_relay.sql`, not applied: needs approval and a Supabase project)
- [ ] Anonymous sign-in on first play, with an optional upgrade to a real account later (needs the Supabase project; the client uses a local anonymous id until then)
- [x] Claim a run: a lock that expires after five minutes if the player leaves
- [x] Submit a segment: the client sends the input log, and the server replays it with the Phase 1 simulation code to verify the result
- [~] Share links: `?r=<run id>` opens straight into play (real `/r/<run id>` paths and the chat preview image need Cloudflare Pages or similar hosting)
- [x] Run queue that decides which waiting run a player receives (longest-waiting first, never your own last run)
- [x] Bot-played segments, so early players never wait for a run
- [x] Run timeline screen: who carried it, floors climbed, emotes left
- [ ] In-app inbox and web push for "your run reached floor N"
- [x] Playwright test: two simulated players complete a full handoff (`npm run test:e2e`)
- [ ] Postgres store and Supabase edge functions wrapping the same `RelayService`

**Gate (owner):** [ ] 20 testers on a mix of phones and desktop browsers complete a chain of 15 or more handoffs. No run is lost, duplicated or stuck.

## Phase 3: Content, modes and anti-griefing

- [x] Expand to 30 upgrades, 8 enemy types and 2 bosses (a boss guards every fifth floor)
- [x] Handoff choices always pair a safe option with a risky one, never a purely harmful one
- [~] Daily Relay: one shared seed per UTC day, with a best score kept on the device (the global leaderboard needs the backend)
- [ ] Friend chains: private relays started from a link
- [ ] Rescue runs: a queue of nearly dead runs with bonus rewards
- [ ] Reputation score that influences which runs a player receives
- [~] First-time tutorial under 30 seconds: three in-run hints on the first run (not yet tied to a bot-seeded relay run)
- [x] Headless balance simulator, reporting single upgrades and upgrade pairs against the average

Balance note: at full skill the bot carries a run for about 4.6 legs and reaches floor 12 at the median. The gate asks for a median chain of 8, so expect to ease the late floors once real players are measured. No upgrade pair performs more than twice the average.

**Gate (owner):** [ ] a closed test with 100 or more players shows day-1 retention of at least 35% and a median chain of 8 or more handoffs.

## Phase 4: Mobile packaging, monetization and polish

- [ ] Wrap the web build with Capacitor for iOS and Android
- [ ] Deep links: a share link opens the app if installed and the browser if not
- [ ] Native push notifications and haptics
- [ ] Installable web app (PWA) for browser players
- [ ] Cosmetics shop: torch skins and trails that travel with the run
- [ ] Season pass and extra daily handoffs, with no purchasable power
- [ ] Payments through store billing on mobile and a card processor on web
- [ ] Performance: 60 frames per second on a mid-range Android phone, first load under 2 MB
- [ ] Accessibility: colorblind-safe palette, reduced-motion setting, one-handed play
- [ ] Text moved into language files, ready for translation (started: all text is in `src/client/strings.ts`)
- [ ] Privacy policy, account deletion and age-rating answers

**Gate (owner):** [ ] builds are accepted into TestFlight and Google Play internal testing, and a share link opens into play in under 3 seconds on a mobile connection.

## Phase 5: Soft launch and first release

- [ ] Launch on web and Android in one or two small markets
- [ ] Dashboard for the five numbers (day-1, day-7, invites per player, link-to-first-input, pickup wait)
- [ ] Weekly loop: read the dashboard, change one thing, measure for a week
- [ ] Load test at ten times the expected peak
- [ ] Store listings, screenshots, a 20-second trailer and a press page
- [ ] Release checklist, staged rollout and a tested rollback
- [ ] Global release on web, Android and iOS

**Gate (owner):** [ ] the targets hold for two weeks in a row, the load test passes, and the global release is live.

## Phase 6: Live operations

- [ ] Every pull request: tests and the replay check block the merge on failure (CI already runs both)
- [ ] Weekly: balance patch and new Daily Relay modifiers
- [ ] Every 6 weeks: a season with one new biome, 8 to 10 upgrades and a cosmetics set
- [ ] Quarterly: one larger feature behind a feature flag (run replays, then crews, then custom towers)

## Decisions that stay with the owner

- [ ] The name: check trademarks and store search before committing to "Relay"
- [ ] Art direction and audio, or the budget to commission them
- [ ] Developer accounts for the Apple and Google stores, payments and push
- [ ] Prices for cosmetics and the season pass
- [ ] Soft-launch markets
- [ ] Whether each gate has truly been met
