import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org/';

function compareVersions(left, right) {
  for (const value of [left, right]) assert.match(value, /^\d+\.\d+\.\d+$/, 'Expected a stable npm latest version');
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  const index = a.findIndex((part, i) => part !== b[i]);
  return index < 0 ? 0 : a[index] > b[index] ? 1 : -1;
}

export async function publishNpm(
  pack,
  {
    fetch: request = globalThis.fetch,
    publish = (filename) =>
      execFileSync('npm', ['publish', filename, '--access', 'public', '--tag', 'latest', `--registry=${registry}`], {
        stdio: 'inherit'
      }),
    wait = (ms) => setTimeout(ms),
    now = () => performance.now(),
    wallNow = () => Date.now()
  } = {}
) {
  const read = async (timeout = 15000, retry = false) => {
    let response;
    try {
      response = await request(`${registry}${encodeURIComponent(pack.name)}`, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeout)))
      });
    } catch (error) {
      if (!retry) throw error;
      return { metadata: {}, delay: 5000 };
    }
    if (retry && [429, 502, 503, 504].includes(response.status)) {
      const header = response.headers.get('retry-after');
      const retryAfter =
        header && /^\d+(?:\.\d+)?$/.test(header.trim())
          ? Number(header) * 1000
          : header
            ? Date.parse(header) - wallNow()
            : 0;
      await response.body?.cancel();
      return { metadata: {}, delay: Number.isNaN(retryAfter) ? 5000 : Math.max(5000, retryAfter) };
    }
    assert.ok(response.status === 200 || response.status === 404, `Registry HTTP ${response.status}`);
    return { metadata: await response.json(), delay: 5000 };
  };
  const matches = (metadata) => {
    const version = metadata.versions?.[pack.version];
    if (!version) return false;
    assert.equal(version.version, pack.version, 'Registry version mismatch');
    assert.equal(version.dist?.integrity, pack.integrity, 'Registry integrity mismatch; refusing to overwrite');
    return true;
  };
  const { metadata } = await read();
  assert.ok(!metadata.time?.unpublished?.versions?.includes(pack.version), 'Cannot reuse an unpublished version');
  const existing = matches(metadata);
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
  const deadline = now() + 300000;
  for (let attempt = 0; attempt < 61 && now() < deadline; attempt++) {
    const { metadata: current, delay } = await read(Math.min(15000, deadline - now()), true);
    const matching = matches(current);
    if (now() >= deadline) break;
    if (matching && ready(current)) return;
    if (attempt === 60) break;
    const remaining = deadline - now();
    if (delay >= remaining) break;
    await wait(delay);
  }
  throw new Error(
    'Published version or latest channel not visible before verification deadline (including Retry-After); rerun to verify, never change the existing tag'
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
