import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { releaseNotes } from './release-notes.mjs';

const [tag, notesFile] = process.argv.slice(2);
assert.ok(
  [3, 4].includes(process.argv.length) && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag),
  'Expected a stable version tag, e.g. v1.0.0'
);
const version = tag.slice(1);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.equal(manifest.version, version, 'package.json version must match the tag');
assert.equal(lock.version, version, 'lockfile version must match the tag');
assert.equal(lock.packages?.['']?.version, version, 'lockfile root version must match the tag');
const notes = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
const revision = (ref) => execFileSync('git', ['rev-parse', '--verify', ref], { encoding: 'utf8' }).trim();
assert.equal(revision(`refs/tags/${tag}^{commit}`), revision('HEAD'), 'Release tag must point to the tested commit');
execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main']);
if (notesFile) writeFileSync(notesFile, notes);
console.log(`Release metadata verified: ${tag}`);
