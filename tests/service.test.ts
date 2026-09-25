import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarketService } from '../src/service.js';
import { readConfig } from '../src/config.js';
import { OfflineTransport, type Transport, type Payload } from '../src/transport.js';
import type { EndpointId, Operation, SearchResponse } from '../src/contracts.js';

const context = {
  latitude: 41,
  longitude: 29,
  distance: 1,
  depots: ['bim-test']
};
const response = {
  numberOfFound: 1,
  searchResultType: 0,
  facetMap: null,
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
};
class FixtureTransport implements Transport {
  readonly mode = 'live' as const;
  calls: { endpoint: EndpointId; payload: Payload | undefined }[] = [];
  constructor(private data: unknown = response) {}
  async request(endpoint: EndpointId, payload?: Payload) {
    this.calls.push({ endpoint, payload });
    return {
      data: this.data,
      meta: {
        source: 'live' as const,
        endpoint,
        experimental: false,
        retrievedAt: '2025-01-01T00:00:00Z'
      }
    };
  }
}
test('basket stops on blank chain keys including zero and out-of-scope offers', async () => {
  for (const [price, depotId] of [
    [10, 'bim-test'],
    [0, 'bim-test'],
    [10, 'other-test']
  ] as const) {
    const bad = {
      ...response,
      content: [
        {
          ...response.content[0]!,
          productDepotInfoList: [
            {
              ...response.content[0]!.productDepotInfoList[0]!,
              marketAdi: '',
              price,
              depotId
            }
          ]
        }
      ]
    };
    const transport = new FixtureTransport(bad);
    await assert.rejects(
      new MarketService(transport, readConfig({})).execute('compareBasket', {
        ...context,
        items: [
          { id: 'A', quantity: 1 },
          { id: 'B', quantity: 1 }
        ]
      }),
      { code: 'INVALID_RESPONSE' }
    );
    assert.equal(transport.calls.length, 1);
  }
});
test('paginated endpoints reject impossible totals and never advertise an unreachable page', async () => {
  const operations = [
    ['search', { ...context, keywords: 'test' }],
    ['searchByCategories', { ...context, main_category: ['Test'] }],
    ['similar', { ...context, id: 'A', keywords: 'test' }],
    [
      'alternative',
      {
        ...context,
        id: 'A',
        keywords: 'test',
        marketName: 'bim'
      }
    ]
  ] as const;
  for (const [operation, args] of operations) {
    for (const [pages, size, total] of [
      [0, 1, 0],
      [1, 2, 2]
    ] as const) {
      const transport = new FixtureTransport({
        ...response,
        numberOfFound: total
      });
      await assert.rejects(
        new MarketService(transport, readConfig({})).execute(operation, {
          ...args,
          pages,
          size
        }),
        { code: 'INVALID_RESPONSE' }
      );
      assert.equal(transport.calls.length, 1);
    }
    const service = new MarketService(new FixtureTransport({ ...response, numberOfFound: 10002 }), readConfig({}));
    const boundary = await service.execute(operation, {
      ...args,
      pages: 10000,
      size: 1
    });
    assert.equal((boundary.meta.pagination as { nextPage: number | null }).nextPage, null);
    assert.ok((boundary.meta.warningCodes as string[]).includes('PAGINATION_LIMIT_REACHED'));
    assert.ok((boundary.meta.warningCodes as string[]).includes('PARTIAL_RESULTS'));
    const before = await service.execute(operation, {
      ...args,
      pages: 9999,
      size: 1
    });
    assert.equal((before.meta.pagination as { nextPage: number | null }).nextPage, 10000);
  }
});
test('empty and short pages keep honest coverage at the page boundary', async () => {
  const operations = [
    ['search', { ...context, keywords: 'test' }],
    ['searchByCategories', { ...context, main_category: ['Test'] }],
    ['similar', { ...context, id: 'A', keywords: 'test' }],
    [
      'alternative',
      {
        ...context,
        id: 'A',
        keywords: 'test',
        marketName: 'bim'
      }
    ]
  ] as const;
  for (const [operation, args] of operations) {
    for (const [pages, size, total, content, partial] of [
      [0, 25, 0, [], false],
      [3, 25, 0, [], true],
      [1, 25, 26, response.content, true]
    ] as const) {
      const service = new MarketService(
        new FixtureTransport({ ...response, numberOfFound: total, content }),
        readConfig({})
      );
      const output = await service.execute(operation, { ...args, pages, size });
      assert.equal((output.meta.pagination as { nextPage: unknown }).nextPage, null);
      assert.equal((output.meta.warningCodes as string[]).includes('PARTIAL_RESULTS'), partial);
      assert.ok(!(output.meta.warningCodes as string[]).includes('PAGINATION_LIMIT_REACHED'));
    }
    const atEnd = await new MarketService(
      new FixtureTransport({ ...response, numberOfFound: 10001 }),
      readConfig({})
    ).execute(operation, { ...args, pages: 10000, size: 1 });
    assert.equal((atEnd.meta.pagination as { nextPage: unknown }).nextPage, null);
    assert.ok(!(atEnd.meta.warningCodes as string[]).includes('PAGINATION_LIMIT_REACHED'));
    const transport = new FixtureTransport();
    await assert.rejects(
      new MarketService(transport, readConfig({})).execute(operation, {
        ...args,
        pages: 10001,
        size: 1
      }),
      { code: 'INVALID_ARGUMENT' }
    );
    assert.equal(transport.calls.length, 0);
  }
});
test('service validates before transport and preserves response metadata', async () => {
  const transport = new FixtureTransport();
  const service = new MarketService(transport, readConfig({}));
  await assert.rejects(service.execute('search', { keywords: 'süt' }), {
    code: 'INVALID_ARGUMENT'
  });
  assert.equal(transport.calls.length, 0);
  const result = await service.execute('search', {
    ...context,
    keywords: 'süt'
  });
  assert.equal(result.meta.source, 'live');
  assert.equal(result.meta.retrievedAt, '2025-01-01T00:00:00Z');
  assert.deepEqual(transport.calls[0]?.payload, {
    ...context,
    keywords: 'süt',
    pages: 0,
    size: 25
  });
});
test('history date filters are local and never sent upstream', async () => {
  const transport = new FixtureTransport([
    {
      name: 'bim',
      series: [
        { name: '2026-09-01', value: 10 },
        { name: '2026-09-02', value: 12 }
      ]
    }
  ]);
  await new MarketService(transport, readConfig({})).execute('priceHistory', {
    ...context,
    uniqueId: 'A',
    from: '2026-09-02'
  });
  assert.deepEqual(transport.calls[0]?.payload, { ...context, uniqueId: 'A' });
});
test('schema-valid large history can be summarized through the service', async () => {
  const data = [
    {
      name: 'bim',
      series: Array.from({ length: 130_000 }, (_, i) => ({
        name: '2026-09-01',
        value: i % 2 ? 20 : 10
      })),
      extra: 'retained'
    }
  ];
  const result = await new MarketService(new FixtureTransport(data), readConfig({})).execute('priceHistory', {
    ...context,
    uniqueId: 'A'
  });
  const output = result.data as {
    summary: { points: number; min: number; max: number }[];
    series: { extra: string }[];
  };
  assert.equal(output.summary[0]?.points, 130_000);
  assert.equal(output.summary[0]?.min, 10);
  assert.equal(output.summary[0]?.max, 20);
  assert.equal(output.series[0]?.extra, 'retained');
});
test('batch sync emits required identityType and size', async () => {
  const transport = new FixtureTransport();
  await new MarketService(transport, readConfig({})).execute('sync', {
    ...context,
    identities: ['A', 'B']
  });
  assert.deepEqual(transport.calls[0]?.payload, {
    ...context,
    identities: ['A', 'B'],
    identityType: 'id',
    pages: 0,
    size: 2
  });
});

test('exact product and sync reject unexpected or duplicate identities', async () => {
  for (const ids of [['B'], ['A', 'B'], ['A', 'A'], ['1']]) {
    const data = {
      ...response,
      content: ids.map((id) => ({ ...response.content[0]!, id }))
    };
    const service = new MarketService(new FixtureTransport(data), readConfig({}));
    await assert.rejects(service.execute('product', { ...context, identity: 'A' }), {
      code: 'INVALID_RESPONSE'
    });
    await assert.rejects(service.execute('sync', { ...context, identities: ['A'] }), {
      code: 'INVALID_RESPONSE'
    });
  }
  const wrong = new MarketService(
    new FixtureTransport({
      ...response,
      content: [{ ...response.content[0]!, id: '1' }]
    }),
    readConfig({})
  );
  await assert.rejects(wrong.execute('product', { ...context, identity: '001' }), {
    code: 'INVALID_RESPONSE'
  });
  await assert.rejects(wrong.execute('compareProduct', { ...context, identity: '001' }), {
    code: 'INVALID_RESPONSE'
  });
});

test('comparisons reject ambiguous exact identities before choosing a price', async () => {
  const original = response.content[0]!;
  const priced = (price: number) => ({
    ...original,
    productDepotInfoList: [{ ...original.productDepotInfoList[0]!, price }]
  });
  for (const content of [
    [priced(10), priced(20)],
    [priced(20), priced(10)],
    [{ ...original, id: 'B' }],
    [original, { ...original, id: 'B' }]
  ]) {
    for (const operation of ['compareProduct', 'compareBasket'] as const) {
      const transport = new FixtureTransport({ ...response, content });
      const service = new MarketService(transport, readConfig({}));
      const args =
        operation === 'compareProduct'
          ? { ...context, identity: 'A' }
          : {
              ...context,
              items: [
                { id: 'A', quantity: 1 },
                { id: 'B', quantity: 1 }
              ]
            };
      await assert.rejects(service.execute(operation, args), {
        code: 'INVALID_RESPONSE'
      });
      assert.equal(transport.calls.length, 1, 'malformed response must stop the basket before another lookup');
    }
  }
});

test('empty exact responses remain unavailable rather than invalid identities', async () => {
  const service = new MarketService(
    new FixtureTransport({ ...response, numberOfFound: 0, content: [] }),
    readConfig({})
  );
  await assert.rejects(service.execute('compareProduct', { ...context, identity: 'A' }), {
    code: 'PRODUCT_NOT_FOUND'
  });
  const result = await service.execute('compareBasket', {
    ...context,
    items: [{ id: 'A', quantity: 1 }]
  });
  const basket = result.data as {
    splitBasket: { total: number | null; missingProductIds: string[] };
  };
  assert.equal(basket.splitBasket.total, null);
  assert.deepEqual(basket.splitBasket.missingProductIds, ['A']);
});

test('exact lookups preserve empty results and opaque IDs without advertising another page', async () => {
  const data = {
    ...response,
    numberOfFound: 99,
    content: [{ ...response.content[0]!, id: '001' }]
  };
  const service = new MarketService(new FixtureTransport(data), readConfig({}));
  const product = await service.execute('product', {
    ...context,
    identity: '001'
  });
  assert.equal((product.data as SearchResponse).content[0]?.id, '001');
  assert.equal((product.meta.pagination as { nextPage: unknown }).nextPage, null);
  const sync = await service.execute('sync', {
    ...context,
    identities: ['001', '002']
  });
  assert.deepEqual(sync.meta.missingProductIds, ['002']);
  assert.equal((sync.meta.pagination as { nextPage: unknown }).nextPage, null);
  const empty = new MarketService(new FixtureTransport({ ...response, numberOfFound: 0, content: [] }), readConfig({}));
  assert.deepEqual((await empty.execute('product', { ...context, identity: 'A' })).data, {
    ...response,
    numberOfFound: 0,
    content: []
  });
  assert.deepEqual((await empty.execute('sync', { ...context, identities: ['A'] })).meta.missingProductIds, ['A']);
  const search = await service.execute('search', {
    ...context,
    keywords: 'test',
    size: 1
  });
  assert.equal((search.meta.pagination as { nextPage: unknown }).nextPage, 1);
});
test('reverse geocode capitalizes API parameters and formats known address fields', async () => {
  const transport = new FixtureTransport({
    Mahalle_Adi: 'Test',
    Yol_Adi: 'Sokak',
    KapiNo: 2,
    Ilce_Adi: 'İlçe',
    Il_Adi: 'İstanbul'
  });
  const result = await new MarketService(transport, readConfig({})).execute('reverseGeocode', {
    latitude: 41,
    longitude: 29
  });
  assert.deepEqual(transport.calls[0]?.payload, { Lat: 41, Lon: 29 });
  assert.equal((result.data as { display_name: string }).display_name, 'Test Mh. Sokak No: 2 İlçe İstanbul');
});
test('geocoder rejects coerced coordinates but accepts actual numeric strings', async () => {
  for (const value of [true, false, [], {}, '  ', null]) {
    const transport = new FixtureTransport([['Address', null, null, null, null, null, null, value, 41]]);
    await assert.rejects(
      new MarketService(transport, readConfig({})).execute('geocode', {
        words: 'address'
      }),
      { code: 'INVALID_RESPONSE' }
    );
  }
  const transport = new FixtureTransport([['Address', null, null, null, null, null, null, '29.25', '41.5']]);
  const result = await new MarketService(transport, readConfig({})).execute('geocode', {
    words: 'address'
  });
  assert.equal((result.data as { content: { longitude: number }[] }).content[0]?.longitude, 29.25);
});
test('category transformations retain upstream completeness warnings and extra fields', async () => {
  const transport = new FixtureTransport({
    content: [],
    warnings: ['Partial category tree'],
    future: 42
  });
  const result = await new MarketService(transport, readConfig({})).execute('categories', {
    flat: true
  });
  assert.deepEqual(result.data, {
    content: [],
    warnings: ['Partial category tree'],
    future: 42
  });
});
test('comparison looks up explicit identities and preserves source records', async () => {
  const transport = new FixtureTransport();
  const service = new MarketService(transport, readConfig({}));
  const result = await service.execute('compareBasket', {
    ...context,
    items: [{ id: 'A', quantity: 2 }]
  });
  assert.equal(transport.calls[0]?.endpoint, 'product');
  assert.deepEqual(transport.calls[0]?.payload, {
    ...context,
    identity: 'A',
    identityType: 'id',
    pages: 0,
    size: 1
  });
  assert.equal((result.data as { groups: { total: number }[] }).groups[0]?.total, 20);
});
test('status and catalog require no API access', async () => {
  const service = new MarketService(new OfflineTransport(), readConfig({}));
  const result = await service.execute('status', {});
  assert.equal((result.data as { mode: string }).mode, 'offline');
});

test('basket budget reserves retries before the first request and status reports effective limits', async () => {
  for (const [retries, allowed] of [
    ['2', 1],
    ['0', 5],
    ['1', 2],
    ['3', 1]
  ] as const) {
    let calls = 0;
    const transport: Transport = {
      mode: 'live',
      async request(endpoint, payload) {
        calls++;
        return {
          data: {
            ...response,
            content: [{ ...response.content[0]!, id: String(payload?.identity) }]
          },
          meta: {
            source: 'live',
            endpoint,
            experimental: false,
            retrievedAt: '2026-09-23T00:00:00Z'
          }
        };
      }
    };
    const config = readConfig({ MARKET_FIYATI_RETRIES: retries });
    const service = new MarketService(transport, config);
    const items = Array.from({ length: allowed + 1 }, (_, i) => ({
      id: `P${i}`,
      quantity: 1
    }));
    await assert.rejects(service.execute('compareBasket', { ...context, items }), {
      code: retries === '0' ? 'INVALID_ARGUMENT' : 'REQUEST_BUDGET_EXCEEDED'
    });
    assert.equal(calls, 0, 'over-budget call must not send even the first lookup');
    const result = await service.execute('compareBasket', {
      ...context,
      items: items.slice(0, allowed)
    });
    assert.equal(calls, allowed);
    assert.equal((result.data as { splitBasket: { total: number } }).splitBasket.total, allowed * 10);
    assert.equal(service.status().limits.basketItems, allowed);
  }
});
test('runtime permission and release validation evidence have distinct status fields', async () => {
  const transport = new FixtureTransport();
  const api = new MarketService(transport, readConfig({})).status().api as Record<string, unknown>;
  assert.equal(api.liveValidationPerformed, false);
  assert.equal(api.liveValidationScope, 'runtime-session');
  assert.equal(api.releaseVerificationReference, 'docs/verification.md');
  assert.equal(transport.calls.length, 0);
});

test('experimental access does not claim that the endpoint has never been validated', async () => {
  const transport: Transport = {
    mode: 'live',
    async request(endpoint) {
      return {
        data: [],
        meta: {
          source: 'live',
          endpoint,
          experimental: true,
          retrievedAt: '2026-09-22T00:00:00Z'
        }
      };
    }
  };
  const result = await new MarketService(transport, readConfig({})).execute('nearest', {
    latitude: 0,
    longitude: 0,
    distance: 1
  });
  assert.ok(result.warnings.some((w) => w.includes('operator enabled access does not certify live validation')));
  assert.ok(!result.warnings.some((w) => w.includes('has not yet been validated')));
});

test('derived comparisons preserve attributed upstream warnings and extra fields', async () => {
  const fixture = {
    ...response,
    searchResultType: 2,
    warnings: ['UPSTREAM_PARTIAL'],
    future: 42,
    content: [
      {
        ...response.content[0]!,
        warnings: ['MEMBERS_ONLY'],
        future: 'product-extra'
      }
    ]
  };
  const before = JSON.stringify(fixture);
  const service = new MarketService(new FixtureTransport(fixture), readConfig({}));
  for (const [operation, args] of [
    ['compareProduct', { ...context, identity: 'A' }],
    ['compareBasket', { ...context, items: [{ id: 'A', quantity: 2 }] }]
  ] as const) {
    const result = await service.execute(operation, args);
    assert.ok(result.warnings.some((w) => w.includes('UPSTREAM_PARTIAL') && w.includes('A')));
    assert.ok(result.warnings.some((w) => w.includes('MEMBERS_ONLY') && w.includes('A')));
    assert.ok(result.warnings.some((w) => w.includes('fuzzy')));
    assert.ok(result.warnings.some((w) => w.includes('stock')));
    assert.deepEqual(result.meta.upstream, [
      {
        requestedIdentity: 'A',
        responseFields: {
          numberOfFound: 1,
          searchResultType: 2,
          facetMap: null,
          warnings: ['UPSTREAM_PARTIAL'],
          future: 42
        },
        productFields: [
          {
            id: 'A',
            title: 'A',
            warnings: ['MEMBERS_ONLY'],
            future: 'product-extra'
          }
        ]
      }
    ]);
    assert.equal(JSON.stringify(fixture), before);
  }
});

test('false discount flags remain authoritative across product and comparison operations', async () => {
  const offer = {
    ...response.content[0]!.productDepotInfoList[0]!,
    price: 34.5,
    discount: false,
    discountRatio: null,
    discountlessPrice: 38.5
  };
  const fixture = {
    ...response,
    content: [{ ...response.content[0]!, productDepotInfoList: [offer, offer] }]
  };
  const before = JSON.stringify(fixture);
  const operations: [Operation, Record<string, unknown>][] = [
    ['search', { keywords: 'test' }],
    ['searchByCategories', { main_category: ['Yoğurt'] }],
    ['product', { identity: 'A' }],
    ['similar', { id: 'A', keywords: 'test' }],
    ['alternative', { id: 'A', keywords: 'test', marketName: 'bim' }],
    ['sync', { identities: ['A'] }],
    ['compareProduct', { identity: 'A' }],
    ['compareBasket', { items: [{ id: 'A', quantity: 1 }] }]
  ];
  for (const [operation, args] of operations) {
    const result = await new MarketService(new FixtureTransport(fixture), readConfig({})).execute(operation, {
      ...context,
      ...args
    });
    assert.equal(result.warnings.filter((w) => w.includes('discount=false')).length, 0, operation);
    assert.ok(!(result.meta.warningCodes as string[]).includes('DISCOUNT_INCONSISTENT'), operation);
    assert.ok(
      (result.meta.offerAssessments as { discountAssessment: string }[]).every(
        (a) => a.discountAssessment === 'not_indicated'
      ),
      operation
    );
    assert.match(JSON.stringify(result.data), /"discount":false/);
    assert.match(JSON.stringify(result.data), /"price":34.5/);
    assert.match(JSON.stringify(result.data), /"discountlessPrice":38.5/);
    assert.equal(JSON.stringify(fixture), before);
  }
});

test('discount filter preserves false and absent flags without inferring discounts', async () => {
  for (const offer of [
    {
      ...response.content[0]!.productDepotInfoList[0]!,
      discount: true,
      discountlessPrice: 12
    },
    {
      ...response.content[0]!.productDepotInfoList[0]!,
      discount: false,
      discountlessPrice: 10
    },
    {
      ...response.content[0]!.productDepotInfoList[0]!,
      discount: false,
      discountlessPrice: 12,
      discountRatio: 20,
      promotionText: 'offer'
    },
    {
      ...response.content[0]!.productDepotInfoList[0]!,
      discountlessPrice: 12,
      discountRatio: 20,
      promotionText: 'offer'
    },
    response.content[0]!.productDepotInfoList[0]!
  ]) {
    for (const operation of ['search', 'searchByCategories'] as const) {
      const args = operation === 'search' ? { keywords: 'test' } : { main_category: ['Yoğurt'] };
      const transport = new FixtureTransport({
        ...response,
        content: [{ ...response.content[0]!, productDepotInfoList: [offer] }]
      });
      const service = new MarketService(transport, readConfig({}));
      const result = await service.execute(operation, {
        ...context,
        ...args,
        offer_discount: ['true']
      });
      assert.deepEqual(transport.calls[0]?.payload?.offer_discount, ['true']);
      const returned = (result.data as SearchResponse).content[0]!.productDepotInfoList[0]!;
      for (const [key, value] of Object.entries(offer)) assert.deepEqual(returned[key], value, key);
      assert.equal(Object.hasOwn(returned, 'discount'), Object.hasOwn(offer, 'discount'));
      const flag = 'discount' in offer ? offer.discount : undefined;
      assert.equal(
        (result.meta.offerAssessments as { discountAssessment: string }[])[0]?.discountAssessment,
        flag === true ? 'unverified' : flag === false ? 'not_indicated' : 'unknown'
      );
      assert.ok(result.warnings.some((w) => w.includes('offer_discount')));
      assert.ok(!result.warnings.some((w) => w.includes('discount=false')));
      for (const filters of [{}, { offer_discount: [] }]) {
        const unfiltered = await service.execute(operation, {
          ...context,
          ...args,
          ...filters
        });
        assert.ok(!unfiltered.warnings.some((w) => w.includes('offer_discount')));
      }
    }
  }
});

test('basket retains repeated attributed upstream warnings without inferring discount conflicts', async () => {
  const transport: Transport = {
    mode: 'live',
    async request(endpoint, payload) {
      return {
        data: {
          ...response,
          warnings: ['KEEP', 'KEEP'],
          content: [
            {
              ...response.content[0]!,
              id: String(payload?.identity),
              productDepotInfoList: [
                {
                  ...response.content[0]!.productDepotInfoList[0]!,
                  discount: false,
                  discountlessPrice: 12
                }
              ]
            }
          ]
        },
        meta: {
          source: 'live',
          endpoint,
          experimental: false,
          retrievedAt: '2026-09-23T00:00:00Z'
        }
      };
    }
  };
  const result = await new MarketService(transport, readConfig({})).execute('compareBasket', {
    ...context,
    items: [
      { id: 'A', quantity: 1 },
      { id: 'B', quantity: 1 }
    ]
  });
  assert.equal(result.warnings.filter((w) => w.includes('discount=false')).length, 0);
  assert.equal(result.warnings.filter((w) => w.includes('KEEP')).length, 4);
  assert.equal(result.warnings.filter((w) => w.includes('lookup "A"') && w.includes('KEEP')).length, 2);
  assert.equal(result.warnings.filter((w) => w.includes('lookup "B"') && w.includes('KEEP')).length, 2);
});

test('basket rejects large warning arrays even within the HTTP response byte limit', async () => {
  const warnings = Array.from({ length: 130_000 }, (_, i) => `notice-${i}`);
  const fixture = { ...response, warnings };
  assert.ok(Buffer.byteLength(JSON.stringify(fixture)) < 5 * 1024 * 1024);
  await assert.rejects(
    new MarketService(new FixtureTransport(fixture), readConfig({})).execute('compareBasket', {
      ...context,
      items: [{ id: 'A', quantity: 1 }]
    }),
    { code: 'RESOURCE_LIMIT_EXCEEDED' }
  );
});

test('basket keeps non-string and empty-response warnings attributed to each lookup', async () => {
  const transport: Transport = {
    mode: 'live',
    async request(endpoint, payload) {
      const data =
        payload?.identity === 'A'
          ? {
              ...response,
              warnings: { code: 'PARTIAL', detail: 'untrusted data' },
              content: [{ ...response.content[0]!, warnings: 'A_NOTICE' }]
            }
          : {
              ...response,
              numberOfFound: 0,
              content: [],
              warnings: ['B_MISSING']
            };
      return {
        data,
        meta: {
          source: 'live',
          endpoint,
          experimental: false,
          retrievedAt: '2026-09-22T00:00:00Z'
        }
      };
    }
  };
  const result = await new MarketService(transport, readConfig({})).execute('compareBasket', {
    ...context,
    items: [
      { id: 'A', quantity: 1 },
      { id: 'B', quantity: 1 }
    ]
  });
  assert.ok(result.warnings.some((w) => w.includes('A_NOTICE')));
  assert.ok(result.warnings.some((w) => w.includes('B_MISSING') && w.includes('B')));
  assert.match(JSON.stringify(result.meta.upstream), /"warnings":\{"code":"PARTIAL"/);
  assert.equal((result.data as { splitBasket: { total: number | null } }).splitBasket.total, null);
});

const mapLinks = {
  google: 'https://www.google.com/maps/search/?api=1&query=41.25%2C29.5',
  apple: 'https://maps.apple.com/?ll=41.25%2C29.5&q=41.25%2C29.5',
  yandex: 'https://yandex.com/maps/?ll=29.5%2C41.25&pt=29.5%2C41.25&z=16'
};
const locatedResponse = {
  ...response,
  content: [
    {
      ...response.content[0]!,
      productDepotInfoList: [
        {
          ...response.content[0]!.productDepotInfoList[0]!,
          latitude: 41.25,
          longitude: 29.5
        }
      ]
    }
  ]
};
test('nearby branch map links use the branch coordinates in each provider order', async () => {
  const branch = {
    id: 'bim-test',
    marketName: 'bim',
    sellerName: 'Test',
    distance: 100,
    location: { lat: 41.25, lon: 29.5 },
    extra: true
  };
  const transport = new FixtureTransport([branch]);
  const result = await new MarketService(transport, readConfig({})).execute('nearest', {
    latitude: 40,
    longitude: 28,
    distance: 1
  });
  assert.deepEqual(result.data, [{ ...branch, maps: mapLinks }]);
  assert.equal(transport.calls.length, 1);
  assert.equal('maps' in branch, false);
});
test('every product operation includes offer map links without additional requests', async () => {
  const operations: [Operation, Record<string, unknown>][] = [
    ['search', { keywords: 'test' }],
    ['searchByCategories', { main_category: ['Yoğurt'] }],
    ['product', { identity: 'A' }],
    ['similar', { id: 'A', keywords: 'test' }],
    ['alternative', { id: 'A', keywords: 'test', marketName: 'bim' }],
    ['sync', { identities: ['A'] }]
  ];
  for (const [operation, args] of operations) {
    const transport = new FixtureTransport(locatedResponse);
    const result = await new MarketService(transport, readConfig({})).execute(operation, {
      ...context,
      ...args
    });
    const data = result.data as SearchResponse;
    assert.deepEqual(data.content[0]?.productDepotInfoList[0]?.maps, mapLinks, operation);
    assert.equal(transport.calls.length, 1);
  }
  assert.equal('maps' in locatedResponse.content[0]!.productDepotInfoList[0]!, false);
});
test('map links never fall back to user coordinates for missing or invalid branch coordinates', async () => {
  for (const coords of [{}, { latitude: 41 }, { latitude: 91, longitude: 29 }, { latitude: 41, longitude: -181 }]) {
    const data = {
      ...response,
      content: [
        {
          ...response.content[0]!,
          productDepotInfoList: [
            {
              ...response.content[0]!.productDepotInfoList[0]!,
              ...coords,
              maps: { google: 'https://untrusted.test' }
            }
          ]
        }
      ]
    };
    const result = await new MarketService(new FixtureTransport(data), readConfig({})).execute('search', {
      ...context,
      keywords: 'test'
    });
    assert.equal((result.data as SearchResponse).content[0]?.productDepotInfoList[0]?.maps, null);
  }
  const result = await new MarketService(
    new FixtureTransport([
      {
        id: 'bim-test',
        marketName: 'bim',
        distance: 0,
        location: { lat: 0, lon: 0 }
      }
    ]),
    readConfig({})
  ).execute('nearest', { latitude: 41, longitude: 29, distance: 1 });
  assert.equal(
    new URL((result.data as { maps: { google: string } }[])[0]!.maps.google).searchParams.get('query'),
    '0,0'
  );
});

test('out-of-scope depot offers remain visible with an explicit warning', async () => {
  const data = {
    ...response,
    content: [
      {
        ...response.content[0]!,
        productDepotInfoList: [
          {
            ...response.content[0]!.productDepotInfoList[0]!,
            depotId: 'bim-outside'
          }
        ]
      }
    ]
  };
  const service = new MarketService(new FixtureTransport(data), readConfig({}));
  for (const [operation, args] of [
    ['search', { ...context, keywords: 'test' }],
    ['compareProduct', { ...context, identity: 'A' }],
    ['compareBasket', { ...context, items: [{ id: 'A', quantity: 1 }] }]
  ] as const) {
    const result = await service.execute(operation, args);
    assert.ok(result.warnings.some((w) => w.includes('outside') && w.includes('bim-outside')));
    assert.match(JSON.stringify(result.data), /bim-outside/);
  }
});

test('invalid coordinate types fail the response contract rather than being coerced', async () => {
  for (const latitude of [null, '41', true]) {
    const data = {
      ...response,
      content: [
        {
          ...response.content[0]!,
          productDepotInfoList: [{ ...response.content[0]!.productDepotInfoList[0]!, latitude }]
        }
      ]
    };
    await assert.rejects(
      new MarketService(new FixtureTransport(data), readConfig({})).execute('search', {
        ...context,
        keywords: 'test'
      }),
      { code: 'INVALID_RESPONSE' }
    );
  }
  const data = [
    {
      id: 'bim-test',
      marketName: 'bim',
      distance: 1,
      location: { lat: 41 }
    }
  ];
  await assert.rejects(
    new MarketService(new FixtureTransport(data), readConfig({})).execute('nearest', {
      latitude: 41,
      longitude: 29,
      distance: 1
    }),
    { code: 'INVALID_RESPONSE' }
  );
});
test('comparison and basket outputs retain links on selected and unavailable offers', async () => {
  const data = {
    ...locatedResponse,
    content: [
      {
        ...locatedResponse.content[0]!,
        productDepotInfoList: [
          ...locatedResponse.content[0]!.productDepotInfoList,
          {
            ...locatedResponse.content[0]!.productDepotInfoList[0]!,
            depotId: 'bim-zero',
            price: 0
          }
        ]
      }
    ]
  };
  const service = new MarketService(new FixtureTransport(data), readConfig({}));
  const compared = (
    await service.execute('compareProduct', {
      ...context,
      depots: ['bim-test', 'bim-zero'],
      identity: 'A'
    })
  ).data as {
    offers: { maps: unknown }[];
    unavailableOffers: { maps: unknown }[];
  };
  assert.deepEqual(compared.offers[0]?.maps, mapLinks);
  assert.deepEqual(compared.unavailableOffers[0]?.maps, mapLinks);
  const basket = (
    await service.execute('compareBasket', {
      ...context,
      items: [{ id: 'A', quantity: 2 }]
    })
  ).data as {
    groups: { lines: { offer: { maps: unknown } }[] }[];
    splitBasket: { lines: { offer: { maps: unknown } }[] };
  };
  assert.deepEqual(basket.groups[0]?.lines[0]?.offer.maps, mapLinks);
  assert.deepEqual(basket.splitBasket.lines[0]?.offer.maps, mapLinks);
});

test('comparisons restrict derived prices to selected depots while retaining outside evidence', async () => {
  const data = {
    ...response,
    warnings: ['source warning'],
    content: [
      {
        ...response.content[0]!,
        productDepotInfoList: [
          {
            depotId: 'outside-1',
            depotName: 'Outside',
            marketAdi: 'outside',
            price: 1,
            extra: 'preserved'
          },
          {
            depotId: 'bim-test',
            depotName: 'Selected',
            marketAdi: 'bim',
            price: 10
          },
          {
            depotId: 'bim-other',
            depotName: 'Tied',
            marketAdi: 'bim',
            price: 10
          },
          {
            depotId: 'outside-zero',
            depotName: 'Zero',
            marketAdi: 'outside',
            price: 0
          }
        ]
      }
    ]
  };
  const service = new MarketService(new FixtureTransport(data), readConfig({}));
  const selected = { ...context, depots: ['bim-test', 'bim-other'] };
  const result = await service.execute('compareProduct', {
    ...selected,
    identity: 'A'
  });
  const comparison = result.data as ReturnType<typeof import('../src/analysis.js').compareOffers>;
  assert.equal(comparison.cheapestPrice, 10);
  assert.deepEqual(comparison.cheapestDepotIds, ['bim-test', 'bim-other']);
  assert.equal(comparison.unavailableOffers.length, 0);
  const outside = (
    result.data as {
      outOfScopeOffers: { productId: string; offer: { extra?: string } }[];
    }
  ).outOfScopeOffers;
  assert.equal(outside.length, 2);
  assert.equal(outside[0]?.offer.extra, 'preserved');
  assert.ok(result.warnings.some((w) => w.includes('source warning')));
  assert.ok(result.warnings.some((w) => w.includes('outside the supplied selection')));
  for (const groupBy of ['market', 'depot'] as const) {
    const basket = await service.execute('compareBasket', {
      ...selected,
      items: [{ id: 'A', quantity: 2 }],
      groupBy
    });
    const output = basket.data as ReturnType<typeof import('../src/analysis.js').compareBasket>;
    assert.equal(output.splitBasket.total, 20);
    assert.ok(output.groups.every((g) => g.total === 20 && !g.requiresMultipleDepots));
    assert.equal(output.groups.length, groupBy === 'market' ? 1 : 2);
    const refs = basket.meta.offerAssessmentRefs as {
      path: string;
      assessmentIndex: number;
    }[];
    assert.ok(refs.some((r) => r.path === '/data/outOfScopeOffers/0/offer' && r.assessmentIndex === 0));
  }
  const absent = await service.execute('compareBasket', {
    ...context,
    depots: ['not-returned'],
    items: [{ id: 'A', quantity: 1 }]
  });
  const missing = absent.data as ReturnType<typeof import('../src/analysis.js').compareBasket>;
  assert.equal(missing.groups.length, 0);
  assert.equal(missing.splitBasket.total, null);
  assert.deepEqual(missing.splitBasket.missingProductIds, ['A']);
});

test('warning limits reject before cloning offers and never silently truncate accepted warnings', async () => {
  let offerReads = 0;
  const guarded = {
    ...response,
    warnings: Array.from({ length: 129 }, () => ''),
    content: [
      {
        ...response.content[0]!,
        get productDepotInfoList() {
          offerReads++;
          return response.content[0]!.productDepotInfoList;
        }
      }
    ]
  };
  await assert.rejects(
    new MarketService(new FixtureTransport(guarded), readConfig({})).execute('compareProduct', {
      ...context,
      identity: 'A'
    }),
    { code: 'RESOURCE_LIMIT_EXCEEDED' }
  );
  assert.equal(offerReads, 0, 'reject before schema cloning or offer decoration');
  const warnings = Array.from({ length: 128 }, (_, i) => `warning ${i}`);
  const accepted = await new MarketService(
    new FixtureTransport({ ...response, warnings, extra: { retained: true } }),
    readConfig({})
  ).execute('compareProduct', { ...context, identity: 'A' });
  assert.equal(accepted.warnings.filter((w) => w.startsWith('Upstream data')).length, 128);
  const upstream = accepted.meta.upstream as {
    responseFields: { warnings: string[]; extra: unknown };
  }[];
  assert.deepEqual(upstream[0]?.responseFields.warnings, warnings);
  assert.deepEqual(upstream[0]?.responseFields.extra, { retained: true });
  await assert.rejects(
    new MarketService(new FixtureTransport({ ...response, warnings: ['\0'.repeat(11_000)] }), readConfig({})).execute(
      'compareProduct',
      { ...context, identity: 'A' }
    ),
    { code: 'RESOURCE_LIMIT_EXCEEDED' }
  );
});

test('raw resource budgets reject excessive depth values offers and bytes before expansion', async () => {
  let nested: unknown = null;
  for (let i = 0; i < 65; i++) nested = { child: nested };
  const cases = [
    { ...response, extra: nested },
    { ...response, extra: Array.from({ length: 500_001 }, () => null) },
    {
      ...response,
      content: [
        {
          ...response.content[0]!,
          productDepotInfoList: Array.from({ length: 10_001 }, () => response.content[0]!.productDepotInfoList[0])
        }
      ]
    }
  ];
  for (const data of cases)
    await assert.rejects(
      new MarketService(new FixtureTransport(data), readConfig({})).execute('compareProduct', {
        ...context,
        identity: 'A'
      }),
      { code: 'RESOURCE_LIMIT_EXCEEDED' }
    );
  await assert.rejects(
    new MarketService(
      new FixtureTransport({ ...response, extra: 'ü'.repeat(600) }),
      readConfig({ MARKET_FIYATI_MAX_RESPONSE_BYTES: '1024' })
    ).execute('product', { ...context, identity: 'A' }),
    { code: 'RESOURCE_LIMIT_EXCEEDED' }
  );
});

test('basket input and warning budgets are cumulative and stop later lookups', async () => {
  for (const extra of [{ warnings: Array.from({ length: 65 }, () => '') }, { extra: 'x'.repeat(3 * 1024 * 1024) }]) {
    let calls = 0;
    const transport: Transport = {
      mode: 'live',
      async request(endpoint, payload) {
        calls++;
        return {
          data: {
            ...response,
            ...extra,
            content: [{ ...response.content[0]!, id: String(payload?.identity) }]
          },
          meta: {
            source: 'live',
            endpoint,
            experimental: false,
            retrievedAt: '2026-09-23T00:00:00Z'
          }
        };
      }
    };
    await assert.rejects(
      new MarketService(transport, readConfig({})).execute('compareBasket', {
        ...context,
        items: [
          { id: 'A', quantity: 1 },
          { id: 'B', quantity: 1 },
          { id: 'C', quantity: 1 }
        ]
      }),
      { code: 'RESOURCE_LIMIT_EXCEEDED' }
    );
    assert.equal(calls, 2);
  }
});

test('product count is bounded before depot coverage or schema copies even with zero offers', async () => {
  let offerReads = 0;
  const content = Array.from({ length: 101 }, (_, i) => ({
    id: `P${i}`,
    title: 'Synthetic',
    get productDepotInfoList() {
      offerReads++;
      return [];
    }
  }));
  const selected = {
    ...context,
    depots: Array.from({ length: 500 }, (_, i) => `branch-${i}`),
    keywords: 'test',
    size: 100
  };
  await assert.rejects(
    new MarketService(new FixtureTransport({ ...response, numberOfFound: 101, content }), readConfig({})).execute(
      'search',
      selected
    ),
    { code: 'RESOURCE_LIMIT_EXCEEDED' }
  );
  assert.equal(offerReads, 0, 'reject before schema copying or coverage amplification');
  const accepted = await new MarketService(
    new FixtureTransport({
      ...response,
      numberOfFound: 100,
      content: content.slice(0, 100)
    }),
    readConfig({})
  ).execute('search', selected);
  assert.equal((accepted.data as SearchResponse).content.length, 100);
  assert.equal((accepted.meta.depotCoverage as { perProduct: unknown[] }).perProduct.length, 100);
});
