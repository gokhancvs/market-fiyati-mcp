import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  readdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function project() {
  const folder = mkdtempSync(join(tmpdir(), 'market-build-'));
  for (const name of ['src', 'tsconfig.json', 'tsconfig.lint.json', '.oxlintrc.json', 'package.json', 'scripts'])
    if (existsSync(join(root, name))) cpSync(join(root, name), join(folder, name), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(folder, 'node_modules'), 'junction');
  return folder;
}
function runScript(folder, script) {
  const npm = process.env.npm_execpath;
  assert.ok(npm, 'Run through npm test or npm run check');
  return spawnSync(process.execPath, [npm, 'run', script], {
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

test('tooling uses only TypeScript 7 without a classic compiler or compatibility aliases', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(manifest.devDependencies.typescript, /^7\.\d+\.\d+$/);
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    assert.doesNotMatch(
      path,
      /node_modules\/(?:@typescript\/(?:typescript6|old|native)|@typescript-eslint|typescript-eslint)(?:\/|$)/
    );
    if (entry.name === 'typescript' || /(?:^|\/)node_modules\/typescript$/.test(path)) {
      assert.match(entry.version, /^7\./, path);
    }
  }
  const npm = process.env.npm_execpath;
  assert.ok(npm, 'Run through npm test or npm run check');
  const result = spawnSync(process.execPath, [npm, 'exec', '--offline', '--', 'tsc', '--version'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      MARKET_FIYATI_MODE: 'offline',
      NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'tests/no-network.mjs')).href}`
    }
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^Version 7\./);
});

test('build removes stale output without deleting files outside dist', () => {
  const folder = project();
  try {
    const stale = join(folder, 'dist/src/removed.js');
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, 'obsolete');
    const keep = join(folder, 'keep.txt');
    writeFileSync(keep, 'keep');
    const result = runScript(folder, 'build');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(keep), true);
    assert.equal(existsSync(join(folder, 'dist/src/index.js')), true);
    const unused = readdirSync(join(folder, 'dist'), { recursive: true }).filter((file) =>
      /\.(?:d\.ts|map)$/.test(String(file))
    );
    assert.deepEqual(unused, [], 'declarations and source maps are not shipped');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('build propagates compiler errors', () => {
  const folder = project();
  try {
    writeFileSync(join(folder, 'src/invalid.ts'), 'export const number: number = "invalid";');
    const result = runScript(folder, 'build');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /TS2322/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('lint rejects legacy octal syntax in JavaScript files without import or export', () => {
  const folder = project();
  try {
    writeFileSync(join(folder, 'scripts/invalid.js'), 'const value = 010; console.log(value);');
    const result = runScript(folder, 'lint');
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /TS1121|octal/i);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
