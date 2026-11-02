import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

function lint(source, filename) {
  const folder = mkdtempSync(join(tmpdir(), 'market-lint-'));
  try {
    writeFileSync(join(folder, 'package.json'), '{"type":"module"}');
    const file = join(folder, filename);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(root, 'tests/no-network.mjs')).href,
        join(root, 'node_modules/oxlint/bin/oxlint'),
        '--config',
        join(root, '.oxlintrc.json'),
        '--format',
        'json',
        '--max-warnings',
        '0',
        file
      ],
      { cwd: root, encoding: 'utf8', timeout: 30_000, env: { ...process.env, MARKET_FIYATI_MODE: 'offline' } }
    );
    assert.ok(result.status === 0 || result.status === 1, result.stdout + result.stderr);
    return { status: result.status, ...JSON.parse(result.stdout) };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const rulesOf = (result) => result.diagnostics.map((message) => message.code);

test('lint accepts typed code and rejects unused variables and explicit any', () => {
  for (const file of ['src/lint-probe.ts', 'tests/lint-probe.ts']) {
    const valid = lint('export const identity = (value: string, _unused?: unknown): string => value;\n', file);
    assert.equal(valid.status, 0, JSON.stringify(valid.diagnostics));
    const invalid = lint('const unused: any = 1;\n', file);
    assert.equal(invalid.status, 1);
    assert.ok(rulesOf(invalid).includes('eslint(no-unused-vars)'), file);
    assert.ok(rulesOf(invalid).includes('typescript(no-explicit-any)'), file);
  }
});

test('lint applies JavaScript rules and Node globals to .mjs scripts and tests', () => {
  for (const file of ['scripts/lint-probe.mjs', 'tests/lint-probe.mjs']) {
    const valid = lint(
      "export const root = (_unused) => new URL('../', import.meta.url).href + process.cwd();\n",
      file
    );
    assert.equal(valid.status, 0, JSON.stringify(valid.diagnostics));
    const invalid = lint('const unused = 1;\nundefinedGlobal();\n', file);
    assert.equal(invalid.status, 1);
    assert.ok(rulesOf(invalid).includes('eslint(no-unused-vars)'), file);
    assert.ok(rulesOf(invalid).includes('eslint(no-undef)'), file);
  }
});

test('lint preserves unused catch bindings and variables even with underscore names', () => {
  for (const extension of ['js', 'mjs', 'ts']) {
    for (const source of [
      'const _unused = 1;',
      "export function parse() { try { return JSON.parse(''); } catch (_error) { return 0; } }"
    ]) {
      const result = lint(source, `probe.${extension}`);
      assert.equal(result.status, 1, source);
      assert.ok(rulesOf(result).includes('eslint(no-unused-vars)'), source);
    }
  }
});

test('lint retains the explicit rule baseline including dead stores and TypeScript assertions', () => {
  for (const [file, source, rule] of [
    ['probe.mjs', 'export function value() { let x = 1; x = 2; return x; }', 'eslint(no-useless-assignment)'],
    ['probe.mjs', 'export function value() { return missingName; }', 'eslint(no-undef)'],
    ['probe.ts', 'export type Empty = {};', 'typescript(no-empty-object-type)'],
    ['probe.ts', '// @ts-ignore\nexport const value = 1;', 'typescript(ban-ts-comment)'],
    [
      'probe.ts',
      'export function value(input?: { count: number }) { return (input?.count as number).toFixed(); }',
      'eslint(no-unsafe-optional-chaining)'
    ]
  ]) {
    const result = lint(source, file);
    assert.equal(result.status, 1, source);
    assert.ok(rulesOf(result).includes(rule), JSON.stringify(result.diagnostics));
  }
});

test('module parsing rejects duplicate parameters and legacy octal syntax', () => {
  for (const [file, source] of [
    ['probe.js', 'function duplicate(value, value) { return value; } console.log(duplicate(1, 2));'],
    ['probe.mjs', 'function duplicate(value, value) { return value; } console.log(duplicate(1, 2));'],
    ['probe.mjs', 'const value = 010; console.log(value);']
  ]) {
    const result = lint(source, file);
    assert.equal(result.status, 1, source);
    assert.ok(result.diagnostics.length > 0, source);
  }
});
