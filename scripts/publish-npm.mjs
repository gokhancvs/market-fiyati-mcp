import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org/';

export async function publishNpm(
  pack,
  {
    fetch: request = globalThis.fetch,
    publish = (filename) =>
      execFileSync('npm', ['publish', filename, '--access', 'public', '--tag', 'latest', `--registry=${registry}`], {
        stdio: 'inherit'
      }),
    wait = () => setTimeout(5000)
  } = {}
) {
  const read = async () => {
    const response = await request(`${registry}${encodeURIComponent(pack.name)}`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15000)
    });
    assert.ok(response.status === 200 || response.status === 404, `Registry HTTP ${response.status}`);
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
  if (matches(metadata)) return;
  const latest = metadata['dist-tags']?.latest;
  if (latest) {
    assert.match(latest, /^\d+\.\d+\.\d+$/, 'Expected a stable npm latest version');
    const next = pack.version.split('.').map(BigInt);
    const previous = latest.split('.').map(BigInt);
    const difference = next.findIndex((part, index) => part !== previous[index]);
    assert.ok(difference >= 0 && next[difference] > previous[difference], 'Version must be newer than npm latest');
  }
  publish(pack.filename);
  // Allow registry propagation five minutes of waiting (60 waits of five seconds).
  for (let attempt = 0; attempt < 61; attempt++) {
    if (matches(await read())) return;
    if (attempt < 60) await wait();
  }
  throw new Error('Published version not visible in registry; rerun to verify, never change the existing tag');
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
