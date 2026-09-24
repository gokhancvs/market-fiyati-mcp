import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function project() {
  const folder = mkdtempSync(join(tmpdir(), 'market-build-'));
  for (const name of ['src', 'tsconfig.json', 'package.json', 'scripts'])
    if (existsSync(join(root, name))) cpSync(join(root, name), join(folder, name), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(folder, 'node_modules'), 'junction');
  return folder;
}
function build(folder) {
  const npm = process.env.npm_execpath;
  assert.ok(npm, 'Run through npm test or npm run check');
  return spawnSync(process.execPath, [npm, 'run', 'build'], {
    cwd: folder,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      MARKET_FIYATI_MODE: 'offline',
      NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'tests/no-network.mjs')).href}`
    }
  });
}

test('build removes stale output without deleting files outside dist', () => {
  const folder = project();
  try {
    const stale = join(folder, 'dist/src/removed.js');
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, 'obsolete');
    const keep = join(folder, 'keep.txt');
    writeFileSync(keep, 'keep');
    const result = build(folder);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(keep), true);
    assert.equal(existsSync(join(folder, 'dist/src/index.js')), true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('build propagates compiler errors', () => {
  const folder = project();
  try {
    writeFileSync(join(folder, 'src/invalid.ts'), 'export const number: number = "invalid";');
    const result = build(folder);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /TS2322/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
