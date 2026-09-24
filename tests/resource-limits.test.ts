import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputBudget, assertOutputBudget, RESOURCE_LIMITS } from '../src/resource-limits.js';

test('input byte accounting matches JSON escaping and UTF-8 exactly at its boundary', () => {
  for (const value of [
    'plain',
    '"\\\b\f\n\r\t\0',
    'Türkçe',
    '😀',
    '\ud800',
    '\udfff',
    { a: [true, false, null, 0, 1e100, -0, '😀'], omitted: undefined },
    [undefined]
  ]) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    new InputBudget(bytes).accept(value);
    assert.throws(() => new InputBudget(bytes - 1).accept(value), {
      code: 'RESOURCE_LIMIT_EXCEEDED'
    });
  }
});

test('output accounting stops before visiting the tail of an oversized object', () => {
  const oversized = {
    first: 'x'.repeat(RESOURCE_LIMITS.outputBytes),
    get tail() {
      return assert.fail('the remaining output must not be traversed after budget exhaustion');
    }
  };
  assert.throws(() => assertOutputBudget(oversized), {
    code: 'OUTPUT_TOO_LARGE'
  });
  assertOutputBudget('x'.repeat(RESOURCE_LIMITS.outputBytes - 2));
  assert.throws(() => assertOutputBudget('x'.repeat(RESOURCE_LIMITS.outputBytes - 1)), {
    code: 'OUTPUT_TOO_LARGE'
  });
});

test('warning and offer limits accumulate across sources without reading rejected arrays', () => {
  const budget = new InputBudget(5 * 1024 * 1024);
  budget.accept({
    warnings: Array.from({ length: 128 }, () => ''),
    content: []
  });
  assert.throws(() => budget.accept({ warnings: ['last'] }), {
    code: 'RESOURCE_LIMIT_EXCEEDED'
  });
  const offers = new InputBudget(5 * 1024 * 1024);
  offers.accept({
    content: [{ productDepotInfoList: Array.from({ length: 6000 }, () => null) }]
  });
  assert.throws(
    () =>
      offers.accept({
        content: [{ productDepotInfoList: Array.from({ length: 4001 }, () => null) }]
      }),
    { code: 'RESOURCE_LIMIT_EXCEEDED' }
  );
});

test('source budgeting rejects nonfinite decoded JSON before visiting later fields', () => {
  for (const number of [Infinity, -Infinity, NaN]) {
    const data = {
      number,
      get tail() {
        return assert.fail('nonfinite input must stop traversal');
      }
    };
    assert.throws(() => new InputBudget(1024).accept(data), {
      code: 'RESOURCE_LIMIT_EXCEEDED'
    });
  }
});
