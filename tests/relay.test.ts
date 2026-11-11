import { describe, expect, it } from 'vitest';
import { BOT_PLAYER_ID, MemoryStore, RelayService, type ClaimGrant, type RelayDeps } from '../src/relay';
import { cloneConfig, deserializeRun, hashState, type SegmentLog, type SimConfig } from '../src/sim';
import { playSegmentWithBot } from './helpers';

const MINUTE = 60_000;

function setup(cfg?: SimConfig) {
  let now = 1_000_000;
  let counter = 0;
  const deps: RelayDeps = {
    now: () => now,
    id: () => `id${++counter}`,
    seed: () => 5000 + ++counter,
  };
  const store = new MemoryStore();
  const service = new RelayService(store, deps, cfg);
  return { store, service, tick: (ms: number) => (now += ms), now: () => now };
}

/** Play a granted segment the way a client would, and return the log and the client's own end hash. */
function play(grant: ClaimGrant, cfg?: SimConfig): { log: SegmentLog; hash: string; died: boolean } {
  const state = deserializeRun(grant.state);
  const { log } = playSegmentWithBot(state, cfg, 0.9);
  return { log, hash: hashState(state), died: state.phase === 'dead' };
}

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Expected ok, got ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe('relay handoff', () => {
  it('twenty players pass runs along chains of 15+ handoffs with nothing lost, duplicated or stuck', async () => {
    const { store, service, tick } = setup();
    const players = Array.from({ length: 20 }, (_, i) => `p${i}`);
    let handoffs = 0;
    let longestChain = 0;

    for (let round = 0; round < 120; round++) {
      const player = players[(round * 7) % players.length];
      const grant = must(await service.claimNext(player));
      tick(MINUTE);
      const { log, hash, died } = play(grant);
      const outcome = must(await service.submitSegment(grant.runId, grant.claimToken, log, hash));
      expect(outcome.died).toBe(died);
      expect(outcome.stateHash).toBe(hash);
      handoffs++;
    }

    for (const run of store.allRuns()) {
      const segments = await store.listSegments(run.id);
      // Every completed segment is recorded exactly once, in order, each starting where the last ended.
      expect(segments.map((s) => s.index)).toEqual(segments.map((_, i) => i));
      expect(segments.length).toBe(run.segments);
      expect(segments.filter((s) => s.died).length).toBe(run.status === 'dead' ? 1 : 0);
      if (run.status === 'dead') expect(segments[segments.length - 1].died).toBe(true);
      // Nothing is left claimed: every run is either waiting for a carrier or finished.
      expect(run.claim).toBeNull();
      // No player carries the same run twice in a row.
      for (let i = 1; i < segments.length; i++) {
        if (!segments[i].isBot) expect(segments[i].playerId).not.toBe(segments[i - 1].playerId);
      }
      longestChain = Math.max(longestChain, segments.length);
    }
    const recorded = (await Promise.all(store.allRuns().map((r) => store.listSegments(r.id)))).flat();
    expect(recorded.filter((s) => !s.isBot).length).toBe(handoffs);
    expect(longestChain).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('one run passes through 16 different carriers and its timeline shows every one of them', async () => {
    // A sturdy carrier, so the test is about the length of the chain and not the bot's skill.
    const cfg = cloneConfig();
    cfg.tuning.player.maxHp = 1e9;
    const { store, service, tick } = setup(cfg);
    let grant = must(await service.startRun('p0'));
    const runId = grant.runId;
    for (let i = 0; i < 16; i++) {
      expect(grant.segmentIndex).toBe(i);
      tick(MINUTE);
      const { log, hash } = play(grant, cfg);
      const outcome = must(await service.submitSegment(runId, grant.claimToken, log, hash));
      expect(outcome.died).toBe(false);
      grant = must(await service.claimRun(runId, `p${i + 1}`));
    }
    expect((await store.listSegments(runId)).map((s) => s.playerId)).toEqual(Array.from({ length: 16 }, (_, i) => `p${i}`));
    const timeline = must(await service.timeline(runId, 'p3'));
    expect(timeline.segments.filter((s) => s.mine).map((s) => s.index)).toEqual([3]);
    expect(new Set(timeline.segments.map((s) => s.carrier)).size).toBe(16);
    expect(JSON.stringify(timeline)).not.toContain('"p3"');
    expect(timeline.run.segments).toBe(16);
    expect(timeline.run.status).toBe('alive');
    for (let i = 1; i < 16; i++) expect(timeline.segments[i].floorStart).toBe(timeline.segments[i - 1].floorEnd);
  }, 120_000);

  it('only one player can hold a run, and the lock expires after five minutes', async () => {
    const { service, tick } = setup();
    const first = must(await service.startRun('alice'));

    expect(await service.claimRun(first.runId, 'bob')).toEqual({ ok: false, error: 'busy' });
    // The holder reopening the link gets the same claim back.
    expect(must(await service.claimRun(first.runId, 'alice')).claimToken).toBe(first.claimToken);

    tick(4 * MINUTE + 59_000);
    expect(await service.claimRun(first.runId, 'bob')).toEqual({ ok: false, error: 'busy' });
    tick(2000);
    const second = must(await service.claimRun(first.runId, 'bob'));
    expect(second.state).toBe(first.state);

    // Alice comes back late: her claim is gone, and the run is untouched.
    const late = play(first);
    expect(await service.submitSegment(first.runId, first.claimToken, late.log)).toEqual({ ok: false, error: 'claim_lost' });

    tick(MINUTE);
    const bob = play(second);
    must(await service.submitSegment(second.runId, second.claimToken, bob.log, bob.hash));
    expect(must(await service.timeline(first.runId, 'bob')).segments.map((s) => s.mine)).toEqual([true]);
  });

  it('a late submit is still accepted if nobody else took the run', async () => {
    const { service, tick } = setup();
    const grant = must(await service.startRun('alice'));
    tick(6 * MINUTE);
    const { log } = play(grant);
    expect((await service.submitSegment(grant.runId, grant.claimToken, log)).ok).toBe(true);
  });

  it('submitting twice gives the same answer and records one segment', async () => {
    const { service, tick } = setup();
    const grant = must(await service.startRun('alice'));
    tick(MINUTE);
    const { log, hash } = play(grant);
    const a = must(await service.submitSegment(grant.runId, grant.claimToken, log, hash));
    const b = must(await service.submitSegment(grant.runId, grant.claimToken, log, hash));
    expect(b).toEqual(a);
    expect(must(await service.timeline(grant.runId)).segments.length).toBe(1);
  });

  it('rejects forged, mismatched and impossibly fast segments, and frees the run each time', async () => {
    const { service, tick } = setup();

    const a = must(await service.startRun('mallory'));
    tick(MINUTE);
    expect(await service.submitSegment(a.runId, a.claimToken, { moves: [0, 999, 0], choice: 0 })).toEqual({
      ok: false,
      error: 'invalid_log',
    });
    const b = must(await service.claimRun(a.runId, 'bob'));

    tick(MINUTE);
    const honest = play(b);
    expect(await service.submitSegment(b.runId, b.claimToken, honest.log, 'f'.repeat(16))).toEqual({
      ok: false,
      error: 'mismatch',
    });
    const c = must(await service.claimRun(a.runId, 'carol'));

    // No time has passed since the claim, so a full minute of input cannot be real.
    expect(await service.submitSegment(c.runId, c.claimToken, honest.log)).toEqual({ ok: false, error: 'too_fast' });
    const d = must(await service.claimRun(a.runId, 'dave'));
    expect(d.state).toBe(a.state);
    expect(must(await service.timeline(a.runId)).segments.length).toBe(0);
  });

  it('the server result does not depend on anything the client claims', async () => {
    const { service, tick } = setup();
    const grant = must(await service.startRun('alice'));
    tick(MINUTE);
    const { log, hash } = play(grant);
    const outcome = must(await service.submitSegment(grant.runId, grant.claimToken, log));
    expect(outcome.stateHash).toBe(hash);
  });

  it('when nothing is waiting, a bot plays the opening segment so the player gets a handoff', async () => {
    const { service } = setup();
    const grant = must(await service.claimNext('alice'));
    expect(grant.segmentIndex).toBe(1);
    const timeline = must(await service.timeline(grant.runId));
    expect(timeline.segments[0].carrier).toBe(BOT_PLAYER_ID);
    expect(timeline.segments[0].isBot).toBe(true);
    expect(timeline.run.claimed).toBe(true);
  });

  it('the queue hands out the longest-waiting run and never your own last run', async () => {
    const { service, tick } = setup();
    const a = must(await service.startRun('alice'));
    tick(MINUTE);
    const played = play(a);
    must(await service.submitSegment(a.runId, a.claimToken, played.log));

    tick(1000);
    const b = must(await service.startRun('bob'));
    tick(MINUTE);
    const bobPlayed = play(b);
    must(await service.submitSegment(b.runId, b.claimToken, bobPlayed.log));

    // Carol gets Alice's run (waiting longest). Alice gets Bob's run, not her own.
    expect(must(await service.claimNext('carol')).runId).toBe(a.runId);
    expect(must(await service.claimNext('alice')).runId).toBe(b.runId);
  });

  it('emotes: one per carried segment, from the allowed set, by the carrier only', async () => {
    const { service, tick } = setup();
    const grant = must(await service.startRun('alice'));
    tick(MINUTE);
    const { log } = play(grant);
    must(await service.submitSegment(grant.runId, grant.claimToken, log));

    expect((await service.leaveEmote(grant.runId, 0, 'bob', '🔥')).ok).toBe(false);
    expect((await service.leaveEmote(grant.runId, 0, 'alice', '<script>')).ok).toBe(false);
    expect((await service.leaveEmote(grant.runId, 0, 'alice', '🔥')).ok).toBe(true);
    expect((await service.leaveEmote(grant.runId, 0, 'alice', '👏')).ok).toBe(false);
    expect(must(await service.timeline(grant.runId)).segments[0].emotes).toEqual(['🔥']);
  });

  it('releasing a claim puts the run straight back in the queue', async () => {
    const { service } = setup();
    const grant = must(await service.startRun('alice'));
    expect((await service.releaseClaim(grant.runId, 'wrong')).ok).toBe(false);
    expect((await service.releaseClaim(grant.runId, grant.claimToken)).ok).toBe(true);
    expect(must(await service.claimNext('bob')).runId).toBe(grant.runId);
  });
});
