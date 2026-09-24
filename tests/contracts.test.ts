import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemas, validateResponse } from '../src/contracts.js';

const context = {
  latitude: 41,
  longitude: 29,
  distance: 1,
  depots: ['bim-test']
};
test('search requires explicit location and selected depots', () => {
  assert.throws(() => schemas.search.parse({ keywords: 'süt' }));
  assert.throws(() => schemas.search.parse({ ...context, depots: [], keywords: 'süt' }));
  const value = schemas.search.parse({ ...context, keywords: ' süt ' });
  assert.equal(value.keywords, 'süt');
  assert.equal(value.pages, 0);
  assert.equal(value.size, 25);
});
test('rejects invalid coordinates, unknown fields and unbounded paging', () => {
  for (const bad of [
    { latitude: 91 },
    { longitude: -181 },
    { size: 101 },
    { pages: -1 },
    { distance: 0 },
    { keywords: '   ' },
    { url: 'https://other.test' },
    { depots: ['a', 'a'] }
  ]) {
    assert.throws(() => schemas.search.parse({ ...context, keywords: 'x', ...bad }));
  }
});
test('category search requires at least one actual category', () => {
  assert.throws(() => schemas.searchByCategories.parse(context));
  assert.throws(() => schemas.searchByCategories.parse({ ...context, menu_category: [] }));
  assert.deepEqual(schemas.searchByCategories.parse({ ...context, sub_category: ['Patates'] }).sub_category, [
    'Patates'
  ]);
});
test('wire sort and price filter match JS, reject inverted ranges', () => {
  assert.doesNotThrow(() =>
    schemas.search.parse({
      ...context,
      keywords: 'yoğurt',
      order: { name: 'offer_unit_price', type: 'asc' },
      offer_price: ['10-20', '100+']
    })
  );
  for (const range of ['20-10', 'abc', '-1-20']) {
    assert.throws(() => schemas.search.parse({ ...context, keywords: 'x', offer_price: [range] }));
  }
});
test('frontend open-ended custom range uses star and discount uses string true', () => {
  assert.doesNotThrow(() =>
    schemas.search.parse({
      ...context,
      keywords: 'x',
      offer_price: ['100-*'],
      offer_discount: ['true']
    })
  );
  assert.throws(() =>
    schemas.search.parse({
      ...context,
      keywords: 'x',
      offer_discount: ['yes']
    })
  );
});
test('validates required upstream fields while preserving future fields', () => {
  const data = {
    numberOfFound: 1,
    searchResultType: 1,
    facetMap: null,
    future: true,
    content: [
      {
        id: 'A',
        title: 'Süt',
        extra: 'keep',
        productDepotInfoList: []
      }
    ]
  };
  assert.deepEqual(validateResponse('search', data), data);
  assert.throws(() => validateResponse('search', { ...data, content: [{ id: 2 }] }), {
    code: 'INVALID_RESPONSE'
  });
  assert.throws(() => validateResponse('priceHistory', [{ name: 'bim', series: [{ name: 'bad', value: '9' }] }]), {
    code: 'INVALID_RESPONSE'
  });
});

test('malformed response diagnostics never copy long upstream keys', () => {
  const key = 'x'.repeat(100_000);
  const data = {
    numberOfFound: 0,
    searchResultType: 0,
    content: [],
    facetMap: { [key]: Array(10).fill(Infinity) }
  };
  assert.throws(
    () => validateResponse('search', data),
    (error: unknown) => {
      const e = error as { code: string; details: unknown };
      assert.equal(e.code, 'INVALID_RESPONSE');
      assert.ok(Buffer.byteLength(JSON.stringify(e.details)) < 2048, 'diagnostics must stay small');
      return true;
    }
  );
});

test('response validation stops at the first malformed row rather than collecting the tail', () => {
  const tail = {
    get name() {
      return assert.fail('must not validate rows after the first invalid row');
    }
  };
  for (const [endpoint, data] of [
    ['priceHistory', [null, tail]],
    ['categories', { content: [null, tail] }],
    [
      'nearest',
      [
        null,
        {
          get id() {
            return assert.fail('must not visit subsequent depots');
          }
        }
      ]
    ],
    [
      'geocode',
      [
        null,
        [
          {
            get nested() {
              return assert.fail('must not visit subsequent tuples');
            }
          }
        ]
      ]
    ]
  ] as const)
    assert.throws(() => validateResponse(endpoint, data), {
      code: 'INVALID_RESPONSE'
    });
});

test('valid long facet keys, nested JSON and future fields remain intact', () => {
  const key = 'a'.repeat(100_000);
  const data = {
    numberOfFound: 0,
    searchResultType: 0,
    content: [],
    facetMap: {
      [key]: [{ nested: [null, true, 12.5, 'text', { future: 'keep' }] }]
    },
    future: { [key]: 'retained' }
  };
  assert.deepEqual(validateResponse('search', data), data);
});

test('finite malformed facet containers produce bounded diagnostics', () => {
  const key = 'x'.repeat(900_000);
  const data = {
    numberOfFound: 0,
    searchResultType: 0,
    content: [],
    facetMap: { [key]: { bad: true } }
  };
  assert.throws(
    () => validateResponse('search', data),
    (error: unknown) => {
      const e = error as { code: string; details: unknown };
      assert.equal(e.code, 'INVALID_RESPONSE');
      assert.ok(Buffer.byteLength(JSON.stringify(e.details)) < 2048);
      assert.ok(!JSON.stringify(e.details).includes(key));
      return true;
    }
  );
});

test('nested JSON stops before a later getter', () => {
  const tail = {
    get later() {
      return assert.fail('tail visited');
    }
  };
  assert.throws(() => validateResponse('reverseGeocode', { bad: [Infinity, tail] }), {
    code: 'INVALID_RESPONSE'
  });
});

test('malformed product arrays stop before the next row', () => {
  const tail = {
    get id() {
      return assert.fail('tail product visited');
    }
  };
  assert.throws(
    () =>
      validateResponse('search', {
        numberOfFound: 2,
        searchResultType: 0,
        content: [null, tail]
      }),
    { code: 'INVALID_RESPONSE' }
  );
});

test('blank chain keys are rejected without normalizing valid source values', () => {
  const responseFor = (marketAdi: string) => ({
    numberOfFound: 1,
    searchResultType: 0,
    content: [
      {
        id: 'A',
        title: 'A',
        productDepotInfoList: [
          {
            depotId: 'chain-test',
            depotName: 'Test',
            marketAdi,
            price: 10
          }
        ]
      }
    ]
  });
  for (const endpoint of ['search', 'searchByCategories', 'product', 'similar', 'alternative', 'sync'] as const) {
    for (const value of ['', ' ', '\t\n', '\u00a0'])
      assert.throws(() => validateResponse(endpoint, responseFor(value)), {
        code: 'INVALID_RESPONSE'
      });
    const source = responseFor(' chain ');
    assert.deepEqual(validateResponse(endpoint, source), source);
  }
});

test('response total cannot be less than its returned product count', () => {
  const data = {
    numberOfFound: 0,
    searchResultType: 0,
    content: [{ id: 'A', title: 'A', productDepotInfoList: [] }]
  };
  for (const endpoint of ['search', 'searchByCategories', 'product', 'similar', 'alternative', 'sync'] as const)
    assert.throws(() => validateResponse(endpoint, data), {
      code: 'INVALID_RESPONSE'
    });
});
