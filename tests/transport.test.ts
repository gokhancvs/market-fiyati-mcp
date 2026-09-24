import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfflineTransport, LiveTransport, createTransport } from '../src/transport.js';
import { readConfig } from '../src/config.js';
import type { EndpointId } from '../src/contracts.js';

const payload = {
  keywords: 'süt',
  pages: 0,
  size: 25,
  latitude: 41,
  longitude: 29,
  distance: 1,
  depots: ['bim-test']
};
test('configuration supports explicit live access and defaults offline', () => {
  assert.equal(readConfig({}).mode, 'offline');
  assert.throws(() => readConfig({ MARKET_FIYATI_MODE: 'liv' }), {
    code: 'CONFIG_ERROR'
  });
  assert.equal(readConfig({ MARKET_FIYATI_MODE: 'live' }).mode, 'live');
  assert.throws(() => readConfig({ MARKET_FIYATI_TIMEOUT_MS: 'no' }), {
    code: 'CONFIG_ERROR'
  });
  assert.throws(() => readConfig({ MARKET_FIYATI_MIN_INTERVAL_MS: ' ' }), {
    code: 'CONFIG_ERROR'
  });
  assert.throws(() => readConfig({ MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'yes' }), {
    code: 'CONFIG_ERROR'
  });
});
test('offline transport always blocks without fetching', async () => {
  await assert.rejects(new OfflineTransport().request('search', payload), {
    code: 'NETWORK_DISABLED'
  });
});
const live = (fetcher: typeof fetch, extra: Record<string, string> = {}) =>
  new LiveTransport(
    readConfig({
      MARKET_FIYATI_MODE: 'live',
      MARKET_FIYATI_MIN_INTERVAL_MS: '0',
      ...extra
    }),
    fetcher
  );
test('live emits only allowed URL, minimal headers and exact JSON; redirects disabled', async () => {
  let calls = 0;
  const transport = live(async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://api.marketfiyati.org.tr/api/v2/search');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), payload);
    assert.equal(new Headers(init?.headers).has('cookie'), false);
    return Response.json({ ok: true });
  });
  assert.deepEqual((await transport.request('search', payload)).data, {
    ok: true
  });
  assert.equal(calls, 1);
});
test('experimental gate prevents fetch; map query is correctly encoded', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    const u = new URL(String(input));
    assert.equal(u.searchParams.get('words'), 'İstanbul & süt');
    return Response.json([]);
  };
  await assert.rejects(live(fetcher).request('geocode', { words: 'İstanbul & süt' }), {
    code: 'EXPERIMENTAL_DISABLED'
  });
  assert.equal(calls, 0);
  await live(fetcher, { MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'true' }).request('geocode', {
    words: 'İstanbul & süt'
  });
  assert.equal(calls, 1);
});
test('retries bounded transient HTTP responses, not ordinary 4xx', async () => {
  let calls = 0;
  const result = await live(
    async () => {
      calls++;
      return calls < 3 ? new Response('', { status: 503 }) : Response.json({ ok: true });
    },
    { MARKET_FIYATI_RETRIES: '2' }
  ).request('search', payload);
  assert.deepEqual(result.data, { ok: true });
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(
    live(async () => {
      calls++;
      return new Response('private body', { status: 400 });
    }).request('search', payload),
    { code: 'HTTP_ERROR' }
  );
  assert.equal(calls, 1);
});

test('default transient failures do not cause automatic repeat requests', async () => {
  let calls = 0;
  await assert.rejects(
    live(async () => {
      calls++;
      return new Response('', { status: 503 });
    }).request('search', payload),
    { code: 'HTTP_ERROR' }
  );
  assert.equal(calls, 1);
});

test('default request spacing holds a queued request for one second', async () => {
  const starts: number[] = [];
  const transport = new LiveTransport(readConfig({ MARKET_FIYATI_MODE: 'live' }), async () => {
    starts.push(performance.now());
    return Response.json({ ok: true });
  });
  await Promise.all([transport.request('categories'), transport.request('categories')]);
  assert.equal(starts.length, 2);
  // Measure the transport's own wait, with tolerance for clock/timer resolution.
  assert.ok(starts[1]! - starts[0]! >= 900, 'queued requests must respect the one-second default interval');
});
test('long Retry-After is returned to caller instead of retrying too soon', async () => {
  let calls = 0;
  await assert.rejects(
    live(async () => {
      calls++;
      return new Response('', {
        status: 429,
        headers: { 'retry-after': '120' }
      });
    }).request('search', payload),
    { code: 'RATE_LIMITED' }
  );
  assert.equal(calls, 1);
});
test('Retry-After prevents another already-queued request from fetching', async () => {
  let calls = 0;
  const transport = live(async () => {
    calls++;
    return calls === 1
      ? new Response('', { status: 429, headers: { 'retry-after': '120' } })
      : Response.json({ content: [] });
  });
  const results = await Promise.allSettled([transport.request('categories'), transport.request('categories')]);
  assert.equal(calls, 1);
  assert.ok(
    results.every(
      (r) => r.status === 'rejected' && r.reason.code === 'RATE_LIMITED' && r.reason.details.retryAfterMs > 0
    )
  );
});

test('exhausted retry budget retains per-origin cooldown until its deadline', async (t) => {
  let now = Date.parse('2026-09-22T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const transport = live(
    async () => {
      calls++;
      return calls === 1
        ? new Response('', {
            status: 503,
            headers: { 'retry-after': new Date(now + 2000).toUTCString() }
          })
        : Response.json({ ok: true });
    },
    { MARKET_FIYATI_RETRIES: '0', MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'true' }
  );
  await assert.rejects(transport.request('categories'), { code: 'HTTP_ERROR' });
  now += 500;
  await assert.rejects(transport.request('search', payload), (error) => {
    assert.equal((error as { details: { retryAfterMs: number } }).details.retryAfterMs, 1500);
    return true;
  });
  assert.equal(calls, 1);
  await transport.request('geocode', { words: 'test' });
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transport.request('categories', {}, controller.signal), {
    code: 'CANCELLED'
  });
  assert.equal(calls, 2);
  now += 1500;
  await transport.request('categories');
  assert.equal(calls, 3);
});

test('invalid or elapsed Retry-After does not freeze future requests', async () => {
  for (const header of ['garbage', '-1', '0', 'Tue, 01 Jan 2000 00:00:00 GMT']) {
    let calls = 0;
    const transport = live(
      async () =>
        ++calls === 1
          ? new Response('', {
              status: 429,
              headers: { 'retry-after': header }
            })
          : Response.json({ ok: true }),
      { MARKET_FIYATI_RETRIES: '0' }
    );
    await assert.rejects(transport.request('categories'), {
      code: 'RATE_LIMITED'
    });
    await transport.request('categories');
    assert.equal(calls, 2);
  }
});

test('short Retry-After allows the original request retry after waiting', async () => {
  let calls = 0;
  const transport = live(
    async () =>
      ++calls === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '0.01' } })
        : Response.json({ ok: true }),
    { MARKET_FIYATI_RETRIES: '2' }
  );
  assert.deepEqual((await transport.request('categories')).data, { ok: true });
  assert.equal(calls, 2);
});
test('rejects malformed JSON, HTML, oversize bodies and redirects', async () => {
  for (const [response, code] of [
    [
      new Response('{oops', {
        headers: { 'content-type': 'application/json' }
      }),
      'INVALID_JSON'
    ],
    [
      new Response('<html>blocked</html>', {
        headers: { 'content-type': 'text/html' }
      }),
      'INVALID_CONTENT_TYPE'
    ],
    [
      new Response('x'.repeat(2048), {
        headers: { 'content-type': 'application/json' }
      }),
      'RESPONSE_TOO_LARGE'
    ],
    [
      new Response('', {
        status: 302,
        headers: { location: 'https://evil.test' }
      }),
      'HTTP_ERROR'
    ]
  ] as const)
    await assert.rejects(
      live(async () => response, {
        MARKET_FIYATI_MAX_RESPONSE_BYTES: '1024'
      }).request('search', payload),
      { code }
    );
});
test('timeout and cancellation also interrupt body reads and never retry', async () => {
  let calls = 0;
  const hanging = live(
    async () => {
      calls++;
      return new Response(new ReadableStream({ start() {} }), {
        headers: { 'content-type': 'application/json' }
      });
    },
    { MARKET_FIYATI_TIMEOUT_MS: '20' }
  );
  await assert.rejects(hanging.request('search', payload), { code: 'TIMEOUT' });
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(hanging.request('search', payload, controller.signal), {
    code: 'CANCELLED'
  });
  assert.equal(calls, 1);
});
test('removed PDF endpoint is rejected before fetching even with experimental access enabled', async () => {
  let calls = 0;
  const transport = live(
    async () => {
      calls++;
      return Response.json({});
    },
    { MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'true' }
  );
  // Exercise stale untyped callers at the runtime allowlist boundary.
  await assert.rejects(transport.request('exportPdf' as EndpointId, {}), {
    code: 'INVALID_ENDPOINT'
  });
  assert.equal(calls, 0);
});
test('inherited endpoint keys are rejected before fetching or counting attempts', async () => {
  let calls = 0;
  const transport = live(async () => {
    calls++;
    return Response.json({});
  });
  const counts = { httpAttempts: 0, retries: 0 };
  for (const endpoint of ['constructor', 'toString', '__proto__']) {
    await assert.rejects(transport.request(endpoint as EndpointId, {}, undefined, counts), {
      code: 'INVALID_ENDPOINT'
    });
  }
  assert.equal(calls, 0);
  assert.deepEqual(counts, { httpAttempts: 0, retries: 0 });
});

test('transport factory creates offline without network and live metadata describes only the request', async () => {
  const offline = await createTransport(readConfig({}));
  await assert.rejects(offline.request('categories'), {
    code: 'NETWORK_DISABLED'
  });
  const response = await live(async () => Response.json({ content: [] })).request('categories');
  assert.deepEqual(Object.keys(response.meta).sort(), ['endpoint', 'experimental', 'retrievedAt', 'source']);
  assert.equal(response.meta.source, 'live');
});

test('live FIFO rejects overflow before fetch and cancelled entries immediately free capacity', async () => {
  let calls = 0;
  const active = new AbortController();
  const controllers = Array.from({ length: 32 }, () => new AbortController());
  const transport = live(async () => {
    calls++;
    return calls === 1 ? new Promise<Response>(() => {}) : Response.json({ ok: true });
  });
  const first = transport.request('categories', {}, active.signal).catch((e) => e.code);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const queued = controllers.map((controller) =>
    transport.request('categories', {}, controller.signal).catch((e) => e.code)
  );
  try {
    await assert.rejects(transport.request('categories', {}, AbortSignal.timeout(25)), {
      code: 'QUEUE_FULL'
    });
    assert.equal(calls, 1);
    for (let i = 0; i < 40; i++) {
      controllers[0]!.abort();
      assert.equal(await queued[0], 'CANCELLED');
      assert.equal(getEventListeners(controllers[0]!.signal, 'abort').length, 0);
      const replacement = new AbortController();
      controllers[0] = replacement;
      queued[0] = transport.request('categories', {}, replacement.signal).catch((e) => e.code);
      await assert.rejects(transport.request('categories', {}, AbortSignal.timeout(25)), {
        code: 'QUEUE_FULL'
      });
    }
  } finally {
    controllers.forEach((c) => c.abort());
    active.abort();
    await Promise.all([first, ...queued]);
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, 'removed queued jobs must never fetch later');
  assert.deepEqual((await transport.request('categories')).data, { ok: true });
  assert.equal(calls, 2);
});

test('FIFO dispatch order survives cancellation of a middle waiting job', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const starts: string[] = [];
  const transport = live(async (_url, init) => {
    const label = (JSON.parse(String(init?.body)) as { label: string }).label;
    starts.push(label);
    if (label === 'active') await gate;
    return Response.json({ label });
  });
  const first = transport.request('search', { label: 'active' });
  const second = transport.request('search', { label: 'second' });
  const removed = new AbortController();
  const middle = transport.request('search', { label: 'removed' }, removed.signal);
  const last = transport.request('search', { label: 'last' });
  removed.abort();
  await assert.rejects(middle, { code: 'CANCELLED' });
  assert.deepEqual(starts, ['active']);
  release();
  const results = await Promise.all([first, second, last]);
  assert.deepEqual(starts, ['active', 'second', 'last']);
  assert.deepEqual(
    results.map((result) => result.data),
    [{ label: 'active' }, { label: 'second' }, { label: 'last' }]
  );
});
