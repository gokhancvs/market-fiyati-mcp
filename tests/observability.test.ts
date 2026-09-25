import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarketService } from '../src/service.js';
import { LiveTransport, OfflineTransport } from '../src/transport.js';
import { readConfig } from '../src/config.js';
import type { Operation, SearchResponse } from '../src/contracts.js';

const context = {
  latitude: 0,
  longitude: 0,
  distance: 1,
  depots: ['bim-A', 'bim-B']
};
const response = (id = 'A') => ({
  numberOfFound: 1,
  searchResultType: 0,
  content: [
    {
      id,
      title: id,
      productDepotInfoList: [
        {
          depotId: 'bim-A',
          depotName: 'A',
          marketAdi: 'bim',
          price: 10
        }
      ]
    }
  ]
});
function service(fetcher: typeof fetch, extra: Record<string, string> = {}) {
  const config = readConfig({
    MARKET_FIYATI_MODE: 'live',
    MARKET_FIYATI_MIN_INTERVAL_MS: '0',
    ...extra
  });
  return new MarketService(new LiveTransport(config, fetcher), config);
}
type Metrics = { httpAttempts: number; retries: number; durationMs: number };
function metrics(value: unknown, attempts: number, retries: number) {
  assert.ok(value, 'request metrics must be available');
  const m = value as Metrics;
  assert.equal(m.httpAttempts, attempts);
  assert.equal(m.retries, retries);
  assert.ok(Number.isFinite(m.durationMs) && m.durationMs >= 0);
}
function failure(attempts: number, retries: number, code: string) {
  return (error: unknown) => {
    const e = error as { code: string; requestMetrics: Metrics };
    assert.equal(e.code, code);
    metrics(e.requestMetrics, attempts, retries);
    return true;
  };
}

test('metrics count actual retries and reset for the next invocation', async () => {
  let calls = 0;
  const s = service(async () => (++calls === 1 ? new Response('', { status: 503 }) : Response.json(response())), {
    MARKET_FIYATI_RETRIES: '1'
  });
  const first = await s.execute('search', { ...context, keywords: 'test' });
  metrics(first.meta.requestMetrics, 2, 1);
  const next = await s.execute('search', { ...context, keywords: 'test' });
  metrics(next.meta.requestMetrics, 1, 0);
  assert.equal(calls, 3);
});

test('metrics preserve successful basket attempts before a later retried failure', async () => {
  const s = service(
    async (_url, init) =>
      JSON.parse(String(init?.body)).identity === 'A'
        ? Response.json(response('A'))
        : new Response('private diagnostic', { status: 503 }),
    { MARKET_FIYATI_RETRIES: '1' }
  );
  await assert.rejects(
    s.execute('compareBasket', {
      ...context,
      items: [
        { id: 'A', quantity: 1 },
        { id: 'B', quantity: 1 }
      ]
    }),
    failure(3, 1, 'HTTP_ERROR')
  );
});

test('metrics report zero attempts for local status and preflight rejections', async () => {
  const s = service(
    async () => {
      assert.fail('preflight must not fetch');
    },
    { MARKET_FIYATI_RETRIES: '1' }
  );
  metrics((await s.execute('status', {})).meta.requestMetrics, 0, 0);
  await assert.rejects(s.execute('search', { keywords: 'test' }), failure(0, 0, 'INVALID_ARGUMENT'));
  await assert.rejects(
    s.execute('compareBasket', {
      ...context,
      items: ['A', 'B', 'C'].map((id) => ({ id, quantity: 1 }))
    }),
    failure(0, 0, 'REQUEST_BUDGET_EXCEEDED')
  );
  await assert.rejects(
    s.execute('nearest', { latitude: 0, longitude: 0, distance: 1 }),
    failure(0, 0, 'EXPERIMENTAL_DISABLED')
  );
  await assert.rejects(
    new MarketService(new OfflineTransport(), readConfig({})).execute('categories', {}),
    failure(0, 0, 'NETWORK_DISABLED')
  );
});

test('metrics survive response parsing, identity validation and analysis failures', async () => {
  const cases: [() => Response, string][] = [
    [() => new Response('{', { headers: { 'content-type': 'application/json' } }), 'INVALID_JSON'],
    [() => Response.json({ content: [] }), 'INVALID_RESPONSE'],
    [() => Response.json(response('wrong-id')), 'INVALID_RESPONSE'],
    [() => Response.json({ numberOfFound: 0, searchResultType: 0, content: [] }), 'PRODUCT_NOT_FOUND'],
    [
      () =>
        Response.json({
          ...response(),
          content: [
            {
              ...response().content[0],
              productDepotInfoList: [
                {
                  ...response().content[0]!.productDepotInfoList[0],
                  price: 1e20
                }
              ]
            }
          ]
        }),
      'INVALID_PRICE'
    ]
  ];
  for (const [make, code] of cases)
    await assert.rejects(
      service(async () => make()).execute('compareProduct', {
        ...context,
        identity: 'A'
      }),
      failure(1, 0, code)
    );
});

test('metrics count timeout and network failure attempts without exposing thrown details', async () => {
  await assert.rejects(
    service(async () => {
      throw new Error('private token');
    }).execute('categories', {}),
    (error) => {
      assert.ok(!JSON.stringify(error).includes('private token'));
      return failure(1, 0, 'NETWORK_ERROR')(error);
    }
  );
  const s = service(
    async () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { 'content-type': 'application/json' }
      }),
    { MARKET_FIYATI_TIMEOUT_MS: '20' }
  );
  await assert.rejects(s.execute('categories', {}), failure(1, 0, 'TIMEOUT'));
});

test('metrics isolate queued cancellation from active and subsequent calls', async () => {
  let started!: () => void,
    release!: (r: Response) => void,
    calls = 0;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const s = service(async () => {
    calls++;
    if (calls === 1)
      return new Promise<Response>((resolve) => {
        release = resolve;
        started();
      });
    return Response.json({ content: [] });
  });
  const active = s.execute('categories', {});
  await ready;
  const controller = new AbortController();
  const queued = s.execute('categories', {}, controller.signal);
  controller.abort();
  let captured: unknown;
  try {
    await assert.rejects(queued, (error) => {
      captured = (error as { requestMetrics: unknown }).requestMetrics;
      return failure(0, 0, 'CANCELLED')(error);
    });
  } finally {
    release(Response.json({ content: [] }));
  }
  metrics((await active).meta.requestMetrics, 1, 0);
  metrics((await s.execute('categories', {})).meta.requestMetrics, 1, 0);
  metrics(captured, 0, 0);
  assert.equal(calls, 2);
});

test('metrics count active cancellation but no retry and zero for cooldown rejection', async () => {
  const controller = new AbortController();
  const s = service(async () => {
    controller.abort();
    return Response.json({ content: [] });
  });
  await assert.rejects(s.execute('categories', {}, controller.signal), failure(1, 0, 'CANCELLED'));
  const limited = service(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }));
  const first = limited.execute('categories', {}),
    second = limited.execute('categories', {});
  await Promise.all([
    assert.rejects(first, failure(1, 0, 'RATE_LIMITED')),
    assert.rejects(second, failure(0, 0, 'RATE_LIMITED'))
  ]);
});

type Coverage = {
  requestedDepotIds: string[];
  returnedDepotIds: string[];
  requestedCount: number;
  returnedCount: number;
  returnedRequestedCount: number;
  unreturnedRequestedDepotIds: string[];
  outOfScopeDepotIds: string[];
  unreturnedStatus: string;
  basis: string;
  perProduct: (Omit<Coverage, 'perProduct'> & { productId: string })[];
};
type Assessment = {
  productId: string;
  depotId: string;
  offerIndex: number;
  discountAssessment: string;
  priceTiming: {
    retrievedAt: string;
    upstreamIndexTime: string | null;
    upstreamTimezone: string;
    ageMs: null;
  };
};

test('coverage counts distinct returned offers, not facet counts or usable-price assumptions', async () => {
  const offer = response().content[0]!.productDepotInfoList[0]!;
  const fixture = {
    ...response(),
    numberOfFound: 3,
    facetMap: { offer_depot: [{ name: 'bim-B', count: 9 }] },
    content: [
      {
        ...response().content[0],
        productDepotInfoList: [
          { ...offer, price: 0 },
          { ...offer, price: 0 },
          { ...offer, depotId: 'bim-C' }
        ]
      }
    ]
  };
  const result = await service(async () => Response.json(fixture)).execute('search', {
    ...context,
    keywords: 'test',
    size: 1
  });
  const c = result.meta.depotCoverage as Coverage;
  assert.ok(c);
  assert.deepEqual(c.requestedDepotIds, ['bim-A', 'bim-B']);
  assert.deepEqual(c.returnedDepotIds, ['bim-A', 'bim-C']);
  assert.equal(c.requestedCount, 2);
  assert.equal(c.returnedCount, 2);
  assert.equal(c.returnedRequestedCount, 1);
  assert.deepEqual(c.unreturnedRequestedDepotIds, ['bim-B']);
  assert.deepEqual(c.outOfScopeDepotIds, ['bim-C']);
  assert.equal(c.unreturnedStatus, 'unknown');
  assert.equal(c.basis, 'returned_offers');
  assert.equal(c.perProduct[0]?.productId, 'A');
  assert.deepEqual(c.perProduct[0]?.unreturnedRequestedDepotIds, ['bim-B']);
  const assessments = result.meta.offerAssessments as Assessment[];
  assert.deepEqual(
    assessments.map((a) => a.offerIndex),
    [0, 1, 2]
  );
  const codes = result.meta.warningCodes as string[];
  for (const code of ['PRICE_SCOPE_LIMITED', 'DEPOT_AVAILABILITY_UNKNOWN', 'OUT_OF_SCOPE_OFFERS', 'PARTIAL_RESULTS'])
    assert.ok(codes.includes(code), code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal((result.data as SearchResponse).content[0]?.productDepotInfoList.length, 3);
});

test('all product operations expose trusted assessments while retaining raw upstream fields', async () => {
  const offer = {
    ...response().content[0]!.productDepotInfoList[0]!,
    discount: false,
    discountlessPrice: 12,
    indexTime: 'not a timestamp',
    discountAssessment: 'confirmed',
    priceTiming: { ageMs: 0 },
    future: 'preserve'
  };
  const fixture = {
    ...response(),
    warnings: ['PARTIAL_RESULTS', 'DISCOUNT_INCONSISTENT'],
    warningCodes: ['FORGED_CODE'],
    content: [{ ...response().content[0], productDepotInfoList: [offer] }]
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
  for (const [op, args] of operations) {
    let calls = 0;
    const result = await service(
      async () => {
        calls++;
        return Response.json(fixture);
      },
      { MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'true' }
    ).execute(op, { ...context, ...args });
    const observations = result.meta.offerAssessments as Assessment[];
    assert.ok(observations, op);
    assert.equal(observations[0]?.discountAssessment, 'not_indicated', op);
    assert.equal(observations[0]?.priceTiming.upstreamIndexTime, 'not a timestamp', op);
    assert.equal(observations[0]?.priceTiming.upstreamTimezone, 'unknown', op);
    assert.equal(observations[0]?.priceTiming.ageMs, null, op);
    const codes = result.meta.warningCodes as string[];
    assert.ok(!codes.includes('DISCOUNT_INCONSISTENT'), op);
    assert.ok(codes.includes('UPSTREAM_WARNING'), op);
    assert.ok(!codes.includes('FORGED_CODE'), op);
    assert.ok(!codes.includes('PARTIAL_RESULTS'), op);
    assert.match(JSON.stringify(result.data), /"discountAssessment":"confirmed"/, op);
    if (op === 'compareProduct' || op === 'compareBasket')
      assert.ok(
        result.warnings.some((w) => w.includes('DISCOUNT_INCONSISTENT') && w.startsWith('Upstream data')),
        op
      );
    else assert.deepEqual((result.data as SearchResponse).warnings, ['PARTIAL_RESULTS', 'DISCOUNT_INCONSISTENT'], op);
    assert.equal(calls, 1, op);
    metrics(result.meta.requestMetrics, 1, 0);
  }
  assert.equal(JSON.stringify(fixture), before);
});

test('only the API discount boolean determines assessments, independent of promotional hints', async () => {
  const base = response().content[0]!.productDepotInfoList[0]!;
  const variants = [
    { discount: false, discountlessPrice: 12, indexTime: '22.09.2026 08:45' },
    { discount: true, discountlessPrice: 12, indexTime: '' },
    { discount: false, discountlessPrice: 10 },
    {},
    { discountlessPrice: 12, promotionText: 'offer' },
    { discount: false, promotionText: 'member offer' },
    {
      discount: false,
      discountlessPrice: 12,
      discountRatio: 20,
      promotionText: 'member offer'
    },
    { discountlessPrice: 12, discountRatio: 20, promotionText: 'member offer' },
    {
      discount: true,
      discountlessPrice: 8,
      discountRatio: null,
      promotionText: null
    }
  ];
  const s = service(async () =>
    Response.json({
      ...response(),
      content: [
        {
          ...response().content[0],
          productDepotInfoList: variants.map((v) => ({ ...base, ...v }))
        }
      ]
    })
  );
  const r = await s.execute('search', {
    ...context,
    keywords: 'test',
    offer_discount: ['true']
  });
  const a = r.meta.offerAssessments as Assessment[];
  assert.ok(a);
  assert.deepEqual(
    a.map((v) => v.discountAssessment),
    [
      'not_indicated',
      'unverified',
      'not_indicated',
      'unknown',
      'unknown',
      'not_indicated',
      'not_indicated',
      'unknown',
      'unverified'
    ]
  );
  const returned = (r.data as SearchResponse).content[0]!.productDepotInfoList;
  for (const [i, variant] of variants.entries()) {
    for (const [key, value] of Object.entries(variant)) assert.deepEqual(returned[i]![key], value, key);
    assert.equal(Object.hasOwn(returned[i]!, 'discount'), Object.hasOwn(variant, 'discount'));
  }
  assert.deepEqual(
    a.map((v) => v.priceTiming.upstreamIndexTime),
    ['22.09.2026 08:45', '', null, null, null, null, null, null, null]
  );
  assert.ok(
    a.every(
      (v) =>
        v.priceTiming.retrievedAt === r.meta.retrievedAt &&
        v.priceTiming.ageMs === null &&
        v.priceTiming.upstreamTimezone === 'unknown'
    )
  );
  assert.ok((r.meta.warningCodes as string[]).includes('DISCOUNT_FILTER_UNVERIFIED'));
});

test('missing exact products have explicit unknown per-product depot coverage', async () => {
  const s = service(
    async (_url, init) => {
      const input = JSON.parse(String(init?.body));
      return Response.json(
        input.identity === 'B' ? { numberOfFound: 0, searchResultType: 0, content: [] } : response()
      );
    },
    { MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'true' }
  );
  for (const [op, args] of [
    ['sync', { identities: ['A', 'B'] }],
    [
      'compareBasket',
      {
        items: [
          { id: 'A', quantity: 1 },
          { id: 'B', quantity: 1 }
        ]
      }
    ]
  ] as const) {
    const r = await s.execute(op, { ...context, ...args });
    const c = r.meta.depotCoverage as Coverage;
    assert.ok(c);
    assert.deepEqual(
      c.perProduct.map((p) => p.productId),
      ['A', 'B']
    );
    assert.deepEqual(c.perProduct[1]?.returnedDepotIds, []);
    assert.deepEqual(c.perProduct[1]?.unreturnedRequestedDepotIds, ['bim-A', 'bim-B']);
    assert.equal(c.perProduct[1]?.unreturnedStatus, 'unknown');
  }
});

test('basket timing retains per-lookup retrieval times and coverage spans all returned products', async () => {
  const s = service(async (_url, init) => {
    const id = JSON.parse(String(init?.body)).identity;
    if (id === 'B') await new Promise((resolve) => setTimeout(resolve, 15));
    return Response.json({
      ...response(id),
      content: [
        {
          ...response(id).content[0],
          productDepotInfoList: [
            {
              ...response(id).content[0]!.productDepotInfoList[0],
              depotId: id === 'A' ? 'bim-A' : 'bim-B',
              indexTime: id === 'A' ? 'old label' : 'other label'
            }
          ]
        }
      ]
    });
  });
  const r = await s.execute('compareBasket', {
    ...context,
    items: [
      { id: 'A', quantity: 1 },
      { id: 'B', quantity: 1 }
    ]
  });
  const a = r.meta.offerAssessments as Assessment[],
    sources = r.meta.sources as { retrievedAt: string }[];
  assert.ok(a);
  assert.equal(a[0]?.priceTiming.retrievedAt, sources[0]?.retrievedAt);
  assert.equal(a[1]?.priceTiming.retrievedAt, sources[1]?.retrievedAt);
  assert.notEqual(a[0]?.priceTiming.retrievedAt, a[1]?.priceTiming.retrievedAt);
  const c = r.meta.depotCoverage as Coverage;
  assert.deepEqual(c.unreturnedRequestedDepotIds, []);
  assert.deepEqual(
    c.perProduct.map((p) => p.unreturnedRequestedDepotIds),
    [['bim-B'], ['bim-A']]
  );
  assert.ok((r.meta.warningCodes as string[]).includes('DEPOT_AVAILABILITY_UNKNOWN'));
  metrics(r.meta.requestMetrics, 2, 0);
});

test('empty search and a last partial page never claim complete depot or search coverage', async () => {
  const empty = await service(async () =>
    Response.json({ numberOfFound: 0, searchResultType: 0, content: [] })
  ).execute('search', { ...context, keywords: 'test' });
  const c = empty.meta.depotCoverage as Coverage;
  assert.ok(c);
  assert.deepEqual(c.unreturnedRequestedDepotIds, ['bim-A', 'bim-B']);
  assert.deepEqual(empty.meta.offerAssessments, []);
  const last = await service(async () => Response.json({ ...response(), numberOfFound: 3 })).execute('search', {
    ...context,
    keywords: 'test',
    pages: 2,
    size: 1
  });
  assert.equal((last.meta.pagination as { nextPage: unknown }).nextPage, null);
  assert.ok((last.meta.warningCodes as string[]).includes('PARTIAL_RESULTS'));
});

test('derived offer paths identify the right assessment after sorting duplicate-depot offers', async () => {
  const offer = response().content[0]!.productDepotInfoList[0]!;
  const fixture = {
    ...response(),
    content: [
      {
        ...response().content[0],
        productDepotInfoList: [
          {
            ...offer,
            price: 20,
            discount: false,
            discountlessPrice: 30,
            indexTime: 'expensive label'
          },
          {
            ...offer,
            price: 5,
            discount: false,
            indexTime: 'cheap label'
          },
          {
            ...offer,
            price: 0,
            indexTime: 'unavailable label',
            promotionText: 'raw-unavailable',
            future: { keep: true },
            latitude: 0,
            longitude: 0
          }
        ]
      }
    ]
  };
  const s = service(async () => Response.json(fixture));
  const compared = await s.execute('compareProduct', {
    ...context,
    identity: 'A'
  });
  const refs = compared.meta.offerAssessmentRefs as {
    path: string;
    assessmentIndex: number;
  }[];
  assert.ok(refs, 'derived offers need explicit references to original assessment records');
  assert.deepEqual(refs, [
    { path: '/data/offers/0', assessmentIndex: 1 },
    { path: '/data/offers/1', assessmentIndex: 0 },
    { path: '/data/unavailableOffers/0', assessmentIndex: 2 }
  ]);
  const assessments = compared.meta.offerAssessments as Assessment[];
  assert.equal(assessments[refs[0]!.assessmentIndex]?.priceTiming.upstreamIndexTime, 'cheap label');
  assert.equal(assessments[refs[1]!.assessmentIndex]?.discountAssessment, 'not_indicated');
  const basket = await s.execute('compareBasket', {
    ...context,
    groupBy: 'depot',
    items: [{ id: 'A', quantity: 2 }]
  });
  const unavailable = (
    basket.data as {
      unavailableOffers?: {
        productId: string;
        offer: Record<string, unknown>;
      }[];
    }
  ).unavailableOffers;
  assert.equal(unavailable?.length, 1);
  assert.equal(unavailable?.[0]?.productId, 'A');
  assert.equal(unavailable?.[0]?.offer.promotionText, 'raw-unavailable');
  assert.deepEqual(unavailable?.[0]?.offer.future, { keep: true });
  assert.ok(unavailable?.[0]?.offer.maps);
  assert.deepEqual(basket.meta.offerAssessmentRefs, [
    { path: '/data/unavailableOffers/0/offer', assessmentIndex: 2 },
    { path: '/data/groups/0/lines/0/offer', assessmentIndex: 1 },
    { path: '/data/splitBasket/lines/0/offer', assessmentIndex: 1 }
  ]);
  metrics(compared.meta.requestMetrics, 1, 0);
  metrics(basket.meta.requestMetrics, 1, 0);
});

test('basket schema and arithmetic failures retain attempts made for earlier products', async () => {
  for (const [second, code] of [
    [{ content: [] }, 'INVALID_RESPONSE'],
    [
      {
        ...response('B'),
        content: [
          {
            ...response('B').content[0],
            productDepotInfoList: [
              {
                ...response('B').content[0]!.productDepotInfoList[0],
                price: 1e20
              }
            ]
          }
        ]
      },
      'INVALID_PRICE'
    ]
  ] as const) {
    const s = service(async (_url, init) =>
      Response.json(JSON.parse(String(init?.body)).identity === 'A' ? response() : second)
    );
    await assert.rejects(
      s.execute('compareBasket', {
        ...context,
        items: [
          { id: 'A', quantity: 1 },
          { id: 'B', quantity: 1 }
        ]
      }),
      failure(2, 0, code)
    );
  }
});
