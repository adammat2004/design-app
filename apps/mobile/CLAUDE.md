@AGENTS.md

## This app in Garden Studio

- It is the AR viewer for designs made in the web app. It never edits a design. Read
  `docs/ar/ar-architecture.md` before changing anything structural, and `docs/onboarding.md` for the
  rest of the repo.
- It imports `@garden-studio/ar-contract` and nothing else from the monorepo. Never import
  `@garden-studio/schema` here.
- Every scene is read through `readARScene`. The renderer draws what the scene says and never
  computes a position, a size or a layout itself.
- Only `src/ar/engine/` may import the AR library.
- `pnpm typecheck`, `pnpm lint` and `pnpm test` must pass: the root `pnpm lint` and `pnpm test` run
  them too.
