# Garden Studio AR: what to build, and ideas for how

_Written 26 September 2026 for the developer taking on the mobile AR app. Read
[`docs/onboarding.md`](../onboarding.md) first if you have not seen the rest of the project._

The goal: a React Native app that loads a finished garden design and shows it **at real size, in the
real garden**, so someone can walk round their future patio before anyone lays a slab.

This document is guidance, not a specification. The parts marked **decided** are the boundary
between the two halves of the project and should only change by agreement. Everything else is a
recommendation you are free to improve on, ideally writing down why.

**What exists today:**

- **`packages/ar-contract`**: the scene format both sides share (draft v0), the coordinate
  convention, and small mesh helpers, all tested.
- **`apps/mobile`**: an Expo app that runs in Expo Go. It lists and opens a hand-written sample
  garden and shows what it contains. There is no AR yet; that is the first milestone.

---

## 1. The shape of the system

```text
                 web / API side (developer A)                  |      mobile side (developer B)
                                                               |
PlanDocument ──► buildARScene()  (not written yet) ──► ARScene ──► SceneSource ──► AR renderer ──► camera
(stored plan)    pure TS, reuses packages/schema               |    (fixture, file,      (Viro, in
                 decides every position, size, mesh            |     or API)             ar/engine/)
                                                               |
                          packages/ar-contract ◄───────────────┴──── the only shared code
```

Three rules make this work.

1. **The mobile app is a viewer, never an editor.** The web app owns creating and editing a design.
   The phone never writes geometry back.
2. **Geometry is decided before it reaches the phone (decided).** A builder on the web/API side turns
   the stored plan into an `ARScene`: every position, size, rotation and triangle is worked out
   there, using the same geometry code the rest of the app uses. The renderer draws what it is
   given. It never invents a position, stretches a layout or re-lays anything. This is the same
   rule the whole project follows: the AI never places anything, and the renderers have no
   authority over the geometry.
3. **The phone never reads `PlanDocument` directly (decided).** It only reads an `ARScene`. That
   keeps it independent of the web editor's data model, which changes often. It also keeps it from
   importing `packages/schema`, which is about 60 modules including the whole design agent.

## 2. The scene format: `packages/ar-contract`

Source: `packages/ar-contract/src/scene.ts`. It depends on `zod` and nothing else, and it has no
React, so both the phone and the server can import it.

```text
ARScene {
  format: 'garden-studio/ar-scene', version, minReaderVersion
  source      which plan, which save, which builder made it
  frame       units 'm', +Y up, right-handed; origin (and where it is in the plan);
              houseOutward, north (advisory), location
  bounds      min/max corner in metres
  ground      { kind: 'flat', boundary }             // no terrain model yet, same as the plan
  referencePoints  house corners, door, boundary corners: what the user taps to align
  materials   id → { baseColor, roughness, metalness, texture: { key, tileSizeM } | null }
  nodes       surface | solid | model | plants
}
```

The four node kinds are the whole vocabulary a renderer has to understand:

| Kind      | What                                           | Examples                                                                              | Carries                                                   |
| --------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `surface` | Flat ground cover at a height                  | lawn, patio, gravel, path, a bed's soil, water                                        | `y`, `material`, `outline`, `mesh`                        |
| `solid`   | Built things whose shape comes from the plan   | house, fences, walls, hedges, retaining, steps, edging, **pergola, shed, raised bed** | `parts: [{ material, mesh }]`                             |
| `model`   | A product drawn from a 3D model file           | furniture, play equipment, lights, trees, specimen shrubs                             | `model` key, `position`, `yaw`, `size`, `fit`, `fallback` |
| `plants`  | A bed's infill as instances of one clump model | perennials, grasses, ground cover                                                     | `plant` key, `instances[]`                                |

**Rules the format fixes (decided):**

- **The builder triangulates.** Surfaces and solids arrive as meshes (positions, normals, UVs,
  indices), so the renderer draws triangles and never runs polygon maths itself.
  Counter-clockwise triangles are the front face (the glTF rule). UVs are in world metres divided
  by the material's `tileSizeM`, so texture tiling comes from the data, not from engine settings.
- **Surfaces never overlap.** The plan stacks them on purpose (a lawn covers a whole zone and a
  patio is drawn on top). In a 3D engine that causes z-fighting, a flicker where two surfaces sit at
  the same height. The builder cuts each surface by everything above it, so the renderer needs no
  layering trick.
- **`size` is authoritative and there is no `scale` field.** A scale only means something against a
  particular model file. The renderer divides `size` by the model's measured natural size:
  - `contain` fits one uniform scale inside the footprint, for furniture, which is never distorted;
  - `stretch` makes width, height and depth exact, for trees, whose spread and height the plan
    states.
- **Structures are solids, not models.** A pergola or shed is whatever rectangle the design gave it,
  so no single model file fits. The builder generates posts, beams and walls from the rectangle.
  (The 2D renderer made the same call: it draws structures from their outline, not from a
  photograph.)
- **Models are named by a key, never a file.** `ModelKey` is the list of product symbols from
  `packages/schema/src/plan/symbols.ts`: `dining-set-4`, `bench`, `tree-fruit` and so on. Which
  `.glb` draws a key is the renderer's business, in its model manifest. A missing model draws its
  `fallback` shape (box, cylinder or simple tree) at the right size, never nothing.
- **Things that already exist are flagged.** The house, existing fences and features the user said
  to keep have `existing: true`, and are usually `visibleByDefault: false` because the real one is
  in front of the camera. Later they can become invisible "occluders" that hide virtual things
  behind real walls.
- **Versioning:**
  - Changes are additive: new optional fields, or new node kinds an old reader can skip.
  - A breaking change bumps `AR_SCENE_VERSION`.
  - `readARScene` refuses a scene whose `minReaderVersion` is newer than the app, before validating
    it, so the user is told to update the app rather than shown a schema error.
  - Any change goes through both developers (see `packages/ar-contract/CHANGELOG.md`).

**Always read a scene with `readARScene(raw)`**, never `ARSceneSchema.parse` directly. It also checks
that every material a node names exists.

## 3. Coordinates (decided)

Getting this wrong mirrors or rotates everything, and it can look plausible for a long time before
anyone notices. So there is exactly one definition, in `packages/ar-contract/src/coordinates.ts`,
and a test (`coordinates.test.ts`) pins it against the plan's own rectangle maths.

|                         | The plan (today)                                              | An AR scene                                                                                       |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Units                   | metres                                                        | metres                                                                                            |
| Axes                    | +x right, **+y down the screen**, origin top-left of the plot | right-handed, **+Y up**; ground is the XZ plane (the glTF / ARKit / ARCore / three.js convention) |
| A point on the ground   | `(x, y)`                                                      | `(X, Z) = (x − origin.x, y − origin.y)`                                                           |
| Height                  | `elevation` + `heightFor(element)`                            | `Y`                                                                                               |
| Rotation                | degrees **clockwise** on screen                               | `yaw`, radians about +Y: **`yaw = −degrees × π / 180`**                                           |
| North                   | `site.orientation`, degrees clockwise from screen-up          | `frame.north`, a unit vector; **advisory only**                                                   |
| Which way the garden is | `gardenDirection(site)`                                       | `frame.houseOutward`, a unit vector                                                               |

Why this works: +X right, +Y up and +Z pointing "down the plan's page" is a right-handed set of axes.
So mapping `x → X` and `y → Z` is a plain translation. It does not mirror anything: the garden seen
from above in AR looks exactly like the plan. The only sign that flips is rotation. Clockwise on the
plan is anticlockwise about +Y by the right-hand rule, hence the minus.

**The origin** is the scene's `[0, 0, 0]`: ground level at the foot of the garden door (the patio or
back door). If there is no door, it is the midpoint of the house wall facing the garden; with no
house, the middle of the plot. It sits at ground level, not on the door sill, which is usually
100 to 200 mm higher. It is the most recognisable point in a real garden and the one every design is
laid out from. `frame.origin.plan` records where it is in plan coordinates, so converting back is
exact.

**Models:** the pivot is at the bottom centre, +Y up, and the **front faces +Z** at `yaw` 0, which is
plan +y, down the page. Width runs along X, depth along Z. The plan itself has no idea of "front",
so this is a convention, and whoever makes or converts models must follow it.

**Placing the garden in the real world** is one transform on one root node: a translation plus a
rotation about the vertical axis, with scale fixed at 1. Nothing inside the scene is ever moved.

## 4. Choosing the AR technology

As of September 2026, the realistic options were:

| Option                                                                     | What it is                                                                                                                                                    | Verdict                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ViroReact** (`@reactvision/react-viro`)                                  | React components over ARKit (iOS) and ARCore (Android). Maintained by ReactVision (v3.0.x, Sep 2026), with an Expo config plugin and New Architecture support | **Recommended starting point.** It has plane detection, hit testing, anchors, GLB models, light estimation and depth/occlusion. Risks to test early: custom meshes (`ViroGeometry`), no GPU instancing, and an older renderer |
| expo-gl + three.js + a native AR module (e.g. `expo-ar` 0.1)               | Draw with three.js, get tracking from a separate module                                                                                                       | Most rendering control, but the AR module is very new, and getting the camera image into GL is the fragile part. Plan B                                                                                                       |
| A custom Expo native module: RealityKit (iOS) + ARCore/SceneView (Android) | Write the AR view natively on each platform                                                                                                                   | Best quality and the best route to LiDAR and occlusion, but two native codebases in Swift and Kotlin. A product-stage option, not a project-stage one                                                                         |
| Babylon React Native                                                       | Babylon.js engine inside RN                                                                                                                                   | React Native support lags badly. No                                                                                                                                                                                           |
| Unity as a library                                                         | Embed a Unity scene                                                                                                                                           | Heavy, a second toolchain, a large app. No                                                                                                                                                                                    |
| WebXR in the browser                                                       | AR in a web page                                                                                                                                              | Works on Android Chrome only; iOS Safari still has no AR mode. No                                                                                                                                                             |
| Quick Look / Scene Viewer                                                  | The phone's built-in viewer for one USDZ/GLB file                                                                                                             | Zero-code, but it shows a single object with no custom alignment. A demo fallback at most                                                                                                                                     |

**Keep ViroReact behind `apps/mobile/src/ar/engine/`.** Nothing outside that folder should import it,
so swapping to plan B later rewrites one folder.

### Why not Expo Go, and what you need instead

**Expo Go can't do AR.** Expo Go is a fixed app containing only the native modules Expo ships.
ARKit/ARCore access, and Viro's renderer, are extra native code, so they need a
**development build**: your own build of the app with those modules compiled in.

- **Day to day it feels like Expo Go.** Install the dev build on the phone once. After that you
  write TypeScript and Metro serves it with fast refresh. You only rebuild when native dependencies
  change.
- **You don't need a Mac to build.** EAS Build (`npx eas-cli@latest build --profile development`)
  compiles in the cloud. Installing on an iPhone needs a paid **Apple Developer account**
  (£79 a year) for device provisioning. Xcode on a Mac is only needed to build locally
  (`npx expo run:ios`).
- **Android** dev builds can be built locally with the Android SDK on any OS, or on EAS.
- **AR does not run in simulators or emulators.** A physical phone is required for anything in the
  AR view.

**Which phones:**

- **iPhone:** any iPhone that runs the current iOS (roughly an iPhone 11 or newer) does world
  tracking, plane detection and people occlusion. **LiDAR** (the Pro models from the 12 Pro) makes
  ground detection faster and allows depth-based occlusion. It's nice to have, not required.
- **Android:** any phone on Google's ARCore supported-devices list. The Depth API is on a subset.
- **Which first:** start with whichever phone you own, since Viro code is the same on both. Prove
  the result on the other platform before calling placement done.

**Until Viro is added, the skeleton runs in Expo Go.** That is deliberate, so you can see the app on
your phone on day one.

## 5. The first milestone: prove scale

The smallest thing worth building:

1. Add ViroReact and switch to a dev build, installed on your phone.
2. Open an AR view and show feedback while it looks for the ground.
3. Detect a horizontal plane, then tap to place an anchor.
4. At the anchor, draw the sample garden's **3 × 3 m pergola** (its `solid` node is already in
   `sample-garden.ts`, built from boxes) and a **1 m cube**. Two fingers turn it.
5. Walk round and through it. **Check it with a tape measure** against a real 3 m and 1 m. Aim for
   within 3%.

While doing it, also find out:

- Does a `Mesh` from the contract render through Viro's custom geometry, with a tiled texture and
  correct lighting?
- Does one free GLB model load?
- Do 300 simple nodes hold 30 fps on your phone?
- Does the pnpm workspace plus the Viro config plugin build cleanly?

Write the answers down. They decide whether Viro stays.

**It proves:** the toolchain, ground detection, anchoring, true metric scale, stable tracking while
walking, custom meshes and a rough performance ceiling.

**It does not prove:**

- lining a whole garden up with a real house;
- accuracy 15 m away (tracking drifts, and sloping ground makes a flat design float or sink);
- whether flat surfaces are readable outdoors in sunlight;
- how it copes with hundreds of plants;
- occlusion;
- the other platform.

## 6. Where scenes come from

`apps/mobile/src/scene/source.ts` defines the seam:

```ts
interface SceneSource {
  list(): Promise<SceneSummary[]>;
  load(id: string): Promise<ARScene>;
}
```

Everything below `src/scene/` works on an `ARScene` and never knows where it came from. Three
sources, in the order they are likely to exist:

1. **`fixtureSource`: bundled scenes.** Exists now, with the hand-written `sample-garden.ts`. Later,
   generated scenes from the eleven real plans in `apps/web/scripts/fixtures/*.plan.json` get added
   here as JSON, once the builder exists.
2. **`fileSource`: an `.ar.json` exported from the web app.** A "Download AR scene" button on the
   web review screen, and "open file" on the phone. This gets real designs onto a phone without the
   phone ever talking to the server.
3. **`apiSource`: fetched over the network.** Last, because the API needs securing first (see §10).

Switching is one line: `export const sceneSource = …` in `fixture-source.ts`. Every source must pass
its result through `readARScene`.

## 7. Placing the design in the real garden

Placement only ever sets the transform on the scene's root node. Ideas, in order of effort:

1. **Tap and turn (first milestone).** Tap the ground at the garden door, then twist to rotate.
   Quick to build, but coarse: one degree of error is 17 cm at 10 m.
2. **Two points on the house wall (the real v1).** The scene carries `referencePoints`. The app
   shows the plan with the two ends of the back wall highlighted, the user taps the ground at the
   foot of each, and the app solves the rotation from the two directions and the translation from
   the first point. Keep the scale at 1, and **compare the tapped distance with the design's**.
   Anything over about 3% out means the plan's house is drawn at the wrong size, which is worth
   telling the user. Then offer small nudge buttons and a Confirm.
3. **Tabletop mode**, clearly labelled: the whole garden at 1:50 on a table. Useful for testing
   indoors and for demos. Never offer rescaling in real-size mode, because real size is the point.
4. **Later:**
   - a third point, to tilt the ground plane for a sloping garden;
   - more points with an error shown;
   - a printed marker at a known spot;
   - saving the placement with ARKit world maps or ARCore Cloud Anchors;
   - LiDAR, to snap to the real wall automatically.

Keep `src/ar/placement/` pure TypeScript with tests. The maths is easy to get subtly wrong and easy to
test.

## 8. Areas versus objects

| Plan element                                               | In AR                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| lawn, patio, gravel, beds, water, paths, decking           | `surface`: a textured flat mesh. Consider semi-transparent by default, with a toggle, so the real ground stays visible                      |
| raised terraces, retaining walls, steps, edging            | `solid`: the builder derives them from the same functions the 2D plan uses (`levelBands`, `stepFlight`, `resolveEdges`)                     |
| fences, walls, hedges                                      | `solid`: from `boundaryRuns(site)`, which already gives height and thickness per side                                                       |
| the house                                                  | `solid` walls and roof; hidden by default, later an occluder                                                                                |
| pergola, shed, gazebo, greenhouse, garden room, raised bed | `solid`: generated from the rectangle                                                                                                       |
| furniture, play, lights, hot tub, trees, specimen shrubs   | `model`                                                                                                                                     |
| a bed's infill                                             | `plants`: sampled like the 2D plan, then thinned to a budget, so the AR bed is a sparser version of the drawn one, not a different planting |

**Ground textures already exist.** The web app's seamless top-down textures
(`apps/web/public/assets/plan/textures/`: `tex-standard-turf`, `tex-gravel-paving`, `tex-soil`,
`face-porcelain-tile`, `face-stone-setts`…) are exactly what a textured ground plane needs. The
sample garden's materials already name them as texture keys, with their real tile sizes. They are
WebP; check that Viro accepts WebP, and convert to PNG/JPG when copying them in if it doesn't.

## 9. 3D models

- **Format:** glTF 2.0 binary (**GLB**). Viro loads it on both platforms. USDZ is only needed if
  Apple Quick Look is ever used.
- **Where they come from, at first:** free CC0 libraries (Poly Haven, Quaternius, Kenney). Record
  each one's licence and source.
- **A model manifest** in `apps/mobile/src/models/` maps each `ModelKey`/`PlantKey` to a file, with
  what the renderer needs to fit it. A suggested shape:

  ```ts
  interface ModelSpec {
    key: ModelKey | PlantKey;
    file: string; // require('../../assets/models/bench.glb')
    naturalSize: [w: number, h: number, d: number]; // measured from the file, in metres
    pivot: 'base-centre';
    front: '+z';
    triangles: number;
    maxTexturePx: number;
    lods?: { file: string; triangles: number; fromDistanceM: number }[];
    licence: string;
    source: string;
  }
  ```

  Measure `naturalSize` from the file rather than typing it. A small script that reads each GLB's
  bounding box and checks the pivot and triangle count saves hours of "why is this bench floating".

- **Budgets to start from:**
  - a hero model (tree, pergola) ≤ 15k triangles;
  - furniture ≤ 5k;
  - a plant clump ≤ 1.5k;
  - textures ≤ 1024 px (plants 512).
- Bundle the models in the app at first, which works offline and loads instantly. Move to downloaded
  files only when the app gets too big.
- **A web 3D view now exists, for single structures** (Sep 2026): the structure editor in
  `apps/web/src/components/structure-3d/`, fed by `apps/web/src/lib/structures/model-registry.ts`.
  Today every structure there is procedural — `structureParts` from `packages/schema`, sized from the
  rect — and structures stay `solid`s in the AR contract for the same reason. When production GLBs
  arrive (for furniture keys, or to dress a structure's parts), move the manifest to a shared package
  so the web and the phone use the same files and the same group → node naming.

## 10. Talking to the API (later)

The server side, when it is built (developer A):

- **`GET /plan-projects/:id/ar-scene`** returns an `ARScene` built from the stored plan when it is
  requested. It is **not stored**, for the same reason zones and the review schedule aren't: a
  stored copy of something derivable goes stale. Its `ETag` is the plan's revision plus the builder's
  version.
- **Fix the network exposure first.** `apps/api/src/main.ts` calls `listen(port)` with no host, so
  the API currently accepts connections from **every device on the network**, with no
  authentication. Anyone on the same Wi-Fi can read and edit every plan and spend the AI key. So:
  1. bind to `127.0.0.1` by default;
  2. for phones, add **read-only share links**: `POST /plan-projects/:id/ar-links` returns a random
     token, and `GET /ar/:token` returns that one scene and nothing else;
  3. add a guard so a request from another device can only reach `/ar/*`.

  The web app can show the link as a QR code. The phone should never talk to the editing API.

- **Phone networking during development:** iOS needs the local-network permission and an App
  Transport Security exception to fetch plain `http://`, and Android dev builds need cleartext HTTP
  allowed. The `.ar.json` file route (§6) avoids all of this, which is why it comes first.

## 11. Performance

Things to watch from the start:

- **Viro has no GPU instancing**, so each plant is its own node and draw call. Plant count is the
  first thing that will hurt. The builder should cap instances (a few hundred per scene) and group
  small beds into clumps.
- **Merge meshes that share a material** into one before drawing. `mergeMeshes` in the contract does
  this.
- **Large translucent ground planes** cost overdraw; measure before making everything see-through.
- **Level of detail:** swap to simpler models far away, and cull what is behind the camera.
- **Avoid:**
  - one node per paving slab;
  - a plant at the density the 2D plan draws;
  - shadows baked into textures (they point the wrong way once the garden is rotated);
  - a separate material per object when one shared material would do.
- `summarise()` on the scene screen already reports triangles and plant instances. Watch those
  numbers.

## 12. Who owns what

|        | Developer A (web, API, geometry)                                                                                                                  | Developer B (mobile, AR)                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owns   | `packages/schema`, `apps/api`, `apps/web`; the future scene builder, the `/ar-scene` endpoint and share links, the web "Download AR scene" button | `apps/mobile`: Expo and EAS setup, the Viro adapter, placement, rendering, performance; 3D model files and their manifest; the hand-written fixture |
| Shares | `packages/ar-contract` and `docs/ar/`                                                                                                             | the same                                                                                                                                            |

**How to avoid treading on each other:**

- **Stay in your own folders.** A never edits `apps/mobile`, and B never edits schema, API or web.
  If you need something from the other side, open an issue or ask.
- **Contract changes are their own small PR**, touching only `packages/ar-contract` (plus its
  changelog and fixtures), reviewed by both. The builder and the renderer catch up in separate PRs.
  Prefer additive changes.
- **The lockfile:** never hand-merge `pnpm-lock.yaml`. Take either side, then run `pnpm install`.
- **Before pushing:** `pnpm --filter @garden-studio/mobile typecheck`, `lint` and `test`, and
  `pnpm --filter @garden-studio/ar-contract test` if you touched the contract.

## 13. Roadmap

| Phase            | Mobile (B)                                                                                                                                                       | Web/API (A)                                                                                                  | Done when                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **1. Spike**     | §5: Viro, dev build, pergola + cube at true scale, the four measurements                                                                                         | Fix the API's host binding; ~~move the pure structure geometry into `packages/schema`~~ (done for pergola/gazebo: `plan/structure/parts.ts`); move the roof geometry | Scale within 3%, and a decision on Viro                 |
| **2. Renderer**  | Draw every node kind from the sample garden; fallbacks for models; tap-and-turn; tabletop mode                                                                   | Start the builder (`PlanDocument → ARScene`) and generate scenes for the eleven fixture plans                | The sample and the generated scenes render on the phone |
| **3. Placement** | Two-point house-wall alignment, nudge, confirm; test on the second platform                                                                                      | "Download AR scene" from the web; the phone opens `.ar.json` files                                           | A real design lined up in a real garden                 |
| **4. Surfaces**  | Textures, translucency toggle, merged meshes                                                                                                                     | Levels, steps, edging, boundary kinds, house and roof in the builder                                         | Paths, patios and lawn read correctly outdoors          |
| **5. Models**    | GLB models and manifest, level of detail, plant clumps, budgets                                                                                                  | Model keys for every symbol; tune the plant budget                                                           | A full garden at 30 fps or better                       |
| **6. Network**   | `apiSource`, open by QR code                                                                                                                                     | The `/ar-scene` endpoint, share links, network guard                                                         | A design edited on the web opens on the phone           |
| **7. Polish**    | Occlusion (people, depth, LiDAR), light estimation, sun position from `site.location`, sloping-ground alignment, saved anchors, a "how it grows" maturity slider | Contract additions as needed                                                                                 | Demo quality                                            |

## 14. Risks

1. **Viro's limits**: custom meshes, no instancing, renderer quality. The spike answers this; the
   `ar/engine/` folder limits the damage.
2. **Real gardens are not flat, and tracking drifts.** Expect 10 to 30 cm of error across a large
   garden at first. Two-point alignment, then a tilt fit, are the answers.
3. **Outdoors is hard for AR.** Bright sun, and a uniform lawn with few features for tracking. Test
   outside from the first week.
4. **Monorepo friction.** Expo in a pnpm workspace works (this skeleton bundles), but native
   autolinking with Viro is untested. If it fights the workspace, it is better to take `apps/mobile`
   out of the workspace than to change how the whole repo installs packages.
5. **The API's network exposure** (§10) must be fixed before any phone talks to it.
6. **Model licensing and app size.**
7. **The AR planting is a thinned subset of the 2D planting.** Say so in the app.

## Sources for the technology survey

- [ReactVision/viro releases](https://github.com/ReactVision/viro/releases)
- [@reactvision/react-viro on npm](https://www.npmjs.com/package/@reactvision/react-viro)
- [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57)
- [Expo: work with monorepos](https://docs.expo.dev/guides/monorepos/)
- [expo-ar](https://www.stewmore.dev/blog/expo-ar-arkit-arcore-react-native)
- [Babylon React Native](https://github.com/BabylonJS/BabylonReactNative)
- [SceneView](https://github.com/sceneview/sceneview)
- [WebXR on iOS in 2026](https://xrdoctors.pro/blog/webxr-on-ios-what-actually-works)
