// Pins tool envelopes, wire payloads and tool schemas so internal refactors cannot change them.
// Regenerate deliberately with UPDATE_CHARACTERIZATION=1 (then prettier) after an intended contract change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MarketService } from '../src/service.js';
import { createServer } from '../src/server.js';
import { readConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { endpoints, type EndpointId, type Operation } from '../src/contracts.js';
import type { Payload, Transport } from '../src/transport.js';

const snapshotFile = new URL('../../tests/fixtures/characterization.json', import.meta.url);
const context = { latitude: 41, longitude: 29, distance: 2, depots: ['a-1', 'a-2', 'b-1'] };
const offer = (depotId: string, marketAdi: string, price: number, extra: Record<string, unknown> = {}) => ({
  depotId,
  depotName: `Depot ${depotId}`,
  marketAdi,
  price,
  latitude: 41.01,
  longitude: 29.02,
  indexTime: '2026-01-01T00:00:00Z',
  ...extra
});
const products: Record<string, unknown> = {
  milk: {
    id: 'milk',
    title: 'Milk 1 L',
    refinedVolumeOrWeight: '1 L',
    productDepotInfoList: [
      offer('a-1', 'a', 30, { discount: true, percentage: 10, discountlessPrice: 33 }),
      offer('a-2', 'a', 28),
      offer('b-1', 'b', 0),
      offer('z-9', 'z', 1)
    ],
    warnings: 'upstream product note'
  },
  bread: {
    id: 'bread',
    title: 'Bread',
    productDepotInfoList: [offer('a-1', 'a', 10), offer('b-1', 'b', 9.5, { discount: false })]
  }
};
const page = (ids: string[], numberOfFound = ids.length, searchResultType = 0) => ({
  numberOfFound,
  searchResultType,
  facetMap: { brand: [{ name: 'X', count: 1 }] },
  content: ids.map((id) => products[id]),
  warnings: ['upstream lookup note']
});

function upstream(endpoint: EndpointId, payload: Payload): unknown {
  switch (endpoint) {
    case 'search':
      return page(['milk', 'bread'], 60, 2);
    case 'searchByCategories':
    case 'similar':
    case 'alternative':
      return page(['bread']);
    case 'product':
      return page(products[String(payload.identity)] ? [String(payload.identity)] : []);
    case 'sync':
      return page((payload.identities as string[]).filter((id) => products[id]));
    case 'categories':
      return {
        content: [
          { id: 1, parentId: null, name: 'Süt', children: [{ id: 2, parentId: 1, name: 'Yoğurt', children: [] }] }
        ]
      };
    case 'priceHistory':
      return [
        {
          name: 'a',
          series: [
            { name: '2026-01-01', value: 10 },
            { name: '2026-01-02', value: null },
            { name: '2026-01-03', value: 12 }
          ]
        }
      ];
    case 'nearest':
      return [{ id: 'a-1', marketName: 'a', distance: 120, location: { lat: 41.01, lon: 29.02 } }];
    case 'markets':
      return { content: [{ marketAdi: 'a', isActive: true }] };
    case 'geocode':
      return [['Kadıköy, İstanbul', 0, 0, 0, 0, 0, 0, '29.02', '41.01']];
    case 'reverseGeocode':
      return { Mahalle_Adi: 'Caferağa', Yol_Adi: 'Moda Cd.', KapiNo: '1', Ilce_Adi: 'Kadıköy', Il_Adi: 'İstanbul' };
  }
}

class RecordingTransport implements Transport {
  readonly mode = 'live' as const;
  readonly calls: { endpoint: EndpointId; payload: Payload | undefined }[] = [];
  async request(endpoint: EndpointId, payload?: Payload) {
    this.calls.push({ endpoint, payload });
    return {
      data: upstream(endpoint, payload ?? {}),
      meta: {
        source: 'live' as const,
        endpoint,
        experimental: endpoints[endpoint].experimental,
        retrievedAt: '2026-01-01T00:00:00Z'
      }
    };
  }
}

const cases: [string, Operation, unknown][] = [
  ['status', 'status', {}],
  ['categories', 'categories', { query: 'yoğurt' }],
  ['markets', 'markets', {}],
  ['nearest', 'nearest', { latitude: 41, longitude: 29, distance: 2 }],
  ['search', 'search', { ...context, keywords: 'süt', pages: 1, size: 2, offer_discount: ['true'] }],
  ['searchByCategories', 'searchByCategories', { ...context, main_category: ['Süt'] }],
  ['product', 'product', { ...context, identity: 'milk' }],
  ['similar', 'similar', { ...context, id: 'milk', keywords: 'Milk 1 L' }],
  ['alternative', 'alternative', { ...context, depots: ['a-1'], id: 'milk', keywords: 'Milk', marketName: 'a' }],
  ['priceHistory', 'priceHistory', { ...context, uniqueId: 'milk', from: '2026-01-01' }],
  ['sync', 'sync', { ...context, identities: ['milk', 'gone'] }],
  ['geocode', 'geocode', { words: 'Kadıköy' }],
  ['reverseGeocode', 'reverseGeocode', { latitude: 41.01, longitude: 29.02 }],
  ['compareProduct', 'compareProduct', { ...context, identity: 'milk' }],
  [
    'compareBasket market',
    'compareBasket',
    {
      ...context,
      items: [
        { id: 'milk', quantity: 2 },
        { id: 'bread', quantity: 1 },
        { id: 'gone', quantity: 1 }
      ]
    }
  ],
  [
    'compareBasket depot',
    'compareBasket',
    {
      ...context,
      items: [
        { id: 'milk', quantity: 1 },
        { id: 'bread', quantity: 3 }
      ],
      groupBy: 'depot'
    }
  ],
  ['compareProduct missing', 'compareProduct', { ...context, identity: 'gone' }],
  ['invalid arguments', 'search', { ...context, keywords: '', size: 500 }],
  ['basket over budget', 'compareBasket', { ...context, items: ['p1', 'p2', 'p3'].map((id) => ({ id, quantity: 1 })) }]
];

async function record() {
  const envelopes: Record<string, unknown> = {};
  const env = { MARKET_FIYATI_MODE: 'offline', MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'true' };
  for (const [name, operation, args] of cases) {
    const transport = new RecordingTransport();
    const retries = name === 'basket over budget' ? '1' : '0';
    const service = new MarketService(transport, readConfig({ ...env, MARKET_FIYATI_RETRIES: retries }));
    let outcome: unknown;
    try {
      const envelope = await service.execute(operation, args);
      (envelope.meta.requestMetrics as { durationMs: number }).durationMs = 0;
      outcome = envelope;
    } catch (error) {
      assert.ok(error instanceof AppError, `${name}: ${String(error)}`);
      outcome = { error: { code: error.code, message: error.message, details: error.details } };
    }
    envelopes[name] = { calls: transport.calls, outcome: JSON.parse(JSON.stringify(outcome)) };
  }
  const located = { ...env, MARKET_FIYATI_LATITUDE: '41', MARKET_FIYATI_LONGITUDE: '29', MARKET_FIYATI_DISTANCE: '3' };
  const tools: Record<string, unknown> = {};
  for (const config of [env, located]) {
    const server = createServer(new MarketService(new RecordingTransport(), readConfig(config)));
    const client = new Client({ name: 'characterization', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st);
      await client.connect(ct);
      tools[config === env ? 'default' : 'envLocation'] = (await client.listTools()).tools;
    } finally {
      await client.close();
      await server.close();
    }
  }
  const catalog = new MarketService(new RecordingTransport(), readConfig(env)).catalog();
  return JSON.parse(JSON.stringify({ envelopes, tools, catalog })) as unknown;
}

test('tool envelopes, wire payloads and tool schemas match the characterization snapshot', async () => {
  const actual = await record();
  if (process.env.UPDATE_CHARACTERIZATION === '1') writeFileSync(snapshotFile, `${JSON.stringify(actual, null, 2)}\n`);
  const expected = JSON.parse(readFileSync(snapshotFile, 'utf8')) as unknown;
  assert.deepEqual(actual, expected);
  // Key order is part of the serialized tool result text.
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
});
