/**
 * Local relay server for development and end-to-end tests. It keeps everything in memory
 * and trusts the player id the client sends. Production replaces this file with Supabase
 * edge functions that wrap the very same RelayService (see docs/PHASE2_PROPOSAL.md).
 *
 *   npm run relay             listens on http://localhost:8787
 *   PORT=9000 npm run relay
 *   RELAY_SKIP_SPEED_CHECK=1 npm run relay    for automated tests only
 */
import { randomBytes, randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { MemoryStore, RelayService, type RelayError } from '../src/relay';

const port = Number(process.env.PORT ?? 8787);
const service = new RelayService(
  new MemoryStore(),
  {
    now: () => Date.now(),
    id: () => randomBytes(9).toString('base64url'),
    seed: () => randomInt(0, 0xffffffff),
  },
  undefined,
  // Automated tests play a minute of game in a few seconds, so they turn the speed check off.
  { skipSpeedCheck: process.env.RELAY_SKIP_SPEED_CHECK === '1' },
);

const STATUS: Record<RelayError, number> = {
  not_found: 404,
  busy: 409,
  dead: 410,
  claim_lost: 409,
  invalid_log: 422,
  mismatch: 422,
  too_fast: 422,
  conflict: 409,
  bad_emote: 422,
};

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Body too large');
  }
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const body = req.method === 'POST' ? await readJson(req) : {};
    const playerId = str(body.playerId);

    const needsPlayer = ['/api/start', '/api/claim-next', '/api/claim', '/api/emote'].includes(url.pathname);
    if (req.method === 'POST' && needsPlayer && !playerId) return send(res, 400, { ok: false, error: 'not_found' });

    let result;
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/health':
        return send(res, 200, { ok: true });
      case 'POST /api/start':
        result = await service.startRun(playerId);
        break;
      case 'POST /api/claim-next':
        result = await service.claimNext(playerId);
        break;
      case 'POST /api/claim':
        result = await service.claimRun(str(body.runId), playerId);
        break;
      case 'POST /api/submit':
        result = await service.submitSegment(
          str(body.runId),
          str(body.claimToken),
          body.log as never,
          typeof body.hash === 'string' ? body.hash : undefined,
        );
        break;
      case 'POST /api/release':
        result = await service.releaseClaim(str(body.runId), str(body.claimToken));
        break;
      case 'POST /api/emote':
        result = await service.leaveEmote(str(body.runId), Number(body.segmentIndex), playerId, str(body.emote));
        break;
      case 'POST /api/timeline':
        result = await service.timeline(str(body.runId), playerId);
        break;
      default:
        return send(res, 404, { ok: false, error: 'not_found' });
    }
    send(res, result.ok ? 200 : STATUS[result.error], result);
  } catch (error) {
    send(res, 400, { ok: false, error: 'invalid_log', detail: String(error) });
  }
}).listen(port, () => {
  console.log(`Relay dev server on http://localhost:${port} (in-memory, resets on restart)`);
});
