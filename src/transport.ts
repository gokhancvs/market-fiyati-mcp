import { setTimeout as delay } from 'node:timers/promises';
import { endpoints, type Endpoint, type EndpointId } from './contracts.js';
import { AppError } from './errors.js';
import { type Config } from './config.js';
import type { HttpAttemptCounts } from './request-metrics.js';

export type Payload = Record<string, unknown>;
export type SourceMeta = {
  source: 'live';
  endpoint: EndpointId;
  experimental: boolean;
  retrievedAt: string;
};
export type TransportResult = { data: unknown; meta: SourceMeta };
export interface Transport {
  readonly mode: Config['mode'];
  request(
    endpoint: EndpointId,
    payload?: Payload,
    signal?: AbortSignal,
    counts?: HttpAttemptCounts
  ): Promise<TransportResult>;
}
export class OfflineTransport implements Transport {
  readonly mode = 'offline' as const;
  async request(_endpoint: EndpointId, _payload?: Payload, _signal?: AbortSignal): Promise<TransportResult> {
    throw new AppError(
      'NETWORK_DISABLED',
      'Live requests are disabled. Enable live only when the user starts live testing.'
    );
  }
}

function buildUrl(endpoint: EndpointId, payload: Payload): URL {
  const e = endpoints[endpoint];
  const url = new URL(e.path, e.origin);
  if (e.method === 'GET') for (const [key, value] of Object.entries(payload)) url.searchParams.set(key, String(value));
  return url;
}
const abortError = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new AppError('CANCELLED', 'Request cancelled.');
};
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}
async function limitedBody(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new AppError('RESPONSE_TOO_LARGE', 'Upstream response exceeds configured byte limit.');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await raceAbort(reader.read(), signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) throw new AppError('RESPONSE_TOO_LARGE', 'Upstream response exceeds configured byte limit.');
      chunks.push(chunk.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

export const MAX_PENDING_REQUESTS = 32;

export class LiveTransport implements Transport {
  readonly mode = 'live' as const;
  private readonly pending = new Set<{ start: () => void }>();
  private active = false;
  private lastStarted = 0;
  private readonly cooldowns = new Map<string, { until: number; status: number }>();
  constructor(
    private readonly config: Config,
    private readonly fetcher: typeof fetch = globalThis.fetch
  ) {
    if (config.mode !== 'live') throw new AppError('CONFIG_ERROR', 'LiveTransport requires explicit live mode.');
  }
  async request(
    endpoint: EndpointId,
    payload: Payload = {},
    signal?: AbortSignal,
    counts?: HttpAttemptCounts
  ): Promise<TransportResult> {
    abortError(signal);
    if (!Object.hasOwn(endpoints, endpoint))
      throw new AppError('INVALID_ENDPOINT', 'Endpoint is not in the allowlist.');
    const e: Endpoint = endpoints[endpoint];
    if (e.experimental && !this.config.enableExperimental)
      throw new AppError(
        'EXPERIMENTAL_DISABLED',
        'Enable experimental endpoints explicitly before live testing this endpoint.',
        { endpoint }
      );
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        abortError(signal);
        const cooldown = this.cooldowns.get(e.origin);
        const remaining = cooldown ? cooldown.until - Date.now() : 0;
        if (cooldown && remaining > 0)
          throw new AppError(
            cooldown.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR',
            'Upstream cooldown is active; no request was sent.',
            { status: cooldown.status, retryAfterMs: remaining }
          );
        this.cooldowns.delete(e.origin);
        const wait = Math.max(0, this.lastStarted + this.config.minIntervalMs - Date.now());
        if (wait) await this.pause(wait, signal);
        this.lastStarted = Date.now();
        try {
          return await this.once(endpoint, payload, signal, counts, attempt > 0);
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          const status = Number(error.details.status);
          const retryable = [429, 502, 503, 504].includes(status);
          const retryAfter = Number(error.details.retryAfterMs ?? 0);
          if (retryable && retryAfter > 0)
            this.cooldowns.set(e.origin, {
              until: Date.now() + retryAfter,
              status
            });
          if (!retryable || attempt >= this.config.retries || retryAfter > 5000) throw error;
          await this.pause(Math.max(retryAfter, 100 * 2 ** attempt), signal);
        }
      }
    };
    if (this.active && this.pending.size >= MAX_PENDING_REQUESTS)
      throw new AppError('QUEUE_FULL', 'Live request queue is full; no request was sent.', {
        maxPendingRequests: MAX_PENDING_REQUESTS
      });
    return new Promise<TransportResult>((resolve, reject) => {
      const detach = () => signal?.removeEventListener('abort', cancel);
      const job = {
        start: () => {
          detach();
          void run()
            .then(resolve, reject)
            .finally(() => {
              this.active = false;
              this.drain();
            });
        }
      };
      const cancel = () => {
        this.pending.delete(job);
        detach();
        reject(new AppError('CANCELLED', 'Request cancelled.'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.add(job);
      this.drain();
    });
  }
  private drain(): void {
    if (this.active) return;
    const job = this.pending.values().next().value;
    if (!job) return;
    this.pending.delete(job);
    this.active = true;
    job.start();
  }
  private async pause(ms: number, signal?: AbortSignal): Promise<void> {
    try {
      await delay(ms, undefined, signal ? { signal } : {});
    } catch {
      throw new AppError('CANCELLED', 'Request cancelled.');
    }
  }
  private async once(
    endpoint: EndpointId,
    payload: Payload,
    signal?: AbortSignal,
    counts?: HttpAttemptCounts,
    isRetry = false
  ): Promise<TransportResult> {
    const e: Endpoint = endpoints[endpoint];
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (e.method === 'POST') headers['Content-Type'] = 'application/json';
      const url = buildUrl(endpoint, payload);
      const init: RequestInit = {
        method: e.method,
        headers,
        redirect: 'error',
        signal: combined,
        ...(e.method === 'POST' ? { body: JSON.stringify(payload) } : {})
      };
      abortError(signal);
      // Count dispatch, including synchronous fetch errors; not planned attempts.
      if (counts) {
        counts.httpAttempts++;
        if (isRetry) counts.retries++;
      }
      const response = await raceAbort(this.fetcher(url, init), combined);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const retryHeader = response.headers.get('retry-after');
        const retryAfterMs = retryHeader
          ? Number.isFinite(Number(retryHeader))
            ? Number(retryHeader) * 1000
            : Math.max(0, Date.parse(retryHeader) - Date.now())
          : 0;
        throw new AppError(
          response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR',
          `Upstream HTTP ${response.status}.`,
          {
            status: response.status,
            ...(Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? { retryAfterMs } : {})
          }
        );
      }
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (mime !== 'application/json' && !mime.endsWith('+json')) {
        void response.body?.cancel().catch(() => {});
        throw new AppError('INVALID_CONTENT_TYPE', 'Unexpected upstream content type.');
      }
      const bytes = await limitedBody(response, this.config.maxResponseBytes, combined);
      let data: unknown;
      try {
        data = JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new AppError('INVALID_JSON', 'Upstream body is not valid JSON.');
      }
      return {
        data,
        meta: {
          source: 'live',
          endpoint,
          experimental: e.experimental,
          retrievedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      if (signal?.aborted) throw new AppError('CANCELLED', 'Request cancelled.');
      if (timeout.signal.aborted) throw new AppError('TIMEOUT', 'Upstream request or body read timed out.');
      if (error instanceof AppError) throw error;
      throw new AppError('NETWORK_ERROR', 'Network request failed; redirects are not followed.');
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function createTransport(config: Config): Promise<Transport> {
  return config.mode === 'live' ? new LiveTransport(config) : new OfflineTransport();
}
