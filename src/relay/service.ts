/**
 * The handoff rules: who may play a run, and what happens when a segment comes back.
 * This code is storage-agnostic and is shared by the tests, the local dev server and the
 * production edge functions. Segment verification replays the input log with the same
 * simulation code the client runs (`replaySegment`), never a copy.
 */
import {
  InputRecorder,
  SIM_VERSION,
  beginSegment,
  botChoice,
  botInput,
  chooseUpgrade,
  createRun,
  defaultConfig,
  deserializeRun,
  hashState,
  replaySegment,
  serializeRun,
  step,
  type RunState,
  type SegmentLog,
  type SimConfig,
} from '../sim';
import settings from './data/relay.json';
import type {
  ClaimGrant,
  RelayDeps,
  RelayStore,
  Result,
  RunRecord,
  SegmentRecord,
  SubmitOutcome,
  Timeline,
} from './types';

export const BOT_PLAYER_ID = 'bot';

/** A four-character label for a carrier, different in every run, so timelines never expose player ids. */
function carrierLabel(playerId: string, runId: string): string {
  let h = 0x811c9dc5;
  const text = `${runId}:${playerId}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(4, '0').slice(-4).toUpperCase();
}
const MAX_RETRIES = 4;

export interface RelayOptions {
  /** Skip the "a minute of play cannot arrive in seconds" check. Only for automated tests. */
  skipSpeedCheck?: boolean;
}

export class RelayService {
  constructor(
    private store: RelayStore,
    private deps: RelayDeps,
    private cfg: SimConfig = defaultConfig,
    private options: RelayOptions = {},
  ) {}

  /** Start a brand new run and claim its first segment for the player. */
  async startRun(playerId: string): Promise<Result<ClaimGrant>> {
    const run = this.newRunRecord(createRun(this.deps.seed(), this.cfg));
    this.setClaim(run, playerId);
    await this.store.insertRun(run);
    return { ok: true, ...this.grant(run) };
  }

  /**
   * Give the player a run to carry: the one that has waited longest, skipping any they carried last.
   * If nothing is waiting, a bot plays the opening segment of a new run, so nobody ever waits.
   */
  async claimNext(playerId: string): Promise<Result<ClaimGrant>> {
    const now = this.deps.now();
    const candidates = await this.store.listClaimable(now, settings.queueScan);
    for (const run of candidates) {
      if (run.lastPlayerId === playerId) continue;
      const rev = run.rev;
      this.setClaim(run, playerId);
      if (await this.store.updateRun(run, rev)) return { ok: true, ...this.grant(run) };
    }
    const seeded = await this.createBotSeededRun();
    return this.claimRun(seeded.id, playerId);
  }

  /** Claim a specific run, as when opening a share link. */
  async claimRun(runId: string, playerId: string): Promise<Result<ClaimGrant>> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const run = await this.store.getRun(runId);
      if (!run) return { ok: false, error: 'not_found' };
      if (run.status === 'dead') return { ok: false, error: 'dead' };
      const now = this.deps.now();
      if (run.claim && run.claim.expiresAt > now) {
        // The same player reopening the link gets their existing claim back.
        if (run.claim.playerId === playerId) return { ok: true, ...this.grant(run) };
        return { ok: false, error: 'busy' };
      }
      const rev = run.rev;
      this.setClaim(run, playerId);
      if (await this.store.updateRun(run, rev)) return { ok: true, ...this.grant(run) };
    }
    return { ok: false, error: 'conflict' };
  }

  /**
   * Accept a played segment. The server replays the input log from the stored state and
   * only trusts its own result. `clientHash` lets a desynced client be caught early.
   */
  async submitSegment(
    runId: string,
    claimToken: string,
    log: SegmentLog,
    clientHash?: string,
  ): Promise<Result<SubmitOutcome>> {
    const run = await this.store.getRun(runId);
    if (!run) return { ok: false, error: 'not_found' };

    if (!run.claim || run.claim.token !== claimToken) {
      // A retry of a submit that already went through gets the same answer again.
      const done = (await this.store.listSegments(runId)).find((s) => s.claimToken === claimToken);
      if (done) {
        return {
          ok: true,
          runId,
          segmentIndex: done.index,
          died: done.died,
          floor: done.floorEnd,
          stateHash: done.endHash,
        };
      }
      return { ok: false, error: 'claim_lost' };
    }
    // An expired claim is still honored as long as nobody else has taken the run.

    const claim = run.claim;
    const rev = run.rev;
    const state = deserializeRun(run.state);
    const startHash = run.stateHash;
    const floorStart = state.floor;
    const killsStart = state.kills;

    try {
      replaySegment(state, log, this.cfg);
    } catch {
      return this.reject(run, rev, 'invalid_log');
    }

    const endHash = hashState(state);
    if (clientHash !== undefined && clientHash !== endHash) return this.reject(run, rev, 'mismatch');

    // A minute of play cannot arrive in a few seconds.
    const now = this.deps.now();
    const playedMs = (state.segTick / this.cfg.tuning.tickRate) * 1000;
    const tooFast = now - claim.claimedAt < playedMs * settings.minElapsedFactor;
    if (tooFast && claim.playerId !== BOT_PLAYER_ID && !this.options.skipSpeedCheck) {
      return this.reject(run, rev, 'too_fast');
    }

    const died = state.phase === 'dead';
    const segment: SegmentRecord = {
      runId,
      index: run.segments,
      playerId: claim.playerId,
      isBot: claim.playerId === BOT_PLAYER_ID,
      claimToken,
      log,
      startHash,
      endHash,
      floorStart,
      floorEnd: state.floor,
      kills: state.kills - killsStart,
      upgrade: died ? null : state.upgrades[state.upgrades.length - 1],
      died,
      createdAt: now,
    };

    if (!died) beginSegment(state, this.cfg);
    run.state = serializeRun(state);
    run.stateHash = hashState(state);
    run.status = died ? 'dead' : 'alive';
    run.segments += 1;
    run.floor = state.floor;
    run.claim = null;
    run.lastPlayerId = claim.playerId;
    run.updatedAt = now;

    if (!(await this.store.commitSegment(run, rev, segment))) return { ok: false, error: 'conflict' };
    return { ok: true, runId, segmentIndex: segment.index, died, floor: state.floor, stateHash: endHash };
  }

  /** Give a run back without playing it, so the next player can take it straight away. */
  async releaseClaim(runId: string, claimToken: string): Promise<Result<object>> {
    const run = await this.store.getRun(runId);
    if (!run) return { ok: false, error: 'not_found' };
    if (!run.claim || run.claim.token !== claimToken) return { ok: false, error: 'claim_lost' };
    const rev = run.rev;
    run.claim = null;
    return (await this.store.updateRun(run, rev)) ? { ok: true } : { ok: false, error: 'conflict' };
  }

  /** Leave one emote on a segment you carried. */
  async leaveEmote(runId: string, segmentIndex: number, playerId: string, emote: string): Promise<Result<object>> {
    if (!settings.emotes.includes(emote)) return { ok: false, error: 'bad_emote' };
    const segment = (await this.store.listSegments(runId)).find((s) => s.index === segmentIndex);
    if (!segment || segment.playerId !== playerId) return { ok: false, error: 'not_found' };
    const existing = (await this.store.listEmotes(runId)).filter(
      (e) => e.segmentIndex === segmentIndex && e.playerId === playerId,
    );
    if (existing.length >= settings.maxEmotesPerSegment) return { ok: false, error: 'bad_emote' };
    await this.store.insertEmote({ runId, segmentIndex, playerId, emote, createdAt: this.deps.now() });
    return { ok: true };
  }

  /** Who carried the run, how far each got, and the emotes they left. */
  async timeline(runId: string, viewerId = ''): Promise<Result<Timeline>> {
    const run = await this.store.getRun(runId);
    if (!run) return { ok: false, error: 'not_found' };
    const [segments, emotes] = await Promise.all([this.store.listSegments(runId), this.store.listEmotes(runId)]);
    return {
      ok: true,
      run: {
        id: run.id,
        status: run.status,
        floor: run.floor,
        segments: run.segments,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        claimed: !!run.claim && run.claim.expiresAt > this.deps.now(),
      },
      segments: segments.map((s) => ({
        index: s.index,
        isBot: s.isBot,
        mine: !s.isBot && s.playerId === viewerId,
        carrier: s.isBot ? 'bot' : carrierLabel(s.playerId, runId),
        floorStart: s.floorStart,
        floorEnd: s.floorEnd,
        kills: s.kills,
        upgrade: s.upgrade,
        died: s.died,
        createdAt: s.createdAt,
        emotes: emotes.filter((e) => e.segmentIndex === s.index).map((e) => e.emote),
      })),
    };
  }

  /** Have the bot carry a waiting run for one segment. Used to keep stale runs moving. */
  async playBotSegment(runId: string): Promise<Result<SubmitOutcome>> {
    const claimed = await this.claimRun(runId, BOT_PLAYER_ID);
    if (!claimed.ok) return claimed;
    const log = this.botLog(deserializeRun(claimed.state));
    return this.submitSegment(runId, claimed.claimToken, log);
  }

  private async createBotSeededRun(): Promise<RunRecord> {
    for (let attempt = 0; attempt < settings.botSeedAttempts; attempt++) {
      const run = this.newRunRecord(createRun(this.deps.seed(), this.cfg));
      await this.store.insertRun(run);
      const outcome = await this.playBotSegment(run.id);
      // Keep the run only if the bot handed it on alive.
      if (outcome.ok && !outcome.died) return (await this.store.getRun(run.id))!;
    }
    // The bot kept dying (only possible with extreme tuning): hand out an untouched run instead.
    const run = this.newRunRecord(createRun(this.deps.seed(), this.cfg));
    await this.store.insertRun(run);
    return run;
  }

  private botLog(state: RunState): SegmentLog {
    const recorder = new InputRecorder();
    while (state.phase === 'play') {
      const input = botInput(state, this.cfg, { skill: settings.botSkill });
      recorder.record(state.segTick, input);
      step(state, input, this.cfg);
    }
    if (state.phase === 'upgrade') {
      recorder.log.choice = botChoice(state);
      chooseUpgrade(state, recorder.log.choice, this.cfg);
    }
    return recorder.log;
  }

  private newRunRecord(state: RunState): RunRecord {
    const now = this.deps.now();
    return {
      id: this.deps.id(),
      seed: state.seed,
      simVersion: SIM_VERSION,
      status: 'alive',
      state: serializeRun(state),
      stateHash: hashState(state),
      segments: 0,
      floor: state.floor,
      claim: null,
      lastPlayerId: null,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    };
  }

  private setClaim(run: RunRecord, playerId: string): void {
    const now = this.deps.now();
    run.claim = {
      playerId,
      token: this.deps.id(),
      claimedAt: now,
      expiresAt: now + settings.claimTtlSeconds * 1000,
    };
  }

  private grant(run: RunRecord): ClaimGrant {
    const claim = run.claim!;
    return {
      runId: run.id,
      claimToken: claim.token,
      expiresAt: claim.expiresAt,
      state: run.state,
      stateHash: run.stateHash,
      segmentIndex: run.segments,
    };
  }

  /** A bad submit must never leave the run stuck: drop the claim so someone else can carry it. */
  private async reject(run: RunRecord, rev: number, error: 'invalid_log' | 'mismatch' | 'too_fast'): Promise<Result<never>> {
    run.claim = null;
    await this.store.updateRun(run, rev);
    return { ok: false, error };
  }
}
