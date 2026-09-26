# Garden Studio AR (`apps/mobile`)

The phone app that will show a finished garden design at real size in the real garden. It is an
Expo (SDK 57, React Native 0.86) app using Expo Router, inside the repo's pnpm workspace.

**Status: a skeleton.** It lists the bundled scenes, opens one, and shows what it contains and
where its alignment points are. There is no AR view yet; building it is the first milestone.

Read these first:

1. [`docs/onboarding.md`](../../docs/onboarding.md): the rest of the project in brief.
2. [`docs/ar/ar-architecture.md`](../../docs/ar/ar-architecture.md): what to build and ideas for how.

## Run it

From the repository root:

```bash
pnpm install
pnpm mobile          # builds packages/ar-contract, then starts the Expo dev server
```

Install **Expo Go** on your phone, put the phone on the same Wi-Fi as your computer, and scan the QR
code the dev server prints. You should see "Garden Studio AR" with a "Sample garden" entry. That is
the first check that everything works.

Other commands, from this folder or with `pnpm --filter @garden-studio/mobile …`:

```bash
pnpm typecheck       # tsc --noEmit
pnpm lint            # expo lint (ESLint 9 + eslint-config-expo)
pnpm test            # jest-expo; checks the sample garden against the scene format
npx expo-doctor      # checks the dependencies match the Expo SDK
```

Add native packages with `npx expo install <package>`, never with `pnpm add`, so they get the
versions this SDK expects.

## When AR is added, Expo Go stops working

AR needs ARKit or ARCore through a library such as ViroReact, which is native code that Expo Go does
not contain. So the first milestone also switches the app to a **development build**:

1. `npx expo install @reactvision/react-viro`, then add its config plugin to `app.json` (follow
   ReactVision's Expo guide for the current version).
2. Build the dev client with EAS, which needs no Mac:
   `npx eas-cli@latest build --profile development --platform ios` (or `android`). The first run
   creates `eas.json` and asks you to sign in to an Expo account.
   - **iPhone:** installing needs a paid Apple Developer account for device provisioning.
   - **Android:** can also be built locally (`npx expo run:android`) with the Android SDK.
3. Install the build on the phone, then `pnpm mobile` as before. Day to day it works like Expo Go.

AR never runs in the iOS Simulator or an Android emulator, so use a real phone. See §4 of the AR doc
for which phones.

## Where things are

```text
src/app/              screens (Expo Router: every file is a route)
  index.tsx           pick a garden
  scene/[id].tsx      what the garden contains; the "View in AR" button (placeholder)
src/scene/            where scenes come from; nothing below here knows
  source.ts           the SceneSource interface
  fixture-source.ts   bundled scenes; `sceneSource` is the one line to change to switch source
  use-ar-scene.ts     load a scene in a component
  summarise.ts        counts: nodes, triangles, plant instances
src/fixtures/         hand-written scenes; `sample-garden.ts` is the one to test against
src/ar/engine/        (empty) the only folder that will import the AR library
src/ar/placement/     (empty) pure maths for lining the design up with the real garden
src/ar/render/        (empty) pure: budgets, merging, model lookup, fallbacks
```

Each empty folder has a README saying what belongs there.

## The scene format

The app reads `ARScene` objects from `@garden-studio/ar-contract` (`packages/ar-contract`), and
nothing from the rest of the project. Always load a scene through `readARScene`. The coordinate
convention is in that package's `src/coordinates.ts`:

- metres, +Y up, right-handed;
- the origin is the ground at the garden door;
- a model's front faces +Z.

Changes to the format are made together with the web/API developer, in a PR of their own. See the
package's `CHANGELOG.md`.

## Known noise

`pnpm peers check` at the root reports `react-native-reanimated@4.7.0` wanting
`react-native-worklets@0.13`. It comes from a circular optional peer between `@expo/cli` and
`expo-router` that pnpm resolves separately. The app itself links reanimated 4.5.1 and worklets
0.10.1, the versions SDK 57 pins, and `npx expo-doctor` passes.
