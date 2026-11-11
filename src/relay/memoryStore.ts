import type { EmoteRecord, RelayStore, RunRecord, SegmentRecord } from './types';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** An in-memory store for tests and the local dev server. It has the same atomic semantics as the Postgres store. */
export class MemoryStore implements RelayStore {
  private runs = new Map<string, RunRecord>();
  private segments = new Map<string, SegmentRecord[]>();
  private emotes: EmoteRecord[] = [];

  async insertRun(run: RunRecord): Promise<void> {
    if (this.runs.has(run.id)) throw new Error(`Run ${run.id} already exists`);
    this.runs.set(run.id, copy(run));
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const run = this.runs.get(id);
    return run ? copy(run) : null;
  }

  async updateRun(run: RunRecord, expectedRev: number): Promise<boolean> {
    const stored = this.runs.get(run.id);
    if (!stored || stored.rev !== expectedRev) return false;
    this.runs.set(run.id, copy({ ...run, rev: expectedRev + 1 }));
    return true;
  }

  async commitSegment(run: RunRecord, expectedRev: number, segment: SegmentRecord): Promise<boolean> {
    const stored = this.runs.get(run.id);
    if (!stored || stored.rev !== expectedRev) return false;
    const list = this.segments.get(run.id) ?? [];
    if (list.some((s) => s.index === segment.index)) return false;
    list.push(copy(segment));
    this.segments.set(run.id, list);
    this.runs.set(run.id, copy({ ...run, rev: expectedRev + 1 }));
    return true;
  }

  async listClaimable(now: number, limit: number): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((r) => r.status === 'alive' && (!r.claim || r.claim.expiresAt <= now))
      .sort((a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map(copy);
  }

  async listSegments(runId: string): Promise<SegmentRecord[]> {
    return (this.segments.get(runId) ?? []).map(copy).sort((a, b) => a.index - b.index);
  }

  async insertEmote(emote: EmoteRecord): Promise<void> {
    this.emotes.push(copy(emote));
  }

  async listEmotes(runId: string): Promise<EmoteRecord[]> {
    return this.emotes.filter((e) => e.runId === runId).map(copy);
  }

  /** Test helper: every run, for invariant checks. */
  allRuns(): RunRecord[] {
    return [...this.runs.values()].map(copy);
  }
}
