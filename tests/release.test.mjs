import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { changelogSections, linkProblems } from '../scripts/release-notes.mjs';

const script = fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url));
const workflow = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url));

test('release workflow gates tag publication on main, offline checks and OIDC', () => {
  const parsed = load(readFileSync(workflow, 'utf8'));
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
  const checks = load(readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8'));
  assert.equal(checks.on.workflow_call, undefined, 'no workflow reuses the full check matrix');
  assert.ok(!JSON.stringify(parsed).includes('NODE_AUTH_TOKEN'));
  const command = parsed.jobs.publish.steps.find((step) => step.name === 'Publish verified release').run;
  assert.match(command, /gh release create "\$RELEASE_TAG" --verify-tag/);
  // The release body is the dated CHANGELOG section written by the release guard.
  assert.ok(
    steps.some((step) => step.run === 'npm run release:check -- "$RELEASE_TAG" "$RUNNER_TEMP/release-notes.md"')
  );
  assert.match(command, /--notes-file "\$RUNNER_TEMP\/release-notes\.md"/);
  assert.doesNotMatch(JSON.stringify(parsed), /docs\/releases/);
  assert.doesNotMatch(command, /--draft/);
});

test('MCP Registry publication runs after npm with OIDC and a verified publisher binary', () => {
  const parsed = load(readFileSync(workflow, 'utf8'));
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

test('Dependabot proposes grouped monthly updates that keep exact pins after a cooldown', () => {
  const config = load(readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8'));
  const byEcosystem = Object.fromEntries(config.updates.map((update) => [update['package-ecosystem'], update]));
  assert.deepEqual(Object.keys(byEcosystem).sort(), ['github-actions', 'npm']);
  for (const [ecosystem, update] of Object.entries(byEcosystem)) {
    assert.equal(update.schedule.interval, 'monthly', ecosystem);
    assert.ok(update.cooldown['default-days'] >= 7, ecosystem);
    assert.equal(update['commit-message'].include, 'scope', ecosystem);
    for (const group of Object.values(update.groups)) {
      assert.deepEqual(group['update-types'], ['minor', 'patch'], `${ecosystem}: majors arrive one by one`);
      assert.equal(group['applies-to'], undefined, `${ecosystem}: security updates are not grouped`);
    }
  }
  const npm = byEcosystem.npm;
  assert.equal(npm['versioning-strategy'], 'increase', 'exact pins stay exact');
  assert.ok(npm['open-pull-requests-limit'] >= 10, 'room for individual major updates');
  assert.equal(npm['commit-message'].prefix, 'build');
  assert.equal(npm.groups.production['dependency-type'], 'production');
  assert.equal(npm.groups.development['dependency-type'], 'development');
  // @types/node follows the supported Node floor in package.json engines.
  assert.deepEqual(npm.ignore, [{ 'dependency-name': '@types/node', 'update-types': ['version-update:semver-major'] }]);
  assert.equal(byEcosystem['github-actions']['commit-message'].prefix, 'ci');
  assert.deepEqual(byEcosystem['github-actions'].groups.actions.patterns, ['*']);
});

function check({
  tag = 'v1.0.0',
  version = '1.0.0',
  lock = '1.0.0',
  root = '1.0.0',
  changelog = '# Değişiklik günlüğü\n\n## 1.0.0 — 2026-09-25\n\n- Değişiklik.\n\n## 0.9.0 — 2026-09-01\n\n- Eski.\n',
  notesFile = false,
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
    const output = join(cwd, 'release-notes.md');
    const result = spawnSync(process.execPath, [script, tag, ...(notesFile ? [output] : [])], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5000
    });
    return { ...result, notes: notesFile && result.status === 0 ? readFileSync(output, 'utf8') : undefined };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const repo = 'https://github.com/gokhancvs/market-fiyati-mcp/';

test('release guard writes the dated CHANGELOG section as the release body', () => {
  const changelog = `# Günlük\n\n## Yayımlanmamış\n\n- Sonraki.\n\n## 1.0.0 — 2026-09-25\n\n- **Yeni:** [API](${repo}blob/v1.0.0/docs/api.md#hata).\n- [Release](${repo}releases/tag/v0.9.0)\n\n## 0.9.0 — 2026-09-01\n\n- Eski.\n`;
  const result = check({ changelog, notesFile: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.notes,
    `- **Yeni:** [API](${repo}blob/v1.0.0/docs/api.md#hata).\n- [Release](${repo}releases/tag/v0.9.0)\n`
  );
});

test('release guard accepts only a matching version, notes and exact tagged commit', () => {
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /v1\.0\.0/);
  assert.equal(check({ advanceMain: true }).status, 0, 'Tagged main ancestors remain releasable');
  assert.equal(check({ changelog: '# Günlük\n\n## Yayımlanmamış — 1.0.0\n\n- A\n' }).status !== 0, true);
  assert.notEqual(
    check({ changelog: '# Günlük\n\n## Yayımlanmamış — 1.0.0\n\n- A\n\n## 1.0.0 — 2026-09-25\n\n- B\n' }).status,
    0
  );

  for (const [input, error] of [
    [{ tag: '../../secret' }, /stable version tag/],
    [{ tag: 'v1.0.0-rc.1' }, /stable version tag/],
    [{ tag: 'v01.0.0' }, /stable version tag/],
    [{ version: '1.0.1' }, /package.json version/],
    [{ lock: '1.0.1' }, /lockfile version/],
    [{ root: '1.0.1' }, /lockfile root version/],
    [
      { changelog: '# Günlük\n\n## 1.0.0 — 2026-09-25\n \n\n## 0.9.0 — 2026-09-01\n\n- Eski.\n' },
      /empty release notes/
    ],
    [{ changelog: '# Günlük\n\n## 1.0.0 — 2026-09-25\n\n- [API](docs/api.md)\n' }, /absolute links/],
    [
      { changelog: `# Günlük\n\n## 1.0.0 — 2026-09-25\n\n- [API](${repo}blob/main/docs/api.md)\n` },
      /absolute links pinned/
    ],
    [
      { changelog: `# Günlük\n\n## 1.0.0 — 2026-09-25\n\n- [API](${repo}blob/v0.9.0/docs/api.md)\n` },
      /absolute links pinned/
    ],
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

test('release note links are checked in every form and repository links must be pinned', () => {
  const blob = `${repo}blob/v1.0.0/README.md`;
  assert.deepEqual(linkProblems(`[a](${blob}) [b](${repo}releases/tag/v0.9.0) [c](https://example.com)`, 'v1.0.0'), []);
  for (const href of [
    'docs/api.md',
    `${repo}blob/main/README.md`,
    `${repo}blob/v1.0.10/README.md`,
    `${repo}tree/main/docs`,
    `${repo}raw/main/README.md`,
    'https://raw.githubusercontent.com/gokhancvs/market-fiyati-mcp/main/README.md'
  ]) {
    assert.deepEqual(linkProblems(`[a](${href})`, 'v1.0.1'), [href]);
    assert.deepEqual(linkProblems(`Metin.\n\n[ref]: ${href}\n`, 'v1.0.1'), [href]);
  }
  assert.deepEqual(linkProblems(`[a](${repo}tree/v1.0.1/docs)`, 'v1.0.1'), []);
  assert.deepEqual(linkProblems(`[a](${blob})`, null), [], 'unreleased links may use any version tag');
  assert.deepEqual(linkProblems(`[a](${repo}blob/main/README.md)`, null), [`${repo}blob/main/README.md`]);
});

test('CHANGELOG sections ignore headings inside fenced code', () => {
  const sections = changelogSections(
    '# G\n\n## 1.0.0 — 2026-09-25\n\n```md\n## örnek\n```\n\n- Son.\n\n## Yayımlanmamış\n'
  );
  assert.deepEqual(
    sections.map(({ heading }) => heading),
    ['1.0.0 — 2026-09-25', 'Yayımlanmamış']
  );
  assert.match(sections[0].body, /## örnek[\s\S]*- Son\./);
});
