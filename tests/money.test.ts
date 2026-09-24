import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, fromCents } from '../src/money.js';

test('signed monetary output rejects one-cent loss at the numeric precision boundary', () => {
  for (const cents of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])
    assert.throws(() => fromCents(cents), { code: 'INVALID_PRICE' });
  assert.equal(fromCents(Number.MAX_SAFE_INTEGER - 1), 90_071_992_547_409.9);
  assert.equal(fromCents(-1255), -12.55);
});
test('monetary helpers reject invalid input without silently changing its type', () => {
  for (const value of [NaN, Infinity, -Infinity, -1]) assert.throws(() => toCents(value), { code: 'INVALID_PRICE' });
  for (const value of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => fromCents(value), { code: 'INVALID_PRICE' });
  assert.equal(toCents(5e-324), 0);
});
