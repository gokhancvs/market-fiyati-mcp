import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.argv.length <= 3, 'Expected optional tested pack.json path');
assert.ok(process.env.npm_execpath, 'Run through npm run test:consumer');
const temp = mkdtempSync(join(tmpdir(), 'market consumer '));
const npm = (args) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: join(temp, 'cache') }
  });
try {
  let pack;
  let archive;
  if (process.argv[2]) {
    const metadataPath = resolve(process.argv[2]);
    [pack] = JSON.parse(readFileSync(metadataPath, 'utf8'));
    assert.equal(basename(pack.filename), pack.filename);
    archive = join(dirname(metadataPath), pack.filename);
  } else {
    npm(['run', 'build']);
    [pack] = JSON.parse(npm(['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', temp]));
    archive = join(temp, pack.filename);
  }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pack.name, manifest.name);
  assert.equal(pack.version, manifest.version);
  assert.equal(`sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`, pack.integrity);
  const install = join(temp, 'install with spaces');
  mkdirSync(install);
  const copied = join(install, pack.filename);
  copyFileSync(archive, copied);
  npm(['install', '--prefix', install, copied, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  execFileSync(process.execPath, [join(root, 'scripts/check-installed-package.mjs'), install], { stdio: 'inherit' });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
