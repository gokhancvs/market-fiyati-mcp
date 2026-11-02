import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { outputSchema } from '../src/output-schemas.js';
import { readToolOutput, testOutputSchemas } from './output-reader.js';

const expected = outputSchema.extend({ data: z.looseObject({ mode: z.literal('offline') }) });
const valid = { data: { mode: 'offline', future: true }, meta: {}, warnings: [] };

test('MCP output reader rejects missing structured content at the boundary', () => {
  assert.throws(() => readToolOutput({ content: [] }, expected), z.ZodError);
});

test('MCP output reader rejects null data and malformed required fields', () => {
  for (const data of [null, {}, { mode: 42 }]) {
    assert.throws(
      () => readToolOutput({ content: [], structuredContent: { ...valid, data } }, expected),
      (error: unknown) => error instanceof z.ZodError && error.issues.some((issue) => issue.path[0] === 'data')
    );
  }
});

test('MCP output reader validates the protocol result and preserves allowed extensions', () => {
  assert.throws(
    () => readToolOutput({ content: [{ type: 'text', text: 42 }], structuredContent: valid }, expected),
    z.ZodError
  );
  assert.deepEqual(readToolOutput({ content: [], structuredContent: valid }, expected), valid);
});

test('application error output requires an error and numeric request metrics', () => {
  const failure = {
    data: null,
    meta: { requestMetrics: { httpAttempts: 1, retries: 0, durationMs: 5 } },
    warnings: [],
    error: { code: 'HTTP_ERROR', status: 422, syntheticAcceptance: true }
  };
  const parsed = readToolOutput({ content: [], structuredContent: failure }, testOutputSchemas.error);
  assert.equal(parsed.error.code, 'HTTP_ERROR');
  assert.equal(parsed.meta.requestMetrics.httpAttempts, 1);
  for (const malformed of [
    { ...failure, error: undefined },
    { ...failure, error: { code: 422 } },
    { ...failure, meta: { requestMetrics: { httpAttempts: '1', retries: 0, durationMs: 5 } } }
  ]) {
    assert.throws(
      () => readToolOutput({ content: [], structuredContent: malformed }, testOutputSchemas.error),
      z.ZodError
    );
  }
});
