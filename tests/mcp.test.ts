import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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

test('small application errors retain safe details and unknown errors hide source text', async () => {
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
      } else assert.ok(!JSON.stringify(result).includes('private raw body'));
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
  const server = createServer(new MarketService(new OfflineTransport(), readConfig({})));
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
test('SDK tool call validates a synthetic HTTP response through the live adapter without networking', async () => {
  const config = readConfig({ MARKET_FIYATI_MODE: 'live' });
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
test('basket guidance reaches clients through the guide, tool description and shopping prompt', async () => {
  const server = createServer(new MarketService(new OfflineTransport(), readConfig({})));
  const client = new Client({ name: 'basket-guidance-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    const guide = await client.readResource({ uri: 'market://guide' });
    const prompt = await client.getPrompt({
      name: 'compare_shopping_list',
      arguments: { items: '1 kg patates, 3 kg yarım yağlı yoğurt' }
    });
    const description =
      (await client.listTools()).tools.find((t) => t.name === 'market_compare_basket')?.description ?? '';
    const surfaces = [
      ['guide', guide.contents.map((c) => ('text' in c ? c.text : '')).join('\n')],
      ['tool', description],
      ['prompt', prompt.messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n')]
    ] as const;
    // These assert the published instruction contract, not an AI's compliance with it.
    for (const [name, content] of surfaces) {
      const text = content.replace(/\s+/g, ' ');
      assert.match(text, /complete (?:basket )?groups first/i, name);
      assert.match(text, /all (?:complete )?groups tied (?:at|for) the lowest total/i, name);
      assert.match(text, /selected (?:offer )?depot IDs/i, name);
      assert.match(text, /splitBasket.*strictly cheaper/i, name);
    }
  } finally {
    await client.close();
    await server.close();
  }
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
