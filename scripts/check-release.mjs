import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const tag = process.argv[2];
assert.ok(
  process.argv.length === 3 && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag),
  'Expected a stable version tag, e.g. v1.0.0'
);
const version = tag.slice(1);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.equal(manifest.version, version, 'package.json version must match the tag');
assert.equal(lock.version, version, 'lockfile version must match the tag');
assert.equal(lock.packages?.['']?.version, version, 'lockfile root version must match the tag');
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const headings = changelog.split(/\r?\n/).filter((line) => line.startsWith('## '));
const prefix = `## ${version} — `;
assert.ok(
  headings.some((line) => line.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(line.slice(prefix.length))),
  'Release version needs a dated changelog section'
);
assert.ok(!headings.includes(`## Yayımlanmamış — ${version}`), 'Release version cannot be unpublished');
assert.ok(readFileSync(`docs/releases/${tag}.md`, 'utf8').trim(), 'Cannot use empty release notes');
const revision = (ref) => execFileSync('git', ['rev-parse', '--verify', ref], { encoding: 'utf8' }).trim();
assert.equal(revision(`refs/tags/${tag}^{commit}`), revision('HEAD'), 'Release tag must point to the tested commit');
execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main']);
console.log(`Release metadata verified: ${tag}`);
