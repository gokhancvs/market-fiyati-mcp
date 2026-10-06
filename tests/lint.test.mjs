import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const rulesOf = (result) => result.messages.map((message) => message.ruleId);

test('lint accepts typed code and rejects unused variables and explicit any', async () => {
  const eslint = new ESLint();
  for (const filePath of ['src/lint-probe.ts', 'tests/lint-probe.ts']) {
    const [valid] = await eslint.lintText(
      'export const identity = (value: string, _unused?: unknown): string => value;\n',
      { filePath }
    );
    assert.equal(valid.errorCount, 0, JSON.stringify(valid.messages));
    const [invalid] = await eslint.lintText('const unused: any = 1;\n', {
      filePath
    });
    const rules = rulesOf(invalid);
    assert.ok(rules.includes('@typescript-eslint/no-unused-vars'), filePath);
    assert.ok(rules.includes('@typescript-eslint/no-explicit-any'), filePath);
  }
});

test('lint applies JavaScript rules and Node globals to .mjs scripts and tests', async () => {
  const eslint = new ESLint();
  for (const filePath of ['scripts/lint-probe.mjs', 'tests/lint-probe.mjs']) {
    const [valid] = await eslint.lintText(
      "export const root = (_unused) => new URL('../', import.meta.url).href + process.cwd();\n",
      { filePath }
    );
    assert.equal(valid.errorCount + valid.warningCount, 0, JSON.stringify(valid.messages));
    const [invalid] = await eslint.lintText('const unused = 1;\nundefinedGlobal();\n', { filePath });
    const rules = rulesOf(invalid);
    assert.ok(rules.includes('no-unused-vars'), `${filePath}: ${JSON.stringify(invalid.messages)}`);
    assert.ok(rules.includes('no-undef'), `${filePath}: ${JSON.stringify(invalid.messages)}`);
  }
});
