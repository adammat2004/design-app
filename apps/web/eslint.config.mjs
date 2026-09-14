import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    /*
     * An argument named for the contract it fills, not for whether this implementation uses it.
     *
     * The same rule the API config carries, and it arrived here for the same reason: a typed test
     * double has to declare the parameters of the function it stands in for — `vi.fn((_planId,
     * _events) => …)` — or the mock's `calls` tuple is empty and every assertion on it is a type
     * error. Renaming them away is not an option, because the position *is* the signature.
     */
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
