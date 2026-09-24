import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url));

function check({
  tag = 'v1.0.0',
  version = '1.0.0',
  lock = '1.0.0',
  root = '1.0.0',
  notes = '# v1.0.0',
  missingTag = false,
  advance = false
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'market-release-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Release test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Release test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid'
  };
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      env,
      stdio: 'pipe'
    });
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version }));
    writeFileSync(
      join(cwd, 'package-lock.json'),
      JSON.stringify({ version: lock, packages: { '': { version: root } } })
    );
    mkdirSync(join(cwd, 'docs/releases'), { recursive: true });
    if (notes !== null) writeFileSync(join(cwd, 'docs/releases/v1.0.0.md'), notes);
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    if (!missingTag) git('-c', 'tag.gpgsign=false', 'tag', '-a', 'v1.0.0', '-m', 'fixture');
    else git('branch', 'v1.0.0'); // A same-named branch must not substitute for the missing tag.
    if (advance) git('commit', '--allow-empty', '-qm', 'later checkout');
    return spawnSync(process.execPath, [script, tag], { cwd, env, encoding: 'utf8', timeout: 5000 });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('release guard accepts only a matching version, notes and exact tagged commit', () => {
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /v1\.0\.0/);

  for (const [input, error] of [
    [{ tag: '../../secret' }, /stable version tag/],
    [{ tag: 'v1.0.0-rc.1' }, /stable version tag/],
    [{ tag: 'v01.0.0' }, /stable version tag/],
    [{ version: '1.0.1' }, /package.json version/],
    [{ lock: '1.0.1' }, /lockfile version/],
    [{ root: '1.0.1' }, /lockfile root version/],
    [{ notes: null }, /ENOENT/],
    [{ notes: ' \n' }, /empty release notes/],
    [{ missingTag: true }, /revision/],
    [{ advance: true }, /tag must point to the tested commit/]
  ]) {
    const result = check(input);
    assert.notEqual(result.status, 0, JSON.stringify(input));
    assert.match(result.stderr, error, JSON.stringify(input));
  }
});
