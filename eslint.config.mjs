import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.mjs',
            'vitest.config.ts',
            'apps/web/postcss.config.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  {
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'node:*',
            'fs',
            'fs/*',
            'path',
            'os',
            'child_process',
            'http',
            'https',
            'better-sqlite3',
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'process',
        'Buffer',
        '__dirname',
        '__filename',
        'require',
        'window',
        'document',
        'localStorage',
        'fetch',
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'engine must be pure: pass time and seeds in through config',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'engine must be pure: pass time and seeds in through config',
        },
      ],
      'no-restricted-syntax': ['error', "NewExpression[callee.name='Date'][arguments.length=0]"],
    },
  },
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'node:*',
            'fs',
            'fs/*',
            'path',
            'os',
            'child_process',
            'http',
            'https',
            'better-sqlite3',
          ],
        },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'data/**'],
  },
);
