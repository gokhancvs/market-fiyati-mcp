import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/sdk/shared/stdio.js';
import {
  InputBudget,
  assertMessageBudget,
  assertOutputBudget,
  RESOURCE_LIMITS,
  toolMessageBytes
} from '../src/resource-limits.js';

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

test('tool result message size covers the JSON-RPC line an SDK stdio client must buffer', () => {
  assert.ok(RESOURCE_LIMITS.messageBytes < STDIO_DEFAULT_MAX_BUFFER_SIZE, 'stay below the SDK stdio read buffer');
  for (const envelope of [
    { data: null, meta: {}, warnings: [] },
    {
      data: { text: 'Türkçe 😀 "quoted" \\ back\nline \u0000 \ud800 \u2028\u2029' },
      meta: { n: [1, 2] },
      warnings: ['"']
    }
  ]) {
    const text = JSON.stringify(envelope);
    for (const isError of [undefined, true]) {
      const line = `${JSON.stringify({
        result: { content: [{ type: 'text', text }], structuredContent: envelope, ...(isError ? { isError } : {}) },
        jsonrpc: '2.0',
        // Allowance covers numeric ids and string ids up to ~150 characters; longer ids fit the 1 MiB margin.
        id: 'r'.repeat(100)
      })}\n`;
      const actual = Buffer.byteLength(line);
      assert.ok(toolMessageBytes(text) >= actual, 'never underestimate');
      assert.ok(toolMessageBytes(text) - actual <= 256, 'only a small fixed protocol allowance');
    }
  }
});

test('message budget rejects escaped duplication beyond the limit and keeps request metrics', () => {
  const metrics = { httpAttempts: 1, retries: 0, durationMs: 5 };
  // JSON.stringify(plain) adds two quotes, which are escaped again in the text field.
  const atLimit = 'x'.repeat((RESOURCE_LIMITS.messageBytes - 264) / 2);
  assert.equal(toolMessageBytes(JSON.stringify(atLimit)), RESOURCE_LIMITS.messageBytes);
  assertMessageBudget(JSON.stringify(atLimit), metrics);
  assert.throws(() => assertMessageBudget(JSON.stringify(`${atLimit}x`), metrics), { code: 'OUTPUT_TOO_LARGE' });
  const quoted = '"'.repeat(Math.ceil(RESOURCE_LIMITS.messageBytes / 6));
  assert.ok(
    Buffer.byteLength(JSON.stringify(quoted)) < RESOURCE_LIMITS.outputBytes,
    'envelope budget alone would pass'
  );
  assert.throws(
    () => assertMessageBudget(JSON.stringify(quoted), metrics),
    (error: unknown) => {
      const failure = error as { code: string; details: Record<string, unknown>; requestMetrics: unknown };
      assert.equal(failure.code, 'OUTPUT_TOO_LARGE');
      assert.deepEqual(failure.details, { resource: 'messageBytes', limit: RESOURCE_LIMITS.messageBytes });
      assert.deepEqual(failure.requestMetrics, metrics);
      return true;
    }
  );
});
