import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from '../src/server.js';
import { MarketService } from '../src/service.js';
import { OfflineTransport, LiveTransport } from '../src/transport.js';
import { readConfig } from '../src/config.js';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { WARNING_CODES } from '../src/observations.js';
import { AppError } from '../src/errors.js';

const context = {
  latitude: 0,
  longitude: 0,
  distance: 1,
  depots: ['bim-test']
};
const itemResponse = (id: string) => ({
  numberOfFound: 1,
  searchResultType: 0,
  content: [
    {
      id,
      title: id,
      productDepotInfoList: [
        {
          depotId: 'bim-test',
          depotName: 'Test',
          marketAdi: 'bim',
          price: 0.1
        }
      ]
    }
  ]
});
async function withClient(
  fetcher: typeof fetch,
  run: (client: Client) => Promise<void>,
  env: Record<string, string> = {}
) {
  const config = readConfig({
    MARKET_FIYATI_MODE: 'live',
    MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'true',
    MARKET_FIYATI_MIN_INTERVAL_MS: '0',
    ...env
  });
  const server = createServer(new MarketService(new LiveTransport(config, fetcher), config));
  const client = new Client({ name: 'protocol-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    await client.listTools();
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test('malformed wire JSON with long facet keys returns a bounded MCP failure', async () => {
  const key = 'x'.repeat(900_000);
  const body = `{"numberOfFound":0,"searchResultType":0,"content":[],"facetMap":{${JSON.stringify(key)}:[${Array(10).fill('1e400').join(',')}]}}`;
  await withClient(
    async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    async (client) => {
      const result = (await client.callTool({
        name: 'market_search_products',
        arguments: { ...context, keywords: 'test' }
      })) as CallToolResult;
      assert.equal(result.isError, true);
      assert.ok(Buffer.byteLength(JSON.stringify(result)) < 4096, 'failure must not amplify upstream diagnostic paths');
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
      assert.equal(
        (
          result.structuredContent!.meta as {
            requestMetrics: { httpAttempts: number };
          }
        ).requestMetrics.httpAttempts,
        1
      );
    }
  );
});

test('finite malformed facets and nonfinite extra fields fail without partial success', async () => {
  const key = 'x'.repeat(900_000);
  const bodies = [
    `{"numberOfFound":0,"searchResultType":0,"content":[],"facetMap":{${JSON.stringify(key)}:{"bad":true}}}`,
    '{"content":[],"future":1e400}'
  ];
  for (const [index, body] of bodies.entries()) {
    await withClient(
      async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
      async (client) => {
        const result = (await client.callTool({
          name: index === 0 ? 'market_search_products' : 'market_get_categories',
          arguments: index === 0 ? { ...context, keywords: 'test' } : {}
        })) as CallToolResult;
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.data, null);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) < 4096);
        assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
        assert.equal(
          (
            result.structuredContent!.meta as {
              requestMetrics: { httpAttempts: number };
            }
          ).requestMetrics.httpAttempts,
          1
        );
      }
    );
  }
});

test('oversized application errors return a bounded fallback with trusted metrics', async () => {
  class FailingService extends MarketService {
    override async execute(): Promise<never> {
      throw new AppError(
        'INVALID_RESPONSE',
        'x'.repeat(9 * 1024 * 1024),
        { privatePayload: 'must-not-escape' },
        { httpAttempts: 2, retries: 1, durationMs: 12 }
      );
    }
  }
  const server = createServer(new FailingService(new OfflineTransport(), readConfig({})));
  const client = new Client({ name: 'error-budget-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    const result = (await client.callTool({
      name: 'market_status',
      arguments: {}
    })) as CallToolResult;
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent!.error as { code: string }).code, 'OUTPUT_TOO_LARGE');
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 4096);
    assert.ok(!JSON.stringify(result).includes('must-not-escape'));
    assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
    assert.deepEqual((result.structuredContent!.meta as { requestMetrics: unknown }).requestMetrics, {
      httpAttempts: 2,
      retries: 1,
      durationMs: 12
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test('error budget covers large details, deep details and invalid metrics', async () => {
  let deep: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < 90; i++) deep = { next: deep };
  const cases = [
    new AppError(
      'INVALID_RESPONSE',
      'small',
      { privatePayload: 'x'.repeat(9 * 1024 * 1024) },
      { httpAttempts: 2, retries: 1, durationMs: 12 }
    ),
    new AppError('INVALID_RESPONSE', 'small', deep, {
      httpAttempts: 2,
      retries: 1,
      durationMs: 12
    }),
    new AppError('INVALID_RESPONSE', 'small', {}, { httpAttempts: NaN, retries: 0, durationMs: Infinity })
  ];
  for (const sourceError of cases) {
    class FailingService extends MarketService {
      override async execute(): Promise<never> {
        throw sourceError;
      }
    }
    const server = createServer(new FailingService(new OfflineTransport(), readConfig({})));
    const client = new Client({ name: 'error-matrix-test', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st);
      await client.connect(ct);
      const result = (await client.callTool({
        name: 'market_status',
        arguments: {}
      })) as CallToolResult;
      assert.equal(result.isError, true);
      assert.equal((result.structuredContent!.error as { code: string }).code, 'OUTPUT_TOO_LARGE');
      assert.ok(Buffer.byteLength(JSON.stringify(result)) < 4096);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
      const metrics = (result.structuredContent!.meta as { requestMetrics?: unknown }).requestMetrics;
      assert.deepEqual(
        metrics,
        sourceError.requestMetrics?.httpAttempts === 2 ? { httpAttempts: 2, retries: 1, durationMs: 12 } : undefined
      );
    } finally {
      await client.close();
      await server.close();
    }
  }
});

test('small application errors retain safe details and unknown errors hide source text', async (t) => {
  // Operator diagnostics for the unknown error are covered in diagnostics.test.ts.
  t.mock.method(process.stderr, 'write', () => true);
  for (const sourceError of [
    new AppError(
      'HTTP_ERROR',
      'HTTP failure.',
      { status: 500, endpoint: 'markets' },
      { httpAttempts: 1, retries: 0, durationMs: 3 }
    ),
    new Error('private raw body')
  ]) {
    class FailingService extends MarketService {
      override async execute(): Promise<never> {
        throw sourceError;
      }
    }
    const server = createServer(new FailingService(new OfflineTransport(), readConfig({})));
    const client = new Client({ name: 'safe-error-test', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st);
      await client.connect(ct);
      const result = (await client.callTool({
        name: 'market_status',
        arguments: {}
      })) as CallToolResult;
      const error = result.structuredContent!.error as Record<string, unknown>;
      assert.equal(error.code, sourceError instanceof AppError ? 'HTTP_ERROR' : 'INTERNAL_ERROR');
      if (sourceError instanceof AppError) {
        assert.equal(error.status, 500);
        assert.equal(error.endpoint, 'markets');
        assert.deepEqual((result.structuredContent!.meta as { requestMetrics: unknown }).requestMetrics, {
          httpAttempts: 1,
          retries: 0,
          durationMs: 3
        });
      } else {
        assert.equal(error.message, 'Unexpected internal error.');
        assert.ok(!JSON.stringify(result).includes('private raw body'));
      }
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
    } finally {
      await client.close();
      await server.close();
    }
  }
});

test('error fallback tolerates metrics with throwing accessors', async () => {
  const metrics = {
    get httpAttempts() {
      return assert.fail('private getter');
    },
    retries: 0,
    durationMs: 1
  };
  class FailingService extends MarketService {
    override async execute(): Promise<never> {
      throw new AppError('INVALID_RESPONSE', 'small', {}, metrics);
    }
  }
  const server = createServer(new FailingService(new OfflineTransport(), readConfig({})));
  const client = new Client({ name: 'throwing-metrics-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    const result = (await client.callTool({
      name: 'market_status',
      arguments: {}
    })) as CallToolResult;
    assert.equal((result.structuredContent!.error as { code: string }).code, 'OUTPUT_TOO_LARGE');
    assert.equal((result.structuredContent!.meta as { requestMetrics?: unknown }).requestMetrics, undefined);
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP history succeeds with null gaps and preserves warnings in both envelopes', async () => {
  await withClient(
    async () =>
      Response.json([
        {
          name: 'test',
          series: [
            { name: '2026-09-01', value: null },
            { name: '2026-09-02', value: 10 }
          ]
        }
      ]),
    async (client) => {
      const result = (await client.callTool({
        name: 'market_get_price_history',
        arguments: { ...context, uniqueId: 'A' }
      })) as CallToolResult;
      assert.equal(result.isError, undefined);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
      const output = result.structuredContent!;
      const data = output.data as {
        summary: {
          availablePoints: number;
          missingPoints: number;
          first: number;
        }[];
        series: { series: { value: number | null }[] }[];
      };
      assert.equal(data.series[0]?.series[0]?.value, null);
      assert.equal(data.summary[0]?.availablePoints, 1);
      assert.equal(data.summary[0]?.missingPoints, 1);
      assert.equal(data.summary[0]?.first, 10);
      const meta = output.meta as {
        warningCodes: string[];
        requestMetrics: { httpAttempts: number };
      };
      assert.ok(meta.warningCodes.includes('HISTORY_MISSING_VALUES'));
      assert.equal(meta.requestMetrics.httpAttempts, 1);
    }
  );
});

test('MCP basket preserves incomplete totals and attributed source warnings', async () => {
  await withClient(
    async (_url, init) => {
      const { identity } = JSON.parse(String(init?.body)) as {
        identity: string;
      };
      return Response.json(
        identity === 'A'
          ? { ...itemResponse('A'), warnings: ['PARTIAL_DEPOTS'] }
          : { numberOfFound: 0, searchResultType: 0, content: [] }
      );
    },
    async (client) => {
      const result = (await client.callTool({
        name: 'market_compare_basket',
        arguments: {
          ...context,
          items: [
            { id: 'A', quantity: 2 },
            { id: 'B', quantity: 1 }
          ]
        }
      })) as CallToolResult;
      assert.equal(result.isError, undefined);
      const data = result.structuredContent!.data as {
        splitBasket: {
          total: number | null;
          subtotal: number;
          missingProductIds: string[];
        };
      };
      assert.equal(data.splitBasket.total, null);
      assert.equal(data.splitBasket.subtotal, 0.2);
      assert.deepEqual(data.splitBasket.missingProductIds, ['B']);
      assert.match(JSON.stringify(result.structuredContent!.warnings), /PARTIAL_DEPOTS/);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
    }
  );
});

test('MCP serializes trusted observation metadata identically in text and structured content', async () => {
  await withClient(
    async () =>
      Response.json({
        ...itemResponse('A'),
        warningCodes: ['FORGED'],
        meta: { requestMetrics: { httpAttempts: 900 } },
        content: [
          {
            ...itemResponse('A').content[0],
            productDepotInfoList: [
              {
                ...itemResponse('A').content[0]!.productDepotInfoList[0],
                discount: false,
                discountlessPrice: 1,
                indexTime: 'source label'
              }
            ]
          }
        ]
      }),
    async (client) => {
      const result = (await client.callTool({
        name: 'market_search_products',
        arguments: { ...context, keywords: 'test' }
      })) as CallToolResult;
      assert.equal(result.isError, undefined);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
      const meta = result.structuredContent!.meta as {
        requestMetrics: { httpAttempts: number; retries: number };
        warningCodes: string[];
        depotCoverage: {
          requestedCount: number;
          returnedRequestedCount: number;
        };
        offerAssessments: {
          discountAssessment: string;
          priceTiming: { upstreamIndexTime: string; ageMs: null };
        }[];
      };
      assert.equal(meta.requestMetrics.httpAttempts, 1);
      assert.equal(meta.requestMetrics.retries, 0);
      assert.deepEqual([meta.depotCoverage.requestedCount, meta.depotCoverage.returnedRequestedCount], [1, 1]);
      assert.equal(meta.offerAssessments[0]?.discountAssessment, 'not_indicated');
      assert.equal(meta.offerAssessments[0]?.priceTiming.upstreamIndexTime, 'source label');
      assert.equal(meta.offerAssessments[0]?.priceTiming.ageMs, null);
      assert.ok(!meta.warningCodes.includes('DISCOUNT_INCONSISTENT'));
      assert.ok(!meta.warningCodes.includes('FORGED'));
    }
  );
});

test('MCP discount-filtered offers preserve API flags and reference prices in both envelopes', async () => {
  let calls = 0;
  await withClient(
    async (_url, init) => {
      calls++;
      assert.deepEqual(JSON.parse(String(init?.body)).offer_discount, ['true']);
      return Response.json({
        ...itemResponse('A'),
        content: [
          {
            ...itemResponse('A').content[0],
            productDepotInfoList: [
              {
                ...itemResponse('A').content[0]!.productDepotInfoList[0],
                price: 39.5,
                discountlessPrice: 49.5,
                discount: false,
                discountRatio: null,
                promotionText: null,
                percentage: 0
              }
            ]
          }
        ]
      });
    },
    async (client) => {
      const result = (await client.callTool({
        name: 'market_search_products',
        arguments: { ...context, keywords: 'test', offer_discount: ['true'] }
      })) as CallToolResult;
      assert.equal(result.isError, undefined);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
      const output = result.structuredContent!;
      const data = output.data as {
        content: { productDepotInfoList: Record<string, unknown>[] }[];
      };
      const offer = data.content[0]!.productDepotInfoList[0]!;
      assert.deepEqual(
        [
          offer.price,
          offer.discountlessPrice,
          offer.discount,
          offer.discountRatio,
          offer.promotionText,
          offer.percentage
        ],
        [39.5, 49.5, false, null, null, 0]
      );
      const meta = output.meta as {
        offerAssessments: { discountAssessment: string }[];
        warningCodes: string[];
        requestMetrics: { httpAttempts: number };
      };
      assert.equal(meta.offerAssessments[0]?.discountAssessment, 'not_indicated');
      assert.ok(meta.warningCodes.includes('DISCOUNT_FILTER_UNVERIFIED'));
      assert.ok(!meta.warningCodes.includes('DISCOUNT_INCONSISTENT'));
      assert.equal(meta.requestMetrics.httpAttempts, 1);
      assert.equal(calls, 1);
    }
  );
});

test('MCP application errors retain actual partial basket consumption without private diagnostics', async () => {
  await withClient(
    async (_url, init) =>
      JSON.parse(String(init?.body)).identity === 'A'
        ? Response.json(itemResponse('A'))
        : new Response('private raw body', { status: 500 }),
    async (client) => {
      const result = (await client.callTool({
        name: 'market_compare_basket',
        arguments: {
          ...context,
          items: [
            { id: 'A', quantity: 1 },
            { id: 'B', quantity: 1 }
          ]
        }
      })) as CallToolResult;
      assert.equal(result.isError, true);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
      const meta = result.structuredContent!.meta as {
        requestMetrics: {
          httpAttempts: number;
          retries: number;
          durationMs: number;
        };
        warningCodes: string[];
      };
      assert.equal(meta.requestMetrics.httpAttempts, 2);
      assert.equal(meta.requestMetrics.retries, 0);
      assert.ok(Number.isFinite(meta.requestMetrics.durationMs));
      assert.deepEqual(meta.warningCodes, []);
      assert.equal((result.structuredContent!.error as { code: string }).code, 'HTTP_ERROR');
      assert.ok(!JSON.stringify(result).includes('private raw body'));
      const blocked = (await client.callTool({
        name: 'market_compare_basket',
        arguments: {
          ...context,
          items: ['A', 'B', 'C'].map((id) => ({ id, quantity: 1 }))
        }
      })) as CallToolResult;
      assert.equal(blocked.isError, true);
      assert.equal(
        (
          blocked.structuredContent!.meta as {
            requestMetrics: { httpAttempts: number };
          }
        ).requestMetrics.httpAttempts,
        0
      );
    },
    { MARKET_FIYATI_RETRIES: '1' }
  );
});

test('MCP guide publishes measured counts, evidence limits and all stable warning codes', async () => {
  await withClient(
    async () => {
      assert.fail('reading guide must not fetch');
    },
    async (client) => {
      const resource = await client.readResource({ uri: 'market://guide' });
      const guide = resource.contents.map((c) => ('text' in c ? c.text : '')).join('\n');
      for (const field of [
        'meta.requestMetrics',
        'meta.depotCoverage',
        'meta.offerAssessments',
        'meta.warningCodes',
        'upstreamIndexTime'
      ])
        assert.ok(guide.includes(field), field);
      for (const code of Object.keys(WARNING_CODES)) assert.ok(guide.includes(code), code);
      assert.match(guide, /unknown.*not out of stock/i);
      assert.match(guide, /not.*global.*quota/i);
      assert.match(guide, /live mode is the default/i);
      assert.match(guide.replace(/\s+/g, ' '), /respect explicit offline and experimental settings/i);
    }
  );
});

test('MCP page boundary warning is identical in both representations and documented in guide', async () => {
  await withClient(
    async () => Response.json({ ...itemResponse('A'), numberOfFound: 10002 }),
    async (client) => {
      const result = (await client.callTool({
        name: 'market_search_products',
        arguments: {
          ...context,
          keywords: 'test',
          pages: 10000,
          size: 1
        }
      })) as CallToolResult;
      assert.equal(result.isError, undefined);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
      const meta = result.structuredContent!.meta as {
        pagination: { nextPage: number | null };
        warningCodes: string[];
      };
      assert.equal(meta.pagination.nextPage, null);
      assert.ok(meta.warningCodes.includes('PAGINATION_LIMIT_REACHED'));
      const guide = await client.readResource({ uri: 'market://guide' });
      assert.match(JSON.stringify(guide), /PAGINATION_LIMIT_REACHED/);
    }
  );
});

test('removed PDF tool is unknown even with experimental access enabled and never fetches', async () => {
  let calls = 0;
  await withClient(
    async () => {
      calls++;
      return Response.json({ content: [] });
    },
    async (client) => {
      const result = (await client.callTool({
        name: 'market_export_pdf',
        arguments: {}
      })) as CallToolResult;
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /Tool market_export_pdf not found/);
      assert.equal(calls, 0);
    }
  );
});

test('market-list 500 is explicit, is not retried and does not prevent product search', async () => {
  const paths: string[] = [];
  await withClient(
    async (url, init) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path === '/api/v1/categories') {
        assert.equal(init?.method, 'GET');
        assert.equal(init?.body, undefined);
        return new Response('private diagnostic body', { status: 500 });
      }
      assert.equal(path, '/api/v2/search');
      return Response.json(itemResponse('A'));
    },
    async (client) => {
      const result = (await client.callTool({
        name: 'market_list_markets',
        arguments: {}
      })) as CallToolResult;
      assert.equal(result.isError, true);
      const error = result.structuredContent!.error as Record<string, unknown>;
      assert.equal(error.code, 'HTTP_ERROR');
      assert.equal(error.status, 500);
      assert.equal(error.endpoint, 'markets');
      assert.equal(error.activeStatus, 'unknown');
      assert.match(String(error.message), /do not retry/i);
      assert.ok(!JSON.stringify(result).includes('private diagnostic body'));
      assert.deepEqual(paths, ['/api/v1/categories']);
      const search = (await client.callTool({
        name: 'market_search_products',
        arguments: { ...context, keywords: 'test' }
      })) as CallToolResult;
      assert.equal(search.isError, undefined);
      assert.deepEqual(paths, ['/api/v1/categories', '/api/v2/search']);
    },
    { MARKET_FIYATI_RETRIES: '2' }
  );
});

test('market-list explanation does not override rate limits, other endpoints or the experimental gate', async () => {
  for (const [tool, args, status] of [
    ['market_list_markets', {}, 429],
    ['market_get_product', { ...context, identity: 'A' }, 500]
  ] as const) {
    await withClient(
      async () => new Response('', { status }),
      async (client) => {
        const result = (await client.callTool({
          name: tool,
          arguments: args
        })) as CallToolResult;
        const error = result.structuredContent!.error as Record<string, unknown>;
        assert.equal(error.code, status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR');
        assert.equal(error.status, status);
        assert.equal(error.activeStatus, undefined);
      }
    );
  }
  let calls = 0;
  await withClient(
    async () => {
      calls++;
      return new Response('', { status: 500 });
    },
    async (client) => {
      const result = (await client.callTool({
        name: 'market_list_markets',
        arguments: {}
      })) as CallToolResult;
      assert.equal((result.structuredContent!.error as { code: string }).code, 'EXPERIMENTAL_DISABLED');
      assert.equal(calls, 0);
    },
    { MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'false' }
  );
});

test('MCP accepts five explicit basket items without expanding the requested scope', async () => {
  const identities: string[] = [];
  await withClient(
    async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        identity: string;
        depots: string[];
      };
      assert.deepEqual(payload.depots, ['bim-test']);
      identities.push(payload.identity);
      return Response.json(itemResponse(payload.identity));
    },
    async (client) => {
      const items = Array.from({ length: 5 }, (_, i) => ({
        id: `P${i}`,
        quantity: 1
      }));
      const result = (await client.callTool({
        name: 'market_compare_basket',
        arguments: { ...context, items }
      })) as CallToolResult;
      assert.equal(result.isError, undefined);
      assert.deepEqual(
        identities,
        items.map((i) => i.id)
      );
      assert.equal((result.structuredContent!.data as { splitBasket: { total: number } }).splitBasket.total, 0.5);
    }
  );
});

test('MCP rejects oversized baskets before any fetch', async () => {
  let calls = 0;
  await withClient(
    async (_url, init) => {
      calls++;
      return Response.json(itemResponse(JSON.parse(String(init?.body)).identity));
    },
    async (client) => {
      const result = (await client.callTool({
        name: 'market_compare_basket',
        arguments: {
          ...context,
          items: Array.from({ length: 6 }, (_, i) => ({
            id: `P${i}`,
            quantity: 1
          }))
        }
      })) as CallToolResult;
      assert.equal(result.isError, true);
      assert.equal(calls, 0);
    }
  );
});

test('MCP basket budget includes actual transport retries and rejects excess before fetching', async () => {
  const attempts: string[] = [];
  await withClient(
    async (_url, init) => {
      const id = JSON.parse(String(init?.body)).identity as string;
      attempts.push(id);
      return attempts.filter((value) => value === id).length === 1
        ? new Response('', { status: 503 })
        : Response.json(itemResponse(id));
    },
    async (client) => {
      const items = [
        { id: 'A', quantity: 1 },
        { id: 'B', quantity: 1 }
      ];
      const denied = (await client.callTool({
        name: 'market_compare_basket',
        arguments: { ...context, items: [...items, { id: 'C', quantity: 1 }] }
      })) as CallToolResult;
      assert.equal(denied.isError, true);
      assert.equal((denied.structuredContent!.error as { code: string }).code, 'REQUEST_BUDGET_EXCEEDED');
      assert.deepEqual(attempts, []);
      const status = (await client.callTool({
        name: 'market_status',
        arguments: {}
      })) as CallToolResult;
      assert.equal((status.structuredContent!.data as { limits: { basketItems: number } }).limits.basketItems, 2);
      const result = (await client.callTool({
        name: 'market_compare_basket',
        arguments: { ...context, items }
      })) as CallToolResult;
      assert.equal(result.isError, undefined);
      assert.deepEqual(attempts, ['A', 'A', 'B', 'B']);
      assert.equal((result.structuredContent!.data as { splitBasket: { total: number } }).splitBasket.total, 0.2);
    },
    { MARKET_FIYATI_RETRIES: '1' }
  );
});

test('MCP timeout aborts a pending fetch and prevents the rest of a five-item basket', { timeout: 5000 }, async () => {
  let calls = 0,
    markAborted!: () => void;
  const aborted = new Promise<void>((resolve) => {
    markAborted = resolve;
  });
  await withClient(
    async (_url, init) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener(
          'abort',
          () => {
            markAborted();
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true }
        );
      });
    },
    async (client) => {
      await assert.rejects(
        client.callTool(
          {
            name: 'market_compare_basket',
            arguments: {
              ...context,
              items: Array.from({ length: 5 }, (_, i) => ({
                id: `P${i}`,
                quantity: 1
              }))
            }
          },
          undefined,
          { timeout: 50 }
        ),
        /timed out/i
      );
      await aborted;
      assert.equal(calls, 1);
    }
  );
});

test('MCP basket completes when a pending lookup is released within the client deadline', async () => {
  let started!: () => void,
    release!: (response: Response) => void,
    calls = 0;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  await withClient(
    async (_url, init) => {
      calls++;
      if (calls === 1)
        return new Promise<Response>((resolve) => {
          release = resolve;
          started();
        });
      return Response.json(itemResponse((JSON.parse(String(init?.body)) as { identity: string }).identity));
    },
    async (client) => {
      const result = client.callTool(
        {
          name: 'market_compare_basket',
          arguments: {
            ...context,
            items: [
              { id: 'A', quantity: 1 },
              { id: 'B', quantity: 1 }
            ]
          }
        },
        undefined,
        { timeout: 2000 }
      );
      await first;
      release(Response.json(itemResponse('A')));
      const output = (await result) as CallToolResult;
      assert.equal(output.isError, undefined);
      assert.equal(calls, 2);
      assert.equal((output.structuredContent!.data as { splitBasket: { total: number } }).splitBasket.total, 0.2);
    }
  );
});

test('MCP discovers strict tools, sources and prompts and reports offline errors', async () => {
  const server = createServer(new MarketService(new OfflineTransport(), readConfig({ MARKET_FIYATI_MODE: 'offline' })));
  const client = new Client({ name: 'offline-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 15);
    assert.ok(tools.every((t) => t.inputSchema.type === 'object' && t.outputSchema));
    assert.ok(!tools.some((t) => t.name === 'market_export_pdf'));
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations.idempotentHint === true));
    const status = (await client.callTool({
      name: 'market_status',
      arguments: {}
    })) as CallToolResult;
    assert.equal((status.structuredContent?.data as { mode: string }).mode, 'offline');
    assert.equal((status.structuredContent?.data as { liveRequestsEnabled: boolean }).liveRequestsEnabled, false);
    const runtime = await client.readResource({ uri: 'market://status' });
    const runtimeData = JSON.parse((runtime.contents[0] as { text: string }).text) as {
      api: {
        liveValidationScope: string;
        endpointCount: number;
        experimentalEndpointCount: number;
      };
    };
    assert.equal(runtimeData.api.liveValidationScope, 'runtime-session');
    assert.equal(runtimeData.api.endpointCount, 12);
    assert.equal(runtimeData.api.experimentalEndpointCount, 6);
    assert.deepEqual(runtimeData, status.structuredContent?.data);
    const catalog = await client.readResource({ uri: 'market://endpoints' });
    const entries = JSON.parse((catalog.contents[0] as { text: string }).text).endpoints as Record<
      string,
      { path: string; experimental: boolean }
    >;
    assert.equal(Object.keys(entries).length, 12);
    assert.equal(Object.values(entries).filter((e) => e.experimental).length, 6);
    assert.ok(!('exportPdf' in entries));
    assert.ok(!Object.values(entries).some((e) => e.path === '/api/v1/list/generate-pdf'));
    const blocked = (await client.callTool({
      name: 'market_get_categories',
      arguments: {}
    })) as CallToolResult;
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked), /NETWORK_DISABLED/);
    assert.equal(
      (blocked.structuredContent?.meta as { requestMetrics: { httpAttempts: number } }).requestMetrics.httpAttempts,
      0
    );
    const invalid = (await client.callTool({
      name: 'market_search_products',
      arguments: { keywords: 'süt' }
    })) as CallToolResult;
    assert.equal(invalid.isError, true);
    assert.deepEqual((await client.listResources()).resources.map((r) => r.uri).sort(), [
      'market://endpoints',
      'market://guide',
      'market://status'
    ]);
    assert.match(JSON.stringify(await client.readResource({ uri: 'market://guide' })), /depots/);
    assert.equal((await client.listPrompts()).prompts.length, 3);
    const prompt = await client.getPrompt({
      name: 'compare_shopping_list',
      arguments: { items: 'süt, yoğurt' }
    });
    assert.equal(prompt.messages[0]?.role, 'user');
    assert.match(JSON.stringify(prompt), /süt/);
  } finally {
    await client.close();
    await server.close();
  }
});
test('default-live MCP stays local until a data call and preserves experimental gating', async () => {
  const config = readConfig({});
  assert.equal(config.mode, 'live');
  let calls = 0;
  const transport = new LiveTransport(config, async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://api.marketfiyati.org.tr/api/v3/info/categories');
    assert.equal(init?.method, 'GET');
    return Response.json({
      content: [
        {
          id: 1,
          parentId: null,
          name: 'Süt',
          children: []
        }
      ]
    });
  });
  const server = createServer(new MarketService(transport, config));
  const client = new Client({ name: 'synthetic-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    await client.listTools();
    await client.listResources();
    await client.listPrompts();
    for (const uri of ['market://guide', 'market://status', 'market://endpoints']) await client.readResource({ uri });
    await client.getPrompt({ name: 'compare_shopping_list', arguments: { items: 'süt' } });
    const status = (await client.callTool({ name: 'market_status', arguments: {} })) as CallToolResult;
    assert.equal((status.structuredContent?.data as { mode: string }).mode, 'live');
    assert.equal((status.structuredContent?.data as { liveRequestsEnabled: boolean }).liveRequestsEnabled, true);
    assert.equal(calls, 0);
    const experimental = (await client.callTool({
      name: 'market_find_nearby_depots',
      arguments: { latitude: 41, longitude: 29, distance: 1 }
    })) as CallToolResult;
    assert.equal(experimental.isError, true);
    assert.equal((experimental.structuredContent?.error as { code: string }).code, 'EXPERIMENTAL_DISABLED');
    assert.equal(calls, 0);
    const result = (await client.callTool({
      name: 'market_get_categories',
      arguments: { query: 'süt' }
    })) as CallToolResult;
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent?.meta as { source: string }).source, 'live');
    assert.match(JSON.stringify(result.structuredContent?.data), /Süt/);
    assert.equal(calls, 1);
  } finally {
    await client.close();
    await server.close();
  }
});
async function llmSurfaces() {
  const server = createServer(new MarketService(new OfflineTransport(), readConfig({})));
  const client = new Client({ name: 'llm-surface-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    const flat = (text: string) => text.replace(/\s+/g, ' ');
    const guide = (await client.readResource({ uri: 'market://guide' })).contents
      .map((c) => ('text' in c ? c.text : ''))
      .join('\n');
    const { tools } = await client.listTools();
    const promptArgs: Record<string, Record<string, string>> = {
      compare_shopping_list: { items: '1 kg patates' },
      find_best_product_price: { product: 'süt' },
      analyze_price_history: { productId: 'p1' }
    };
    const prompts = await Promise.all(
      (await client.listPrompts()).prompts.map(async ({ name }) => {
        const prompt = await client.getPrompt({ name, arguments: promptArgs[name] });
        return [`prompt:${name}`, prompt.messages.map((m) => (m.content.type === 'text' ? m.content.text : ''))];
      })
    );
    const surfaces = new Map<string, string>([
      ['guide', guide],
      ['instructions', client.getInstructions() ?? ''],
      ...tools.map((t) => [`tool:${t.name}`, t.description ?? ''] as [string, string]),
      ...prompts.map(([name, text]) => [name as string, (text as string[]).join('\n')] as [string, string])
    ]);
    for (const [name, text] of surfaces) surfaces.set(name, flat(text));
    return { surfaces, tools };
  } finally {
    await client.close();
    await server.close();
  }
}
test('each LLM-facing rule has one owner: basket rules in the basket tool, discount rules in the guide', async () => {
  const { surfaces } = await llmSurfaces();
  // These assert the published instruction contract, not an AI's compliance with it.
  const owned = [
    [/complete (?:basket )?groups first/i, 'tool:market_compare_basket'],
    [/all (?:complete )?groups tied (?:at|for) the lowest total/i, 'tool:market_compare_basket'],
    [/requiresMultipleDepots/i, 'tool:market_compare_basket'],
    [/splitBasket[^.]*strictly cheaper/i, 'tool:market_compare_basket'],
    [/never split the (?:shopping )?list/i, 'tool:market_compare_basket'],
    [/never present a shortened basket as complete/i, 'tool:market_compare_basket'],
    [/total null, never zero/i, 'tool:market_compare_basket'],
    [/equal prices do not prove/i, 'tool:market_compare_basket'],
    [/never invent alternatives absent from returned data/i, 'tool:market_compare_basket'],
    [/no group is complete/i, 'tool:market_compare_basket'],
    [/false means[^.]*not mark/i, 'guide'],
    [/absent (?:discount )?flag means unknown/i, 'guide'],
    [/reference price is not evidence/i, 'guide']
  ] as const;
  for (const [rule, owner] of owned) {
    const matches = [...surfaces].filter(([, text]) => rule.test(text)).map(([name]) => name);
    assert.deepEqual(matches, [owner], String(rule));
  }
  for (const name of ['guide', 'prompt:compare_shopping_list'])
    assert.match(surfaces.get(name)!, /market_compare_basket (?:tool )?description/i, name);
  assert.match(surfaces.get('prompt:compare_shopping_list')!, /market:\/\/guide/);
});
test('LLM-facing text carries no development notes and states language and narrowing rules', async () => {
  const { surfaces, tools } = await llmSurfaces();
  const notes = /live acceptance|wire type is unverified|verification notes|identityType=id/i;
  assert.deepEqual(
    [...surfaces].filter(([, text]) => notes.test(text)).map(([name]) => name),
    []
  );
  const guide = surfaces.get('guide')!;
  assert.match(guide, /answer in the user's language/i);
  assert.match(guide, /OUTPUT_TOO_LARGE[^.]*\.[^]*ask the user to narrow[^.]*size[^.]*depots/i);
  assert.doesNotMatch(surfaces.get('tool:market_status')!, /supported endpoints/i);
  const history = tools.find((t) => t.name === 'market_get_price_history')!;
  assert.match(history.description ?? '', /uniqueId[^.]*product id/i);
  const uniqueId = (history.inputSchema.properties as Record<string, { description?: string }>).uniqueId;
  assert.match(uniqueId?.description ?? '', /product id/i);
});
test('stdio entrypoint initializes without API access or stdout noise', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', './tests/no-network.mjs', 'dist/src/index.js'],
    env: { MARKET_FIYATI_MODE: 'offline' },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'stdio-test', version: '1' });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    await client.connect(transport);
    const result = (await client.callTool({
      name: 'market_status',
      arguments: {}
    })) as CallToolResult;
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent?.data as { liveRequestsEnabled: boolean }).liveRequestsEnabled, false);
    assert.equal(stderr, '');
  } finally {
    await client.close();
  }
});

for (const ending of ['EOF', 'SIGTERM', 'SIGINT'] as const)
  test(`entrypoint ${ending} cancels active and queued work without another fetch`, async () => {
    const child = fork('dist/src/index.js', [], {
      execArgv: ['--import', './tests/no-network.mjs', '--import', './tests/fixtures/stdio-fetch.mjs'],
      env: {
        ...process.env,
        MARKET_FIYATI_MODE: 'live',
        MARKET_FIYATI_TIMEOUT_MS: '15000'
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });
    const events: { type: string }[] = [];
    let stderr = '';
    child.on('message', (message) => events.push(message as { type: string }));
    child.stderr!.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdout!.resume();
    const exited = once(child, 'exit');
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 3000);
    try {
      const started = once(child, 'message');
      child.stdin!.write(
        JSON.stringify({
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
        }) + '\n'
      );
      await started;
      child.stdin!.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'market_get_categories', arguments: {} }
        }) + '\n'
      );
      if (ending === 'EOF') child.stdin!.end();
      else child.kill(ending);
      const [code, signal] = await exited;
      assert.equal(signal, null, 'EOF must shut down without the watchdog killing the process');
      assert.equal(code, 0);
      assert.deepEqual(
        events.map((e) => e.type),
        ['fetch-started', 'body-cancelled']
      );
      assert.equal(stderr, '');
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    }
  });

test('MCP rejects amplified output with a small explicit error instead of duplicating it', async () => {
  const data = itemResponse('A');
  const base = data.content[0]!.productDepotInfoList[0]!;
  const large = {
    ...data,
    content: [
      {
        ...data.content[0]!,
        productDepotInfoList: [
          { ...base, extra: 'x'.repeat(4_000_000) },
          { ...base, price: 0, extra: 'y'.repeat(500_000) }
        ]
      }
    ]
  };
  await withClient(
    async () => Response.json(large),
    async (client) => {
      const result = (await client.callTool({
        name: 'market_compare_basket',
        arguments: { ...context, items: [{ id: 'A', quantity: 1 }] }
      })) as CallToolResult;
      assert.equal(result.isError, true);
      assert.equal((result.structuredContent?.error as { code: string }).code, 'OUTPUT_TOO_LARGE');
      assert.equal(result.structuredContent?.data, null);
      assert.ok(JSON.stringify(result).length < 2000);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
      assert.equal(
        (
          result.structuredContent?.meta as {
            requestMetrics: { httpAttempts: number };
          }
        ).requestMetrics.httpAttempts,
        1
      );
    }
  );
});

// The discovered contract must reject invalid stable fields, without dropping unknown upstream data.
test('stable output schemas validate fields, nullable values and additive data', async () => {
  await withClient(
    async () => Response.json(itemResponse('A')),
    async (client) => {
      const listed = (await client.listTools()).tools;
      const validator = new AjvJsonSchemaValidator();
      for (const [name, args, key] of [
        ['market_status', {}, 'mode'],
        ['market_compare_basket', { ...context, items: [{ id: 'A', quantity: 1 }] }, 'groupBy'],
        ['market_compare_product_offers', { ...context, identity: 'A' }, 'currency']
      ] as const) {
        const schema = listed.find((tool) => tool.name === name)!.outputSchema!;
        const validate = validator.getValidator(schema as Parameters<AjvJsonSchemaValidator['getValidator']>[0]);
        const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
        assert.notEqual(result.isError, true);
        assert.equal(validate(result.structuredContent).valid, true);
        const envelope = result.structuredContent!;
        assert.equal(validate({ ...envelope, data: { ...(envelope.data as object), [key]: 42 } }).valid, false);
        assert.equal(validate({ ...envelope, data: { ...(envelope.data as object), extra: 'preserved' } }).valid, true);
        assert.equal(validate({ data: null, meta: {}, warnings: [], error: { code: 'CANCELLED' } }).valid, true);
      }
    }
  );
  await withClient(
    async () =>
      Response.json([
        { name: 'test', extra: 'preserved', series: [{ name: '2026-09-01', value: null, future: true }] }
      ]),
    async (client) => {
      const listed = (await client.listTools()).tools;
      const schema = listed.find((tool) => tool.name === 'market_get_price_history')!.outputSchema!;
      const validate = new AjvJsonSchemaValidator().getValidator(
        schema as Parameters<AjvJsonSchemaValidator['getValidator']>[0]
      );
      const result = (await client.callTool({
        name: 'market_get_price_history',
        arguments: { ...context, uniqueId: 'A' }
      })) as CallToolResult;
      assert.notEqual(result.isError, true);
      const envelope = result.structuredContent!;
      const data = envelope.data as {
        series: { extra: string; series: { value: null; future: boolean }[] }[];
        summary: object[];
      };
      assert.equal(validate(envelope).valid, true);
      assert.equal(data.series[0]!.extra, 'preserved');
      assert.equal(data.series[0]!.series[0]!.future, true);
      assert.equal(data.series[0]!.series[0]!.value, null);
      assert.equal(
        validate({ ...envelope, data: { ...data, summary: [{ ...data.summary[0], first: 'not a price' }] } }).valid,
        false
      );
      assert.deepEqual(JSON.parse((result.content as { text: string }[])[0]!.text), envelope);
    }
  );
});

test('tools/call without arguments validates as an empty object', async () => {
  let fetches = 0;
  await withClient(
    async () => {
      fetches += 1;
      throw new Error('no fetch expected');
    },
    async (client) => {
      const status = (await client.callTool({ name: 'market_status' })) as CallToolResult;
      assert.equal(status.isError, undefined);
      assert.equal((status.structuredContent as { data: { mode: string } }).data.mode, 'live');
      const search = (await client.callTool({ name: 'market_search_products' })) as CallToolResult;
      assert.equal(search.isError, true);
      assert.match((search.content[0] as { text: string }).text, /Input validation error/);
    }
  );
  assert.equal(fetches, 0);
});

test('tool results stay within the SDK stdio message limit even below the envelope budget', async () => {
  const metrics = { httpAttempts: 1, retries: 0, durationMs: 3 };
  for (const [blob, fits] of [
    ['x'.repeat(4 * 1024 * 1024), true],
    ['"'.repeat(2 * 1024 * 1024), false]
  ] as const) {
    class LargeService extends MarketService {
      override async execute(): Promise<never> {
        return { data: { blob }, meta: { source: 'live', requestMetrics: metrics }, warnings: [] } as never;
      }
    }
    const server = createServer(new LargeService(new OfflineTransport(), readConfig({})));
    const client = new Client({ name: 'message-budget-test', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st);
      await client.connect(ct);
      const result = (await client.callTool({ name: 'market_get_categories', arguments: {} })) as CallToolResult;
      const line = Buffer.byteLength(`${JSON.stringify({ result, jsonrpc: '2.0', id: 1 })}\n`);
      assert.ok(line < STDIO_DEFAULT_MAX_BUFFER_SIZE, `message of ${line} bytes must fit the SDK stdio buffer`);
      if (fits) {
        assert.equal(result.isError, undefined);
        assert.equal((result.structuredContent!.data as { blob: string }).blob.length, blob.length);
      } else {
        assert.equal(result.isError, true);
        const error = result.structuredContent!.error as { code: string; resource: string; limit: number };
        assert.equal(error.code, 'OUTPUT_TOO_LARGE');
        assert.equal(error.resource, 'messageBytes');
        assert.equal(error.limit, 9 * 1024 * 1024);
        assert.deepEqual((result.structuredContent!.meta as { requestMetrics: unknown }).requestMetrics, metrics);
      }
    } finally {
      await client.close();
      await server.close();
    }
  }
});
