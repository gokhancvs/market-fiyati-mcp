import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const script = fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url));
const workflow = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url));

test('release workflow gates tag publication on main, offline checks and OIDC', () => {
  const parsed = yaml.load(readFileSync(workflow, 'utf8'));
  assert.deepEqual(parsed.on.push.tags, ['v*']);
  assert.equal(parsed.on.workflow_dispatch, undefined);
  assert.equal(parsed.concurrency.queue, 'max');
  assert.equal(parsed.concurrency['cancel-in-progress'], false);
  // Branch protection already requires the full check matrix on every main commit; the tag is not re-verified.
  assert.equal(parsed.jobs.verify, undefined);
  assert.equal(parsed.jobs.publish.needs, 'validate');
  assert.equal(parsed.jobs.publish.permissions['id-token'], 'write');
  assert.equal(parsed.env.MARKET_FIYATI_MODE, 'offline');
  const steps = parsed.jobs.publish.steps;
  const check = steps.findIndex((step) => step.run === 'npm run check');
  assert.equal(steps[check].env.MARKET_FIYATI_PACK_DESTINATION, '${{ runner.temp }}/npm-release');
  const consumer = steps.findIndex((step) => step.run?.startsWith('npm run test:consumer'));
  const publish = steps.findIndex((step) => step.run?.includes('scripts/publish-npm.mjs'));
  assert.ok(check >= 0 && consumer > check && publish > consumer);
  const checks = yaml.load(readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8'));
  assert.equal(checks.on.workflow_call, undefined, 'no workflow reuses the full check matrix');
  assert.ok(!JSON.stringify(parsed).includes('NODE_AUTH_TOKEN'));
  const command = parsed.jobs.publish.steps.find((step) => step.name === 'Publish verified release').run;
  assert.match(command, /gh release create "\$RELEASE_TAG" --verify-tag/);
  assert.doesNotMatch(command, /--draft/);
});

test('MCP Registry publication runs after npm with OIDC and a verified publisher binary', () => {
  const parsed = yaml.load(readFileSync(workflow, 'utf8'));
  const registry = parsed.jobs.registry;
  assert.equal(registry.needs, 'publish');
  assert.deepEqual(registry.permissions, { contents: 'read', 'id-token': 'write' });
  assert.match(registry.env.MCP_PUBLISHER_VERSION, /^v\d+\.\d+\.\d+$/);
  assert.match(registry.env.MCP_PUBLISHER_SHA256, /^[0-9a-f]{64}$/);
  const run = registry.steps.map((step) => step.run ?? '').join('\n');
  assert.match(run, /releases\/download\/\$MCP_PUBLISHER_VERSION\//);
  assert.match(run, /sha256sum -c/);
  assert.ok(run.indexOf('sha256sum -c') < run.indexOf('tar -xzf'), 'verify before extracting');
  assert.doesNotMatch(run, /releases\/latest/);
  assert.match(run, /mcp-publisher" login github-oidc/);
  assert.match(run, /mcp-publisher" publish/);
  assert.match(run, /\/versions\/\$version/, 'skip and verify by exact registry version');
  assert.match(run, /404\) ;;/, 'publish only when the version is absent');
  const curls = run.split('\n').filter((line) => /\bcurl /.test(line));
  assert.ok(curls.length >= 3 && curls.every((line) => /--max-time \d+/.test(line)), 'bound every HTTP call');
  assert.ok(!JSON.stringify(registry).includes('secrets.'), 'OIDC needs no stored secret');
  const checkout = registry.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], false);
});

function check({
  tag = 'v1.0.0',
  version = '1.0.0',
  lock = '1.0.0',
  root = '1.0.0',
  notes = '# v1.0.0',
  changelog = '# Değişiklik günlüğü\n\n## 1.0.0 — 2026-09-25\n',
  missingTag = false,
  advance = false,
  outsideMain = false,
  missingMain = false,
  advanceMain = false
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
    writeFileSync(join(cwd, 'CHANGELOG.md'), changelog);
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    if (!missingMain) git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    if (outsideMain) git('commit', '--allow-empty', '-qm', 'not pushed to main');
    if (!missingTag) git('-c', 'tag.gpgsign=false', 'tag', '-a', 'v1.0.0', '-m', 'fixture');
    else git('branch', 'v1.0.0'); // A same-named branch must not substitute for the missing tag.
    if (advance) git('commit', '--allow-empty', '-qm', 'later checkout');
    if (advanceMain) {
      git('commit', '--allow-empty', '-qm', 'later main');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('checkout', '--detach', 'v1.0.0');
    }
    return spawnSync(process.execPath, [script, tag], { cwd, env, encoding: 'utf8', timeout: 5000 });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('release guard accepts only a matching version, notes and exact tagged commit', () => {
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /v1\.0\.0/);
  assert.equal(check({ advanceMain: true }).status, 0, 'Tagged main ancestors remain releasable');
  assert.equal(check({ changelog: '# Günlük\n\n## Yayımlanmamış — 1.0.0\n' }).status !== 0, true);
  assert.equal(check({ changelog: '# Günlük\n\n## 1.0.0 — 2026-09-25\n' }).status, 0);
  assert.notEqual(check({ changelog: '# Günlük\n\n## Yayımlanmamış — 1.0.0\n\n## 1.0.0 — 2026-09-25\n' }).status, 0);

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
    [{ advance: true }, /tag must point to the tested commit/],
    [{ outsideMain: true }, /main/],
    [{ missingMain: true }, /main/]
  ]) {
    const result = check(input);
    assert.notEqual(result.status, 0, JSON.stringify(input));
    assert.match(result.stderr, error, JSON.stringify(input));
  }
});
