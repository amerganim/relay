import type { SegmentLog } from '../sim';

export interface Claim {
  playerId: string;
  /** Secret handed to the claimant. Submitting a segment requires it. */
  token: string;
  claimedAt: number;
  expiresAt: number;
}

export interface RunRecord {
  id: string;
  seed: number;
  simVersion: number;
  status: 'alive' | 'dead';
  /** JSON of the run at the start of the next segment (or its final state once dead). */
  state: string;
  stateHash: string;
  /** Number of segments completed so far. */
  segments: number;
  floor: number;
  claim: Claim | null;
  lastPlayerId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Bumped on every write. Updates only apply if the stored value still matches. */
  rev: number;
}

export interface SegmentRecord {
  runId: string;
  index: number;
  playerId: string;
  isBot: boolean;
  /** The claim token this segment was submitted with, so a retried submit is recognized. */
  claimToken: string;
  log: SegmentLog;
  startHash: string;
  endHash: string;
  floorStart: number;
  floorEnd: number;
  kills: number;
  /** Id of the upgrade chosen, or null if the carrier died. */
  upgrade: string | null;
  died: boolean;
  createdAt: number;
}

export interface EmoteRecord {
  runId: string;
  segmentIndex: number;
  playerId: string;
  emote: string;
  createdAt: number;
}

/**
 * Storage the relay needs. Every method is one atomic operation, so the same service code
 * runs against the in-memory store in tests and against Postgres in production.
 */
export interface RelayStore {
  insertRun(run: RunRecord): Promise<void>;
  getRun(id: string): Promise<RunRecord | null>;
  /** Replace the run only if its stored `rev` equals `expectedRev`. Returns false if someone else wrote first. */
  updateRun(run: RunRecord, expectedRev: number): Promise<boolean>;
  /** Like `updateRun`, and also appends the segment, as one transaction. A (runId, index) pair can exist only once. */
  commitSegment(run: RunRecord, expectedRev: number, segment: SegmentRecord): Promise<boolean>;
  /** Alive runs with no live claim, longest-waiting first. */
  listClaimable(now: number, limit: number): Promise<RunRecord[]>;
  listSegments(runId: string): Promise<SegmentRecord[]>;
  insertEmote(emote: EmoteRecord): Promise<void>;
  listEmotes(runId: string): Promise<EmoteRecord[]>;
}

/** Things the service cannot derive deterministically. Injected so tests control them. */
export interface RelayDeps {
  now(): number;
  /** A new unguessable id. */
  id(): string;
  /** A new 32-bit run seed. */
  seed(): number;
}

export type RelayError =
  | 'not_found'
  | 'busy'
  | 'dead'
  | 'claim_lost'
  | 'invalid_log'
  | 'mismatch'
  | 'too_fast'
  | 'conflict'
  | 'bad_emote';

export type Result<T> = ({ ok: true } & T) | { ok: false; error: RelayError };

export interface ClaimGrant {
  runId: string;
  claimToken: string;
  expiresAt: number;
  /** JSON of the run to play from. */
  state: string;
  stateHash: string;
  segmentIndex: number;
}

export interface SubmitOutcome {
  runId: string;
  segmentIndex: number;
  died: boolean;
  floor: number;
  stateHash: string;
}

export interface TimelineSegment {
  index: number;
  isBot: boolean;
  /** True if the viewer carried this segment. */
  mine: boolean;
  /** A short label that is stable within this run but does not reveal the player's id. */
  carrier: string;
  floorStart: number;
  floorEnd: number;
  kills: number;
  upgrade: string | null;
  died: boolean;
  createdAt: number;
  emotes: string[];
}

export interface Timeline {
  run: Pick<RunRecord, 'id' | 'status' | 'floor' | 'segments' | 'createdAt' | 'updatedAt'> & { claimed: boolean };
  segments: TimelineSegment[];
}
