# `apps/web`

The Garden Studio web app: the six-step plan wizard and the design editor (Next.js 16, App Router).

It is run from the repository root, not from here: `./script/setup` once, then `pnpm dev` (web on
:3000, API on :3001). See the root [`README.md`](../../README.md) for scripts, and
[`docs/onboarding.md`](../../docs/onboarding.md) for how the app is put together.

Things specific to this package:

- `pnpm --filter @garden-studio/web test` for unit tests (Vitest, jsdom), and `test:e2e` for
  Playwright (needs the API and the web app running).
- `render:material` and `render:plan` write judging sheets; `audit:assets` checks the image library.
- This Next.js has breaking changes from older versions. `AGENTS.md` in this folder is written by
  `next dev` itself; read it before changing framework-level code.
