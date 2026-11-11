import type { ClaimGrant, Result, SubmitOutcome, Timeline } from '../relay/types';
import type { SegmentLog } from '../sim';

const PLAYER_KEY = 'relay.player';

/** Base URL of the relay backend. When it is not set, the game runs in solo mode with no handoffs. */
export const RELAY_URL: string = (import.meta.env.VITE_RELAY_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const relayEnabled = RELAY_URL !== '';

/**
 * A stable anonymous id for this browser. In production this is replaced by the
 * Supabase anonymous sign-in, and the server takes the id from the session, not the request.
 */
export function playerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

export type ApiResult<T> = Result<T> | { ok: false; error: 'offline' };

async function call<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${RELAY_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Result<T>;
  } catch {
    return { ok: false, error: 'offline' };
  }
}

export const api = {
  start: () => call<ClaimGrant>('/api/start', { playerId: playerId() }),
  claimNext: () => call<ClaimGrant>('/api/claim-next', { playerId: playerId() }),
  claim: (runId: string) => call<ClaimGrant>('/api/claim', { runId, playerId: playerId() }),
  submit: (runId: string, claimToken: string, log: SegmentLog, hash: string) =>
    call<SubmitOutcome>('/api/submit', { runId, claimToken, log, hash }),
  emote: (runId: string, segmentIndex: number, emote: string) =>
    call<object>('/api/emote', { runId, segmentIndex, emote, playerId: playerId() }),
  timeline: (runId: string) => call<Timeline>('/api/timeline', { runId, playerId: playerId() }),
};

/** The link that opens straight into a run. */
export function shareUrl(runId: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('r', runId);
  return url.toString();
}

export function runIdFromUrl(): string | null {
  return new URLSearchParams(location.search).get('r');
}
