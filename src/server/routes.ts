import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

import { METADATA_LANGUAGE_CODES } from '../domain/constants.ts';
import {
  asClientId,
  asItemId,
  asVerifierEntryId,
  type ClientId,
  type ConflictDecision,
  type EpisodeOrderMode,
  type ItemId,
  type ItemPatch,
  type MediaKind
} from '../domain/types.ts';
import { JobRunner, LockConflictError } from './services/jobRunner.ts';
import { MetadataProviderError } from './services/metadata/baseMetadataProvider.ts';

const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const MAX_JSON_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon']
]);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_JSON_BODY_BYTES) {
      throw new Error('Request body too large');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return (raw ? JSON.parse(raw) : {}) as T;
}

function requireClientId(req: IncomingMessage): ClientId {
  const raw = req.headers['x-client-id'];
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (!val || !val.includes(':')) {
    throw new Error('Missing or invalid X-Client-Id header');
  }
  return asClientId(val);
}

async function serveStaticDist(
  distDir: string,
  reqPath: string,
  res: ServerResponse
): Promise<void> {
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  const resolvedRoot = path.resolve(distDir);
  let target = path.resolve(resolvedRoot, `.${cleanPath}`);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`) && target !== resolvedRoot) {
    sendJson(res, HTTP_NOT_FOUND, { error: 'Not found' });
    return;
  }
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      target = path.join(target, 'index.html');
    }
    const content = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(HTTP_OK, {
      'Content-Type': MIME_TYPES.get(ext) ?? 'application/octet-stream'
    });
    res.end(content);
  } catch {
    try {
      const indexHtml = await fs.readFile(path.join(resolvedRoot, 'index.html'));
      res.writeHead(HTTP_OK, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
    } catch {
      sendJson(res, HTTP_NOT_FOUND, { error: 'Not found' });
    }
  }
}

/** Creates the native Node.js HTTP request handler for `/api/*`, SSE `/api/events`, and static `dist/`. */
export function createRequestHandler(runner: JobRunner, distDir: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    try {
      if (method === 'GET' && pathname === '/api/state') {
        sendJson(res, HTTP_OK, runner.getState());
        return;
      }

      if (method === 'GET' && pathname === '/api/events') {
        res.writeHead(HTTP_OK, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        const unsubscribe = runner.subscribe({
          send(event, data): void {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          }
        });
        req.on('close', unsubscribe);
        return;
      }

      if (method === 'POST' && pathname === '/api/scan') {
        const clientId = requireClientId(req);
        const revision = runner.startScan(clientId);
        sendJson(res, HTTP_ACCEPTED, { revision });
        return;
      }

      if (method === 'PATCH' && pathname === '/api/queue/items/bulk') {
        const clientId = requireClientId(req);
        const body = await readJsonBody<{
          readonly revision: number;
          readonly itemIds: readonly string[];
          readonly patch: ItemPatch;
        }>(req);
        if (!Array.isArray(body.itemIds) || body.itemIds.length === 0) {
          sendJson(res, HTTP_BAD_REQUEST, {
            code: 'INVALID_BULK_PATCH',
            message: 'itemIds must be a non-empty array.'
          });
          return;
        }
        const state = await runner.patchItemsBulk(
          clientId,
          body.revision,
          body.itemIds.map((id) => asItemId(id)),
          body.patch
        );
        sendJson(res, HTTP_OK, state);
        return;
      }

      if (method === 'PATCH' && pathname.startsWith('/api/queue/items/')) {
        const clientId = requireClientId(req);
        const rawId = pathname.slice('/api/queue/items/'.length);
        const body = await readJsonBody<{ readonly revision: number; readonly patch: ItemPatch }>(
          req
        );
        const state = await runner.patchItem(clientId, body.revision, asItemId(rawId), body.patch);
        sendJson(res, HTTP_OK, state);
        return;
      }

      if (method === 'POST' && pathname === '/api/metadata/search') {
        const clientId = requireClientId(req);
        const body = await readJsonBody<{
          readonly query: string;
          readonly year?: number;
          readonly kind: MediaKind;
          readonly imdbId?: string;
          readonly tvdbId?: string;
          readonly episodeOrder?: EpisodeOrderMode;
        }>(req);
        const candidates = await runner.searchMetadata(clientId, body);
        sendJson(res, HTTP_OK, { candidates });
        return;
      }

      if (method === 'POST' && pathname === '/api/preflight') {
        const clientId = requireClientId(req);
        const body = await readJsonBody<{ readonly revision: number }>(req);
        const report = await runner.preflight(clientId, body.revision);
        sendJson(res, HTTP_OK, report);
        return;
      }

      if (method === 'POST' && pathname === '/api/jobs/start') {
        const clientId = requireClientId(req);
        const body = await readJsonBody<{
          readonly revision: number;
          readonly conflictResolutions: Partial<Record<ItemId, ConflictDecision>>;
        }>(req);
        const result = await runner.startJob(
          clientId,
          body.revision,
          body.conflictResolutions ?? {}
        );
        sendJson(res, HTTP_ACCEPTED, result);
        return;
      }

      if (method === 'POST' && pathname === '/api/jobs/unlock') {
        const clientId = requireClientId(req);
        const body = await readJsonBody<{ readonly force?: boolean }>(req);
        const state = await runner.unlock(clientId, Boolean(body.force));
        sendJson(res, HTTP_OK, state);
        return;
      }

      if (method === 'POST' && pathname === '/api/logs/clear') {
        const state = runner.clearLogs();
        sendJson(res, HTTP_OK, state);
        return;
      }

      if (method === 'POST' && pathname === '/api/preferences') {
        const body = await readJsonBody<{ readonly preferredLanguages?: readonly string[] }>(req);
        const validCodes = new Set<string>(METADATA_LANGUAGE_CODES);
        const isValid =
          Array.isArray(body.preferredLanguages) &&
          body.preferredLanguages.length > 0 &&
          body.preferredLanguages.every((lang) => typeof lang === 'string' && validCodes.has(lang));
        if (!isValid || !body.preferredLanguages) {
          sendJson(res, HTTP_BAD_REQUEST, {
            code: 'INVALID_PREFERENCES',
            message: 'preferredLanguages must be a non-empty array of valid language codes.'
          });
          return;
        }
        const state = runner.setPreferredLanguages(body.preferredLanguages);
        sendJson(res, HTTP_OK, state);
        return;
      }

      if (method === 'POST' && pathname === '/api/verifier/scan') {
        const clientId = requireClientId(req);
        const revision = runner.startVerifierScan(clientId);
        sendJson(res, HTTP_ACCEPTED, { revision });
        return;
      }

      if (method === 'POST' && pathname === '/api/verifier/fix') {
        const clientId = requireClientId(req);
        const body = await readJsonBody<{ readonly entryIds: readonly string[] }>(req);
        if (!Array.isArray(body.entryIds) || body.entryIds.length === 0) {
          sendJson(res, HTTP_BAD_REQUEST, {
            code: 'INVALID_VERIFIER_FIX',
            message: 'entryIds must be a non-empty array.'
          });
          return;
        }
        const revision = runner.startVerifierFix(
          clientId,
          body.entryIds.map((id) => asVerifierEntryId(id))
        );
        sendJson(res, HTTP_ACCEPTED, { revision });
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, HTTP_NOT_FOUND, { error: 'Unknown API endpoint' });
        return;
      }

      await serveStaticDist(distDir, pathname, res);
    } catch (err) {
      if (err instanceof LockConflictError) {
        sendJson(res, HTTP_CONFLICT, {
          error: err.code,
          message: err.message,
          state: runner.getState()
        });
        return;
      }
      if (err instanceof MetadataProviderError) {
        const status = err.kind === 'rate_limited' ? HTTP_TOO_MANY_REQUESTS : HTTP_BAD_GATEWAY;
        sendJson(res, status, {
          error: err.message,
          code: err.kind,
          provider: err.provider
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.includes('X-Client-Id') || message.includes('Unresolved conflict')
          ? HTTP_BAD_REQUEST
          : HTTP_INTERNAL_ERROR;
      sendJson(res, status, { error: message });
    }
  };
}
