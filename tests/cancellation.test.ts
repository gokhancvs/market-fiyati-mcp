import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { MarketService } from '../src/service.js';
import { readConfig } from '../src/config.js';
import type { Transport as MarketTransport } from '../src/transport.js';
import { RequestCancellation } from '../src/cancellation.js';
import { AppError } from '../src/errors.js';
import { OfflineTransport, LiveTransport } from '../src/transport.js';
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport as McpTransport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { withCancellation } from '../src/cancellation-transport.js';

test('cancellation ownership distinguishes numeric and string IDs and ignores stale cleanup', () => {
  const requests = new RequestCancellation();
  const zero = requests.begin(0),
    textZero = requests.begin('0');
  requests.cancel(0);
  assert.equal(zero.signal.aborted, true);
  assert.equal(textZero.signal.aborted, false);
  assert.throws(() => requests.begin('0'), { code: 'INVALID_ARGUMENT' });
  requests.finish(0, zero);
  const reused = requests.begin(0);
  requests.finish(0, zero);
  assert.equal(requests.current(0), reused);
  requests.close();
  assert.equal(reused.signal.aborted, true);
  assert.equal(textZero.signal.aborted, true);
  assert.equal(requests.current(0), undefined);
  assert.throws(() => requests.begin(2), { code: 'INVALID_ARGUMENT' });
});

for (const id of [0, 1, '', '0'] as const)
  test(`SDK tool cancellation aborts request ID ${JSON.stringify(id)}`, { timeout: 5000 }, async () => {
    let entered!: () => void;
    let release!: () => void;
    let signal!: AbortSignal;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport = {
      mode: 'offline',
      async request(_endpoint: unknown, _payload: unknown, requestSignal: AbortSignal) {
        signal = requestSignal;
        entered();
        await completion;
        return {
          data: { content: [] },
          meta: {
            source: 'live',
            endpoint: 'categories',
            experimental: false,
            retrievedAt: new Date(0).toISOString()
          }
        };
      }
    } as MarketTransport;
    const server = createServer(new MarketService(transport, readConfig({})));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    ct.onmessage = () => {};
    try {
      await server.connect(st);
      await ct.start();
      await ct.send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'market_get_categories', arguments: {} }
      });
      await started;
      await ct.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: id, reason: 'synthetic cancellation' }
      });
      await tick();
      assert.equal(signal.aborted, true);
    } finally {
      release();
      await tick();
      await ct.close();
      await server.close();
    }
  });

test('same-turn cancellation stops before the tool service starts', { timeout: 5000 }, async () => {
  for (const id of [0, ''] as const) {
    let calls = 0;
    class CountingService extends MarketService {
      override async execute(): Promise<never> {
        calls++;
        throw new Error('unexpected tool execution');
      }
    }
    const server = createServer(
      new CountingService(
        {
          mode: 'offline',
          async request() {
            throw new Error('unexpected fetch');
          }
        } as MarketTransport,
        readConfig({})
      )
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    let responded!: () => void;
    const response = new Promise<void>((resolve) => {
      responded = resolve;
    });
    ct.onmessage = (message) => {
      if ('id' in message && message.id === id) responded();
    };
    try {
      await server.connect(st);
      await ct.start();
      await ct.send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'market_get_categories', arguments: {} }
      });
      await ct.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: id }
      });
      await response;
      assert.equal(calls, 0);
    } finally {
      await ct.close();
      await server.close();
    }
  }
});

test(
  'duplicate unrelated requests cannot steal an active tool ID; completed IDs can be reused',
  { timeout: 5000 },
  async () => {
    let entered!: () => void,
      release!: () => void,
      signal!: AbortSignal,
      calls = 0;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport = {
      mode: 'offline',
      async request(_endpoint: unknown, _payload: unknown, requestSignal: AbortSignal) {
        calls++;
        signal = requestSignal;
        entered();
        await hold;
        if (requestSignal.aborted) throw new AppError('CANCELLED', 'Request cancelled.');
        return {
          data: { content: [] },
          meta: {
            source: 'live',
            endpoint: 'categories',
            experimental: false,
            retrievedAt: new Date(0).toISOString()
          }
        };
      }
    } as MarketTransport;
    const server = createServer(new MarketService(transport, readConfig({})));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const messages: unknown[] = [];
    ct.onmessage = (message) => {
      messages.push(message);
    };
    try {
      await server.connect(st);
      await ct.start();
      await ct.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: { name: 'market_get_categories', arguments: {} }
      });
      await started;
      await ct.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'ping',
        params: {}
      });
      await ct.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: { name: 'market_get_categories', arguments: {} }
      });
      await tick();
      assert.equal(
        messages.filter(
          (message) =>
            typeof message === 'object' &&
            message !== null &&
            'error' in message &&
            (message as { error: { code: number } }).error.code === -32600
        ).length,
        2
      );
      assert.equal(calls, 1);
      await ct.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: '0' }
      });
      assert.equal(signal.aborted, false);
      await ct.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 0 }
      });
      assert.equal(signal.aborted, true);
      release();
      await tick();
      await tick();
      await ct.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: { name: 'market_get_categories', arguments: {} }
      });
      await tick();
      assert.equal(calls, 2);
    } finally {
      release();
      await ct.close();
      await server.close();
    }
  }
);

test('SDK input rejection releases the request ID for a later valid call', { timeout: 5000 }, async () => {
  const server = createServer(new MarketService(new OfflineTransport(), readConfig({})));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await ct.start();
    let received!: (message: unknown) => void;
    let response = new Promise<unknown>((resolve) => {
      received = resolve;
    });
    ct.onmessage = (message) => received(message);
    await ct.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'tools/call',
      params: {
        name: 'market_search_products',
        arguments: { keywords: 'test' }
      }
    });
    await response;
    response = new Promise<unknown>((resolve) => {
      received = resolve;
    });
    await ct.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'tools/call',
      params: { name: 'market_status', arguments: {} }
    });
    const second = (await response) as { result?: { isError?: boolean } };
    assert.equal(second.result?.isError, undefined);
  } finally {
    await ct.close();
    await server.close();
  }
});

test('completed response permits ID reuse inside the receiving callback', { timeout: 5000 }, async () => {
  const server = createServer(new MarketService(new OfflineTransport(), readConfig({})));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const replies: unknown[] = [];
  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  ct.onmessage = (message) => {
    replies.push(message);
    if (replies.length === 1) {
      void ct.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: { name: 'market_status', arguments: {} }
      });
    } else finished();
  };
  try {
    await server.connect(st);
    await ct.start();
    await ct.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'tools/call',
      params: { name: 'market_status', arguments: {} }
    });
    await done;
    assert.equal(replies.length, 2);
    assert.ok(replies.every((reply) => typeof reply === 'object' && reply !== null && 'result' in reply));
  } finally {
    await ct.close();
    await server.close();
  }
});

test('an in-flight non-tool request reserves its ID before a tool arrives', { timeout: 5000 }, async () => {
  let calls = 0;
  class CountingService extends MarketService {
    override async execute(): Promise<never> {
      calls++;
      throw new Error('unexpected tool execution');
    }
  }
  const server = createServer(new CountingService(new OfflineTransport(), readConfig({})));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const replies: unknown[] = [];
  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  ct.onmessage = (message) => {
    replies.push(message);
    if (replies.length === 2) finished();
  };
  try {
    await server.connect(st);
    await ct.start();
    await ct.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'ping',
      params: {}
    });
    await ct.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'tools/call',
      params: { name: 'market_status', arguments: {} }
    });
    await done;
    assert.equal(calls, 0);
    assert.equal(replies.filter((reply) => typeof reply === 'object' && reply !== null && 'result' in reply).length, 1);
    assert.equal(
      replies.filter(
        (reply) =>
          typeof reply === 'object' &&
          reply !== null &&
          'error' in reply &&
          (reply as { error: { code: number } }).error.code === -32600
      ).length,
      1
    );
  } finally {
    await ct.close();
    await server.close();
  }
});

test(
  'cancelled non-tool request releases its ID even when SDK suppresses its response',
  { timeout: 5000 },
  async () => {
    let started!: () => void;
    let aborted!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const stopped = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const server = createServer(new MarketService(new OfflineTransport(), readConfig({})));
    server.server.setRequestHandler(PingRequestSchema, async (_request, extra) => {
      started();
      await new Promise<void>((resolve) =>
        extra.signal.addEventListener(
          'abort',
          () => {
            aborted();
            resolve();
          },
          { once: true }
        )
      );
      return {};
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const replies: unknown[] = [];
    let responded!: () => void;
    const response = new Promise<void>((resolve) => {
      responded = resolve;
    });
    ct.onmessage = (message) => {
      replies.push(message);
      responded();
    };
    try {
      await server.connect(st);
      await ct.start();
      await ct.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
        params: {}
      });
      await entered;
      await ct.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 1 }
      });
      await stopped;
      await tick();
      assert.equal(replies.length, 0, 'SDK suppresses the cancelled ping response');
      await ct.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'market_status', arguments: {} }
      });
      await response;
      assert.ok(replies.some((reply) => typeof reply === 'object' && reply !== null && 'result' in reply));
    } finally {
      await ct.close();
      await server.close();
    }
  }
);

test('falsy non-tool cancellation keeps ownership until its response', { timeout: 5000 }, async () => {
  for (const id of [0, ''] as const) {
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = createServer(new MarketService(new OfflineTransport(), readConfig({})));
    server.server.setRequestHandler(PingRequestSchema, async () => {
      started();
      await held;
      return {};
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const replies: unknown[] = [];
    ct.onmessage = (message) => {
      replies.push(message);
    };
    try {
      await server.connect(st);
      await ct.start();
      await ct.send({
        jsonrpc: '2.0',
        id,
        method: 'ping',
        params: {}
      });
      await entered;
      await ct.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: id }
      });
      await ct.send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'market_status', arguments: {} }
      });
      assert.ok(
        replies.some(
          (reply) =>
            typeof reply === 'object' &&
            reply !== null &&
            'error' in reply &&
            (reply as { error: { code: number } }).error.code === -32600
        )
      );
      release();
      await tick();
      await tick();
      await ct.send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'market_status', arguments: {} }
      });
      await tick();
      assert.ok(
        replies.some(
          (reply) =>
            typeof reply === 'object' &&
            reply !== null &&
            'result' in reply &&
            'structuredContent' in (reply as { result: Record<string, unknown> }).result
        )
      );
    } finally {
      release();
      await ct.close();
      await server.close();
    }
  }
});

test('failed response send and connection close release tracked requests', async () => {
  const requests = new RequestCancellation();
  const inner: McpTransport = {
    async start() {},
    async send() {
      throw new Error('synthetic send failure');
    },
    async close() {
      this.onclose?.();
    }
  };
  const wrapped = withCancellation(inner, requests);
  wrapped.onmessage = () => {};
  await wrapped.start();
  inner.onmessage?.({
    jsonrpc: '2.0',
    id: 0,
    method: 'ping',
    params: {}
  });
  assert.ok(requests.current(0));
  await assert.rejects(wrapped.send({ jsonrpc: '2.0', id: 0, result: {} }), /synthetic send failure/);
  assert.equal(requests.current(0), undefined);
  inner.onmessage?.({
    jsonrpc: '2.0',
    id: 1,
    method: 'ping',
    params: {}
  });
  const pending = requests.current(1)!;
  await wrapped.close();
  assert.equal(pending.signal.aborted, true);
  assert.equal(requests.current(1), undefined);
});

test('cancelling a queued tool frees its slot and does not start a second fetch', { timeout: 5000 }, async () => {
  let calls = 0,
    started!: () => void,
    aborted!: () => void;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  const firstAborted = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const config = readConfig({
    MARKET_FIYATI_MODE: 'live',
    MARKET_FIYATI_MIN_INTERVAL_MS: '0'
  });
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    started();
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener(
        'abort',
        () => {
          aborted();
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    });
  };
  const server = createServer(new MarketService(new LiveTransport(config, fetcher), config));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  ct.onmessage = () => {};
  try {
    await server.connect(st);
    await ct.start();
    await ct.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'tools/call',
      params: { name: 'market_get_categories', arguments: {} }
    });
    await first;
    await ct.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'market_get_categories', arguments: {} }
    });
    await tick();
    await ct.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1 }
    });
    await ct.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 0 }
    });
    await firstAborted;
    await tick();
    assert.equal(calls, 1);
  } finally {
    await ct.close();
    await server.close();
  }
});

test(
  'cancelled basket retains the first HTTP attempt and never fetches its second item',
  { timeout: 5000 },
  async () => {
    let calls = 0,
      started!: () => void;
    const first = new Promise<void>((resolve) => {
      started = resolve;
    });
    const config = readConfig({
      MARKET_FIYATI_MODE: 'live',
      MARKET_FIYATI_MIN_INTERVAL_MS: '1000'
    });
    const fetcher: typeof fetch = async () => {
      calls++;
      started();
      return Response.json({
        numberOfFound: 1,
        searchResultType: 0,
        content: [
          {
            id: 'A',
            title: 'A',
            productDepotInfoList: [
              {
                depotId: 'bim-test',
                depotName: 'Test',
                marketAdi: 'bim',
                price: 10
              }
            ]
          }
        ]
      });
    };
    const server = createServer(new MarketService(new LiveTransport(config, fetcher), config));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    let responded!: (message: unknown) => void;
    const response = new Promise<unknown>((resolve) => {
      responded = resolve;
    });
    ct.onmessage = (message) => responded(message);
    try {
      await server.connect(st);
      await ct.start();
      await ct.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: {
          name: 'market_compare_basket',
          arguments: {
            latitude: 0,
            longitude: 0,
            distance: 1,
            depots: ['bim-test'],
            items: [
              { id: 'A', quantity: 1 },
              { id: 'B', quantity: 1 }
            ]
          }
        }
      });
      await first;
      await tick();
      await ct.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 0 }
      });
      const message = (await response) as {
        result: {
          isError: boolean;
          structuredContent: {
            error: { code: string };
            meta: { requestMetrics: { httpAttempts: number } };
          };
        };
      };
      assert.equal(message.result.isError, true);
      assert.equal(message.result.structuredContent.error.code, 'CANCELLED');
      assert.equal(message.result.structuredContent.meta.requestMetrics.httpAttempts, 1);
      assert.equal(calls, 1);
    } finally {
      await ct.close();
      await server.close();
    }
  }
);
