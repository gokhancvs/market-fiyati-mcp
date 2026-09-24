import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const guard = fileURLToPath(new URL('./no-network.mjs', import.meta.url));

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
    assert.ok(
      paths.every((path) =>
        /^(dist\/src\/.*\.js|docs\/.*\.md|examples\/mcp-config\.json|package\.json|README\.md|LICENSE|CHANGELOG\.md)$/.test(
          path
        )
      ),
      'Tarball must contain only runtime JavaScript and public documentation'
    );
    for (const path of ['dist/src/index.js', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
      assert.ok(paths.includes(path), `Missing ${path}`);
    }
    execFileSync('tar', ['-xzf', join(temp, packed.filename), '-C', temp]);
    const cwd = join(temp, 'package');
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
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
  } finally {
    await client.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
