# Phase 2 proposal: schema and claim/submit API

**Status: waiting for the owner's approval.** Nothing here has been applied to a database, and no Supabase project exists yet. The handoff rules themselves are already built and tested against an in-memory store, so approving this is a decision about the schema and hosting, not about untested logic.

## What is already built

| Piece | Where | Tested by |
| --- | --- | --- |
| Handoff rules: claim, submit, verify, queue, bot fill, emotes, timeline | `src/relay/service.ts` | `tests/relay.test.ts` |
| Storage interface with atomic operations | `src/relay/types.ts` (`RelayStore`) | same |
| In-memory store | `src/relay/memoryStore.ts` | same |
| Local HTTP server wrapping the service | `server/dev.ts` (`npm run relay`) | `e2e/handoff.spec.ts` |
| Client: claim a run, play, submit, timeline, share link, emotes | `src/client/api.ts`, `src/main.ts`, `src/client/ui.ts` | `e2e/handoff.spec.ts` |

Server-side verification calls `replaySegment` from `src/sim/replay.ts`, the same function the client and the replay tests use. There is no second copy of the simulation.

## How a handoff works

1. **Claim.** The player asks for a run (`claim-next`), opens a share link (`claim`) or starts a fresh one (`start`). The server writes a claim on the run: player, secret token, expiry five minutes out. The write only succeeds if the run's `rev` has not changed, so two players can never hold the same run. The response carries the run state to play from.
2. **Play.** The client simulates locally and records an input log: a short list of `[tick, x, y]` changes, plus the index of the chosen upgrade.
3. **Submit.** The client sends the run id, the claim token, the log and its own end-state hash. The server loads the stored state, replays the log, and trusts only its own result.
4. **Commit.** In one transaction the server appends the segment and stores the new state with the claim cleared. The run is now waiting for the next carrier, or dead.

## Guarantees and how each is enforced

| Guarantee | Mechanism |
| --- | --- |
| A run is never held by two players | Compare-and-set on `runs.rev` for every claim |
| A run is never stuck | Claims expire after five minutes. A rejected submit clears the claim |
| A run is never lost | A late submit is still accepted if nobody else has claimed the run since |
| A leg is never recorded twice | Primary key `(run_id, index)`, and a retried submit with the same token returns the first answer |
| A run never forks | The run update and the segment insert are one transaction guarded by `rev` |
| A leg cannot be faked | The server replays the input log. Malformed logs, wrong hashes and legs that arrive faster than they could be played are rejected |
| Timelines do not expose player ids | Carriers appear as a four-character label that differs per run |

## API

All endpoints are `POST` with a JSON body and return `{ ok: true, ... }` or `{ ok: false, error }`. In production the player id comes from the Supabase session, not from the body.

| Endpoint | Body | Success | Errors |
| --- | --- | --- | --- |
| `/api/start` | none | claim grant | none |
| `/api/claim-next` | none | claim grant | none (a bot seeds a run if none is waiting) |
| `/api/claim` | `runId` | claim grant | `not_found`, `dead`, `busy`, `conflict` |
| `/api/submit` | `runId`, `claimToken`, `log`, `hash` | `segmentIndex`, `died`, `floor`, `stateHash` | `not_found`, `claim_lost`, `invalid_log`, `mismatch`, `too_fast`, `conflict` |
| `/api/release` | `runId`, `claimToken` | none | `not_found`, `claim_lost` |
| `/api/emote` | `runId`, `segmentIndex`, `emote` | none | `not_found`, `bad_emote` |
| `/api/timeline` | `runId` | run summary and legs | `not_found` |

A claim grant is `{ runId, claimToken, expiresAt, state, stateHash, segmentIndex }`.

## Schema

The proposed migration is `supabase/migrations/0001_relay.sql`. It has not been run. Summary:

- `players`: one row per Supabase user (anonymous or upgraded), with a reputation score for Phase 3.
- `runs`: the current state of each run as text, its hash, floor, segment count, the claim columns and `rev`.
- `segments`: one row per completed leg, with the input log kept for audits and replays.
- `emotes`: one per player per leg.
- Row level security is enabled on every table with no policies, so only the edge functions (service role) can read or write.
- Two SQL functions, `relay_update_run` and `relay_commit_segment`, implement the two atomic operations the service needs.

One detail matters: `runs.state` is `text`, not `jsonb`. The state hash is computed over the JSON text, and `jsonb` does not preserve key order.

## What I need from you

1. **Approve or change the schema and API above.**
2. **Create a Supabase project** and enable anonymous sign-ins. Set these as environment variables or repository secrets, never in the repo: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. **Choose hosting for the public URL.** GitHub Pages does not work for a private repository on the current plan. Either make the repository public, or create a Cloudflare Pages project and give CI a `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Cloudflare also gives real `/r/<run id>` paths and per-branch previews.

## Once approved

- Write `PostgresStore` (the `RelayStore` interface over the two SQL functions) and run the existing relay tests against it.
- Wrap `RelayService` in Supabase edge functions with the same routes as `server/dev.ts`.
- Switch the client's player id to the Supabase anonymous session.
- Move share links from `?r=<id>` to `/r/<id>` with a preview image for chat apps.
- In-app inbox and web push for "your run reached floor N".
- A scheduled job that lets a bot carry runs that have waited too long.
