// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'drizzle/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      /*
       * A leading underscore means "this argument exists because the signature says so".
       *
       * `LayoutArchetype` is an interface several compositions implement, and a courtyard genuinely
       * has nothing to vary and nothing to read off the zone plan — so it takes the arguments and
       * ignores them. Renaming them away is not an option: the position is the contract. The
       * default `after-used` would have every such implementation either lie about its signature or
       * carry a disable comment.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
