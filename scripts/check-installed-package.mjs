import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

assert.equal(process.argv.length, 3, 'Expected the independent npm install directory');
const cwd = realpathSync(resolve(process.argv[2]));
const modules = join(cwd, 'node_modules');
const packageRoot = join(modules, 'market-fiyati-mcp');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const expected = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, expected.name);
assert.equal(manifest.version, expected.version);
for (const path of [modules, packageRoot, ...Object.keys(manifest.dependencies).map((name) => join(modules, name))]) {
  const local = relative(cwd, realpathSync(path));
  assert.ok(
    !isAbsolute(local) && local !== '..' && !local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    'Runtime dependencies must belong to the consumer install'
  );
}
const client = new Client({ name: 'installed-package-test', version: '1' });
const guard = fileURLToPath(new URL('../tests/no-network.mjs', import.meta.url));
const transport = new StdioClientTransport({
  command: join(modules, '.bin', `market-fiyati-mcp${process.platform === 'win32' ? '.cmd' : ''}`),
  args: [],
  cwd,
  env: {
    MARKET_FIYATI_MODE: 'offline',
    MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'false',
    NODE_OPTIONS: `--import=${pathToFileURL(guard).href}`
  },
  stderr: 'pipe'
});
let stderr = '';
transport.stderr.on('data', (chunk) => {
  stderr += chunk;
});
try {
  await client.connect(transport);
  assert.equal(client.getServerVersion().version, manifest.version);
  assert.equal((await client.listTools()).tools.length, 15);
  assert.equal((await client.listResources()).resources.length, 3);
  assert.equal((await client.listPrompts()).prompts.length, 3);
  const status = await client.callTool({ name: 'market_status', arguments: {} });
  assert.notEqual(status.isError, true);
  assert.equal(status.structuredContent.data.mode, 'offline');
  const blocked = await client.callTool({ name: 'market_get_categories', arguments: {} });
  assert.equal(blocked.isError, true);
  assert.equal(blocked.structuredContent.error.code, 'NETWORK_DISABLED');
  assert.equal(blocked.structuredContent.meta.requestMetrics.httpAttempts, 0);
} finally {
  await client.close();
}
assert.equal(stderr, '', 'Installed server must not emit unexpected diagnostics');
console.log(`Independent npm binary verified offline: ${manifest.name}@${manifest.version}`);
