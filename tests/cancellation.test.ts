import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../src/server.js';
import { MarketService } from '../src/service.js';
import { readConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { LiveTransport, type Transport as MarketTransport } from '../src/transport.js';

const categoriesCall = (id: string | number) =>
  ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'market_get_categories', arguments: {} }
  }) as const;
const cancel = (requestId: string | number) =>
  ({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } }) as const;

/** A market transport whose request waits until released and exposes its abort signal. */
function heldTransport() {
  let entered!: () => void;
  let release!: () => void;
  const held = {
    signal: undefined as AbortSignal | undefined,
    calls: 0,
    started: new Promise<void>((resolve) => {
      entered = resolve;
    }),
    release: () => release(),
    transport: {
      mode: 'offline',
      async request(_endpoint: unknown, _payload: unknown, signal: AbortSignal) {
        held.calls++;
        held.signal = signal;
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          data: { content: [] },
          meta: { source: 'live', endpoint: 'categories', experimental: false, retrievedAt: new Date(0).toISOString() }
        };
      }
    } as MarketTransport
  };
  return held;
}

/** Connect a raw client transport and record every message the server sends. */
async function connect(service: MarketService) {
  const server = createServer(service);
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const replies: JSONRPCMessage[] = [];
  client.onmessage = (message) => replies.push(message);
  await server.connect(serverSide);
  await client.start();
  const answered = async (id: string | number) => {
    while (!replies.some((reply) => 'id' in reply && reply.id === id)) await tick();
  };
  const close = async () => {
    await client.close();
    await server.close();
  };
  return { client, replies, answered, close };
}
const repliesFor = (replies: JSONRPCMessage[], id: string | number) =>
  replies.filter((reply) => 'id' in reply && reply.id === id);

for (const id of [1, 'call-1'] as const)
  test(`client cancellation aborts active tool ${JSON.stringify(id)} and sends no response`, async () => {
    const held = heldTransport();
    let settled!: () => void;
    const executed = new Promise<void>((resolve) => {
      settled = resolve;
    });
    class SettledService extends MarketService {
      override async execute(...args: Parameters<MarketService['execute']>) {
        try {
          return await super.execute(...args);
        } finally {
          settled();
        }
      }
    }
    const session = await connect(new SettledService(held.transport, readConfig({})));
    try {
      await session.client.send(categoriesCall(id));
      await held.started;
      await session.client.send(cancel(id));
      await tick();
      assert.equal(held.signal?.aborted, true);
      held.release();
      // Any response for the cancelled call is sent right after the service settles, before this ping's.
      await executed;
      await session.client.send({ jsonrpc: '2.0', id: 'after', method: 'ping' });
      await session.answered('after');
      assert.deepEqual(repliesFor(session.replies, id), []);
    } finally {
      held.release();
      await session.close();
    }
  });

test('same-turn cancellation stops before the tool service starts', async () => {
  for (const id of [1, 'x'] as const) {
    let calls = 0;
    class CountingService extends MarketService {
      override async execute(): Promise<never> {
        calls++;
        throw new Error('unexpected tool execution');
      }
    }
    const session = await connect(new CountingService(heldTransport().transport, readConfig({})));
    try {
      await session.client.send(categoriesCall(id));
      await session.client.send(cancel(id));
      await session.client.send({ jsonrpc: '2.0', id: 'after', method: 'ping' });
      await session.answered('after');
      assert.equal(calls, 0);
      assert.deepEqual(repliesFor(session.replies, id), []);
    } finally {
      await session.close();
    }
  }
});

test('closing the connection aborts an active tool', async () => {
  const held = heldTransport();
  const session = await connect(new MarketService(held.transport, readConfig({})));
  try {
    await session.client.send(categoriesCall(1));
    await held.started;
    await session.close();
    assert.equal(held.signal?.aborted, true);
  } finally {
    held.release();
  }
});

test('cancelling a queued tool frees its slot and does not start a second fetch', async () => {
  let calls = 0,
    started!: () => void,
    aborted!: () => void;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  const firstAborted = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const config = readConfig({ MARKET_FIYATI_MODE: 'live', MARKET_FIYATI_MIN_INTERVAL_MS: '0' });
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
  const session = await connect(new MarketService(new LiveTransport(config, fetcher), config));
  try {
    await session.client.send(categoriesCall(1));
    await first;
    await session.client.send(categoriesCall(2));
    await tick();
    await session.client.send(cancel(2));
    await session.client.send(cancel(1));
    await firstAborted;
    await tick();
    assert.equal(calls, 1);
  } finally {
    await session.close();
  }
});

test('cancelled basket retains the first HTTP attempt and never fetches its second item', async () => {
  let calls = 0,
    started!: () => void,
    failed!: (error: unknown) => void;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  const outcome = new Promise<unknown>((resolve) => {
    failed = resolve;
  });
  const config = readConfig({ MARKET_FIYATI_MODE: 'live', MARKET_FIYATI_MIN_INTERVAL_MS: '1000' });
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
          productDepotInfoList: [{ depotId: 'bim-test', depotName: 'Test', marketAdi: 'bim', price: 10 }]
        }
      ]
    });
  };
  class RecordingService extends MarketService {
    override async execute(...args: Parameters<MarketService['execute']>) {
      try {
        return await super.execute(...args);
      } catch (error) {
        failed(error);
        throw error;
      }
    }
  }
  const session = await connect(new RecordingService(new LiveTransport(config, fetcher), config));
  try {
    await session.client.send({
      jsonrpc: '2.0',
      id: 1,
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
    await session.client.send(cancel(1));
    const error = (await outcome) as AppError;
    assert.equal(error.code, 'CANCELLED');
    assert.equal(error.requestMetrics?.httpAttempts, 1);
    assert.equal(calls, 1);
  } finally {
    await session.close();
  }
});
