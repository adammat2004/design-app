# Garden Studio: a guide for a new developer

This is the short version of the project, written for someone joining it. The long version is
`CLAUDE.md` at the root, which is over 3,000 lines of decisions and the reasons for them. Read this
first, then use `CLAUDE.md` as a reference; there is a reading list at the end.

If you are here to build the AR app, read this, then [`docs/ar/ar-architecture.md`](ar/ar-architecture.md),
then [`apps/mobile/README.md`](../apps/mobile/README.md).

## What the product is

A homeowner describes their garden: the shape of the plot, where the house and its doors are, what
is already there, and what they want. The app then generates three garden designs, lets them edit
one, and shows a schedule of materials.

The one idea everything else rests on: **a design is real geometry, never a picture.** Every patio,
lawn, tree and table is a polygon, rectangle, circle or line in metres, and that data is the source
of truth. The 2D plan, the focused 3D structure editor, the PNG export and (soon) the AR view are all
drawn _from_ it. That is why the app can measure areas, count slabs, check that nothing crosses the fence,
and why the AI can never place anything directly (more on that below).

## The repository

```text
apps/web            Next.js 16 (App Router) — the whole user-facing wizard and editor
apps/api            NestJS — stores plans, validates geometry with PostGIS, generates designs, AI assistants
apps/mobile         Expo / React Native — the AR viewer (skeleton only; see docs/ar/)
packages/schema     Zod schemas + pure geometry helpers, shared by web and api
packages/ar-contract  The AR scene format, shared by whatever builds scenes and the mobile app
tools/assets        Offline image-generation tool for the plan's textures and sprites
docs/               Longer write-ups (this file, the AR architecture, asset style guides)
```

It is a **pnpm workspace** (`pnpm-workspace.yaml`). Shared packages compile to `dist/` and the apps
import the compiled output, so **after changing `packages/schema` or `packages/ar-contract`, rebuild
it** (`pnpm --filter @garden-studio/schema build`). Type errors in an app that look stale usually mean
this.

## Running it

```bash
./script/setup        # installs, starts Postgres+PostGIS in Docker, builds shared packages, migrates, runs tests
pnpm dev              # API on :3001, web on :3000
pnpm mobile           # the Expo dev server for apps/mobile (scan the QR code with Expo Go)
pnpm test             # every package's unit tests (the API's need the database up)
pnpm lint
```

You need Node 20 to 24 (`.nvmrc` says 24), pnpm (run `corepack enable`) and Docker Desktop for the
database. Env files are `apps/api/.env` (created from `.env.example` by setup) and
`apps/web/.env.local`. The AI features need an `ANTHROPIC_API_KEY` in `apps/api/.env`. **Everything
works without one**; the assistant panels just say they are unavailable.

## The wizard

`/` is a landing page. `/plan` creates a plan and redirects to `/plan/<id>/map`. There are six steps,
each owning one section of the stored document:

| Step | Route      | Owns       | What the user does                                                                                        |
| ---- | ---------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| 1    | `map`      | `site`     | Draws the plot (starts from a rectangle preset), places the house, marks doors, gates and the street side |
| 2    | `features` | `features` | Marks what is already in the garden and should be kept; optional                                          |
| 3    | `brief`    | `brief`    | Picks spaces (pictures), a style, budget and maintenance level                                            |
| 4    | `concepts` | `concepts` | Sees three generated designs and chooses one                                                              |
| 5    | `editor`   | `layout`   | Edits the chosen design on a canvas, or asks the AI designer for changes                                  |
| 6    | `review`   | nothing    | Schedule of materials and cost band, all derived at read time                                             |

`/projects` lists saved plans. Every step autosaves each section to the API about 800 ms after an
edit.

## The data model

All of it is in `packages/schema/src/plan/`, and all of it is Zod.

**`PlanDocument`** (`document.ts`) is one JSON document per plan, stored in a `jsonb` column:

```text
{ version, unit, site, features, brief, concepts, layout }
```

`readPlanDocument` migrates old documents on read. Zones (front, back, left, right) are **not
stored**: they are recomputed from the boundary and the house every time (`computeZones`). This
"derive, don't store" rule appears everywhere. A stored copy of something derivable can only go
stale.

**`site`** (`site.ts`) holds the boundary vertices, the `house` footprint (outline, walls, doors and
windows, storeys, roof covering), gates, which side faces the street, boundary styles (fence, wall,
hedge and so on), `orientation` (which way north is) and an optional `location`.

**`layout.elements: DesignElement[]`** (`concepts.ts`) is the design itself, and it is what the AR
app will show. Each element has:

- `id`, `category` (`lawn`, `planting-bed`, `paved-area`, `gravel-mulch`, `structure`,
  `water-feature`, `furniture`, `lighting`, `existing-feature`), `role` (`fill` or `feature`), `zone`
- `shape: PlanGeometry`, which is one of:
  - `{ kind: 'rect', centre, width, depth, rotation }`: a patio, a shed, a table
  - `{ kind: 'polygon', points, cornerRadius }`: a lawn, a bed
  - `{ kind: 'point', at, radius }`: a tree (the radius is the canopy)
  - `{ kind: 'polyline', points, width }`: a path
- optional `material`, `symbol` (what a thing _is_: `pergola`, `dining-set-4`, `tree-fruit`, from
  `symbols.ts`), `elevation` (metres above ground), `height`, `name`, `hidden`, and more.

**Array order is drawing order.** Base fills (a whole zone of lawn) come first and things are drawn
over them, so surfaces overlap on purpose.

## Coordinates

- **Metres**, always. The ft/m setting only changes what is displayed.
- **Origin at the top-left of the plot, +x to the right, +y _down_** the screen. The y-down choice
  came from the canvas library.
- **Rotations are degrees clockwise** as seen on screen (`rotatePoint` in `geometry/primitives.ts`).
- `site.orientation` is degrees clockwise from screen-up to true north.
- Heights are separate numbers: `elevation` is where a thing's base sits; `heightFor(element)`
  (`heights.ts`) is how tall it is.

The AR scene uses a different, 3D convention. The mapping between the two is defined in exactly one
place, `packages/ar-contract/src/coordinates.ts`, and explained in the AR doc.

## Geometry is authoritative, and the AI never places anything

**`geometryOutline`** (`features.ts`) turns every shape kind into a ring of points. The canvas, the
PostGIS validator and the schedule all use that same function, so what you see is exactly what is
checked. Circles are always 16-sided.

**Validation** runs in PostGIS on the server (`apps/api/src/plan/geometry-validation.service.ts`):
things must stay inside the boundary. Invalid drafts are saved _and reported_, never rejected.

**Generation** (`apps/api/src/plan/generation/`) is deterministic and seeded. It composes a garden
(a terrace at the doors, a lawn, borders, rooms, paths, trees), then a pure "design agent" scores it
against landscape-design principles.

**The AI assistants** (`apps/api/src/plan/assistant/`) turn a sentence into _structured intent_
("make this bigger by a factor of 1.2", "move it towards the house"). Deterministic code turns that
into geometry. The intent type has no field that can hold a coordinate, so the model cannot place
anything even if it tried. Keep this pattern: the AR app follows the same rule, drawing what the
geometry says and never inventing a layout.

## The API

NestJS, routes under **`/plan-projects`** (see the table in `README.md`). Every write carries a
`revision`, and a stale one gets a 409. `GET /plan-projects/:id` returns `{ id, name, document,
revision, createdAt, updatedAt }`.

**There is no authentication.** `apps/api/src/main.ts` also calls `listen` without a host, so the
server accepts connections on every network interface, not just localhost. Anyone on the same Wi-Fi
could read and edit plans and spend the AI key. That has to be fixed before a phone is allowed to
talk to it; see the AR doc.

The tests (`vitest`) run against a real PostGIS, not mocks. Don't run two copies of the API suite at
once, because they share the dev database and slow each other to a crawl.

## How the plan is drawn (for context, not for reuse)

`apps/web/src/lib/render/` and `apps/web/src/lib/materials/` hold the 2D renderers:

- **Konva** is the interactive canvas.
- **Canvas2D** draws thumbnails and exports.
- **PixiJS** composites the plan's ground and planting under the editor's Konva canvas.

(The tilted 2.5D "Visualise" view was removed in September 2026.)

They paint with about 200 AI-generated **images** (`apps/web/public/assets/`: top-down textures and
sprites). **None of this is 3D, and none of it should be imported by the mobile app.** It is built
around 2D canvases and the browser. Three things are reusable as data:

- **the seamless ground textures** (`public/assets/plan/textures/tex-*`, `face-*`), which are exactly
  what a textured ground plane in AR needs;
- **the pure geometry** in `packages/schema`;
- **a configurable structure's parts** — `resolveStructure` → `structureParts` in
  `packages/schema/src/plan/structure/`, the same boxes the web's 3D structure editor (React Three
  Fiber) renders, with finishes shaped like `ARMaterial`. A pergola's `solid` node is those parts
  through `boxMesh`. See "Structures in 3D" in `CLAUDE.md`.

## Conventions

- Zod for all validation, front and back.
- British spelling in anything a user reads.
- `data-testid` / `testID` for test hooks.
- Comments explain _why_, not what.
- **The repository owner handles git.** Don't commit to someone else's area; see "Who owns what" in
  the AR doc.

## What to read in `CLAUDE.md`

Search for these headings, in this order:

1. **"Current status"**: what exists today (long, but skim it).
2. **"Decisions worth knowing"**, the first dozen paragraphs: document storage, validation,
   revisions, `geometryOutline`, rectangles being centre-anchored.
3. **"Heights live in a manifest"** and **"`site.orientation` is read by the sun model"**: the
   vertical facts the AR builder will need.
4. **"Structures in 3D"**: the web's 3D structure editor, the persisted `structure` configuration
   and how the AR builder is meant to consume it.
5. **"Traps already hit"**: environment gotchas (Postgres JIT, pnpm, Konva, jsdom).
