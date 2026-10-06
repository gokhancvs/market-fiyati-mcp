import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const unusedVars = ['error', { argsIgnorePattern: '^_' }];

export default defineConfig(
  // plans/ and reports/ are local, Git-ignored archives, as in .prettierignore.
  { ignores: ['dist/', 'coverage/', 'plans/', 'reports/'] },
  {
    files: ['**/*.{js,mjs,ts}'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'module', globals: globals.node },
    rules: { 'no-unused-vars': unusedVars }
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: { '@typescript-eslint/no-unused-vars': unusedVars }
  },
  prettier
);
