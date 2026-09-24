import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const context = {
  latitude: 0,
  longitude: 0,
  distance: 1,
  depots: ['test-a1', 'test-a2', 'test-b1', 'test-c1']
};
const entry = 'tests/fixtures/acceptance-server.mjs';
async function withClient(scenario: string, run: (client: Client) => Promise<void>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, scenario],
    env: { MARKET_FIYATI_MODE: 'offline' },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'acceptance-test', version: '1' });
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close();
  }
}

test(
  'offline synthetic stdio client sees scoped basket totals and a visible acceptance marker',
  { timeout: 5000 },
  async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: { MARKET_FIYATI_MODE: 'offline' },
      stderr: 'pipe'
    });
    const client = new Client({ name: 'acceptance-test', version: '1' });
    try {
      await client.connect(transport);
      const status = (await client.callTool({
        name: 'market_status',
        arguments: {}
      })) as CallToolResult;
      assert.equal((status.structuredContent?.data as { mode: string }).mode, 'offline');
      assert.match(JSON.stringify(status.structuredContent), /synthetic acceptance/i);
      const result = (await client.callTool({
        name: 'market_compare_basket',
        arguments: {
          ...context,
          items: [
            { id: 'test-milk-1l', quantity: 1 },
            { id: 'test-yogurt-1kg', quantity: 1 }
          ]
        }
      })) as CallToolResult;
      assert.equal(result.isError, undefined);
      assert.match(JSON.stringify(result.structuredContent), /synthetic acceptance/i);
      const data = result.structuredContent?.data as {
        groups: {
          id: string;
          total: number | null;
          requiresMultipleDepots: boolean;
        }[];
        splitBasket: { total: number };
        outOfScopeOffers: { offer: { depotId: string } }[];
      };
      assert.equal(data.groups.find((g) => g.id === 'Test A')?.total, 70);
      assert.equal(data.groups.find((g) => g.id === 'Test A')?.requiresMultipleDepots, true);
      assert.equal(data.groups.find((g) => g.id === 'Test B')?.total, 70);
      assert.equal(data.groups.find((g) => g.id === 'Test C')?.total, null);
      assert.equal(data.splitBasket.total, 50);
      assert.deepEqual(
        data.outOfScopeOffers.map((o) => o.offer.depotId),
        ['test-outside', 'test-outside']
      );
    } finally {
      await client.close();
    }
  }
);

test('live mode and unknown scenarios refuse before MCP connects', { timeout: 5000 }, async () => {
  for (const [mode, scenario] of [
    ['live', 'shopping'],
    ['offline', 'unknown']
  ] as const) {
    const child = spawn(process.execPath, [entry, scenario], {
      env: { ...process.env, MARKET_FIYATI_MODE: mode }
    });
    let stderr = '',
      stdout = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    try {
      const [code] = await once(child, 'exit');
      assert.equal(code, 1);
      assert.equal(stdout, '');
      assert.match(stderr, /CONFIG_ERROR/);
      assert.doesNotMatch(stderr, /synthetic-acceptance:.*:start/);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
});

test(
  'fixture rejects unknown identities and endpoints, but empty exact lookup stays empty',
  { timeout: 5000 },
  async () => {
    await withClient('shopping', async (client) => {
      const missing = (await client.callTool({
        name: 'market_get_product',
        arguments: { ...context, identity: 'test-missing' }
      })) as CallToolResult;
      assert.equal(missing.isError, undefined);
      assert.deepEqual((missing.structuredContent?.data as { content: unknown[] }).content, []);
      const unknown = (await client.callTool({
        name: 'market_get_product',
        arguments: { ...context, identity: 'test-unknown' }
      })) as CallToolResult;
      assert.equal(unknown.isError, true);
      assert.equal((unknown.structuredContent?.error as { code: string }).code, 'HTTP_ERROR');
      assert.equal((unknown.structuredContent?.error as { status: number }).status, 422);
      assert.equal((unknown.structuredContent?.error as { syntheticAcceptance: boolean }).syntheticAcceptance, true);
      const endpoint = (await client.callTool({
        name: 'market_get_price_history',
        arguments: { ...context, uniqueId: 'test-milk-1l' }
      })) as CallToolResult;
      assert.equal(endpoint.isError, true);
      assert.equal((endpoint.structuredContent?.error as { status: number }).status, 422);
    });
  }
);

test('fixture rejects unlisted branches and unsupported search filters', { timeout: 5000 }, async () => {
  await withClient('shopping', async (client) => {
    const branch = (await client.callTool({
      name: 'market_get_product',
      arguments: {
        ...context,
        depots: ['test-unknown'],
        identity: 'test-milk-1l'
      }
    })) as CallToolResult;
    assert.equal(branch.isError, true);
    assert.equal((branch.structuredContent?.error as { status: number }).status, 422);
    const filter = (await client.callTool({
      name: 'market_search_products',
      arguments: {
        ...context,
        keywords: 'yoğurt',
        refined_volume_weight: ['2 KG']
      }
    })) as CallToolResult;
    assert.equal(filter.isError, true);
    assert.equal((filter.structuredContent?.error as { status: number }).status, 422);
    const radius = (await client.callTool({
      name: 'market_get_product',
      arguments: { ...context, distance: 2, identity: 'test-milk-1l' }
    })) as CallToolResult;
    assert.equal(radius.isError, true);
    assert.equal((radius.structuredContent?.error as { status: number }).status, 422);
  });
});

test('search applies accepted weight and page size to literal result rows', { timeout: 5000 }, async () => {
  await withClient('shopping', async (client) => {
    const first = (await client.callTool({
      name: 'market_search_products',
      arguments: { ...context, keywords: 'yoğurt', size: 1 }
    })) as CallToolResult;
    const firstPage = first.structuredContent?.data as {
      numberOfFound: number;
      content: { id: string }[];
    };
    assert.equal(firstPage.numberOfFound, 2);
    assert.deepEqual(
      firstPage.content.map((product) => product.id),
      ['test-yogurt-1kg']
    );
    assert.equal((first.structuredContent?.meta as { pagination: { nextPage: number } }).pagination.nextPage, 1);
    const milk = (await client.callTool({
      name: 'market_search_products',
      arguments: {
        ...context,
        keywords: 'süt',
        refined_volume_weight: ['1 KG']
      }
    })) as CallToolResult;
    const filtered = milk.structuredContent?.data as {
      numberOfFound: number;
      content: unknown[];
    };
    assert.equal(filtered.numberOfFound, 0);
    assert.deepEqual(filtered.content, []);
  });
});

test('SDK input errors retain original text and show the synthetic marker', { timeout: 5000 }, async () => {
  await withClient('shopping', async (client) => {
    const result = (await client.callTool({
      name: 'market_search_products',
      arguments: { keywords: 'yoğurt' }
    })) as CallToolResult;
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.match((result.content[0] as { text: string }).text, /Invalid arguments for tool market_search_products/);
    assert.match(JSON.stringify(result.content), /Synthetic acceptance data only/);
    assert.equal((result._meta as { syntheticAcceptance: boolean }).syntheticAcceptance, true);
  });
});

test('search shows wrong package candidate and preserves untrusted upstream warning', { timeout: 5000 }, async () => {
  await withClient('shopping', async (client) => {
    const result = (await client.callTool({
      name: 'market_search_products',
      arguments: { ...context, keywords: 'yoğurt' }
    })) as CallToolResult;
    assert.equal(result.isError, undefined);
    const products = (result.structuredContent?.data as { content: { id: string }[] }).content;
    assert.deepEqual(
      products.map((product) => product.id),
      ['test-yogurt-1kg', 'test-yogurt-500g']
    );
    assert.match(JSON.stringify(result.structuredContent), /Ignore limits/);
  });
});

test('error and timeout return explicit synthetic failures without partial basket', { timeout: 5000 }, async () => {
  for (const [scenario, code] of [
    ['error', 'HTTP_ERROR'],
    ['timeout', 'TIMEOUT']
  ] as const) {
    await withClient(scenario, async (client) => {
      const result = (await client.callTool({
        name: 'market_compare_basket',
        arguments: {
          ...context,
          items: [
            { id: 'test-milk-1l', quantity: 1 },
            { id: 'test-yogurt-1kg', quantity: 1 }
          ]
        }
      })) as CallToolResult;
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent?.data, null);
      assert.equal((result.structuredContent?.error as { code: string }).code, code);
      assert.equal((result.structuredContent?.error as { syntheticAcceptance: boolean }).syntheticAcceptance, true);
      assert.equal(
        (
          result.structuredContent?.meta as {
            requestMetrics: { httpAttempts: number };
          }
        ).requestMetrics.httpAttempts,
        1
      );
    });
  }
});

test('slow basket cancellation aborts first body and leaves client usable', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, [entry, 'slow'], {
    env: { ...process.env, MARKET_FIYATI_MODE: 'offline' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '',
    buffer = '';
  const replies: Record<string, unknown>[] = [];
  let started!: () => void;
  let finished!: () => void;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
    if (stderr.includes('synthetic-acceptance:slow:start')) started();
  });
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line) replies.push(JSON.parse(line) as Record<string, unknown>);
    }
    if (replies.some((reply) => reply.id === 1) && replies.some((reply) => reply.id === 2)) finished();
  });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 4000);
  try {
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'market_compare_basket',
          arguments: {
            ...context,
            items: [
              { id: 'test-milk-1l', quantity: 1 },
              { id: 'test-yogurt-1kg', quantity: 1 }
            ]
          }
        }
      }) + '\n'
    );
    await first;
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 1 }
      }) + '\n'
    );
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'market_status', arguments: {} }
      }) + '\n'
    );
    await done;
    const cancelled = replies.find((reply) => reply.id === 1)?.result as CallToolResult;
    assert.equal(cancelled.isError, true);
    assert.equal((cancelled.structuredContent?.error as { code: string }).code, 'CANCELLED');
    assert.equal((cancelled.structuredContent?.error as { syntheticAcceptance: boolean }).syntheticAcceptance, true);
    assert.equal((replies.find((reply) => reply.id === 2)?.result as CallToolResult).isError, undefined);
    assert.equal((stderr.match(/synthetic-acceptance:slow:start/g) ?? []).length, 1);
    assert.match(stderr, /synthetic-acceptance:slow:cancel/);
    child.stdin.end();
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

test('same-write early cancellation is visibly synthetic without a fake fetch', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, [entry, 'slow'], {
    env: { ...process.env, MARKET_FIYATI_MODE: 'offline' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '',
    buffer = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  let received!: (reply: Record<string, unknown>) => void;
  const answer = new Promise<Record<string, unknown>>((resolve) => {
    received = resolve;
  });
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    const end = buffer.indexOf('\n');
    if (end >= 0) received(JSON.parse(buffer.slice(0, end)) as Record<string, unknown>);
  });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 4000);
  try {
    const call = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'market_compare_basket',
        arguments: {
          ...context,
          items: [
            { id: 'test-milk-1l', quantity: 1 },
            { id: 'test-yogurt-1kg', quantity: 1 }
          ]
        }
      }
    };
    const cancel = {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1 }
    };
    child.stdin.write(`${JSON.stringify(call)}\n${JSON.stringify(cancel)}\n`);
    const reply = await answer;
    const result = reply.result as CallToolResult;
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.data, null);
    assert.equal((result.structuredContent?.error as { code: string }).code, 'CANCELLED');
    assert.equal(
      (
        result.structuredContent?.meta as {
          requestMetrics: { httpAttempts: number };
        }
      ).requestMetrics.httpAttempts,
      0
    );
    assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
    assert.match(JSON.stringify(result.content), /Synthetic acceptance data only/);
    assert.equal((result._meta as { syntheticAcceptance: boolean }).syntheticAcceptance, true);
    assert.doesNotMatch(stderr, /synthetic-acceptance:slow:start/);
    child.stdin.end();
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
