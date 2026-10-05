import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AppError, MAX_DIAGNOSTIC_CHARS, reportInternalError } from '../src/errors.js';
import { MarketService } from '../src/service.js';
import { createServer } from '../src/server.js';
import { OfflineTransport, type Transport } from '../src/transport.js';
import { readConfig } from '../src/config.js';

function captureStderr(t: TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

test('internal error report is one bounded JSON line with the stack', () => {
  const lines: string[] = [];
  const error = new TypeError(`broken ${'x'.repeat(MAX_DIAGNOSTIC_CHARS)}`);
  reportInternalError(error, (line) => lines.push(line));
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.endsWith('\n'));
  const entry = JSON.parse(lines[0]!) as { code: string; detail: string };
  assert.equal(entry.code, 'INTERNAL_ERROR');
  assert.match(entry.detail, /^TypeError: broken/);
  assert.equal(entry.detail.length, MAX_DIAGNOSTIC_CHARS);
});

test('internal error report skips application errors and survives odd throws', () => {
  const lines: string[] = [];
  reportInternalError(new AppError('HTTP_ERROR', 'HTTP failure.'), (line) => lines.push(line));
  assert.equal(lines.length, 0);
  reportInternalError('plain text', (line) => lines.push(line));
  reportInternalError(
    {
      toString() {
        throw new Error('no');
      }
    },
    (line) => lines.push(line)
  );
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).detail),
    ['plain text', 'Unprintable thrown value.']
  );
});

test('a failing diagnostics writer never replaces the original failure', async (t) => {
  assert.doesNotThrow(() =>
    reportInternalError(new Error('defect'), () => {
      throw new Error('stderr closed');
    })
  );
  t.mock.method(process.stderr, 'write', () => {
    throw new Error('stderr closed');
  });
  const transport: Transport = {
    mode: 'live',
    async request() {
      throw new TypeError('defect behind closed stderr');
    }
  };
  await assert.rejects(new MarketService(transport, readConfig({})).execute('categories', {}), {
    code: 'INTERNAL_ERROR'
  });
});

test('service logs an unexpected transport failure once and returns a generic error', async (t) => {
  const transport: Transport = {
    mode: 'live',
    async request() {
      throw new TypeError('service-side defect');
    }
  };
  const service = new MarketService(transport, readConfig({ MARKET_FIYATI_MODE: 'live' }));
  const lines = captureStderr(t);
  await assert.rejects(service.execute('categories', {}), (error: AppError) => {
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.equal(error.message, 'Unexpected internal error.');
    return true;
  });
  assert.equal(lines.length, 1);
  assert.match(JSON.parse(lines[0]!).detail, /TypeError: service-side defect/);
});

test('server logs an unexpected tool failure while the result hides it', async (t) => {
  class FailingService extends MarketService {
    override async execute(): Promise<never> {
      throw new Error('server-side defect');
    }
  }
  const server = createServer(new FailingService(new OfflineTransport(), readConfig({})));
  const client = new Client({ name: 'diagnostics-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const lines = captureStderr(t);
    const result = (await client.callTool({ name: 'market_status', arguments: {} })) as CallToolResult;
    assert.equal((result.structuredContent!.error as { code: string }).code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(result).includes('server-side defect'));
    assert.equal(lines.length, 1);
    assert.match(JSON.parse(lines[0]!).detail, /Error: server-side defect/);
  } finally {
    await client.close();
    await server.close();
  }
});

test('a real service failure through the MCP server is logged exactly once', async (t) => {
  const transport: Transport = {
    mode: 'live',
    async request() {
      throw new TypeError('end-to-end defect');
    }
  };
  const server = createServer(new MarketService(transport, readConfig({})));
  const client = new Client({ name: 'diagnostics-e2e-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const lines = captureStderr(t);
    const result = (await client.callTool({ name: 'market_get_categories', arguments: {} })) as CallToolResult;
    assert.equal((result.structuredContent!.error as { code: string }).code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(result).includes('end-to-end defect'));
    assert.equal(lines.length, 1);
    assert.match(JSON.parse(lines[0]!).detail, /TypeError: end-to-end defect/);
  } finally {
    await client.close();
    await server.close();
  }
});
