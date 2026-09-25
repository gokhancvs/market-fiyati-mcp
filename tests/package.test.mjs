import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const guard = fileURLToPath(new URL('./no-network.mjs', import.meta.url));

test('unlisted documentation cannot enter the published package', () => {
  const temp = mkdtempSync(join(tmpdir(), 'market-package-scope-'));
  try {
    const source = join(temp, 'source');
    mkdirSync(source);
    copyFileSync(join(root, 'package.json'), join(source, 'package.json'));
    cpSync(join(root, 'docs'), join(source, 'docs'), { recursive: true });
    writeFileSync(join(source, 'docs/package-probe.md'), 'Private draft; must not ship.');
    const [packed] = JSON.parse(
      execFileSync('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', temp], {
        cwd: source,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: join(temp, 'cache') }
      })
    );
    assert.ok(!packed.files.some(({ path }) => path === 'docs/package-probe.md'));
    assert.ok(packed.files.some(({ path }) => path === 'docs/api.md'));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('npm tarball excludes development files and runs the offline MCP outside the checkout', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'market-package-'));
  const client = new Client({ name: 'package-test', version: '1.0.0' });
  try {
    const [packed] = JSON.parse(
      execFileSync('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', temp], {
        cwd: root,
        env: { ...process.env, npm_config_cache: join(temp, 'cache') },
        encoding: 'utf8'
      })
    );
    const paths = packed.files.map(({ path }) => path);
    const publicFiles = new Set([
      'docs/api.md',
      'docs/architecture.md',
      'docs/verification.md',
      'docs/offline-acceptance.md',
      'docs/live-testing.md',
      'docs/releasing.md',
      'docs/releases/v1.0.0.md',
      'docs/releases/v1.0.1.md',
      'docs/releases/v1.0.2.md',
      'docs/releases/v1.0.4.md',
      'docs/releases/v1.0.5.md',
      'docs/releases/v1.0.6.md',
      'examples/mcp-config.json',
      'package.json',
      'SECURITY.md',
      'README.md',
      'LICENSE',
      'CHANGELOG.md'
    ]);
    assert.ok(
      paths.every((path) => /^dist\/src\/.*\.js$/.test(path) || publicFiles.has(path)),
      'Tarball must contain only runtime JavaScript and explicitly public documentation'
    );
    for (const path of ['dist/src/index.js', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
      assert.ok(paths.includes(path), `Missing ${path}`);
    }
    execFileSync('tar', ['-xzf', join(temp, packed.filename), '-C', temp]);
    const cwd = join(temp, 'package');
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const example = JSON.parse(readFileSync(join(cwd, 'examples/mcp-config.json'), 'utf8'));
    assert.equal(example.mcpServers['market-fiyati'].command, 'npx');
    assert.deepEqual(example.mcpServers['market-fiyati'].args, ['-y', `${manifest.name}@${manifest.version}`]);
    assert.equal(example.mcpServers['market-fiyati'].env.MARKET_FIYATI_MODE, 'offline');
    const registry = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8'));
    assert.equal(registry.name, manifest.mcpName);
    assert.equal(registry.version, manifest.version);
    assert.equal(registry.packages[0].identifier, manifest.name);
    assert.equal(registry.packages[0].version, manifest.version);
    assert.notEqual(manifest.private, true, 'Package must permit publication');
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    assert.equal(lock.version, manifest.version);
    assert.equal(lock.packages[''].version, manifest.version);
    // Reuse installed dependencies only; runtime modules must come from the tarball.
    symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'junction');
    const entry = join(cwd, manifest.bin['market-fiyati-mcp']);
    const help = execFileSync(process.execPath, ['--import', guard, entry, '--help'], { cwd, encoding: 'utf8' });
    assert.match(help, /Market Fiyati MCP \(stdio\)/);
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', guard, entry],
        cwd,
        env: { MARKET_FIYATI_MODE: 'offline', MARKET_FIYATI_ENABLE_EXPERIMENTAL: 'false' },
        stderr: 'pipe'
      })
    );
    assert.equal(client.getServerVersion().version, manifest.version);
    const status = await client.callTool({ name: 'market_status', arguments: {} });
    assert.notEqual(status.isError, true);
    assert.equal(status.structuredContent.data.mode, 'offline');
    const destination = process.env.MARKET_FIYATI_PACK_DESTINATION;
    if (destination) {
      mkdirSync(destination, { recursive: true });
      copyFileSync(join(temp, packed.filename), join(destination, packed.filename));
      writeFileSync(join(destination, 'pack.json'), JSON.stringify([packed]));
    }
  } finally {
    await client.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
