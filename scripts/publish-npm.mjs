import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org/';
const verificationReads = 24;
const verificationWait = 10000;

function compareVersions(left, right) {
  for (const value of [left, right]) assert.match(value, /^\d+\.\d+\.\d+$/, 'Expected a stable npm latest version');
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  const index = a.findIndex((part, i) => part !== b[i]);
  return index < 0 ? 0 : a[index] > b[index] ? 1 : -1;
}

const transient = (error) =>
  error instanceof TypeError ||
  ['AbortError', 'TimeoutError'].includes(error?.name) ||
  [429, 502, 503, 504].includes(error?.status);

export async function publishNpm(
  pack,
  {
    fetch: request = globalThis.fetch,
    publish = (filename) =>
      execFileSync('npm', ['publish', filename, '--access', 'public', '--tag', 'latest', `--registry=${registry}`], {
        stdio: 'inherit'
      }),
    wait = (ms) => setTimeout(ms)
  } = {}
) {
  const read = async () => {
    const response = await request(`${registry}${encodeURIComponent(pack.name)}`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(10000)
    });
    if (response.status !== 200 && response.status !== 404) {
      await response.body?.cancel();
      throw Object.assign(new Error(`Registry HTTP ${response.status}`), { status: response.status });
    }
    return response.json();
  };
  const matches = (metadata) => {
    const version = metadata.versions?.[pack.version];
    if (!version) return false;
    assert.equal(version.version, pack.version, 'Registry version mismatch');
    assert.equal(version.dist?.integrity, pack.integrity, 'Registry integrity mismatch; refusing to overwrite');
    return true;
  };
  const metadata = await read();
  assert.ok(!metadata.time?.unpublished?.versions?.includes(pack.version), 'Cannot reuse an unpublished version');
  const existing = matches(metadata);
  // An existing release may already be behind a newer latest; a new one must become latest itself.
  const ready = (value) => {
    const latest = value['dist-tags']?.latest;
    return Boolean(latest && (existing ? compareVersions(latest, pack.version) >= 0 : latest === pack.version));
  };
  if (existing && ready(metadata)) return;
  if (!existing) {
    const latest = metadata['dist-tags']?.latest;
    if (latest) assert.ok(compareVersions(pack.version, latest) > 0, 'Version must be newer than npm latest');
    await publish(pack.filename);
  }
  for (let attempt = 1; attempt <= verificationReads; attempt++) {
    if (attempt > 1) await wait(verificationWait);
    let current;
    try {
      current = await read();
    } catch (error) {
      if (!transient(error)) throw error;
      continue;
    }
    if (matches(current) && ready(current)) return;
  }
  throw new Error(
    'Published version or latest channel not visible after the verification reads; rerun to verify, never change the existing tag'
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadataPath = process.argv[2];
  assert.equal(process.argv.length, 3, 'Expected the tested pack.json path');
  const [pack] = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pack.name, manifest.name);
  assert.equal(pack.version, manifest.version);
  assert.equal(basename(pack.filename), pack.filename);
  const filename = resolve(dirname(metadataPath), pack.filename);
  const integrity = `sha512-${createHash('sha512').update(readFileSync(filename)).digest('base64')}`;
  assert.equal(integrity, pack.integrity, 'Tested tarball integrity mismatch');
  await publishNpm({ ...pack, filename });
  console.log(`npm verified: ${pack.name}@${pack.version} ${integrity}`);
}
