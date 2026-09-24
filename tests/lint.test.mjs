import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

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
    const rules = invalid.messages.map((message) => message.ruleId);
    assert.ok(rules.includes('@typescript-eslint/no-unused-vars'), filePath);
    assert.ok(rules.includes('@typescript-eslint/no-explicit-any'), filePath);
  }
});
