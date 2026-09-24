import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareOffers, compareBasket, summarizeHistory, filterCategories } from '../src/analysis.js';
import type { Product, Offer } from '../src/contracts.js';

const offer = (marketAdi: string, depotId: string, price: number): Offer => ({
  marketAdi,
  depotId,
  depotName: depotId,
  price
});
const product = (id: string, offers: Offer[]): Product => ({
  id,
  title: id,
  productDepotInfoList: offers
});
test('basket uses cents, deduplicates offers and does not count missing products as free', () => {
  const items = [
    { id: 'A', quantity: 3 },
    { id: 'B', quantity: 1 }
  ];
  const products = [
    product('A', [offer('bim', 'bim-1', 0.1), offer('bim', 'bim-2', 0.2), offer('sok', 'sok-1', 0.05)]),
    product('B', [offer('bim', 'bim-1', 0.2)])
  ];
  const result = compareBasket(items, products, 'market');
  assert.equal(result.groups[0]?.id, 'bim');
  assert.equal(result.groups[0]?.total, 0.5);
  assert.equal(result.groups[0]?.lines.length, 2);
  const incomplete = result.groups.find((g) => g.id === 'sok')!;
  assert.equal(incomplete.total, null);
  assert.equal(incomplete.subtotal, 0.15);
  assert.deepEqual(incomplete.missingProductIds, ['B']);
  assert.equal(result.splitBasket.total, 0.35);
});
test('separate branch baskets never combine different branches into one store', () => {
  const items = [
    { id: 'A', quantity: 1 },
    { id: 'B', quantity: 1 }
  ];
  const products = [product('A', [offer('bim', 'bim-1', 10)]), product('B', [offer('bim', 'bim-2', 20)])];
  const branches = compareBasket(items, products, 'depot');
  assert.equal(branches.groups.length, 2);
  assert.ok(branches.groups.every((g) => !g.complete && g.total === null));
  const market = compareBasket(items, products, 'market');
  assert.equal(market.groups[0]?.total, 30);
  assert.equal(market.groups[0]?.requiresMultipleDepots, true);
});
test('complete baskets retain every tied minimum group even when individual prices differ', () => {
  const items = [
    { id: 'potato', quantity: 1 },
    { id: 'yogurt', quantity: 1 }
  ];
  const products = [
    product('potato', [offer('a', 'a-1', 30), offer('b', 'b-1', 40), offer('c', 'c-1', 1)]),
    product('yogurt', [offer('a', 'a-1', 130), offer('b', 'b-1', 120)])
  ];
  for (const groupBy of ['market', 'depot'] as const) {
    const result = compareBasket(items, products, groupBy);
    assert.deepEqual(
      result.groups.map((g) => ({
        id: g.id,
        total: g.total,
        complete: g.complete
      })),
      [
        { id: groupBy === 'market' ? 'a' : 'a-1', total: 160, complete: true },
        { id: groupBy === 'market' ? 'b' : 'b-1', total: 160, complete: true },
        {
          id: groupBy === 'market' ? 'c' : 'c-1',
          total: null,
          complete: false
        }
      ]
    );
    assert.ok(result.groups.slice(0, 2).every((g) => g.lines.length === 2 && !g.requiresMultipleDepots));
  }
});
test('equal-price ties prefer a shared cheapest depot instead of unnecessary trips', () => {
  const items = [
    { id: 'A', quantity: 1 },
    { id: 'B', quantity: 1 }
  ];
  const products = [
    product('A', [offer('bim', 'bim-1', 10), offer('bim', 'bim-2', 10)]),
    product('B', [offer('bim', 'bim-2', 20)])
  ];
  const result = compareBasket(items, products, 'market');
  assert.equal(result.groups[0]?.total, 30);
  assert.equal(result.groups[0]?.requiresMultipleDepots, false);
  assert.ok(result.groups[0]?.lines.every((line) => line.offer.depotId === 'bim-2'));
  assert.equal(result.splitBasket.requiresMultipleDepots, false);
  const noCommon = compareBasket(
    items,
    [product('A', [offer('bim', 'bim-1', 9), offer('bim', 'bim-2', 10)]), products[1]!],
    'market'
  );
  assert.equal(noCommon.groups[0]?.total, 29);
  assert.equal(noCommon.groups[0]?.requiresMultipleDepots, true);
});
test('basket ties use the same deterministic depot order with and without a shared depot', () => {
  const tied = product('A', [offer('chain', 'a', 10), offer('chain', 'B', 10)]);
  for (const offers of [tied.productDepotInfoList, [...tied.productDepotInfoList].reverse()]) {
    const a = { ...tied, productDepotInfoList: offers };
    const one = compareBasket([{ id: 'A', quantity: 1 }], [a], 'market');
    const two = compareBasket(
      [
        { id: 'A', quantity: 1 },
        { id: 'C', quantity: 1 }
      ],
      [a, product('C', [offer('chain', 'c', 20)])],
      'market'
    );
    for (const result of [one, two]) {
      assert.equal(result.groups[0]?.lines[0]?.offer.depotId, 'B');
      assert.equal(result.splitBasket.lines[0]?.offer.depotId, 'B');
    }
    assert.equal(one.splitBasket.total, 10);
    assert.equal(two.splitBasket.total, 30);
    assert.equal(two.splitBasket.requiresMultipleDepots, true);
  }
});
test('equal-price basket groups use code-unit IDs and retain the first duplicate offer', () => {
  const first = offer('B', 'B', 10),
    duplicate = offer('B', 'B', 10);
  const offers = [offer('a', 'a', 10), first, duplicate];
  for (const groupBy of ['market', 'depot'] as const) {
    const result = compareBasket([{ id: 'A', quantity: 1 }], [product('A', offers)], groupBy);
    assert.deepEqual(
      result.groups.map((group) => group.id),
      ['B', 'a']
    );
    assert.equal(result.groups[0]?.lines[0]?.offer, first);
  }
});
test('missing identities, no offers and zero prices remain explicit', () => {
  const empty = compareBasket([{ id: 'missing', quantity: 1 }], [], 'market');
  assert.equal(empty.splitBasket.total, null);
  assert.deepEqual(empty.missingProductIds, ['missing']);
  const zero = compareOffers(product('A', [offer('bim', 'bim-1', 0), offer('sok', 'sok-1', 10)]));
  assert.equal(zero.cheapestPrice, 10);
  assert.equal(zero.unavailableOffers.length, 1);
  assert.equal(compareOffers(product('A', [])).cheapestPrice, null);
});
test('basket preserves unusable selected offers once without changing totals', () => {
  const zero = {
    ...offer('bim', 'bim-1', 0),
    promotionText: 'raw-zero',
    future: { keep: true }
  };
  const sub = offer('bim', 'bim-1', 0.001),
    outside = offer('bim', 'bim-out', 0);
  const products = [product('A', [zero, sub, { ...zero }, outside]), product('B', [offer('bim', 'bim-1', 5)])];
  const items = [
    { id: 'A', quantity: 1 },
    { id: 'B', quantity: 2 },
    { id: 'M', quantity: 1 }
  ];
  for (const groupBy of ['market', 'depot'] as const) {
    const result = compareBasket(items, products, groupBy, undefined, new Set(['bim-1']));
    assert.ok('unavailableOffers' in result);
    assert.deepEqual(
      result.unavailableOffers,
      products[0]!.productDepotInfoList.slice(0, 3).map((offer) => ({ productId: 'A', offer }))
    );
    assert.deepEqual(result.outOfScopeOffers, [{ productId: 'A', offer: outside }]);
    assert.deepEqual(result.missingProductIds, ['M']);
    assert.deepEqual(result.groups[0]?.missingProductIds, ['A', 'M']);
    assert.equal(result.groups[0]?.total, null);
    assert.equal(result.groups[0]?.subtotal, 10);
    assert.equal(result.splitBasket.total, null);
    assert.equal(result.splitBasket.subtotal, 10);
    assert.ok(!Object.hasOwn(result.groups[0]!, 'unavailableOffers'));
  }
});
test('offer comparison preserves discount semantics and rounds money only', () => {
  const result = compareOffers(
    product('A', [{ ...offer('bim', 'bim-1', 10), percentage: 25, discount: false }, offer('sok', 'sok-1', 12.55)])
  );
  assert.equal(result.offers[0]?.discount, false);
  assert.equal(result.offers[1]?.savingIfCheapest, 2.55);
  assert.equal(result.priceSpread, 2.55);
});

test('positive sub-cent offers cannot create a free complete basket', () => {
  for (const price of [0.001, 1e-7, 0]) {
    const p = product('A', [offer('bim', 'bim-1', price)]);
    const compared = compareOffers(p);
    assert.equal(compared.cheapestPrice, null);
    assert.equal(compared.unavailableOffers[0]?.price, price);
    assert.equal(compareBasket([{ id: 'A', quantity: 50 }], [p], 'market').splitBasket.total, null);
  }
});

test('money is rounded decimal half-up before multiplying quantities', () => {
  for (const [price, expected] of [
    [10.075, 10.08],
    [20.075, 20.08],
    [0.005, 0.01],
    [1.005, 1.01],
    [1e-2, 0.01],
    [12.55, 12.55]
  ] as const) {
    const p = product('A', [{ ...offer('bim', 'bim-1', price), unitPriceValue: 1.2345 }]);
    const compared = compareOffers(p);
    assert.equal(compared.cheapestPrice, expected);
    assert.equal(compared.offers[0]?.price, price);
    assert.equal(compared.offers[0]?.unitPriceValue, 1.2345);
  }
  const p = product('A', [offer('bim', 'bim-1', 0.005)]);
  assert.equal(compareBasket([{ id: 'A', quantity: 50 }], [p], 'market').splitBasket.total, 0.5);
  const history = [
    {
      name: 'bim',
      series: [
        { name: '2026-09-01', value: 20.075 },
        { name: '2026-09-02', value: 10.075 }
      ]
    }
  ];
  assert.equal(summarizeHistory(history).summary[0]?.change, -10);
});

test('money rejects unsafe prices, line totals and aggregate totals', () => {
  assert.throws(() => compareOffers(product('A', [offer('bim', 'bim-1', 1e100)])), {
    code: 'INVALID_PRICE'
  });
  const high = product('A', [offer('bim', 'bim-1', 50_000_000_000_000)]);
  assert.throws(() => compareBasket([{ id: 'A', quantity: 50 }], [high], 'market'), {
    code: 'INVALID_PRICE'
  });
  assert.throws(
    () =>
      compareBasket(
        [
          { id: 'A', quantity: 1 },
          { id: 'B', quantity: 1 }
        ],
        [high, { ...high, id: 'B' }],
        'market'
      ),
    { code: 'INVALID_PRICE' }
  );
});
test('history percent uses normalized cents including a zero baseline', () => {
  const history = [
    {
      name: 'bim',
      series: [
        { name: '2026-09-01', value: 0.004 },
        { name: '2026-09-02', value: 0.005 }
      ]
    }
  ];
  assert.equal(summarizeHistory(history).summary[0]?.changePercent, null);
  const rounded = [
    {
      name: 'bim',
      series: [
        { name: '2026-09-01', value: 0.015 },
        { name: '2026-09-02', value: 0.025 }
      ]
    }
  ];
  assert.equal(summarizeHistory(rounded).summary[0]?.changePercent, 50);
});
test('valid cent totals cannot silently lose precision when converted back to numbers', () => {
  const products = [
    product('A', [offer('bim', 'bim-1', 90_071_992_547_409.9)]),
    product('B', [offer('bim', 'bim-1', 0.01)])
  ];
  assert.throws(
    () =>
      compareBasket(
        [
          { id: 'A', quantity: 1 },
          { id: 'B', quantity: 1 }
        ],
        products,
        'market'
      ),
    { code: 'INVALID_PRICE' }
  );
});
test('history is sorted, filtered locally, and handles zero baseline or empty window', () => {
  const history = [
    {
      name: 'bim',
      series: [
        { name: '2026-09-03', value: 15 },
        { name: '2026-09-01', value: 0 },
        { name: '2026-09-02', value: 10 }
      ]
    }
  ];
  assert.equal(summarizeHistory(history).summary[0]?.changePercent, null);
  const filtered = summarizeHistory(history, '2026-09-02', '2026-09-03');
  assert.equal(filtered.summary[0]?.changePercent, 50);
  assert.equal(filtered.summary[0]?.min, 10);
  assert.equal(summarizeHistory(history, '2027-01-01').summary[0]?.latest, null);
});
test('history extrema handle a large series without argument-stack overflow', () => {
  const history = [
    {
      name: 'bim',
      series: Array.from({ length: 130_000 }, (_, i) => ({
        name: '2026-09-01',
        value: i % 2 ? 20 : 10
      }))
    }
  ];
  assert.ok(Buffer.byteLength(JSON.stringify(history)) < 5 * 1024 * 1024);
  const summary = summarizeHistory(history).summary[0]!;
  assert.equal(summary.points, 130_000);
  assert.equal(summary.min, 10);
  assert.equal(summary.max, 20);
});
test('category queries preserve hierarchy and use Turkish case folding', () => {
  const categories = [
    {
      id: 1,
      parentId: null,
      name: 'Gıda',
      children: [
        {
          id: 2,
          parentId: 1,
          name: 'Ispanak',
          children: []
        }
      ]
    }
  ];
  const flat = filterCategories(categories, { flat: true, query: 'ıspanak' });
  assert.equal(flat.length, 1);
  assert.equal(flat[0]?.name, 'Ispanak');
  assert.equal(filterCategories(categories, { flat: false, query: 'ıspanak' })[0]?.name, 'Gıda');
  assert.equal(filterCategories(categories, { flat: false, parentId: 1 })[0]?.id, 2);
});

test('basket work grows near-linearly for distinct depots and disjoint minimum-price ties', (t) => {
  for (const groupBy of ['depot', 'market'] as const) {
    const measure = (size: number) => {
      let reads = 0;
      const offers = (prefix: string) =>
        Array.from({ length: size }, (_, i) => ({
          marketAdi: 'chain',
          get depotId() {
            reads++;
            return `${prefix}-${String(i).padStart(5, '0')}`;
          },
          depotName: 'Synthetic',
          price: 10.075
        }));
      const result = compareBasket(
        [
          { id: 'A', quantity: 2 },
          { id: 'B', quantity: 1 }
        ],
        [product('A', offers('a')), product('B', offers('b'))],
        groupBy
      );
      assert.equal(result.splitBasket.total, 30.24);
      assert.equal(result.splitBasket.requiresMultipleDepots, true);
      assert.equal(result.groups.length, groupBy === 'depot' ? 2 * size : 1);
      assert.ok(result.groups.every((g) => (groupBy === 'depot' ? g.total === null : g.total === 30.24)));
      return reads;
    };
    const small = measure(200),
      large = measure(800);
    t.diagnostic(`${groupBy}: 200=${small} reads, 800=${large} reads`);
    assert.ok(large <= small * 6, `${groupBy} should not repeatedly rescan every offer: ${small} -> ${large}`);
  }
});
