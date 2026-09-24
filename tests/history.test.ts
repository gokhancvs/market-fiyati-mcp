import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarketService } from '../src/service.js';
import { LiveTransport } from '../src/transport.js';
import { readConfig } from '../src/config.js';

const context = {
  latitude: 0,
  longitude: 0,
  distance: 1,
  depots: ['chain-a']
};
const config = readConfig({
  MARKET_FIYATI_MODE: 'live',
  MARKET_FIYATI_MIN_INTERVAL_MS: '0'
});
type Summary = {
  market: string;
  points: number;
  availablePoints: number;
  missingPoints: number;
  from: string | null;
  to: string | null;
  first: number | null;
  latest: number | null;
  min: number | null;
  max: number | null;
  change: number | null;
  changePercent: number | null;
};
type HistoryOutput = {
  series: {
    name: string;
    extra?: string;
    series: { name: string; value: number | null; note?: string }[];
  }[];
  summary: Summary[];
  dateFilterAppliedLocally: boolean;
};

async function history(data: unknown, filters: Record<string, string> = {}) {
  const bodies: unknown[] = [];
  const transport = new LiveTransport(config, async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(data);
  });
  const result = await new MarketService(transport, config).execute('priceHistory', {
    ...context,
    uniqueId: 'A',
    ...filters
  });
  assert.deepEqual(bodies, [{ ...context, uniqueId: 'A' }]);
  assert.equal((result.meta.requestMetrics as { httpAttempts: number }).httpAttempts, 1);
  return { ...result, data: result.data as HistoryOutput };
}

// Catches rejecting legitimate gaps, treating null as zero, or choosing missing endpoints.
test('history preserves missing days and summarizes only observed prices', async () => {
  const result = await history([
    {
      name: 'test',
      extra: 'retained',
      series: [
        { name: '2026-09-05', value: null },
        { name: '2026-09-04', value: 15 },
        { name: '2026-09-01', value: null, note: 'gap' },
        { name: '2026-09-03', value: null },
        { name: '2026-09-02', value: 10 }
      ]
    }
  ]);
  assert.deepEqual(result.data.summary, [
    {
      market: 'test',
      points: 5,
      availablePoints: 2,
      missingPoints: 3,
      from: '2026-09-02',
      to: '2026-09-04',
      first: 10,
      latest: 15,
      min: 10,
      max: 15,
      change: 5,
      changePercent: 50
    }
  ]);
  assert.deepEqual(result.data.series, [
    {
      name: 'test',
      extra: 'retained',
      series: [
        { name: '2026-09-01', value: null, note: 'gap' },
        { name: '2026-09-02', value: 10 },
        { name: '2026-09-03', value: null },
        { name: '2026-09-04', value: 15 },
        { name: '2026-09-05', value: null }
      ]
    }
  ]);
  assert.ok((result.meta.warningCodes as string[]).includes('HISTORY_MISSING_VALUES'));
  assert.ok((result.meta.warningCodes as string[]).includes('HISTORY_AGGREGATION_UNKNOWN'));
  assert.ok(result.warnings.some((w) => /missing/i.test(w) && /null/i.test(w)));
});

test('all-null history is missing evidence rather than a zero-price trend', async () => {
  const result = await history([
    {
      name: 'test',
      series: [
        { name: '2026-09-01', value: null },
        { name: '2026-09-02', value: null }
      ]
    }
  ]);
  assert.deepEqual(result.data.summary, [
    {
      market: 'test',
      points: 2,
      availablePoints: 0,
      missingPoints: 2,
      from: null,
      to: null,
      first: null,
      latest: null,
      min: null,
      max: null,
      change: null,
      changePercent: null
    }
  ]);
  assert.equal(result.data.series[0]?.series.length, 2);
  assert.ok((result.meta.warningCodes as string[]).includes('HISTORY_MISSING_VALUES'));
});

test('null history outside a local date window neither rejects nor warns on the selected window', async () => {
  const result = await history(
    [
      {
        name: 'test',
        series: [
          { name: '2026-09-01', value: null },
          { name: '2026-09-02', value: 10 },
          { name: '2026-09-03', value: 12 },
          { name: '2026-09-04', value: null }
        ]
      }
    ],
    { from: '2026-09-02', to: '2026-09-03' }
  );
  assert.deepEqual(result.data.summary, [
    {
      market: 'test',
      points: 2,
      availablePoints: 2,
      missingPoints: 0,
      from: '2026-09-02',
      to: '2026-09-03',
      first: 10,
      latest: 12,
      min: 10,
      max: 12,
      change: 2,
      changePercent: 20
    }
  ]);
  assert.deepEqual(result.data.series[0]?.series, [
    { name: '2026-09-02', value: 10 },
    { name: '2026-09-03', value: 12 }
  ]);
  assert.equal(result.data.dateFilterAppliedLocally, true);
  assert.ok(!(result.meta.warningCodes as string[]).includes('HISTORY_MISSING_VALUES'));
});

test('empty history windows carry zero counts and null statistics', async () => {
  const result = await history([{ name: 'test', series: [{ name: '2026-09-01', value: null }] }], {
    from: '2026-09-02'
  });
  assert.deepEqual(result.data.summary, [
    {
      market: 'test',
      points: 0,
      availablePoints: 0,
      missingPoints: 0,
      from: null,
      to: null,
      first: null,
      latest: null,
      min: null,
      max: null,
      change: null,
      changePercent: null
    }
  ]);
  assert.deepEqual(result.data.series[0]?.series, []);
  assert.ok(!(result.meta.warningCodes as string[]).includes('HISTORY_MISSING_VALUES'));
});

test('real zero remains an observed history price with undefined percent change', async () => {
  const result = await history([
    {
      name: 'test',
      series: [
        { name: '2026-09-01', value: null },
        { name: '2026-09-02', value: 0 },
        { name: '2026-09-03', value: 10 }
      ]
    }
  ]);
  assert.deepEqual(result.data.summary, [
    {
      market: 'test',
      points: 3,
      availablePoints: 2,
      missingPoints: 1,
      from: '2026-09-02',
      to: '2026-09-03',
      first: 0,
      latest: 10,
      min: 0,
      max: 10,
      change: 10,
      changePercent: null
    }
  ]);
});

test('history rejects malformed values and absent values rather than coercing them', async () => {
  for (const value of ['32.50', '', false, true, {}, [], undefined, -1]) {
    await assert.rejects(history([{ name: 'test', series: [{ name: '2026-09-01', value }] }]), {
      code: 'INVALID_RESPONSE'
    });
  }
});

test('missing days are counted independently across markets', async () => {
  const result = await history([
    { name: 'a', series: [{ name: '2026-09-01', value: null }] },
    { name: 'b', series: [{ name: '2026-09-01', value: 15 }] },
    { name: 'c', series: [] }
  ]);
  assert.deepEqual(
    result.data.summary.map((s) => [s.market, s.availablePoints, s.missingPoints, s.first, s.change]),
    [
      ['a', 0, 1, null, null],
      ['b', 1, 0, 15, 0],
      ['c', 0, 0, null, null]
    ]
  );
});

// Characterizes observed upstream selection without adding automatic branch requests.
test('a missing multi-depot offer stays unknown until a caller explicitly selects that depot', async () => {
  const bodies: { depots: string[] }[] = [];
  const transport = new LiveTransport(config, async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { depots: string[] };
    bodies.push(body);
    const depotId = body.depots.length === 1 ? 'chain-b' : 'chain-a';
    return Response.json({
      numberOfFound: 1,
      searchResultType: 0,
      facetMap: null,
      content: [
        {
          id: 'A',
          title: 'Test',
          productDepotInfoList: [
            {
              depotId,
              depotName: depotId,
              marketAdi: 'chain',
              price: 10
            }
          ]
        }
      ]
    });
  });
  const service = new MarketService(transport, config);
  const first = await service.execute('product', {
    ...context,
    depots: ['chain-a', 'chain-b'],
    identity: 'A'
  });
  const coverage = first.meta.depotCoverage as {
    unreturnedRequestedDepotIds: string[];
    unreturnedStatus: string;
  };
  assert.deepEqual(coverage.unreturnedRequestedDepotIds, ['chain-b']);
  assert.equal(coverage.unreturnedStatus, 'unknown');
  assert.equal(bodies.length, 1);
  const second = await service.execute('product', {
    ...context,
    depots: ['chain-b'],
    identity: 'A'
  });
  assert.deepEqual(
    bodies.map((b) => b.depots),
    [['chain-a', 'chain-b'], ['chain-b']]
  );
  assert.deepEqual((second.meta.depotCoverage as { returnedDepotIds: string[] }).returnedDepotIds, ['chain-b']);
  for (const result of [first, second])
    assert.equal((result.meta.requestMetrics as { httpAttempts: number }).httpAttempts, 1);
});
