import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { MarketService } from '../src/service.js';
import { LiveTransport, OfflineTransport } from '../src/transport.js';

const configured = {
  MARKET_FIYATI_LATITUDE: '0',
  MARKET_FIYATI_LONGITUDE: '0',
  MARKET_FIYATI_DISTANCE: '2'
};
const product = {
  numberOfFound: 1,
  searchResultType: 0,
  content: [
    {
      id: 'A',
      title: 'Test',
      productDepotInfoList: [{ depotId: 'bim-test', depotName: 'Test', marketAdi: 'bim', price: 10 }]
    }
  ]
};
async function withLocationClient(
  env: Record<string, string>,
  run: (client: Client, calls: { url: URL; body: Record<string, unknown> }[]) => Promise<void>
) {
  const config = readConfig({
    MARKET_FIYATI_MODE: 'live',
    MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'true',
    MARKET_FIYATI_MIN_INTERVAL_MS: '0',
    ...env
  });
  const calls: { url: URL; body: Record<string, unknown> }[] = [];
  const transport = new LiveTransport(config, async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const data =
      url.pathname.endsWith('/nearest') || url.pathname.endsWith('/price-history')
        ? []
        : url.pathname.endsWith('/ReverseGeocode')
          ? {}
          : product;
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  });
  const server = createServer(new MarketService(transport, config));
  const client = new Client({ name: 'location-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    await run(client, calls);
  } finally {
    await client.close();
    await server.close();
  }
}

test('environment coordinates validate pairs, finite bounds and numeric syntax without exposing values', () => {
  const defaults = (env: Record<string, string>) =>
    (readConfig(env) as unknown as Record<string, unknown>).defaultLocation;
  assert.equal(defaults({}), undefined);
  assert.deepEqual(defaults(configured), { latitude: 0, longitude: 0, distance: 2 });
  assert.deepEqual(
    defaults({ MARKET_FIYATI_LATITUDE: ' -9e1 ', MARKET_FIYATI_LONGITUDE: '+180', MARKET_FIYATI_DISTANCE: '.5' }),
    { latitude: -90, longitude: 180, distance: 0.5 }
  );
  const invalid = [
    { MARKET_FIYATI_LATITUDE: '0' },
    { MARKET_FIYATI_LONGITUDE: '0' },
    { MARKET_FIYATI_DISTANCE: '2' },
    { MARKET_FIYATI_LATITUDE: '0', MARKET_FIYATI_LONGITUDE: '0' },
    ...['', ' ', '91', '-91', 'NaN', 'Infinity', '0x10', '41,5', 'secret-location'].map((value) => ({
      ...configured,
      MARKET_FIYATI_LATITUDE: value
    })),
    ...['181', '-181', ''].map((value) => ({ ...configured, MARKET_FIYATI_LONGITUDE: value })),
    ...['0', '-1', '50.1', 'Infinity', 'NaN', ''].map((value) => ({ ...configured, MARKET_FIYATI_DISTANCE: value }))
  ];
  for (const env of invalid)
    assert.throws(
      () => readConfig(env),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'CONFIG_ERROR');
        assert.ok(!JSON.stringify(error).includes('secret-location'));
        return true;
      }
    );
});

test('MCP discovery permits configured omissions without publishing coordinates or overriding radius', async () => {
  await withLocationClient({ ...configured, MARKET_FIYATI_LATITUDE: '12.34567' }, async (client, calls) => {
    const { tools } = await client.listTools();
    const search = tools.find((tool) => tool.name === 'market_search_products')!;
    assert.ok(!search.inputSchema.required?.includes('latitude'));
    assert.ok(!search.inputSchema.required?.includes('longitude'));
    assert.ok(search.inputSchema.required?.includes('depots'));
    assert.ok(!JSON.stringify(tools).includes('12.34567'));
    const status = await client.callTool({ name: 'market_status', arguments: {} });
    assert.deepEqual(
      ((status.structuredContent as Record<string, unknown>).data as Record<string, unknown>).locationDefaults,
      { configured: true }
    );
    assert.ok(!JSON.stringify(status).includes('12.34567'));
    assert.equal(calls.length, 0);
    const result = await client.callTool({ name: 'market_find_nearby_depots', arguments: {} });
    assert.notEqual(result.isError, true);
    assert.deepEqual(calls[0]!.body, { latitude: 12.34567, longitude: 0, distance: 2 });
  });
  await withLocationClient({}, async (client, calls) => {
    const { tools } = await client.listTools();
    assert.ok(tools.find((tool) => tool.name === 'market_search_products')!.inputSchema.required?.includes('latitude'));
    const result = await client.callTool({ name: 'market_find_nearby_depots', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
    const missingRadius = await client.callTool({
      name: 'market_find_nearby_depots',
      arguments: { latitude: 0, longitude: 0 }
    });
    assert.equal(missingRadius.isError, true);
    assert.equal(calls.length, 0);
  });
});

test('unconfigured location requires explicit radius instead of silently choosing one kilometer', async () => {
  await withLocationClient({}, async (client, calls) => {
    const result = await client.callTool({
      name: 'market_find_nearby_depots',
      arguments: { latitude: 0, longitude: 0 }
    });
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
  });
});

test('every location-aware MCP operation resolves configured coordinates and preserves wire contracts', async () => {
  const cases: [string, Record<string, unknown>][] = [
    ['market_find_nearby_depots', {}],
    ['market_search_products', { keywords: 'test' }],
    ['market_search_by_category', { menu_category: ['Test'] }],
    ['market_get_product', { identity: 'A' }],
    ['market_find_similar_products', { id: 'A', keywords: 'test' }],
    ['market_find_alternatives', { id: 'A', keywords: 'test', marketName: 'bim' }],
    ['market_get_price_history', { uniqueId: 'A' }],
    ['market_sync_products', { identities: ['A'] }],
    ['market_compare_product_offers', { identity: 'A' }],
    ['market_compare_basket', { items: [{ id: 'A', quantity: 1 }] }]
  ];
  await withLocationClient(configured, async (client, calls) => {
    for (const [name, extra] of cases) {
      const args = name === 'market_find_nearby_depots' ? extra : { depots: ['bim-test'], ...extra };
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result)}`);
      const { latitude, longitude, distance } = calls.at(-1)!.body;
      assert.deepEqual({ latitude, longitude, distance }, { latitude: 0, longitude: 0, distance: 2 }, name);
    }
    const reverse = await client.callTool({ name: 'market_reverse_geocode', arguments: {} });
    assert.notEqual(reverse.isError, true);
    assert.equal(calls.at(-1)!.url.searchParams.get('Lat'), '0');
    assert.equal(calls.at(-1)!.url.searchParams.get('Lon'), '0');
    assert.equal(calls.at(-1)!.url.searchParams.has('distance'), false);
  });
});

test('explicit coordinates and radius affect only their own invocation', async () => {
  await withLocationClient(configured, async (client, calls) => {
    for (const args of [
      {},
      { latitude: 3, longitude: 4, distance: 0.5 },
      {},
      { distance: 3 },
      { latitude: 5, longitude: 6 }
    ]) {
      const result = await client.callTool({ name: 'market_find_nearby_depots', arguments: args });
      assert.notEqual(result.isError, true);
    }
    assert.deepEqual(
      calls.map((call) => call.body),
      [
        { latitude: 0, longitude: 0, distance: 2 },
        { latitude: 3, longitude: 4, distance: 0.5 },
        { latitude: 0, longitude: 0, distance: 2 },
        { latitude: 0, longitude: 0, distance: 3 },
        { latitude: 5, longitude: 6, distance: 2 }
      ]
    );
  });
  await withLocationClient(
    { MARKET_FIYATI_LATITUDE: '7', MARKET_FIYATI_LONGITUDE: '8', MARKET_FIYATI_DISTANCE: '4' },
    async (client, calls) => {
      await client.callTool({ name: 'market_find_nearby_depots', arguments: {} });
      assert.deepEqual(calls[0]!.body, { latitude: 7, longitude: 8, distance: 4 });
    }
  );
});

test('invalid partial overrides, depots and refined arguments fail before HTTP with defaults configured', async () => {
  await withLocationClient(configured, async (client, calls) => {
    for (const args of [
      { latitude: 1 },
      { longitude: 1 },
      { latitude: null, longitude: 0 },
      { latitude: '1', longitude: 0 },
      { latitude: 91, longitude: 0 },
      { distance: 0 },
      { extra: 1 }
    ]) {
      const result = await client.callTool({ name: 'market_find_nearby_depots', arguments: args });
      assert.equal(result.isError, true);
    }
    const invalid: [string, Record<string, unknown>][] = [
      ['market_search_products', { keywords: 'test' }],
      ['market_search_products', { keywords: 'test', depots: [] }],
      ['market_search_by_category', { depots: ['bim-test'] }],
      ['market_find_alternatives', { id: 'A', keywords: 'test', marketName: 'bim', depots: ['other-test'] }],
      ['market_get_price_history', { uniqueId: 'A', depots: ['bim-test'], from: '2026-02-02', to: '2026-01-01' }],
      ['market_get_categories', { latitude: 0 }]
    ];
    for (const [name, args] of invalid)
      assert.equal((await client.callTool({ name, arguments: args })).isError, true, name);
    assert.equal(calls.length, 0);
  });
});

test('configured location does not enable network or experimental endpoints', async () => {
  const config = readConfig(configured);
  const service = new MarketService(new OfflineTransport(), config);
  await assert.rejects(service.execute('search', { keywords: 'test', depots: ['bim-test'] }), {
    code: 'NETWORK_DISABLED'
  });
  await withLocationClient({ ...configured, MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'false' }, async (client, calls) => {
    const result = await client.callTool({ name: 'market_find_nearby_depots', arguments: {} });
    assert.equal(
      ((result.structuredContent as Record<string, unknown>).error as { code: string }).code,
      'EXPERIMENTAL_DISABLED'
    );
    assert.equal(calls.length, 0);
  });
});

test('legacy search without distance needs an explicit or configured radius', async () => {
  const legacy = { keywords: 'yoğurt', latitude: 41, longitude: 29, depots: ['bim-test'], pages: 0, size: 5 };
  await withLocationClient({}, async (client, calls) => {
    const result = await client.callTool({ name: 'market_search_products', arguments: legacy });
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
  });
  await withLocationClient(configured, async (client, calls) => {
    const result = await client.callTool({ name: 'market_search_products', arguments: legacy });
    assert.notEqual(result.isError, true);
    assert.equal(calls[0]?.body.distance, 2);
    assert.equal(calls[0]?.body.latitude, 41);
    assert.equal(calls[0]?.body.longitude, 29);
  });
});
