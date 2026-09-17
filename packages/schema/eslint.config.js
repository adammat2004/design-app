// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**'],
  },
  ...tseslint.configs.recommended,
  {
    /*
     * An underscore means "I know, and it is deliberate".
     *
     * The same rule `apps/api` and `apps/web` already carry, added here when
     * `const { id: _id, ...element } = change.next` — the ordinary way to drop a key while copying
     * an object — failed the default rule. Renaming it away is not an option, because the binding
     * is what does the dropping.
     */
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
