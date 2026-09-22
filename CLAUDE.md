# Garden Studio — working notes

AI-assisted residential garden design tool (final-year Computer Science project). See
[README.md](README.md) for setup and scripts; this file records the decisions and traps that
are not obvious from reading the code.

## Where things are

```
apps/web          Next.js 16 App Router frontend — the plan editor
apps/api          NestJS backend — persistence + PostGIS constraint validation
packages/schema   Zod schemas and pure geometry helpers, imported by both apps
```

`packages/schema` compiles to `dist/` and both apps consume the built output, so **run
`pnpm --filter @garden-studio/schema build` after changing shared types** (or leave
`pnpm --filter @garden-studio/schema dev` running to rebuild on change). Type errors in the
apps that look stale are usually this.

## Current status

The web app is the `/plan` wizard: `/` is a thin landing page whose only job is to start it at
`/plan`, which creates a plan and redirects into it. The original single-screen editor and its
`/designs` API have been deleted.

**The whole wizard is one document.** `PlanDocumentSchema` in `packages/schema/src/plan/document.ts`
holds `site`, `features`, `brief`, `concepts` and `layout` — one section per step, each written by
the one screen that owns it. Zones are **not** in it: they are derived from the boundary and the
house by `computeZones`, so storing them could only create something stale.

**Plans persist.** Wizard URLs are `/plan/[id]/{map,features,brief,concepts,editor,review}`;
`/plan` creates a plan and redirects into it. Working end to end:

- `plan_projects` table; `POST/GET /plan-projects`, `GET/PATCH /plan-projects/:id`
- per-section writes: `PATCH /plan-projects/:id/{site,features,brief,layout,concept-selection}`
- `POST /plan-projects/validate`, side-effect free
- PostGIS spatial validation over the new model, including the house as a rotated footprint
- debounced autosave per section (`state/project-sync.ts`), real save/saving/error states in the
  bottom bar, and 409 conflict adoption
- the plan is loaded into the stores on arrival (`state/hydrate.ts`), id counters re-seeded
- **concept generation on the server**: `POST /plan-projects/:id/concepts/generate`, seeded and
  deterministic, with PostGIS computing the feasible region for each placement and true polygon
  booleans for the ground cover (`src/plan/generation/`). ~130 ms for three concepts.
- **the design assistant**: `POST /plan-projects/:id/assistant/messages` takes a sentence and
  returns a reviewable diff (`src/plan/assistant/`). Claude turns the sentence into structured
  intent; a deterministic planner turns intent into geometry. Read-only — applying a change is an
  ordinary layout patch afterwards.

- **procedural surface materials**: surfaces draw as generated texture rather than a flat hex
  (`apps/web/src/lib/materials/`). Eight pattern types — `grid`, `board`, `pack`, `scatter`,
  `hedge`, `pads`, `water`, `stripe` — cover thirty-three of the forty-three materials (all but
  `powder-coated-steel`, `steel-edging`, `rendered-block`, the three furniture materials, the three
  lighting finishes and `existing`), and the generator assigns a material to every element it
  places. `scatter` carries a `form` axis (`blob`, `tufted`,
  `clipped-mass`) so a grass is a different _shape_ from a shrub rather than a different shade. `pnpm --filter @garden-studio/web render:material` writes PNGs to a gitignored
  `.material-preview/` to look at; the contact sheet is the one to judge by.
- **the garden can change level**: `DesignElement.elevation` is real at last — it was captured in
  the editor and drawn by nothing. A raised surface gets a derived retaining face
  (`plan/levels.ts`), casts from the top of its plinth, and is served by a flight of `steps` whose
  treads are derived from the rise. The model is **local**: no ground surface, no inferred slope.
  The generator lifts a terrace only on a formal or modern brief at a high budget, and never
  without a flight down. A raised surface may name a `retaining` wall — coursed stone, brick or
  rendered block, with real faces — or keep the plain upstand in its own paving.
- **surfaces can be edged**: `DesignElement.edging` names a product from `EDGING_MATERIALS` —
  steel, brick, sleeper, setts or kerb — and `plan/edging.ts` derives where the course actually
  goes, leaving out the sides against the fence and the house and refusing a seam two beds share.
  It is the first thing on the plan measured in **linear metres**, which is what `ScheduleLine
  .lengthM` exists for. The generator edges beds where the style asks for one; the editor offers it
  on any of the four ground-covering categories.
- **the garden can be lit**: `lighting` is the ninth `ElementCategory` — four fittings
  (`light-spike`, `light-bollard`, `light-recessed`, `light-wall`), three finishes, and a scheme the
  generator composes from what it has already placed: an uplight at the foot of each tree and
  bollards down the longer paths. After dark the plan washes over and each fitting throws a pool,
  which is what finally makes the second half of Visualise's twenty-four-hour time slider mean
  something — before this, 11 pm drew the identical picture to noon. Gated on `site.location` like
  every other solar claim. `pnpm render:plan` writes `04-lighting-hours.png` to judge it by.
- **the plan reads as an enclosed garden**: a boundary drawn per edge as one of five treatments —
  fence with posts, walled with piers, hedge, railing, or an open dashed cadastral line — plus
  feature chips without zone labels and a size badge on the selected shape.

- **a generated concept contains a garden**: a planted border hugging the fence and up to five
  trees, on top of the base fills, accents and requested features.
- **symbols for the things that are not surfaces**: tree canopies, a fire pit, pergola beams. One
  `ElementDrawing` component draws every element, shared by step 4 and step 5.
- **plot dimensions** outside the fence with arrowheads, and a grid that is clipped to the plot and
  can be turned off.
- **one sun over the whole drawing**: `site.location` plus `site.sun` feed `suncalc`, and the same
  unit vector lights slab bevels, plant crowns, water crests and a real cast-shadow layer. Set a
  location in step 1's Sun and shade panel and the shadows follow the real sun through the day;
  leave it unset and the plan casts them from the conventional top-left drawing light instead,
  which says how tall things are and nothing about where the shade falls. Soft in both views, with
  the penumbra growing with the caster's height, and a **Shadows** toggle in the toolbar.
- **a schedule of materials on step 6**: areas, slab and board counts, the budget asked for against
  what the materials came to, and which requested features made it in. Every figure is derived from
  the geometry at read time; nothing is stored.
- **a way back to a saved plan**: `/projects` lists them, and the landing page links to it.

- **the plan draws with photographs and sprites**: slab and board faces, seamless tiles of gravel,
  turf, bark and water, top-down plant and tree-canopy sprites, furniture, light fittings and the
  faces of edging and walling products, all generated once by `tools/assets` with an image model and
  checked in under `apps/web/public/assets/` (203 files across 99 families;
  `pnpm --filter @garden-studio/web audit:assets` is the check that the manifest and the disk
  agree, and it exits non-zero when they do not). The app never calls an image model; a missing
  file means the procedural pattern draws instead, so everything works with no key. Every sprite
  is drawn to one versioned specification (`asset-style.ts`, `ASSET_SPEC_VERSION`) on
  `gpt-image-2.5-sunburst`; the opaque surfaces were kept from the first library. See "Rendering
  with assets" and "Asset Library v2" below.
- **furniture is a category**, `symbol` is a field, and the generator furnishes what it places: a
  lounge set on the seating patio, a dining set under the pergola, a barbecue in the outdoor
  kitchen, a bowl in the fire pit, a swing on the play area; a store is a `shed`, a veg patch a
  `raised-bed`, a pergola a `pergola`. The editor's palette offers twelve pieces of furniture and,
  since lighting landed, four fittings.
- **the house is drawn as a building**: a wall of real thickness round a floor on step 1, and a
  **roof** everywhere the design is drawn — slate, dark tile or red tile, with ridge and hip
  capping, a fascia and a rooflight on a broad plane. The door is not lost under it: the ground
  outside carries a threshold mark, which is what a landscape drawing shows. Doors and windows are
  drawn on the walls themselves in Visualise, where you can see them.
- **concept cards show the real render**, drawn by the same composer as everything else, and the
  editor and the review screen can **download the plan as a PNG** with its feature chips.
- **`pnpm render:plan`** writes whole-plan judging sheets from three captured generator fixtures
  (`apps/web/scripts/fixtures/`, refreshed by `pnpm capture:fixtures` with the API up).

- **step 1 captures how you get in and out**: patio and front doors, a side gate on a boundary
  edge, and which fence faces the street, all in an Access sub-step whose every inference is a
  one-tap chip. The generator reads all four.
- **step 2 is "the existing garden", and only maps what matters**: a quick-add grid where one tap
  arms and one tap places, a **Redesign area** tab beside it, an optional **Garden assistant** that
  takes a description and puts features on the plan, and **Skip this step** as a first-class action
  in the bottom bar. Continue has never been gated here and still is not. See "Step 2" below.
- **step 3 is a brief built from pictures, not a form**: fifteen garden *spaces* as isometric
  vignettes, four style directions as photographs, and budget, maintenance and the prose demoted to
  a quieter band underneath. Every space is honoured by generation — seven were added to
  `DesiredFeature` to get there, three of them composed rather than placed. The artwork is a second,
  much smaller manifest (`lib/brief-art.ts`, `tools/assets generate:brief`) and a missing file falls
  back to a drawn placeholder. See "Step 3" below.
- **the concepts are composed, not sampled**: a terrace across the garden doors, one lawn panel
  behind it, planting round the panel in runs, the shed in the corner nearest the gate, paths
  between them, and a front garden with a paved path to the kerb. The three concepts are three
  layout templates — "Terrace and lawn", "Sweeping lawn", "Formal axis" — and the brief's style
  picks the recommended one. See "The layout grammar" below.

- **Visualise is a live WebGL view, not a picture of one**: `buildRenderScene` resolves the plan
  once and two backends draw it — Canvas2D for thumbnails, exports and the judging sheets, PixiJS
  for the Visualise tab, which pans, zooms and answers to a planting-maturity control and a
  time-of-day slider. Planting there is lifted out of each bed's raster and drawn as sprites above
  it, so foliage overlaps its bed's edge and its neighbours; the house gets a derived roof. See
  "The render scene, and the two views" and "PixiJS, and where it earns its place" below.
- **Visualise is also _elevated_**: an oblique projection lifts anything with a height `h × RISE`
  up the screen (`RISE = tan 12°`), so a shed shows its front wall, the house shows render under
  its roof and a fence has a face. Everything built is **extruded from its own outline** rather
  than photographed, so it is correct at any rotation; everything placed is a sprite. One
  depth-sorted `RenderScene.stack` replaces the old pass order in that view, which is what lets a
  canopy fall across a roof and a border hide behind the fence in front of it. The plan view is
  untouched and its `stack` is empty. The matching **elevated asset library** (`vis-*`, `skin-*`)
  is specified in `docs/visualise-asset-style.md` and `asset-spec.ts` and **is generated** — 28
  `vis-*` and 4 `skin-*` files. A family with no twin still falls back to its plan sprite, which is
  what lets the library arrive in waves. See "Visualise is elevated" and "The two cameras" below.

**There is a measurement of how a plan composes, and it is the seed of the evaluation harness.**
`measureComposition` (`packages/schema/src/plan/composition.ts`, beside `quantities.ts`) samples a
grid over the zones in scope and classifies each point by the **topmost** element covering it, so
shares of hard landscaping, lawn, planting and base-showing-through sum to one by construction.
Element areas overlap by design — a base fill is the whole zone and everything is drawn over it —
so summing them double counts; sampling is the pure way to read coverage without a polygon-boolean
library. It has no authority: every outline came from `geometryOutline`, and deleting the file
leaves the plan dimensionally identical.

**The bands come from the traced target, not from the generator.**
`apps/web/scripts/fixtures/target.plan.json` is `target_design.png` traced by hand and scaled so the
house is 9 m wide; it measures hard 0.42, lawn 0.21, planting 0.32, with 0.02 of base showing.
`COMPOSITION_BANDS` (`apps/api/src/plan/generation/composition-rules.ts`) widens those and
cross-checks them against the usual rules of thumb. Calibrating against the generator's own output
would only ever confirm what it already did. The target renders on the judging sheet as the eleventh
fixture, which is the comparison the sheet exists for.

**The bands are asserted on the garden proper, and the whole plot is reported beside it.**
`reference-fixture.test.ts` runs the rules over 10 fixtures × 3 concepts of live generation;
`COMPOSITION_REPORT=1` prints both rows instead of asserting. The room is what the templates
control. Over the whole plot, generated plans still show 5-46% base ground against the target's 2%,
and closing that is the arrival grammar and the second side room — recorded in TODOS.md rather than
hidden by a wider band. `MEASURE_TOLERANCE` is 0.05 m because clipping to an odd room and
simplifying in PostGIS shaves centimetres off a floor the sketch guaranteed.

- **there is a designer's reading of every plan, and a benchmark over the generator**: a pure
  TypeScript design agent (`apps/api/src/plan/generation/design/`, `knowledge/`) that analyses the
  site, infers what the garden is *for*, ranks the requested features by tier, writes a strategy per
  concept slot, and scores the finished elements against eleven landscape-design principles — with the
  faults it found, each a measured sentence. `GeneratedConcept` carries `strategy`, `score` and
  `explanation`; step 4 shows the decisions and why a feature was left out.
  `pnpm --filter @garden-studio/api eval:generator` is the harness: 13 cases × 3 seeds, reporting
  validity, composition bands, score per principle, inclusion, determinism and latency. Today's
  numbers: **117/117 valid, deterministic, mean score 0.856, no critical faults, 85% of requested
  features drawn.** Nothing here moves a coordinate.
- **the scorer judges a garden against its own brief, and there is a benchmark over the scorer
  itself.** The weights follow what the concept is *for* (`knowledge/weight-profiles.ts`), four
  principles read the fields that vary by concept slot, and `maintenanceFit` is the tenth principle.
  `pnpm --filter @garden-studio/api eval:scorer` measures it against nine hand-built gardens with no
  database and no generator (`design/evaluate/gallery.ts`). **Measured**: the three concept slots
  were identical to three decimal places and now differ on every garden; a well-composed plan given
  to the wrong brief dropped from 0.97 to 0.89 under that brief while scoring 0.97+ under the other
  three; the composition pairs still separate by 0.31 to 0.39. See "The scorer reads the brief".
- **the layout is chosen rather than cycled**: seven composition archetypes
  (`apps/api/src/plan/generation/knowledge/archetypes/`), each answering for itself whether a plot
  can hold it — a refusal is honoured — with the brief's style weighed evenly against the site. Four
  of them are compositions the three original templates could not express: rooms beside each other
  on a wide shallow plot, a sequence of rooms down a corridor, a courtyard designed as a room, and a
  garden whose point is the far end. Functional zones (`design/zone-planner.ts`) position the *rooms*
  and the features are fitted inside them, so `Slot.zoneId` says which room a slot belongs to. Every
  concept carries the composition it used and the decisions it took, each naming real elements.
  **Measured against the Phase 1 baseline**: mean score 0.851 → 0.865, relationships 0.50 → 0.66,
  routes that reach nothing 59 → 46, sheds in the sightline 43 → 31, and the largest fixture four
  times faster.
- **many layouts are drawn and the best is offered**: `design/choose.ts` enumerates every suitable
  composition against the variations each offers, previews each one with no query at all
  (`design/layout-generator.ts`), scores the field on the same principles the finished plan is
  judged by, and takes the best
  that is not too like what the other slots have already taken. A candidate is judged on its score
  *and* on how well its composition suited the job; repeating a composition costs extra, because
  three cards are a promise of three answers. **Measured**: the worst plan in the fixture set went
  from 0.680 to 0.739, eight of eleven comparable fixtures improved, and the whole field of
  candidates costs a few milliseconds because nothing in it touches PostGIS.
- **what people do with a design is recorded**: `design_events` stores which concept was chosen,
  which was rerolled, and what was added, moved, resized, deleted or reset afterwards, each stamped
  with the composition the garden was drawn from (`state/design-events.ts`, `POST
  /plan-projects/:id/events`). It is the only outside opinion on the generator the project has —
  every other number is the scorer marking its own homework. Nothing in the design layer reads it,
  deliberately, because a scorer consuming its own feedback stops being inspectable.
- **the strategy can be written by a model, and the geometry never is**: with
  `DESIGN_BRIEF_LLM=true` one call per generation decides what each of the three concepts is *for*
  and how the requested spaces rank in it (`assistant/design-brief/`), reconciled field by field
  against what the user actually asked for and what the plot can hold. There is nowhere in a
  `DesignBrief` to put a coordinate, so the model cannot place anything; every failure falls back to
  the deterministic brief, so generation cannot fail because of it. Off by default, because step 4
  generates the moment a user arrives on it.
- **a chosen plan is improved rather than merely chosen**: `design/repair.ts` takes the winner's
  worst repairable fault, changes the one thing the scorer named — moves that feature to its next
  room, takes the next approach to that path, leaves that one thing out — redraws the layout and
  keeps the result only if the score measurably rose. What it accepts is carried into realisation
  rather than being a preview-only fiction, and the card says what was adjusted. **Measured**: 24
  repairs across 15% of concepts, relationships 0.697 → 0.717, mean 0.870 → 0.872, and a plan that
  scored 0.74 now scores 0.92. It helps about one time in six it is tried, which is the
  accept-only-on-improvement gate doing its job.
- **an AI designer can be watched working on the plan**: a redesign arrives as a `DesignRun` of
  structured `DesignOperation`s (`packages/schema/src/plan/operations.ts`), a pure executor
  (`apps/web/src/lib/ai-run/`) turns it into a function of the clock, and the editor animates it
  against the real `DesignElement[]` — the terrace is selected, enlarged in its own paving, the
  furniture travels with it, the route is set out and redrawn, a border is deepened and the lawn
  gives up the same strip, lights are added, the reviewer looks over it and centres the seating.
  One gesture bracket per run, so the whole thing is one Undo; Stop, Skip, Compare and Replay round
  it out. `Demo AI redesign` in the editor's AI panel plays a scripted one against whatever concept
  is on screen. Nothing about the reasoning is in it yet — see "Visual AI agents" below.
- **you can point at something and talk about it**: click an element and the composer says what the
  request will be about, so "make this bigger" — or "use porcelain instead", with no noun in it at
  all — resolves to the thing on screen instead of the designer asking which one is meant.
  `ProposeRequest.selection` is ids, never a position, and the chip is a view of the canvas
  selection rather than a second copy of it. See "The selection is what 'this' means" below.

**Not built yet:** printing at true scale, a navigable 3D preview, and the optional AI
photo-render. React Three Fiber is installed but unused — the WebGL that shipped is PixiJS, and it
draws the same top-down scene rather than a camera. There is still **no user study**: the feedback
events below are collected but nobody has yet sat down with the table and asked it anything. The two faults the harness reports most
are both outside the design agent's reach as it stands: too many materials in one plan is a
`materialFor` question, and seating in shade on a north-facing plot wants a *second* sitting area in
the sun rather than a displaced terrace.

**No Anthropic call is made by the test suite** — every assistant test injects a fake client
(`Pick<Anthropic, 'messages'>`), constructing real `Anthropic.*Error` classes only to check the
error mapping. Everything up to the request is exercised. That covers **three** assistants, the
third being the strategic brief on the generation path, which is off by default and falls back to the
deterministic brief on every failure. The garden assistant's deterministic half (`anchors.ts`,
`garden-planner.service.ts`) is tested against real PostGIS with no model at all, which is the point
of the split. `apps/api/.env` carries a key and `ASSISTANT_ENABLED` is unset (so, enabled), so the
running app is live-capable. Server-side `fallbacks` remains off because it cannot be tested here.

**The prompt cache has now been measured, and it works — _this reverses_ "may never hit".**
Two calls with the identical system prefix, against `claude-opus-5`:

```
call 1   input=14  cache_write=1417  cache_read=0
call 2   input=14  cache_write=0     cache_read=1417
```

So the breakpoint on `ASSISTANT_RULES` writes on the first call of a window and reads the whole
prefix back on the next. **The estimate that said otherwise was wrong twice over**: it guessed ~800
tokens from a characters-over-four heuristic (4,176 chars ≈ 1,044 by that rule) where the real
tokenisation is **1,417** — comfortably over the 1,024-token minimum, and further over it since the
tone, vocabulary and conversation sections were added. Do not re-derive this from character counts;
`logAssistantUsage` reports it on every call now.

## Decisions worth knowing

**Plans are stored as a JSONB document, not normalised spatial columns.** One `plan_projects`
table; the plan lives in a `document jsonb` column typed via `.$type<PlanDocument>()`. Every
spatial check is _within_ a single plan, so per-row geometry columns and GiST indexes would buy
nothing, and the document shape is still changing. PostGIS is used as the geometry engine rather
than as storage. `name` is a column so a project list needs no jsonb parsing, and `updated_at`
is the real "last saved".

**Validation is a pure function.** `GeometryValidationService` builds geometries inline from
the candidate payload with `ST_GeomFromText`, so it never needs rows to exist. That is why
`POST /plan-projects/validate` can exist with no side effects, and why the tests can run
without inserting anything. It keeps a whole-document signature: the section-patch handlers
merge the section over the stored document _first_, then validate the merge, which costs no
extra query because the row had to be read for the revision check anyway.

**Invalid drafts are stored and reported, not rejected.** _This reverses an earlier decision_
(422-on-write) and the reason matters: the wizard autosaves, and a user can reach an illegal
state through the UI — drag a boundary vertex inward past a shed — so refusing the write would
silently lose every edit that followed until they noticed. Section patches persist the draft and
return `violations` alongside the project (200); **Continue is gated on `violations` being
empty, not on the save**. Concept generation is where the line is drawn: it returns 422 on an
invalid document, because the generator has to be able to trust its input.

**The plot sanity band is a warning, and could not be anything else.** `checkPlotSanity`
(`packages/schema/src/plan/sanity.ts`) says so when a plot is over 2,000 m², has a side over 60 m,
or is under 5 m² — the 113 × 74.5 m "garden" that was accepted in silence. It is not a violation
and does not gate Continue: an out-of-band plot is unusual rather than illegal, and a genuinely
large rural site is a real thing somebody has. What the user must not be able to do is walk past
the mistake, which is why the running area total sits in `PlanBottomBar` on **every** step rather
than only in step 1's summary panel — the number has to be somewhere unavoidable, and it has to
keep updating while the boundary is still being drawn.

`scaleDownHelps` is **measured, not assumed**: the polygon is actually scaled and re-checked. A
plot three orders of magnitude out is not fixed by one step, and a button that leaves the same
banner on screen teaches the user that the fix does not work.

**The house's corners and walls carry ids, and that is what `MIGRATIONS[1]` exists for.** (The
document is at version **3** now — 2 → 3 is the no-op that dates `elevation` becoming something the
plan draws. This section is about the 1 → 2 change.)
`HouseFootprint.outline` is `HouseVertex[]` (a point plus an id) and the footprint carries a
parallel `walls[]`. The ids exist so things can be _attached_ to a wall: a door recorded as "0.9 m
along this wall" survives a move and a rotation with positional identity, but not a resize — which
rewrites every coordinate — and not a corner being inserted on a custom outline, which renumbers
every edge after it and silently moves every opening on them to a different wall. That is the
failure this codebase least tolerates, and it is the same reason `BoundaryVertex` has an id.

Consequences worth knowing:

- **`MIGRATIONS[1]` is the first migration that does real work.** Every earlier shape change was an
  addition with a default, which Zod fills for free; this one changes an element _type_, so a stored
  row genuinely does not parse without help. Ids are assigned positionally, because that is all a v1
  document carries — the point is not that `h0` is meaningful, it is that from here on it is stable.
- **`PlanDocumentSchema.parse` does not migrate; `readPlanDocument` does.** Test fixtures call the
  former, so all eight of them had to be written in the v2 shape by hand. If a future migration
  breaks, those fixtures fail with a Zod error rather than a useful one.
- **Anything that rebuilds `outline` must spread the old vertex, not rebuild `{ x, y }`.**
  `resizeHouse` and `scaleHouseAbout` both do; getting it wrong drops the ids without an error.
  There is a test either side.
- **`houseWalls` resolves the walls rather than trusting them.** A footprint stored before walls
  existed has `[]`, and one whose outline has since grown a corner has fewer walls than edges. Total
  by construction here means no caller has to remember either case.

**An opening is a wall id and a distance, never a coordinate — and its position is derived every
time.** `openingSegment` / `openingCentre` / `openingNormal` / `thresholdRect`
(`packages/schema/src/plan/openings.ts`) resolve through `housePolygon`, so rotation is applied
exactly once by code that is already tested. There is no update step and nothing to keep in sync:
a door survives the house being moved, rotated and resized for the same reason zones are recomputed
rather than stored.

Four things about that module worth knowing before touching it:

- **The schema lives in `opening.ts` and the resolvers in `openings.ts`, and the split is
  load-bearing.** `site.ts` needs the schema to put `openings` on the house, and the resolvers need
  `housePolygon` from `site.ts` — a direct cycle. Same fix, same reason, as `zone-id.ts`.
- **Every resolver returns `null` rather than guessing.** A wall id that no longer exists, or an
  opening that overruns a wall a resize has shortened, is a state the model can genuinely reach. A
  door hanging off the end of the building is geometry that _looks_ valid, which is worse than one
  the caller skips.
- **`openingNormal` probes rather than assuming a winding direction.** `rectangleOutline` runs one
  way and a hand-drawn custom outline may run the other; an outward normal that is silently inward
  puts every threshold, view cone and path origin inside the building, and nothing downstream checks
  that a derived direction points somewhere sensible. There is a test on a reversed outline.
- **`thresholdRect` is pushed half its own depth along the normal**, so it starts at the wall rather
  than straddling it. Half of it inside the house would be permanently unusable and would fight the
  house-clearance rule.

**Openings are captured on a wall elevation strip, not on the plan.** Placing a 900 mm door on a
footprint at step-1 zoom is an unreasonable ask — the whole building is a couple of centimetres
across. `WallElevationStrip.tsx` unrolls one wall flat with a ruler on it, which turns a hard 2D
task into an easy 1D one, and the horizontal axis _is_ `offsetAlongEdge`: the number under the
pointer and the number in the document are the same number. It is plain DOM rather than Konva —
a ruler with draggable blocks is React's job, and it keeps the panel out of the `ssr: false` dance.
The vertical axis is illustrative only, which is why sill height is typed and never dragged.

**The panel lives inside step 1's house tools and never gates Continue.** A mandatory screen about
door positions would be a regression for every user whose answer is "the patio doors are in the
middle of the back wall". `HouseOpenings.tsx` draws the plan-view echo — gaps in the wall, swing
arcs on hinged doors — because otherwise the strip is a form whose effect the user never sees.

**The inferred patio door is offered, not applied.** `suggestedDoorWall` picks the wall facing the
back garden using the same bearing `computeZones` does, and the panel puts it behind a one-tap chip.
The whole value of an opening is that the generator _trusts_ it: a wrong silent door has the design
built confidently around a fiction the user never stated and cannot see they should check.

**Legality about a wall lives in `fitsOnWall`, not in the panel.** Two openings cannot share wall,
an opening must sit wholly on its wall, and a party wall holds nothing. Reclassifying a wall
_removes_ the openings that are no longer legal on it rather than hiding them — a door left on a
party wall would have the generator route a path to a doorway into next door's kitchen. Note these
edits deliberately do **not** go through `commitHouse`: that guard is about the footprint leaving
the plot, and none of them move it.

**`openingCounter` is re-seeded in `hydrateBoundaryStore`,** alongside `vertexCounter`. Miss it and
the first opening added after a reload takes an id already in use.

**A side gate is a `Gate` on a boundary edge — _this reverses_ "a side gate is a `FeatureKind`".**
The old reasoning was sound about `wallId` and about `ZoneId`'s ambiguity, and it is answered by
giving the gate its own key: `edgeVertexId` plus `offsetAlongEdge`, in `plan/gate.ts` and
`plan/gates.ts`, which are the boundary-edge twins of `opening.ts` and `openings.ts` and follow
both of their rules (resolve through `boundaryPolygon`, return `null` rather than guess). What
forced the reversal is that the layout grammar keys on the gate: the shed, the bins and the side
path go where you can actually carry something in from the street, and a 0.45 m point dropped
inside the plot cannot say which fence it is in — or that it is in one at all. The `FeatureKind`
stays in the enum so stored plans parse; it is gone from step 2's palette.

**`site.streetEdgeVertexId` is the other half, and `gardenDirection` is why it matters.** Which
fence faces the street decides where the front garden is, and therefore which way the _back_ is.
`gardenDirection(site)` is "away from the street" when the street is known, and otherwise the
house wall with the most plot beyond it — never the rotation convention alone, which called a
1 m strip the back garden on the first fixture it met. `streetDirection` is its opposite. Both
return `null` without a house, and nothing is inferred into the document: `suggestedAccess` is
what a chip applies, and what a fixture or the capture script calls deliberately.

**`gateCounter` is re-seeded in `hydrateBoundaryStore`**, exactly as `openingCounter` is, and for
the same reason: miss it and the first gate added after a reload takes an id already in use.

**A gate, a door and a side's kind all hang on an edge, and `plan/along-edge.ts` is the one place
the arithmetic lives.** `gateSegment` and `openingSegment` are wrappers on `spanOnSegment`;
`fitsOnEdge` / `fitsOnWall` share `spanFits` and `spansOverlap`; both clamps share `clampOffset`.
The point is not the saved lines — it is that what happens to an offset when the segment under it
changes has to be the *same* rule for a gate and a door, or a corner insert treats them differently.
Offsets stay **metres from the start vertex to the centre**, never a 0–1 fraction: stretch a 6 m
side to 12 m and a fraction slides the gate 3.6 m along the fence, where metres keep it with the
corner it was hung from. The rules, each pinned by a test on both sides:

- **Insert a corner** (`insertVertexOnEdge`): a gate beyond the cut is re-homed onto the new edge
  measured from the new corner, then **clamped** onto its half (`gatesAfterSplit`), so a gate the
  cut ran through is nudged whole onto one side rather than left straddling a corner. **Both halves
  inherit the side's kind** (`inheritBoundaryStyle`) — _this reverses_ the note that had the new
  half take the default: the user described that side, and a corner in it does not change what is
  built along it; the default is also a guess, and the worse one because it draws a change where the
  user made none. The street edge stays on the first half.
- **Delete a corner** (`accessAfterDelete`): the edge that started there is gone; what was on it is
  **carried onto the merged edge where that edge actually passes through the old centre** (within
  `MERGE_TOLERANCE`, 0.5 m) and dropped where it does not. Deleting a redundant corner on a straight
  side is the common case and loses nothing; a gate that was on a real bend has no honest place on
  the straight line that replaced it. The street designation transfers by the same test on the old
  edge's midpoint. Styles are still pruned.
- **Type a side length**: every side but the closing edge is lengthened from its far end and needs
  nothing. The closing edge ends on corner A, so its *start* slides — `offsetFromEndPreserved`
  re-measures the gate so it stays where it was hung. Without this, a gate 4 m from A moved up the
  fence every time the last side was typed.
- **Rescale the plot** (`scalePlot`): offsets scale with the fence, **widths do not** — a 0.9 m gate
  on a tenth-size plot is still 0.9 m, it is the plot that was drawn wrong. `scaleHouseAbout` does the
  same for the openings, which used to be left at their old offsets and silently stopped resolving.
- **Anything that then does not fit is left unplaced**, never moved: it stops resolving (`null`) and
  draws nothing, and the document keeps it so it comes back if the geometry does.

**`endGesture` compares `sameDraft`, not geometry.** The old `sameGeometry` looked at vertices and
the house outline only — complete while those were the only things a drag could move, and a trap
the moment a gate can be dragged along its fence: the gesture would end on "nothing changed" and
leave no way to undo it. Anything a drag can touch has to be in that comparison.

**`Gate.kind` is `pedestrian | vehicle | open`, defaulted.** A driveway and an open gap are the
same key, position and fit rule as a garden gate; what differs is what the generator makes of them,
which is a `kind` for the reason `OpeningType` is one enum. `GATE_DEFAULTS` carries the width and
the keep-clear depth per kind (five metres inside a vehicle gate: a car stands there). The default
means every stored gate reads back as the pedestrian gate it was — no migration, no version bump.
The driveway *surface* is still the generator's to draw and is not built.

**`HouseFootprint.storeys` is the one vertical fact about the building, and `houseHeight` reads
it.** Storeys rather than a height in metres — the question a user can answer — and per house rather
than per wall, because a single-storey extension is a footprint question that can be a per-wall
override later. `EAVES_BY_STOREYS` is a table, not `storeys × 2.7`: a bungalow's eaves are about
3 m, two storeys 6 m, a third adds less because it is often in the roof. The default is 2 → 6 m, so
`HOUSE_HEIGHT` still means what it did and every stored plan casts the shadow it always did.
`houseHeight` tolerates an absent `storeys` for the reason `scatterForm` does: fixtures and
hand-built houses never go through `.parse()`.

**Step 1 draws `FenceLine` with `boundaryRuns`, as step 5 always did.** It drew a plain 2 px
`Line`, so a hedge chosen on step 1 changed nothing on the screen it was chosen on. Only once
`draft.closed`: `boundaryRuns` does not check `closed`, and a half-drawn outline has edges but not
yet sides. Step 2 draws the same.

**A part of the property is described by clicking it, and `Selection` is what that means.** It was
`vertex | house | null`; it is now those plus `edge`, `wall`, `gate` and `opening` — an `edge` named
by the vertex it starts at and a `wall` by its id, for the reason gates and openings are keyed that
way. A gate or an opening selected on its own shows its *parent's* editor with that entry expanded,
which is what `selectedEdgeVertexId` / `selectedWallId` resolve; `selectedWallId` replaced the
store's old `selectedWallId` **field**, so the wall the strip shows and the wall the plan highlights
can no longer disagree. `SelectedObjectPanel` only routes: `SideEditor`, `WallEditor`, the house
branch, the vertex branch.

**The Access mode is gone, and that reverses "a side gate is placed with an armed tool".** It was a
fourth `EditorMode` with an `accessTool` armed from a panel: press a button, then click a fence, and
the tool disarms. Everything it did is a fact about *a side* — which fence has the gate, which faces
the street, what the side is made of — and a fact about a side belongs in the panel that opens when
you click that side. `AccessPanel`, `BoundaryStylePanel` and `OpeningsPanel` are deleted; what
survives is `SuggestionsRow`, the four one-tap inferences, which are still **offered, not applied**.
Modes are now `boundary | house | select | measure`, and placing a house lands in `select` rather
than leaving the user in a creation tool. Boundary and House stay because their empty-canvas
gestures (click to drop a corner, drag out a rectangle) genuinely conflict with clicking to select.

**Everything selectable has a real button in the off-screen list, and that is not only about
keyboards.** Konva shapes are not DOM at all, so a `data-testid` on a `Line` addresses nothing: the
first version of the e2e test for this waited thirty seconds for `boundary-edge-0` and timed out.
Sides and walls joined the corners and the house in the `sr-only` list, which makes them reachable
by tab *and* gives Playwright something to focus. For a real pointer click on a side, aim at the
side's own **length chip** — that is HTML, positioned at the edge midpoint, so its bounding box
gives the pixel whatever the fit-on-load frame turned out to be.

**A side's descriptor follows the zone labels, not `gardenDirection`.** `lib/side-labels.ts` calls
the back the house's own bearing 270, which is what `computeZones` uses. Asking `gardenDirection`
instead is the obvious thing and it is wrong on screen: it infers the garden from where the most
plot lies, so a centred house makes it land on a *side*, and the panel then called a strip "Left
side" while the canvas wrote "Back garden" across the same ground two inches away. Agreeing with the
visible label beats agreeing with the generator's own inference — the descriptor says what a side
*is called*, not where to design. Never a compass word: the plot can be drawn at any angle.

**An attachment that no longer fits is kept, said, and never moved.** A gate whose side was typed
shorter, or a door whose wall a resize shrank, stops resolving (`gateSegment` / `openingSegment`
return `null`), draws nothing, and appears in its editor with an "off this side" badge and two
honest answers: **Fit** (`fitGate` / `fitOpening`, offered only when the segment is long enough) or
remove. Clamping it silently would move a thing the user placed; deleting it would lose it. This is
what makes every rule in the section above safe to apply.

**The generator picks the side path's gate rather than taking the first one.** It read
`resolvedGates(site)[0]` — whichever gate was stored first — which was harmless while every gate
was a 900 mm pedestrian one and wrong the moment a gap in the boundary can be a driveway or a
street frontage. `sidePathGate` skips **anything on the street edge** (the front path already runs
to the kerb; starting the back garden's side path there drags it through the front garden and past
the house) and prefers pedestrian, then `open`, then vehicle — a side path carries the bins and the
mower, and a driveway is only the last resort because you *can* walk through one. `gateSide`, the
utility corner and the shed all follow from that choice, so getting it wrong moved the shed too.

**Every opening in the boundary is kept clear to its own kind's depth.** `gateThresholdDepth` reads
`GATE_DEFAULTS`: a metre to open a gate and step through, **five** for a car to stand inside a
driveway. An `open` gap gets a pedestrian's metre rather than nothing — there is no leaf to swing,
but it is still the way through, and a bed planted across it is a gap that is not a gap.

**The suburban fixture has a driveway on its street edge and a side gate on its return, and the
l-shape is a bungalow.** Neither is decoration: a vehicle opening is drawn as a *pair* of leaves,
keeps five metres clear, and must not be chosen as the side path's start — none of which is visible
on a sheet where every opening is a 900 mm gate. `storeys: 1` makes `houseHeight` visible at all,
since every other fixture takes the two-storey default and throws the identical shadow it always
did.

**The composer draws the openings, and until Phase 3 it drew none at all.** A patio door was
visible on step 1 and absent from every thumbnail, PNG export and judging sheet of the same plan —
which is exactly backwards, since the door is the single most layout-determining object in the
drawing and the sheets are what the design gets judged on. `RenderHouse.openings` carries them
resolved (`RenderOpening`: the opening, its span, its outward normal), skipping any that do not
currently resolve, and `drawOpenings` is a port of `HouseOpenings`. **Not over a roof**: from
directly above you cannot see the doors beneath one, so Visualise — the only view with a roof —
returns before them, and every other view gets the flat diagram where the openings are the point.

**`swingGeometry` is the one answer, and the copies had already diverged.** The arc a hinged leaf
sweeps was worked out in `SwingArc` and again inline in `drawAccess`, and the composer's version
always hinged on the segment's *first* end — so a gate and the same gate on an exported PNG could
open from opposite sides. It now lives in `symbols/property.ts` beside `gateSwings` and
`openGapTicks`, returns **world metres** (the frame both backends agree on, for the reason
`useSurfacePattern` gives), and `SwingArc` takes the resolved geometry rather than recomputing it.

**`roofFor` deliberately does not read `house.storeys`**, now that it exists. A roof seen from
directly above covers the same ground whether the house below is one storey or three: height
changes how far the *shadow* falls, which is `shadowOccluders`' business. Taking it as an input
would be a dependency that changes no pixel, and one a later reader would assume must matter.

**A gate or a door is dragged along the thing it belongs to, and it cannot leave it by
construction.** `AttachmentHandle` projects the pointer onto the parent segment with
`offsetOfPoint` and passes on **only that distance** — the position off the line is thrown away, so
a drag out into the garden slides the gate to the nearest point of its fence and there is no frame
in which it is somewhere it could not be. Clamping afterwards would be the same picture with a
worse guarantee. One component serves both, because the gesture is identical; what differs — what
is legal, how narrow it may go — is in the store actions it is handed, so the handle knows nothing
about gates.

**End handles appear only when the thing is big enough on screen to have ends worth grabbing.**
Each end's grab area reaches about 14 px, so on the 30 px a 900 mm gate occupies at plan zoom the
two of them swallow the middle: the first real drag in a browser turned a 0.9 m gate into a 0.7 m
one, because every attempt to slide it hit an end and resized instead. `MIN_SPAN_FOR_ENDS_PX`
leaves a clear body between them. The consequence is deliberate and reads right — a small gate is
move-only until you zoom in, and its width is *typed*, since 0.9, 1.2 and 3.0 are catalogue numbers
rather than things you drag to. **This class of bug is only findable in a browser**: Konva's
hit-testing decides it, and there is an e2e test for exactly this now.

**A resize moves the end under the pointer and nothing else.** `spanFromDraggedEnd` pins the far
end, clamps both into the segment, and **refuses** a result under the minimum width rather than
holding it there — stopping dead shows the user a limit where silently pinning looks like the drag
stopped tracking. Note it answers `offset` because it is about spans, and a gate stores
`offsetAlongEdge`: spreading the result set the width, left the position behind and added a stray
key. Map the fields.

**Undo keeps the selection where it still exists.** It used to clear it outright, which was right
while only a corner or the house could be selected — undo usually meant geometry had appeared or
gone. It is wrong now that a gate, a door or a side can be: undoing a gate drag closed the very
panel the drag happened in, so the correction vanished from under the user along with the thing
being corrected. `reconcileSelection` is the same function the removals already call.

**`SegmentTrack` is the wall strip, extracted.** A side of the property gets the same unrolled
control for its gates, for the same reason the wall has one: placing a 900 mm thing on a drawing
where the whole plot is a few hundred pixels across is a hard 2D task, and unrolling it makes it an
easy 1D one. The vertical axis is the caller's business — a wall draws its openings at their true
height against a storey, a fence draws a full-height block, because a gate has no elevation worth
claiming. The drag listens on `window` rather than on the block so it survives the pointer running
off the end of the track, which is the common case.

**`Gate.kind` changes the drawing, not just the data.** `GateMarks` draws a pedestrian gate as one
leaf on an arc, a driveway as **two half-width leaves hung at opposite ends** (the convention for a
double gate, and what stops a 3 m opening reading as a very wide garden gate), and an open gap as a
pair of dashed ticks with no leaf at all — because a leaf there would claim a gate the user said was
absent. A **window** is no longer drawn as a gap: the wall carries on past it and two fine lines
cross the band, since drawn as a hole every window read as a doorway.

**`site.orientation` is read by the sun model.** Degrees clockwise from screen-up to true
north, defaulting to 0. The compass was a _drawing_ for most of this project's life — it pointed up
and no code consulted it. `shadowCast` consults it now. Defaulting to 0 means every stored plan is
unchanged and the compass keeps pointing exactly where it did.

**Orientation is not enough for a sun, and `site.location` is the gate.** Which way the plot is
turned says nothing about where on Earth it is, and solar altitude is a function of latitude —
shadow length is `height / tan(altitude)`. So `location` is nullable and **null means the app makes
no solar claim at all**: no time of day, no shade study, no night, no lighting hours. There is no
latitude that is true of anywhere, and a plausible guess would have the design built confidently
around a fact the user never stated. Offered, not applied, exactly as `suggestedDoorWall` handles
the inferred patio door.

**A plan with no location still casts shadows, from the drawing's own light — _this reverses_ "no
cast shadows, and the conventional top-left drawing light everywhere".** The old rule was right
about the claim and wrong about the picture, and the cost was measurable against the professional
reference: nothing in an unlocated garden was attached to the ground, which is most of what makes a
render read as a diagram. Note what it was already inconsistent about — a contact disc under every
sprite, a shade band along every fence and a ground shadow under the house have *always* been drawn
without a location, pushed away from `LIGHT_DIRECTION`. The cast layer was the one drawing
convention held to the solar standard.

`presentationCast(site, light)` (`materials/light.ts`) is the one answer: the real sun where there
is a location, `conventionalCast` where there is not — shadows falling away from the same top-left
light that bevels every slab, at a flat `CONVENTIONAL_SHADOW_RATIO` of 0.55 m per metre of height.
`ShadowCast.source` says which it is, and that field is what keeps the rule above true: every
consumer that would be making a claim about *this garden at this hour* checks it rather than
assuming a cast means a sun.

**The test is `site.location`, not the null cast, and getting that wrong draws a second sun at
midnight.** `shadowCast` returns null for two different reasons — no location, or a location whose
sun is below the horizon — and only the first may fall back to a convention. A located garden at
eleven at night has no shadows because there is no sun, and conventional ones drawn across the
night wash would be a second light in a picture whose whole subject is that the first one has gone.

**`site.sun` is on the document, like `pattern`.** "Show me half three in June" is a design decision
of the same kind as which way the decking boards run, and it has to survive a reload for the same
reason — otherwise a plan printed with shadows on it cannot be reproduced from the stored document.
Both fields are additions with defaults, so no migration and no `PLAN_DOCUMENT_VERSION` bump.

**The ephemeris is `suncalc`, not ours.** Two kilobytes, no dependencies, Meeus' algorithms, and it
returns azimuth clockwise from north — the convention `orientation` already uses. Writing one is a
week of work and a source of quiet wrongness. Note the SDK-shaped trap avoided here is the opposite
of the usual one: the tempting thing was to hand-roll, not to over-import.

**Shadow geometry is returned unmerged, and that dissolves the hard part.** A shadow is the
footprint, the footprint translated to where its top lands, and the quads swept between them.
Unioning those in TypeScript needs a polygon-boolean dependency; `projectShadow` returns the pieces
instead, because every consumer already has a better union. The canvas gets one free by filling
them opaque into one layer, and a future PostGIS query would use `ST_Union` anyway.

**Shadows are drawn opaque and composited once.** Two overlapping shadows are one shadow — a tree
standing in a hedge's shade is not twice as dark — and drawing translucent shapes in sequence
double-darkens the overlap, which reads instantly as a bug. Fill every piece at full opacity into a
layer of its own, then draw that layer once at `SHADOW_OPACITY`. There is a test that samples the
overlap and demands it match either shadow alone.

**The shadow layer is spliced into the elements layer, not given its own.** Shadows fall _on_
surfaces so they must sit above them, and a tree stands up out of the ground so it must be drawn
over the shadow it casts. Inserting at the fill-to-feature seam inside the existing layer preserves
the "array order is stacking order" guarantee; two Konva layers would not.

**The editor's stage has a layer budget: four, and only one of them is spare.** Konva warns above
five, and it warned — the visual-agents work mounted two layers of its own on a stage that was
already at four with the grid on. Every Konva `Layer` is a full-size canvas at device-pixel ratio
plus a hit canvas, composited by the browser every frame whether or not it draws anything; two of
the old layers held one child each and existed only for stacking order, which a `Group` gives for
free. The four now: the **backdrop** (grid and plot outline — never listens, never animates, and
its own `visible` is bound to whether it has anything to draw, because a hidden layer leaves the
page where a hidden group does not), the **elements** (the only interactive layer, shadows spliced
in as above), the **chrome** (fence first, then house, handles, guides and tape — redraws on
selection), and the **AI's** (mounted only during a run, the one thing animating at frame rate,
which is exactly what a layer of its own is for). A new drawing pass goes in a `Group` inside one
of those, never in a new `Layer`; `ai-redesign.spec.ts` counts the canvases and fails on the
warning.

**The shadow raster covers the plot, not the shadows.** Anchoring to the shadows' own bounding box
would move the raster's origin every time the time of day changed, shifting every pixel of the
layer sideways as its extent grew and shrank. It is also clipped to the boundary: a shadow really
does cross a fence, but a garden plan that shades the neighbour's property is describing land it
does not own — the same clamp `borderRegions` already applies.

**Heights live in a manifest, and a fence and a tree must not cast the same shadow.** `heightFor`
resolves a material to a height with an explicit per-element override, because a pergola and a
raised bed are both softwood structures. `HOUSE_HEIGHT` is a constant rather than a manifest lookup
— the house is not a `DesignElement` and the plan records its footprint, not its storeys. Guessing
six metres is honest in a way guessing a latitude is not: the answer varies by a metre or two
rather than by the hemisphere.

**One light reaches everything, through `DrawPass.light`.** Slab bevels, blob highlights, water
crests and cast shadows all take the same unit vector. Two suns in one drawing is the single most
obvious way a render gives itself away, and it happens by default the moment shadows follow a real
sun while shading stays on a compile-time constant. The light is in `patternKey` for the same
reason: leave it out and moving the time slider relights only the surfaces that happened to fall out
of the cache, so the plan repaints in patches.

**Step 1 opens on a shape, not on a blank grid.** `plot-presets.ts` builds a rectangle (12 × 8 m by
default) or an L, and corner-by-corner drawing is the escape hatch for irregular plots rather than
the mandatory route. Drawing a scaled polygon on an empty grid asks the user to _originate_ a
measurement from nothing, which is how a 113 × 74.5 m plot got drawn; a preset turns the same task
into adjusting a default. This is the single biggest reduction in that error class, and the sanity
band is the net under it rather than the primary defence.

**Which shape it is, is derived from the outline — never stored.** `matchRectanglePlot` /
`matchLShapePlot` read the actual corners, for exactly the reason zones are recomputed: a remembered
"this is a rectangle" flag goes stale the moment a corner is dragged, and then the width field is
editing a shape that is not there. The visible consequence is deliberate and worth understanding —
**the dimension fields and `SideLengthsPanel` use different editing models.** Width moves two
corners because a rectangle has to stay a rectangle; a side length moves one because a free-form
outline has no such rule. Editing a side of a rectangle therefore makes the width/depth fields
disappear, which is the honest report: it is a quadrilateral now. A rectangle drawn by hand gets the
fields for free, which is the other half of deriving rather than remembering.

`matchRectanglePlot` accepts any starting corner but **refuses an anticlockwise outline** — it would
report the same width and depth and then rebuild clockwise, silently reversing the vertex order
under the user's selection. `matchLShapePlot` is stricter still and only matches the canonical
corner order, because deciding which limb is "the return" from geometry alone would swap two fields
mid-edit whenever it guessed wrong.

**`nextDrawPoint` is called by both the ghost preview and the store**, so the preview cannot promise
a position the click then fails to deliver — the same rule the tessellation layer follows for the
canvas and the validator. Right angles are held relative to the _previous side_, not to the world
axes: a plot drawn 20° off screen still has right angles, and axis snapping would fight every one of
them. Only the **distance** along the chosen direction is grid-snapped; snapping the resulting point
to the grid is the obvious way to write it and knocks the corner straight back off the axis.

**Closing the boundary is tested against the raw pointer, not the snapped result.** Right-angle
snapping projects the point onto an axis, which can carry it further from corner A than
`CLOSE_DISTANCE` — so snapping first makes the polygon refuse to close exactly when the user aimed
at the corner in order to close it.

**`setEdgeLength` refuses an edit that folds the outline through itself.** A bow tie has a perfectly
ordinary vertex list and a shoelace area that is quietly wrong, so nothing downstream would report
it; `polygonIsSimple` is the guard and the refusal leaves the last legal outline on screen. Note
that a convex plot cannot fold — the test for this needs a concave one, and uses a C shape.

**`edgeReflowTargets` exists so the rule can be drawn rather than explained.** Changing one side of
a closed polygon is genuinely ambiguous, and `reflowEdge` resolves it by pinning the preceding
corner and sliding the following one — except on the closing edge, which ends on corner A and slides
its own start instead. Focusing a side-length field highlights the pinned corner as a dashed ring and
the moving one as a solid dot, and there is a test asserting the highlight and `reflowEdge` agree
about which is which.

**A rescale is not zone-preserving, and `scalePlot` says so rather than pretending.** `MIN_ZONE_AREA`
is an absolute 0.5 m², so dividing every length by ten divides every zone area by a hundred and a
narrow side return drops below the sliver threshold. `selectedZoneIds` is therefore left untouched —
the ticks survive in the document and `effectiveZoneIds` reconciles them, so the choice comes back
if the zone does. There is a test pinning both halves.

**`scaleHouseAbout` touches `outline` as well as `centre`**, and that is the whole point of it
existing. Scaling only the centre leaves a full-size building on a tenth-size plot, which then
fails `houseFitsInside` — and every later house edit is silently refused by `commitHouse` for a
reason the user cannot see anywhere on screen.

**The zoom readout is metres across the viewport, not a percentage.** "100%" meant `DEFAULT_SCALE`
— 32 pixels per metre — and nothing else: not the fit, not device pixels, not any real-world
ratio, so two plans at "100%" were not comparable. A printed drawing states a ratio instead, and
1:100 was the obvious alternative; it is rejected because a ratio is only true if the display's
_physical_ size is known, which in a browser it is not. Metres-across needs no calibration and is
exactly true. The grid square size is written under the scale bar for the same reason — it is what
the user measures against while drawing, and nothing used to say how big one square was.

**The size anchor is positioned in world metres, not pinned to a screen corner.** `sizeAnchorAt`
parks a real 4.5 × 1.8 m car 1.5 m below the plot's bottom-left corner, so it zooms and pans with
the drawing. That is the entire mechanism: a scale bar in the corner reads as a caption and gets
ignored, where a car sitting next to the plot gets compared to it whether the user means to or
not. It is deliberately **not** clamped to a minimum size — if the car is three pixels wide the
plot is far too big, and drawing that faithfully is more useful than keeping the car legible.

**Writes are per-section, with an optimistic-concurrency token.** Each store has its own save
clock, and `layout` is by far the biggest payload — a debounced autosave on the map screen must
not re-upload a generated garden every time a vertex moves. Every write carries the `revision`
it was based on; the update is a compare-and-swap in one statement, and a mismatch returns 409
carrying the server's current project so the client can adopt it rather than guess.

**The persisted slice of a store is not just `present`.** `features-store.skipped` and
`concepts-store.chosenConceptId` sit outside the undo history but are real user intent, so the
sync subscriptions watch them too. This is the easiest thing in the sync layer to get wrong, and
there are tests for both.

**Loading a plan must not look like editing it.** Writing into the stores fires the same
subscriptions an edit does, so `project-sync.ts` holds a `hydrating` flag while it loads. Without
it, adopting the server's version after a 409 sent that version straight back — and would have
overwritten whatever the other tab did next. Load and sync are therefore one call,
`startProjectSync`, so the subscriptions cannot exist while the load is running.

**Undo history does not survive a reload, deliberately.** Up to fifty full drafts per store, for
state whose only consumer is the session — and a redo stack rebuilt after a reload would let the
user redo into geometry the server never validated. `layout.pristine` is the one piece of history
worth keeping, which is why it is a document field rather than derived.

**Let Postgres stamp `updated_at`.** Use `sql\`now()\``, never `new Date()`. Inserts stamp from
Postgres at microsecond precision and a JavaScript `Date` only carries milliseconds, so mixing
them lets a row written _after_ another sort _before_ it — which showed up as a project list in
the wrong order.

**`ST_Overlaps` is the wrong predicate for "these two shapes overlap."** It returns false
when one geometry is entirely inside another — a shed dropped fully inside a patio would
pass — and false for geometries that merely touch. The correct test for shared interior
space is `ST_Intersects(a, b) AND NOT ST_Touches(a, b)`. There is a test pinning exactly
this case; do not "simplify" it back to `ST_Overlaps`.

**Every shape is tessellated once, in TypeScript, and shared.** `geometryOutline` in
`packages/schema/src/plan/features.ts` turns all four geometry kinds into a plain ring, and both
Konva and the validator use it. If the canvas tessellated a shape differently from the
validator, a feature could render inside the boundary and validate as outside.

Two consequences that reverse what an earlier version of this file said:

- **Circles are no longer buffered in PostGIS.** They were, and the canvas drew an octagon while
  the validator buffered a 64-gon — making the server's circle up to 7.6% of the radius larger,
  enough to reject a tree the user could see was inside the fence. Both now call the shared
  `circleRing` (16 segments).
- **Polylines are tessellated, not buffered.** `ST_Buffer` rounds caps and joins where
  `polylineStrip` cuts them square and mitres them, so a buffered path is bigger at the ends —
  the server would reject a path laid flush against a fence. There is a test for exactly that
  case (all vertices inside, the strip crossing out).

**Rectangles are centre-anchored.** `rectToPolygon` takes `{ centre, width, depth, rotation }`,
because every gesture in the editor is defined about a centre and rotation always is. Degrees
clockwise, which in this y-down frame is also what PostGIS's `ST_Rotate` produces — there is a
test pinning that, because the generator's placer builds candidate boxes in SQL.

**There is deliberately no `elements_overlap` violation.** A concept stacks a pergola on a patio
on a base fill by design, so flagging overlapping layout elements would flag every correct
concept. Layout elements are checked for containment and nothing else — exactly what
`geometryIsLegal` checks on the client.

**A thing may sit on the house, and _this reverses_ "nothing sits on the house".** A patio against
the back wall, a path to the door, a pergola off the building: those are the commonest things in a
real garden and they were the ones the editor would not accept. `geometryIsLegal` is containment
alone now; `feature_on_house` and `element_on_house` are gone from `ViolationCodeSchema` and from
the validator. Two things keep it safe. The house is painted **opaquely and last** in every
renderer — the composer, both Konva canvases, and now step 2's as well, which had it underneath
and would have lost the building under the first patio placed against it. And the **generator is
unchanged**: `geometryClearsHouse` survives as the generator's own composition rule, asked
explicitly by `placeable` in `concepts.service.ts`, by `isPlaceable` in `layout/fit.ts`, by
`furnish`, and by the assistant's `add` — so a composed concept still never lays ground under the
building, and the whole concept suite passes untouched. Only what a person places by hand, or asks
the assistant to move or grow, may overlap. One accepted consequence: an element run under the
house counts its whole area in step 6's schedule. `groundCoverArea` is base fills only, and those
come from `computeZones`, which excludes the house, so the ground total is unaffected.

**The house still may not cross the fence — it may reach it.** A house really can be the full width
of its plot, and `houseFitsInside` always allowed flush (on-edge counts as inside, matching
`ST_Contains`); what was missing was any way to _get_ there. The typed width and depth refused
outright and in silence, leaving the rejected number in the box beside a house that had not moved.
`clampHouseSize` answers with the largest house that fits — the binary search `clampHouseInside`
already used for a drag — and `readMetres` on the two `LengthInput`s settles the field on what was
actually applied. `shrinkHouseToFit` does the same for placing a preset on a plot too small for it,
and still returns null for the case shrinking cannot rescue: a centre that is not on the plot.
Note `resizeHouse` scales about the footprint's own centre, so an off-centre house stops when its
nearest wall meets a fence; recentring would move a building the user placed deliberately.

**Nothing in generation reads the brief for a design decision — it reads `DesignConstraints`.**
`resolveConstraints` (`apps/api/src/plan/generation/constraints.ts`) is called once per concept and
everything downstream takes its answer. This is not tidiness: the card's badge used to come from
`archetype.maintenance(brief)` while `fillPalette` read `brief.maintenance`, so a brief saying
_medium_ produced a concept badged **Low** with a lawn under it. One call means there is no second
source left to diverge from. The rule lives here rather than in a prompt for the same reason
coordinates do — "low maintenance means no lawn" is a thing that can be _checked_.

The forbidden list is applied to the palette's **result**, not folded into its tables. Even when
badge and palette agreed, a `gravel-mulch` base took `['planting-bed', 'lawn']` as its accents, so
lawn returned as an accent regardless. Filtering once, at the end, is what makes "no lawn" true of
the whole palette. `materialFor` filters the same way, because a brief that is both `formal` and
low-maintenance takes the formal branch and lands on `mixed-border`.

**A stated maintenance level is a ceiling, not a suggestion.** The archetypes declare their own
upkeep — the entertaining concept is `medium` whatever was asked — so without `cappedMaintenance` a
user who asked for low maintenance is still offered a medium-upkeep concept among the three. Capping
rather than overriding: an archetype may still come in _under_ the ceiling, and the retreat stays low
on a medium brief.

**Feature footprints scale sub-linearly with the plot, exponent 0.35.** `FEATURE_SPECS` stays quoted
at suburban scale so the manifest still reads as "a dining pergola is 3.6 × 3.6 m", and `scaledSpec`
applies the factor at the point of use. Linear scaling gives a 130 m² pergola; no scaling gives the
defect that prompted this, a 13 m² pergola on 8,400 m². The surplus from `featureAttempts` becomes a
_second_ of something in `REPEATABLE_FEATURES` rather than nothing — an estate given the same six
things slightly larger still reads as a suburban design marooned in a field. `designedArea` is the
zones in scope, not the whole plot: a user who ticked only the back garden of a large property is
designing a suburban-sized space.

**The indicative cost is a band, never a figure in pounds.** `Material.cost` is documented as a rough
relative 1-to-4; turning it into currency would invent a number nothing here can support, and the
review screen is where a marker looks hardest. `estimateBudgetBand` reports it in the same four bands
the user chose from on step 3, which also makes "does this concept match the budget they asked for" a
question with an answer. `budget` is what the concept aims at; `estimatedBudget` is what its
materials came to.

**Generation asks PostGIS where a thing can go, and TypeScript whether it may.** The placer
computes the feasible region exactly — `zone − union(obstacles)`, eroded by the footprint's
inradius — and samples it with a seeded `ST_GeneratePoints`. It does **not** decide legality:
candidates are verified with the shared `geometryIsLegal`, so a generated concept can never fail
the validation that guards its own save. There is a test asserting exactly that, and it is the
strongest one in the repository.

**The base fill stays the whole zone polygon, even though the booleans are now exact.** The old
`concept-fill.ts` claimed the backend could drop it once it had true polygon subtraction. It
cannot: coverage is a property of the z-order, and `isLocked` exists so the editor cannot open a
hole in the ground. An exact-remainder base would open one the moment a feature moved, which is
the entire purpose of step 5. Accents get the true booleans; the base does not.

**Interior rings are discarded in the fill pass.** Subtracting a tree from a lawn leaves a donut
and `PlanGeometry.polygon` cannot express a hole. The exterior ring is kept and the hole dropped —
safe for the same reason as the base layer: the geometry that made the hole is drawn on top of it.

**`ST_GeneratePoints` is deterministic per PostGIS version, not across versions.** The compose file
pins `postgis:16-3.4`. Do not write a test that assumes cross-version stability.

**The assistant is a hybrid: the model produces intent, the planner produces geometry.** Claude
returns a `DesignIntent[]` — resize by a factor, move towards the house, use this material, add a
thing of this size in this zone — and `planner.service.ts` turns each one into a `ProposedChange`
using the same placer and the same `geometryIsLegal` as the generator. **`DesignIntent` has no
field that can hold a coordinate**, which is what makes "the assistant never writes coordinates" a
property of the type rather than a prompt instruction. The interesting half of the feature is
therefore testable with no model involved at all: `planner.service.test.ts` feeds `DesignIntent`
objects straight in, against real PostGIS.

**The model writes the prose; the planner writes the facts.** When intent cannot be placed the
change is omitted and an `unplaceable` entry is added with a reason the planner measured ("There
is no clear 4.2 × 4 m space left in the back garden"), which the service appends to the reply. It
never fabricates a position, never silently drops the request, and never re-prompts — a second
call cannot help, because the model still cannot see geometry.

**The structured-output schema has a size budget, and it has already been exceeded once.** Adding
the `reroute` and `rotate` verbs took `INTENT_JSON_SCHEMA` to eleven `anyOf` branches and twelve
optional properties, and every assistant message then failed with
`400 invalid_request_error` — *"The compiled grammar is too large, which would cause performance
issues."* **Nothing in the schema was invalid**: no unsupported keyword, no numeric or string bound,
no recursion, every object already closed with an explicit `required`. It was simply too big for the
grammar compiler, and the published limits name unsupported *keywords* rather than any cap on size,
so a static reading of the docs could not have found it.

**An optional property is the expensive kind.** A required key is one thing to parse; an optional one
means the grammar must accept the object with it *and* without it, so k optionals in an object are
2^k shapes, multiplied again by anything nested. The fix was therefore to make nine fields
**required with an honest empty value** — `""`, `[]`, `false`, `0`, and the default the model would
otherwise have omitted — and to pull the nine inlined copies of `target` into one `$defs` entry.
Census went 22 objects / 12 optionals → **14 / 2**, and the same request compiled. No verb was taken
away from the user, which was the other option and the wrong one.

**Zod is deliberately untouched by that.** Every one of those fields is still `.optional()` or
`.default()` there, because a `DesignIntent` built by hand — by the repair service, by a test — should
not have to carry placeholders. The empty values parse, and every read of them in
`planner.service.ts` is a truthiness or length check, so `""` behaves exactly as absent. Both halves
have tests; a future `!== undefined` written in good faith would break it silently.

**`pnpm --filter @garden-studio/api probe:assistant` is how you find out for the price of one token.**
It sends one request carrying nothing but the schema and prints the API's own sentence back. Run it
before landing anything that grows the schema, and run `probe:assistant garden` as the control — if
the known-good schema also fails, the schema is not the variable and the next place to look is the
model or the key. The budget is also pinned as a unit test, so the usual case is that a red test on a
laptop replaces a 400 in front of a user.

**A 4xx from Anthropic is a 503, not a 502, and the difference is what the user is told.** 502 renders
in the chat as *"the designer replied with something unusable — try rephrasing"*, which is sound for
a refusal or unparseable JSON and useless for a rejected request: the model never read the message,
and it will refuse the next one identically. The three failures above spent three attempts telling
the user to rephrase. `toHttpException` now splits on `error.status`, and the `APIError` branch logs
`type`, `message` and `requestID` rather than the status alone — all three come off the *response*,
so the rule about never logging the key or a full prompt still holds.

**Do not disable thinking.** It is on by default on Opus 5, and with it off the model can write a
tool call into its visible text: the turn succeeds, nothing runs, no error is raised. Cost is
controlled with `output_config: { effort: 'low' }` instead, which is the cheaper lever anyway.
Note that `max_tokens` caps thinking _plus_ text together — 16 000 here, and lowballing it
truncates the answer rather than the reasoning.

**A missing `ANTHROPIC_API_KEY` is a supported state, not an error.** The provider resolves to
`null`, the endpoint answers 503, and the chat panel says "unavailable". `pnpm dev` and the entire
test suite work without a key, which they have to: this gets handed to a marker who will not have
one.

**There is no auth, so the API must stay on localhost.** A reachable deployment would hand a
stranger the key's spend. `assistant.service.ts` rate-limits regardless (an in-process token
bucket, 20/min overall and 6/min per plan → 429); if it ever leaves this machine it needs a shared
header check first. Never log the key or full prompts.

**The material renderer has no authority.** It is handed a ring that `geometryOutline` already
produced and it returns pixels; it never measures anything, and nothing downstream reads it. Delete
`apps/web/src/lib/materials/` and the plan is still dimensionally correct, just plainer. That is
also why `DesignElement.pattern` holds only an origin and a rotation — presentation anchoring, no
geometry — and why it is optional, with `patternAnchor` resolving the absent case.

**A surface's pattern is anchored to the plan origin, not to its own bounding box.** Anchoring each
surface to its own corner guarantees two touching patios _miss_ at the seam, which is the one thing
real paving never does. One shared origin makes continuous courses the default and re-anchoring an
explicit decision. There is a test that draws two abutting surfaces and one wide one and demands
identical pixels.

**A module's tone is seeded from its grid coordinates, never from the render sweep.** Seed it from
iteration order and dragging one vertex renumbers the sweep and repaints the whole polygon. This is
also why `Math.random()` is banned in that directory: the raster is thrown away whenever the zoom
crosses a bucket, so a non-deterministic tone makes the plan shimmer as the user zooms.

**Joints are the background, not lines between modules.** Modules are inset by half a joint on each
side and drawn over a joint-coloured fill. A stroked joint needs a pixel width, which either
vanishes zoomed out or swells zoomed in; drawn as background it is correct at every zoom by
construction. The suite uses a high-contrast fixture with a fat joint for structural assertions and
the shipped palette only for determinism.

**The drawn joint has a floor and a cap, and _this reverses_ "a sub-pixel joint is fine, do not
threshold those pixels".** The old note was right that a 10 mm joint on a 600 mm slab is well under
a pixel — 0.21 px at the plan zoom, 0.51 px close up — and wrong that this was acceptable. It never
lands as a line, only as a faint blend, so neighbouring slabs merge: a dozen of them read as about
five, and the complaint that arrives is "the slabs are way too big" about a surface whose slabs are
exactly the size the manifest says. Measuring a shipped render showed a true 58 px pitch reading as
nearly 90.

`drawnJointPx` (`lod.ts`) clamps it: at least `MIN_JOINT_PX` (1), at most `MAX_JOINT_SHARE` (0.12)
of the pitch. The floor is the same answer the bevel three lines from the joint code already gives
("at least a whole pixel, or the bevel is drawn at a fraction of one and simply does not appear")
and the same as `MIN_CUT_EDGE_PX` — the joint was the one drawn line with no floor, and that
asymmetry was the defect. The cap is what keeps it honest: joints are the background, so an
unbounded floor would swallow a small unit (a 200 mm sett at plan zoom has a 5.5 px pitch, and a
whole pixel of that is 18% against a real 4.8%).

**The pitch is never floored — only the gap.** Module positions, module counts and the schedule's
slab counts all still come from `(moduleSize + jointWidth) / 1000` exactly, which is why the
module is derived as `pitchPx − drawnJoint` rather than by scaling `moduleSize`. Two abutting
patios still line up for the same reason they always did.

**Module shading is a proportion of the module, not a real bevel.** The first attempt used a true
10-15 mm arris, which is under a pixel at every zoom the plan supports: the shading was computed,
drawn, and did nothing. It is a drawing convention, like the canvas's drop shadows, so it is written
in units of the thing it decorates. `LIGHT_DIRECTION` is exported so planting and structures can
later shade to the same sun.

**Rasters are cached per surface per √2 zoom bucket, and panning must never miss.** The cache key
hashes the outline and the anchor, so a vertex drag invalidates while selecting, renaming or moving
another element does not. `pattern.x/y` are differences in _metres_, so a pan changes neither — which
is what keeps a pan at zero regenerations. Bucketing matters because `use-canvas-viewport` eases zoom
through `requestAnimationFrame`: keyed on raw scale, the pattern would be redrawn every frame of
every wheel gesture.

**Konva's `fillPatternImage` does the work; do not hand-roll a clipped `Image`.** It clips to the
shape, keeps the fill as the hit region and leaves the stroke on top, all three of which a separate
image node would have to reproduce. Its transform is translate-then-scale, so the raster's top-left
lands on `fillPatternX/Y`. Konva types the image as `HTMLImageElement` but passes it straight to
`createPattern`, which takes a canvas — the cast is the type being narrower than the runtime.

**Coordinates are metres in a local planar system**, origin top-left, +y downwards so it maps
directly onto Konva. This is not geographic data — do not reach for SRID 4326 or `geography`.

**The perimeter border is an annulus, and that is the whole difficulty.** `FillService.accentRegions`
cannot make one: `exteriorRing` reads only `coordinates[0]` and discards interior rings, so a band
handed to it comes back as the entire plot and plants the whole garden. `borderRegions` therefore
grows the annulus from the **boundary** and cuts it with each zone, which both opens the hole and
tells each piece which zone it is in. `ST_NumInteriorRings(geom) = 0` is the guard: a piece the cut
failed to open is refused rather than flattened, because no border is a far better wrong answer
than a garden of shrubs. There is a test for exactly that.

**It cannot be built per zone either.** `computeZones` clips half-planes, so the zones' union is not
the boundary and their interior seams are not fence — a band grown from a zone polygon runs a border
across the middle of the garden.

**A border must be wider than `MIN_FILL_SIDE` (1.2 m)**, or every piece is rejected as a sliver and
the feature vanishes with no error at all. `borderRegions` refuses a narrow band up front instead.

**Fill elements are never checked by `geometryIsLegal` — except the border.** Accents are legal by
construction, being negative buffers of a subset of the zone. A band grown from the boundary has no
such guarantee, and `ST_SimplifyPreserveTopology` preserves topology but _not_ containment, so the
border is clamped with `ST_Intersection(..., boundary)` **and** guarded explicitly in
`concepts.service.ts`. Nothing downstream would catch an escapee: it would generate cleanly and then
be refused by the validator that guards its own save.

**A drawn canopy must be inscribed in the radius the geometry uses.** The first version let lobes
overshoot by a fifth because it looks better in isolation — and it is wrong: the placer erodes by
exactly `TREE_RADIUS` and the validator tessellates the same circle with `circleRing`, so an
overshooting lobe draws a tree hanging over the fence that the model says is comfortably inside.
`canopy.test.ts` pins it. Never buffer a canopy in PostGIS either — `shapes.ts:8-10` explains why.

**Trees are `role: 'feature'`, never `fillKind: 'accent'`.** `geometryArea` is 0 for a point, so a
tree tagged as an accent slips past the "every accent has a real area" test and quietly breaks it.

**What goes onto `obstacles` is the *trunk*, and _this reverses_ the note that said the tree does.**
The pairwise-disjointness the concept tests require is measured on `legalFootprint` now — see
"Trees: the trunk is what occupies the ground" — so a bed or a path laid afterwards may run under
the branches, which is the whole point of the change. The note above about an inscribed canopy is
untouched and still load-bearing: the *drawn* lobes must not overshoot `shape.radius`, because the
radius is what the schedule, the shadow model and the user's own canopy handle read.

**One `ElementDrawing`, used by both canvases.** There were two, and they had already drifted — the
editor drew textures while step 4 drew flat category colours, so the screen where the user _chooses_
a concept contradicted the next one. Interaction stays in the editor's wrapper; selection is drawn
as an outline _over_ the shared drawing rather than by restyling it, so the drawing stays a pure
function of the element. `offsetPx` is how the two frames are reconciled: the editor parks a group
on the element's anchor, step 4 draws absolutely.

**`useSurfacePattern` returns world metres, not pixels.** It used to return coordinates relative to
the editor's group, which silently misplaced the texture the moment a second canvas drew the same
element. Metres are the frame the two agree on.

**Plot dimensions replaced the midpoint chips rather than joining them.** `plotDimensionGuides`
emits one guide per edge, so keeping the old chips put two copies of the same number a few pixels
apart on every side. `DimensionGuide.distance` is an independent field, which is what lets the line
be drawn offset outside the fence while the label still reports the true edge length.

**`gridVisible` has five edit points**, and the one that bites is `ephemeralState()` — shared by
`resetPlanEditorStoreForTests` and `hydratePlanEditorStore`. Miss it and the flag survives a reload.

**Two kinds of material share the `scatter` renderer for opposite reasons.** Gravel, bark and
chippings are a _mass_: the units are texture on a body of the same stuff, so the ground behind them
is drawn from the middle of their own palette. Planting and meadow are _figure on ground_: plants on
soil, flowers in grass, where a darker ground is the point. Getting this backwards is what made the
first attempt's aggregates read as sparse dots scattered on mud, and there is a test either side of
the line — `palette.test.ts` holds the aggregate rule, the renderer's suite holds the coverage rule.

**Scatter densities are drawn densities, not planting schedules.** A border really planted at five a
square metre closes up in a season; drawn at five a square metre it reads as dots on soil, because a
plan shows one instant and a garden is judged by how it will look. `density × the mean unit's area`
is kept appreciably above 1 so units overlap, and a test in `material-patterns.test.ts` pins it. Do
not read these numbers as a quantity to order.

**Size, density and hue were not enough: `scatter` has a `form` axis.** Every planting material drew
the same round lobed blob, so ornamental grasses read as pale cauliflower and a hedge read as loose
bobbles. `blob` is the default and nothing changed without opting in; `tufted` draws a rosette of
radiating leaves (a grass seen from above); `clipped-mass` keeps the reaches in a narrow band so the
units merge into one scalloped body with a defined edge. Colour can stand in for form up to a point
— which is exactly why `wildflower` and `mixed-border` already worked — but a grass is a different
_shape_ from a shrub, not a different shade of one.

**A form change moves the density with it.** A rosette covers roughly half the ground a blob of the
same radius does, so the `density × mean unit area` rule was calibrated against the wrong shape:
grasses at the blob-era 8 per square metre read as soil with stars on it. Now 15. The number belongs
to the form, not to the planting.

**`form` is optional in the manifest and resolved by `scatterForm`.** `MATERIAL_PATTERNS` is
hand-written literals that never go through `.parse()`, so a Zod `.default()` would look like it
applied and never fire. Same reason `patternAnchor` and `heightFor` exist.

**Still water is a design statement, not a missing value.** `rippleSpacing: 0` on a formal pool and a
water bowl is deliberate — a formal pool is meant to read as a mirror, and drawing it like a pond
loses the distinction the user chose between. The first version of the water renderer drew a broad
rectangular sheen in the middle; it was wrong twice over, because a hard-edged slab of pale colour
reads as a UI panel and because a bright patch in the centre of a pond is not how water is drawn in
plan anyway. Fine crest lines brightening towards the lit side, and nothing else.

**A cut edge is keyed on the surface's own category, not on the pair of categories that meet.** The
pair was the intent and it fights the architecture: an edge is drawn on the _upper_ surface's
outline, and every surface is rasterised independently and clipped to its own outline, so it does
not know what is underneath. Teaching it would put its neighbours in the cache key and destroy the
independence the renderer rests on — moving one bed would invalidate every surface near it. Little
is lost: a border has a spade-cut edge whether it sits on lawn or gravel, and gravel needs
containment either way. Widths are millimetres like every other product dimension, and the first
attempt at 60 mm of near-black read as a picture frame rather than a cut in the ground.

**Stroking the clipped outline _is_ the cut edge.** The context is already clipped to the outline, so
a stroke centred on that path renders only its inner half. Computing an inset polygon to fill would
be real work for the same picture, and would have to handle a concave outline eating itself.

**Level of detail is a policy in `lod.ts`, not four thresholds in four files.** `tierFor` answers
`mass | units | detail` and `shadesAt` answers whether a thing is big enough to light. The floors
differ by pattern type on purpose: a slab stops reading at three pixels, but a gravel chipping
genuinely _is_ about a pixel and a half at a normal editing zoom, and raising its floor to match
made every aggregate fall back to flat colour and read as dead beige card.

**Palette hexes are validated once per surface, in `resolvePattern`.** Loud in development — naming
the material and the key, because a typo in a static manifest is a bug and you are the person who
can fix it in the next keystroke — and a fallback grey in production, because `hexToRgb` throws, the
throw escapes through Konva's render, and the whole plan disappears. Safe _only because it is a
colour_: the return-null-rather-than-guess rule exists for geometry, where a guess misleads about
where things are.

**A blob's highlight is a scaled copy of its own outline, not a circle laid on top.** The circle
version made every shrub look like a fried egg — a hard round highlight reads as a separate object.
Same `LIGHT_DIRECTION` as the slab bevels, so a bed and the patio beside it are lit from one sun.

**The fence is drawn above the surfaces.** A boundary drawn underneath is covered by the base fill,
which runs to the edge of the zone in every generated concept — so the garden would lose its edge
exactly where it needs one. Posts are spaced in metres, not pixels, and dropped when they get closer
than about nine pixels apart.

**A boundary states its height with a lit edge and a cast band.** The plan draws a boundary as the
band it occupies on the ground, and a band is flat — so a 1.8 m fence and a 1.1 m railing were the
same drawing at different widths, and neither read as anything but a line on the paper. Visualise
has extrusions and faces to say it; the plan has only conventions. `drawBoundaryRelief` puts a lit
line along the edge the light comes from and a band of shade on the ground on the far side, and
**the reach of that band is `height × CONVENTIONAL_SHADOW_RATIO`** — the same ratio every other
standing thing casts by, so a fence's mark and a shed's shadow agree about where the drawing's sun
is. A convention in the `houseGroundShadow` class: drawn whether or not the plan knows where on
Earth it is, and withdrawn with the rest of the shading when shadows are turned off.

**A hedge's face is skinned with `tex-hedge-top`, and it needs no family of its own.** A hedge is
the one boundary whose top and whose side are the same material seen from two angles: a fence has a
capping rail and a wall a coping, and neither top would do as a face, but clipped box is clipped box.
Lit by the renderer like every other face rather than carrying its own light, which is the rule every
skin follows.

**Zone labels are off on step 5, on purpose.** Zones are scaffolding for "which parts do you want
designed"; once that is answered, writing "Back garden ≈ 18 m²" across a finished design is a note
about the tool rather than the garden. `ConceptLabels` takes `zones` optionally and the editor omits
it. Steps 1, 2 and 4 still show them.

**Anything drawn on a rotated shape has to sit outside the rotated group.** The selected element's
size badge is rendered beside `ShapeHandles` rather than inside it, because that group rotates with
the shape and a dimension written at 30° is a dimension nobody reads.

**Do not test the tuned palette by thresholding pixels.** At a realistic zoom a 10 mm joint on a
600 mm slab is under a pixel and never lands as a pure colour, and the shipped tones are a narrow
spread by design. Structural assertions use a high-contrast fixture with a fat joint; the shipped
palette is only used where the assertion is about determinism. Note also that the curved patterns —
scatter and board — are **not byte-stable against a change in the clip region**: the rasteriser's
coverage arithmetic shifts by a channel step even for pixels far inside. Their re-clip test asserts
a tolerance; `grid` fills axis-aligned rectangles, has no anti-aliased edges, and demands equality.

**Product dimensions are millimetres, and only in the manifest.** `MATERIAL_PATTERNS` quotes a slab
as 600 × 600 on a 10 mm joint because that is how products are specified and what a costing pass
will count. The renderer divides by `MM_PER_METRE` once, at its top edge; nothing below that line
sees a millimetre. The manifest is deliberately split — geometry in `packages/schema`, palette hexes
in `apps/web/src/lib/materials/palette/` — for the reason `materials.ts` already gives about
colour being presentation. `resolvePattern` joins the halves, and returns `null` if either is
missing, which is the flat-fill path.

**Paving is quoted at garden scale, not at utility scale.** `concrete` was 900 × 600 — the coarsest
module in the catalogue — and `materialFor` hands it to two of the three medium-budget concepts, so
the biggest slab in the app was the default look: about forty of them on a 7 × 3.3 m terrace, which
reads as a yard. It is 400 × 400 now, which is what a garden is actually paved in. `porcelain` keeps
its 600 × 600 stack bond because large-format porcelain really is laid that way, and keeping it is
what makes the three concepts differ in grain rather than only in colour.

**`stone-pavers` is a `pack`, not a grid, because riven sandstone is sold as one.** A pack holds
`courses` and `lengths` rather than a single `moduleSize`, and the painter **walks** both instead
of dividing — neither falls at a constant pitch. Both walks start at the plan origin and take their
sizes from the course and unit index, so two abutting patios share course lines and unit boundaries
exactly as a grid does, and a vertex drag renumbers nothing. `bondOffset` has no part in it: each
course draws its own first length from its own index, so the vertical joints diverge from the first
unit. The `random` bond was standing in for this — it gives the varying vertical joint that is the
signature of laid stone, but with one unit size a patio still read as a chequerboard however small
the module got. `PACK_MAX_COURSES` and `PACK_MAX_UNITS` exist because a walking sweep has no closed
form for where it ends.

**A pack is counted; a scatter is not; and `isCountable` is where that line is drawn.** A pack has
no single pitch so it cannot answer `modulePitchMetres` — that is what `isModular` still means — but
its members are real product dimensions and a pack is sold by the area it covers, so
`packMeanUnitMetres` gives the schedule a number somebody can order from. A planting density is a
_drawn_ density and still gets nothing.

**Routes are laid in setts.** `stone-setts` (300 × 300) is the fine unit, and `circulationFor`
returns it for every paved route rather than the terrace's slab. A path in the same paving as the
patio it leaves reads as a narrow patio; at the old 900 × 600 a 1.2 m path was barely one slab wide.
Square rather than 200 × 100 block paving, deliberately: a 100 mm side is 2.6 px at plan zoom, under
`MIN_DRAWN_MODULE_PX`, so block paving would collapse to flat colour exactly where the fine grain
was wanted.

**`MIN_SHADED_PX` is 9, down from 12.** Twelve was set when the smallest paving unit was 600 mm
(15.6 px at plan zoom). With a 400 mm slab at 10.4 px it would have taken the light off every
terrace on every concept card and left the paving finer but flatter. Nine keeps a 400 mm slab and a
coursed pack lit at plan zoom while leaving a 300 mm sett flat, which is right — you do not see a
chamfer on a sett from that far away.

**Quantities live in `packages/schema/src/plan/quantities.ts`, and this is the architecture paying
off.** A plan here is real geometry rather than a generated picture, and the point of insisting on
that — the tessellation rules, the PostGIS validation, deriving rather than storing — is that
quantities _fall out of it_. Nothing in that file measures anything; it reads areas `elementArea`
already computed from shapes the validator already checked. The cost functions moved there from the
API's generator for the same reason: stranded server-side, the screen that most needs a budget could
not reach them without a second implementation.

**Unit counts are given for modular products only, and the restriction is load-bearing.**
`unitsPerSquareMetre` returns a number for a scatter quite happily. Multiplying it by an area would
print "412 plants" — turning the _drawn_ density that `material-patterns.ts` warns about into a
shopping list. Slabs and boards are safe because their manifest entries are real product dimensions.
Planting gets an area and a dash, and the dash is the honest answer rather than a gap in the work.

**`groundCoverArea` counts base fills only, and that is what makes it exact.** Element areas overlap
by design — a base fill is the whole zone and everything else is drawn over it — so summing them all
reported 196 m² for a garden whose ground was 135 m². Base fills are one per zone and `computeZones`
clips half-planes, so they tile without overlapping. The schedule groups by layer for the same
reason and says plainly that the groups must not be added. The exact net remainder _is_ computable —
`FillService.accentRegions` does it in PostGIS — but deriving it client-side from element areas would
lean on the generator's disjointness guarantees, which the editor breaks the moment someone drags one
bed over another.

**The review screen stores nothing.** Schedule, ground area and cost band are all derived at read
time. There is no `review` section on the document and there should not be, for the same reason zones
are recomputed: a summary that can disagree with the thing it summarises is worse than no summary.

**Three failures, three answers, decided where they are still knowable.** The plan layout used to do
`getProject(id).catch(() => null)` then `notFound()`, which told someone whose API was simply not
running that their URL was wrong. Now a 404 is `notFound()`, an unreachable server gets a screen
naming the address and the commands to start it, and anything else is rethrown to `error.tsx`. The
middle case is handled in the layout rather than in the boundary because **Next scrubs server-side
error messages in production** and hands the boundary only a digest — by the time an error page sees
it, what went wrong is no longer knowable.

**A displaced label needs a line back to what it names.** `stackLabels` resolves collisions by pushing
labels down and used to overwrite `at`, throwing the original away — so a label that moved pointed at
nothing. It returns `anchor` and `displaced` now, and `LabelLeader` draws a hairline to a dot at the
subject, only when the label genuinely moved. The leader is vertical because the displacement is;
there is a test asserting `at.x === anchor.x` so that assumption fails loudly if it ever changes.

**Label width is capped in CSS, not in JavaScript.** Names are user-supplied and the label is centred
with `whitespace-nowrap`, so a long one grows in both directions and runs off the canvas —
`stackLabels` never sees it, because that collision is horizontal. `text-overflow: ellipsis` cuts at
the exact rendered pixel in whatever font actually loaded, where a character count is wrong for
"Wildflower meadow" and "IIIIIIIIII" in opposite directions. The full name goes on `title`.

## Step 2 — the existing garden

**The screen asks for far less than it used to, because the generator consumes far less than it
asked for.** `concepts.service.ts` reads `document.features` in exactly one place and only takes
`status === 'keep'` — those become obstacles and `existing-feature` elements. `remove` and
`replace` are deliberately neither. So a user who carefully maps their whole garden is doing work
the system throws away, which is what "only map what matters" is a correction to.

**`FeatureStatus` is still `keep | remove | replace`, and that was a decision not an omission.**
The brief asked for `keep / prefer_keep / remove`. The existing triple already expresses it —
`keep` is protected, `replace` is "keep the space, change the thing", `remove` is "this may go" —
and a fourth state would have to be *honoured* by the generator or it is a lie on screen. No
schema change, no version bump, every stored plan unaffected; the UI copy says what each one means
for the design instead.

**Skipping is an action, not a checkbox.** It used to be a tick at the bottom of the placed-features
list, which recorded `skipped` but did not move you on — so there were two controls for one flag and
only one of them did the thing the user wanted. `PlanBottomBar` gained a `secondaryAction` slot (a
`{ label, onClick }`, used only here, so the shared bar still knows nothing about what any step
means) and Skip sets the flag, flushes and navigates. It deliberately does **not** clear features
already placed: a feature the user drew is a fact about their garden whatever they press next.

**The redesign area is two fields, and its *type* is derived.** `site.selectedZoneIds` stays the
zone truth — same owner, same undo stack, same `site` section — and `site.scopePolygon` joins it.
`resolveDesignScope` in `packages/schema/src/plan/scope.ts` answers
`entire_garden | zones | custom` from the two. A stored `type: 'custom'` would go stale the moment
the outline was cleared, and then a plan would claim an area it no longer has. Same argument as
zones, openings and the roof.

`BoundaryDraft` is a re-export of `SiteSection`, so adding the field gave persistence, hydration
and 409-adoption for nothing — **no `project-sync.ts` change at all.** Worth knowing before adding
another site field and writing plumbing that already exists.

**`scopeRing` is the single rule about what a usable area is**, and the store, the PostGIS
validator (`invalid_scope_polygon`) and the generator all ask it rather than repeating it. It
refuses a self-crossing ring, a sliver under `MIN_SCOPE_AREA`, and one that leaves the fence —
returning `null` rather than trimming, because `ST_Intersection` would absorb an overhang without a
word. **`null` is not "the whole plot"**: it is the signal to skip the clip entirely, which is what
keeps an unscoped plan generating byte-identically.

**The scope-drawing gesture shares step 2's draft pipeline, and one line of that is load-bearing.**
`mode: 'scope'` reuses `draftPoints`, `addDraftPoint` and `CLOSE_DISTANCE` rather than opening a
second click pipeline on the same canvas. `handleStageMouseDown` has to name scope mode alongside
`place`: falling through to the branch below arms the pan on every press, `handleStageClick`
returns early while `panActive`, and every corner click is then swallowed in silence — the area
simply cannot be drawn and nothing says why. `draftPlacement` exists for the same class of reason:
the finish button was gated on `placement`, which is null with no `placingKind`, so the area had no
way to close.

**The dim is a `Shape` with an even-odd fill, not two `Line`s.** A custom area dims the plot
*except* the outline, which is a polygon with a hole, and Konva's `Line` cannot express one. Zone
scope needs none of that — it dims the zones that are out, reusing the polygons the canvas already
tints. The overlay is spliced above the zone tints and below the features, so the house and every
existing feature stay legible, which is what the brief asks for and what the layer order already
gave for free.

## Step 3 — the brief is built from pictures

**The screen asks what the garden is *for*, and it asks it with images.** Step 3 was five numbered
`FormSection` cards in a three-column layout: eight tick-box chips with 16 px lucide icons for the
features, four abstract SVG motifs a fifth of the width for the style. Everything on it was
accurate and nothing on it showed the user what any answer would produce. It is now one centred
column: a grid of isometric garden vignettes, a row of style photographs, and budget, maintenance
and the free-text prose demoted to a quieter band underneath. The `FormSection` framing survives
only in that band, which is the honest division — the two questions above it are a brief, and the
three below it are fields.

**Budget and maintenance are at the bottom although they are the two answers that gate Continue,
and that is deliberate.** The pictures are where the user forms an opinion; those are two clicks
made in a second afterwards. Opening on them would open the screen on a form and lose the point of
it, and `PlanBottomBar` names anything still outstanding, so nothing can be missed by scrolling
past it.

**The three side panels were removed rather than moved.** `BriefProgress` restated the
`StepIndicator` already in the top bar; `FeatureLegendPanel` is step 2's vocabulary for features
that already *exist*, which on a screen about what you *want* is a second and conflicting legend;
`InspirationCallout` was a third copy of the sage callout. `ContextPanel` survives, restyled as a
horizontal strip under the heading, because it is the only one answering a question the user
genuinely has here — which part of the property am I briefing. The width matters as much as the
tidying: sixteen pictures four across want the whole page, and squeezed into a middle column
between two rails they land at the size of the icons they replaced, which would buy nothing.

**A space is a room, not an object — and every id is honoured somewhere in generation.**
`DesiredFeatureSchema` went from eight members to fifteen (`dining`, `gardenRoom`, `hotTub`,
`greenhouse`, `lawn`, `plantingBeds`, `lighting` are new; every existing id is untouched, so stored
plans and `RequestedFeatureCheck` are unaffected and there is **no migration and no
`PLAN_DOCUMENT_VERSION` bump** — a union that only gains permitted values still parses everything).
Adding one is a compile error in exactly four total `Record`s, which is the mechanism that keeps a
card from being a tick the design ignores: `DESIRED_FEATURE_LABELS`, `FEATURE_SPECS`, the slot
`PREFERENCES` table and the web app's `DESIRED_FEATURE_ICONS`.

**`dining` split out of `seating`, and the terrace rule generalised with it.** The old label was
"Seating / dining area", so a brief asking for both got one patio with a sofa on it. The terrace
still exists in every plan and is still claimed by `seating` — but by `dining` when seating was not
asked for, named and furnished accordingly (`FURNISHINGS.dining` is a table and nothing else, which
is also what `hostFloor('dining')` measures). A brief with both gets the terrace for seating and
the dining room at `terrace-end` or `beside-terrace`, which is how a garden of that brief is
actually laid out.

**Three of the fifteen are *composed*, not placed, and are reported from what was drawn.**
`lawn`, `plantingBeds` and `lighting` are passes that already run over the whole plan — the
template lays the lawn panel, `designedBeds` cuts the borders, `lightingScheme` reads the finished
garden. Sending them through `assignSlots` and the sampler as well would draw a second lawn on top
of the first. So `COMPOSED_FEATURES` holds them out of stage 1 entirely and out of `attempts` (a
budget of *placements*, which they consume none of — counting them would have a brief that ticked
lawn and planting beds quietly starve two real features out of the plan), and at the very end one
check per requested composed feature is pushed, `included` derived from whether an element of the
matching category actually landed. The danger this avoids is specific: a tick that reports success
because nothing ever tried and failed. A courtyard with no room for a lawn now says so.

**A space ticked by name beats the setting that would have refused it.** Two overrides, both in
`resolveConstraints`, both for the same reason: `lowMaintenance` reads as "Minimalist" on the style
cards, so choosing a spare look *and* a lawn is ordinary rather than contradictory, and lighting is
off at a low budget as a *default* rather than as a rule about what is possible. `wantsLawn` drops
`'lawn'` from `forbiddenFill`; `wantsLighting` lifts `lightingScheme`'s budget gate. The upkeep
badge is deliberately not softened with it — the concept still says "Low", which is the honest
report of a garden whose one demanding element the owner chose knowingly.

**The style ids did not move; only the words did.** `STYLE_LABELS` is one word each now — Modern,
Natural, Traditional, Minimalist — because a style is chosen from a picture rather than read from a
phrase, and a concept card has room for a name rather than a name and its gloss. `StyleDirection`
itself is untouched: generation branches on those exact strings for the planting style, the tree
palette, corner radii, edging, paving, the retaining material and which template is recommended.
Mediterranean was left out for that reason and is in TODOS.md — a new direction that fell through
to the defaults would draw a garden identical to Modern, and a card that produces the same plan as
the card beside it makes the whole selector look like decoration.

**`styleLabel` is a lookup now, not a `split`.** It took the first half of "Modern / minimal"; with
one-word labels that would silently return the whole string the day somebody reworded one.

**Selection shape carries the many-versus-one distinction on its own now.** `ChoiceCard`'s rule was
*square indicator on the left means many, round badge on the right means one*, reinforced by
`border` against `border-2`. A card whose artwork runs edge to edge has nowhere to put an indicator
but the top right, so both moved there and only the shape is left doing the work: `SpaceCard`'s tick
is a rounded **square**, `SelectionBadge` is a **circle**. Do not round off the first. Both also
changed to a white ring on a translucent white ground, because a pale grey ring disappears against
half the photographs it now has to be legible on.

**Every selectable card carries two test ids, and they answer different questions.** `${testId}` is
on the `sr-only` input — the *state*, which is what a unit test and a screen reader read —
and `${testId}-card` is on the `<label>`, which is the *target*. A hidden input is not clickable by
a real pointer, and Playwright refuses an element outside the viewport outright, so a browser test
has to aim at the label. That it also fails on the day the label stops wrapping its input is the
point: it is the one regression that would break the whole interaction while every unit test passed.
`e2e/brief.spec.ts` is what exercises it.

**The card artwork is a separate manifest from the plan renderer's, and that is not tidiness.**
`lib/brief-art.ts` holds one `BriefArt` per space and per style; `tools/assets/src/generate-brief.ts`
writes them to `public/brief/<id>.webp`. They are kept out of `ASSET_FAMILIES` because of what that
tool does *after* the model answers — seam-scoring, measuring a sprite's opaque reach, recording a
mean colour to tint towards, and writing `catalogue.json`, which the painters read and
`audit:assets` checks against disk. A picture on a card is never tiled, never tinted, never
measured, and its path is derived from its id, so sharing the file would mean every one of those
passes growing a case meaning "not this one". What *is* shared is the discipline: the prompt is the
specification, the art is generated once offline and checked in, the raw PNGs are cached under
`tools/assets/raw/brief/`, and **a missing file is a supported state** — `SpaceCard` and `StyleCard`
fall back on `onError` to a lucide icon and to `StyleThumbnail` respectively, so the screen works
with no artwork at all.

**A prompt has to refuse a comparison outright.** The lighting card asked for "the same garden at
dusk" and the model returned a **before-and-after diptych** — a perfectly reasonable reading of
"the same", and useless on a card that has one thing to say. `ISOMETRIC` now says "a single plot in
one image — never a diptych, a split view, a before-and-after or a grid of variations", which
protects every card rather than only the one that was caught. Worth knowing before writing the next
scene: an image model treats any phrase implying two states as licence to draw both.

**The spaces are miniatures and the styles are photographs, and the difference is the question.**
A photograph of somebody else's pergola is a picture of *their* garden — the eye reads the fence,
the house and the light, and "do I want one of these" becomes "do I want that". A small isometric
model on a plain ground reads as a component. A *style*, though, is planting density, edge treatment
and colour temperature, which is exactly what a simplified render flattens; you cannot tell somebody
what "naturalistic" means, you show them one. Hence `ISOMETRIC` for one and `STYLE_PHOTO` for the
other, both with no people and no text, and the styles all in overcast light because bright sun is
itself a style and would make whichever garden got it look like the nice one.

**`hot-tub` is the only structure in the plan library drawn from a photograph.**
`asset-spec.ts` says structures are absent on purpose: a shed, a pergola, a garden room or a
greenhouse is whatever rectangle the placer gave it at whatever rotation, so a stretched photograph
puts its posts and its ridge in the wrong places. A hot tub is not like that — it is a product, it
comes in one size, and 2.4 m square is what the generator places. So it takes the
`furniture-fire-pit` route (`feature-hot-tub`, via `SYMBOL_SPRITES`) while `garden-room` and
`greenhouse` are drawn geometry in `symbols/structures.ts` like every other building.

**What identifies a garden room in plan is the glass, not the roof.** From directly above a flat
roof and a mono-pitch are the same rectangle, so `gardenRoomParts` gives one plane (there is no
ridge to break it at), a glazed band down one long face and mullions across it. **Which face is
glazed is a stated convention, not an inference**: the document records no door on an element and no
direction it faces, and guessing from the house would be a derived direction nothing downstream
could check — the class of thing `openingNormal` exists to avoid. The greenhouse reuses `shedRoof`
unchanged and adds `glazingBars`; both drop their divisions below `MIN_GLAZING_BAR_PX`, the same
judgement `boundaryRuns` makes about fence posts, because a run of fine lines closer than about
three pixels is a grey wash over the whole roof rather than divisions.

## Feedback: what people do with the design they are offered

**The design agent could say how good it thought a plan was; it had no way to find out whether it
was right.** Every number the evaluation harness reports is the scorer marking the generator's
homework against rules the same author wrote, which is circular by construction — a well-calibrated
scorer and a badly-calibrated one produce equally confident tables. `design_events` is the only
outside opinion the project can collect short of a user study: which of three concepts somebody
took, and what they changed about it straight afterwards.

**Eight kinds, and deliberately only eight.** Concept chosen and regenerated, element added, moved,
resized and deleted, layout reset, plan exported. Each answers something the scorer cannot: choosing
says which strategy a person preferred against a recommendation that claims to know; deleting an
element says the generator put it where somebody did not want it. **Not** recorded: opening a
screen, hovering, scrolling, how long anything took. Those measure the interface rather than the
design, and every one of them is a decision nobody made.

**`strategy` is the field that makes the table worth having.** It is what turns "somebody deleted a
shed" into "people delete the shed on destination-garden plans", which is a statement about a
*composition* rather than about one person's afternoon. It is stamped onto every event from the
emitter's context rather than passed at each call site, and `startProjectSync` recovers it from the
stored plan — so a user who comes back a day later and deletes something is still describing the
same design.

**Nothing in `generation/design/**` imports any of it, and nothing ever should.** A scorer reading
its own feedback would close the loop and stop being inspectable: "why did it choose this" would
become "because people like it", which is not a claim anybody can argue with or test. The rows are
for a person to read and for a calibration pass to reason about offline. That restriction is the
whole design, not a phase boundary.

**It records what changed, never where anything is.** A category and a magnitude — 1.8 m, or a
factor of 1.25 — never a position or an outline. The plan is already stored, so a second copy of the
geometry here could only ever disagree with it.

**One event per gesture, which is the same unit the undo stack uses.** A drag calls
`moveElementLive` on every mousemove, and forty rows saying a shed moved two centimetres describe
the mouse rather than the decision. `endGesture` compares the snapshot to the present and reports
only when *exactly one* element changed — several at once is a selection drag or an applied
assistant diff, and "three things moved by various amounts" is not a fact anybody can act on.

**It cannot break anything, and that is the contract rather than an aspiration.** The emitter
swallows its own failures, batches on a two-second timer, and is never awaited; the service logs a
failed insert and answers zero rather than raising. An emitter is called from inside a store action
a user is waiting on, so a rejected fetch must not surface as a broken drag — a measurement that
damages the thing it measures is worth less than no measurement. There is no retry queue, on
purpose: a dropped batch costs one datum, and a retry queue would cost a user's afternoon the day
the server is down.

**The one failure allowed to be loud is an unknown plan**, which answers 404. That is a client bug,
and the foreign key would refuse it anyway with an error naming a constraint rather than the fix.

**`pnpm test` no longer truncates the dev database, and that reverses a trap recorded twice above.**
Adding a second suite that writes rows exposed what the shared `truncate` helper always was: vitest
runs files concurrently, so a suite that empties a table deletes whatever the suite beside it is
using. Serialising the API suite fixes it and costs minutes rather than seconds. Each suite now
removes the rows it created — which is what a test sharing a database should always have done — and
the `list projects` assertion filters to its own rows rather than demanding an empty table. The
helper is gone, so there is nothing left to reach for.

## The strategic brief: a model on the generation path

**The one model call that is part of designing rather than part of answering a question.** It writes
the *strategy* for three concepts — what each garden is for, how the spaces the user ticked rank in
it, which rooms matter, which compositions are worth trying — and a deterministic engine then draws
all three. `apps/api/src/plan/assistant/design-brief/`, off unless `DESIGN_BRIEF_LLM=true`.

**It is the "LLM confined to the strategic reasoning layer" the architecture was built for, and the
confinement is structural.** There is nowhere in a `DesignBrief` to put a coordinate, a dimension or
a distance, so the model cannot say where anything goes even if it tried — the same property
`DesignIntent` and `GardenAction` have, tested the same way by walking the JSON Schema's property
names. What it decides is categorical: an intent, an emphasis, a room, a tier, a shortlist, a
sentence.

**Generation never fails because of the model, and that is the difference from the other two
assistants.** They map an error to an HTTP status because a user asked a question and is waiting;
here nobody asked, and the deterministic brief is a complete answer. Every path — no key, a refusal,
a timeout, prose instead of JSON, the wrong shape, two briefs instead of three — returns the
deterministic briefs and logs. There is a test that walks all seven.

**Reconciled field by field, never trusted or rejected wholesale.** `design/brief-reconcile.ts` is
pure and lives with the design layer, so the interesting half is testable with no model at all —
the same split `planner.service.test.ts` gets from `DesignIntent`. A feature the user never ticked is
dropped from the ranking, because the zone planner builds rooms from that list and an invented hot
tub becomes a real rectangle in a real garden. A composition the plot refused is filtered out. More
than four essentials are demoted rather than dropped, because they did ask for them. The style is
never the model's to change: they chose it from a picture and it is theirs. Every field falls back
independently, so one hallucinated id cannot silently revert a good reading of the intent.

**A shortlist that changed nothing would have been the third "tick the design ignores" in these
notes**, so `archetypeShortlist` now reaches `rankArchetypes` — and it took a measurement to find
out how much it is allowed to be worth. Giving a shortlisted composition a tenth of a point made the
fixture set *worse*: mean 0.872 → 0.868, and the worst plan 0.739 → 0.680. The site-and-style ranking
is simply the better judge of which arrangement suits a plot. What survives is the narrow claim the
measurement supports — where two compositions score within three points the plot has no opinion, and
the brief's preference beats the alphabetical order that decided it before. Benchmark unchanged.

**The near-tie is quantised into bands rather than compared with an epsilon**, because
`Math.abs(a - b) < ε ? 0 : b - a` is not transitive: 0.50, 0.52 and 0.54 make a level with b, b level
with c and a clearly above c, so the ranking would depend on the order the array arrived in. A
generator that promises the same plan for the same seed needs a real ordering.

**Once per generation, never per candidate, and cached on the rendered inputs.** Fifty candidates are
scored per concept and the brief is an input to all of them. Rerolling one slot asks the identical
strategic question, so it is answered from the cache; keying on the inputs rather than the document
also means nudging a boundary vertex on an earlier step does not pay for a fresh call. **A non-answer
is never cached** — every give-up path returns the array it was handed, and the identity check is how
that is known, because caching a refusal would both disable the feature for ten minutes and come back
as something the caller could no longer tell apart from a real answer.

**`ConceptsService` takes it as an `@Optional()` dependency and passes briefs *down* as data.** The
design layer stays pure: it never imports a service, never sees Nest, and cannot reach a model. Three
call sites build the concepts service by hand — the concept suite, the reference fixtures and the
eval harness — and none of them wants a model in the loop. `null` means "use the deterministic
builder", which is deliberately a different value from handing back the fallback briefs: `read` builds
its briefs against its own slot's constraints, so passing the fallback down would quietly replace a
per-concept reading with slot A's and change what the generator drew with the feature switched off.

**No real call has been made on this path.** Everything up to the request and everything after the
response is exercised with a fake client, as it is for the other two assistants. Its own usage is
reported by `logAssistantUsage` when it does run, and this is the call where the numbers matter most
for cost: it happens once per *generation* rather than once per question, and step 4 generates the
moment a user arrives on it.

## Visual AI agents: watching the plan being redesigned

**A redesign is a script of structured operations, not an animation.** `DesignOperation` in
`packages/schema/src/plan/operations.ts` is the contract between whatever decided on a change and
the editor that performs it: `select`, `move`, `resize`, `rotate`, `reshape`, `reroute`,
`setProperty`, `add`, `remove`, `inspect`, `analyse`, `note`, plus `group` for things that happen
together with a stagger. A `DesignRun` is a list of them with the request that produced it. The same
executor plays a hand-written demonstration and, later, a planner's output — which is the whole
reason the reasoning and the motion are separated.

**Three properties are of the type rather than of anybody's good behaviour.** There is nowhere in an
operation to put a `from`, so it cannot disagree with the plan it lands on — the starting state is
read from the live elements when it runs, which is also what makes Replay a re-run rather than a
recording. There is nowhere to put an opacity, a scale or an easing curve, so an operation cannot
be a renderer instruction in disguise; motion is derived and thrown away. And nothing in the file
decides legality: `resolveOperation` does, against the same `geometryIsLegal` and `isLocked` a drag
answers to.

**Every operation is resolved before a pixel of it is drawn, and that is the feature's one hard
rule.** `prepareRun` folds the whole script through `resolveOperation` against the state each
operation will actually meet, so a refused one is given zero duration and reported in the panel
instead of being animated. Animating a change the store would then decline is the single most
untrustworthy thing this product could do — it is the same reason `applyProposal` reports what it
refused rather than claiming success, and the reason the planner rather than the model writes
`unplaceable`.

**The store holds settled states only, and the gesture bracket is the transaction.** One
`beginGesture` at the start of a run and one `endGesture({ silent: true })` at the end, with raw
`setState` at each operation boundary in between — exactly what `applyProposal` does, and it buys
the same thing: **one undo entry however many operations ran**. Cancel restores the snapshot inside
the bracket, so `sameElements` is true and stopping leaves no trace at all. Replay winds the plan
back inside a fresh bracket and plays the same prepared run, so the snapshot equals the result and
no second entry is written. There is **no working copy**, deliberately: a separate draft would mean
the renderer drawing something other than `present`.

**`silent` exists because `gestureChange` would file a run as a hand edit.** A one-operation run is
exactly the shape it reports as `element_moved`, and the whole value of `design_events` is that it
records what *people* did with the design. Runs report themselves instead, with four kinds of their
own and a `delta` of how many elements changed.

**Autosave is suppressed for the length of any gesture, which fixed a pre-existing bug.** The layout
subscription used to fire on every `present` change, so a drag with a pause in it longer than the
800 ms debounce uploaded the layout from the middle of the drag; a twenty-second run would have
uploaded a dozen. Nothing is scheduled while `gestureSnapshot` is non-null and one save is scheduled
when it closes.

**Motion is substituted into the real renderer, not drawn over it — and the first version got this
wrong.** An element being moved is handed to `buildRenderScene` with this instant's geometry, so a
terrace being enlarged goes on being drawn in its own paving. Drawing it flat on a Konva layer above
instead was tried, looked at, and is visibly wrong: the plan is photographic, and a grey rectangle
sliding across it reads as the renderer having broken. `MotionEntry.replacesSettled` is the line.
Only what the scene cannot express goes on the overlay layer — something fading out, and the old
route while its replacement is drawn along — because both need a per-element opacity a plan has
nowhere to put.

**The cost of that was measured before it was designed around.** One editor scene build is **~34 ms**
for a 50-element garden, and **it is almost entirely planting**: `buildRenderScene` re-samples every
bed on every call (1,355 plants on the entertaining fixture), and the same call with instancing off
is 1.3 ms. Sub-linear in element count and much the same whether anything changed. That is already
what every drag frame costs in the rich renderer, so a run is no worse than a drag — but it is why
nothing here writes to the store per frame, and why memoising the planting sample is the one change
that would make this and every drag faster. Recorded in TODOS.

**A run is a function of the clock, and that is what makes it testable.** `evaluateRun(prepared, t)`
returns motion, overlays, cursor, chip, stage and agent for any instant, touching no store, no timer
and no canvas — so a nineteen-second redesign is asserted frame by frame in Node with a
`manualClock`, and Replay, Compare and scrubbing are the same function called differently. Pausing
is an offset rather than a stopped clock, because `performance.now()` keeps moving while a user
thinks.

**The overlay outline follows the live shape, and only the corners that move are marked.** Drawn at
the target instead, the outline reads as a second selection round the first and quietly claims the
terrace is already the size it is only on its way to being. And a sweeping lawn is a twenty-eight
point ellipse: marking every corner to show that four of them moved covers the garden in dots and
says nothing. Both were found by looking at screenshots, not by reasoning.

**The AI has its own colour, and it is neither the selection green nor the clash red.** `COLOUR.ai`
is an indigo. Green is what *you* have selected and red is "that edit was refused", so an AI cursor
in either would be saying something the canvas already means. While a run is on, the editor's own
selection outline, handles and size badge are suppressed — the run does set `selectedId`, which is
how the properties panel follows the work, but drawing two selections in two colours over one shape
is the thing to avoid.

**The editor's tools are off while the AI has the plan, and the reason is the bracket rather than
arbitration.** A drag landing inside the run's gesture would be swept into the run's single undo
entry, so pressing Undo afterwards would take away the user's own change along with the redesign.
The honest options are to watch it or to stop it, and both are in the panel. Zoom and pan stay live,
because the viewport is not the plan.

**The activity panel is a list of stages, never a conversation.** Agents talking to each other on
screen invents a process the code does not have and competes with the canvas, which is the thing
worth watching. Every line is read off the operation being run, so the panel cannot claim work the
plan did not receive. It sits *above* the properties panel because properties grow with the selected
element and would push it below the fold exactly when a run is in progress.

**The demonstration is written from predicates, never ids.** A generated concept's ids are
`c<seed>-<index>-eN` and change every regeneration, so a script naming one would work exactly once.
`buildDemoRun` finds the terrace by asking which paved rectangle sits against the house, computes
every target relative to what it found, and checks each with `geometryIsLegal` as it builds — so it
cannot script a refusal and call it a design decision. A plan it cannot work with gets a sentence
("This plan has no paved terrace for the designers to work from"), not half a run. There is a test
asserting it resolves clean on five real fixtures. The button is development-only (or `?aiDemo`).

**The minimum side is a rule about resizing, and applying it more widely broke lighting.** The first
`resolveOperation` refused anything under `MIN_FEATURE_SIDE` in any dimension, which the demo caught
immediately: a bollard light is 160 mm across and the generator places them routinely. The editor
only applies that rule in `resizeElementLive` and `setCanopyDiameter`; an AI held to a stricter rule
than a person is a bug in the rule.

**`polygonArea` is unsigned, so the winding check in `alignRings` needs its own shoelace.** That
function is documented as always positive because winding "is not meaningful to the UI" — true
everywhere else and false here, where it is the difference between a bed morphing into its new
outline and a bed turning inside out half way. A local signed area, for the reason `openingNormal`
probes rather than assuming. A test caught the silent no-op.

**The assistant's diff plays as a run, with nothing new on the wire.** `ProposedChange` already
carries the element on both sides, so `runFromProposal` is a pure client-side function and the chat
gained a **Watch** button beside Apply for no extra request and no second model call. The plan said
to put `operations` on `AssistantProposalSchema`; that was wrong twice — it would make `assistant.ts`
and `operations.ts` import each other, the cycle `zone-id.ts` exists to avoid, and it would put a
presentation decision in the contract between the two halves of the system.

**The operation is derived from the two elements, never from the change's own `kind`.** The planner's
`kind` is what it meant to do; `previous` and `next` are what differ. A "move" of a bed is a new list
of corners, so it is drawn as the reshape the document says it is. The corners are *compared* rather
than assumed different, because every line of the diff carries a whole element on each side — a
material swap on a bed arrives with an outline too, and morphing it into the identical outline is a
second of nothing in a run whose whole claim is that each movement means something.

**There is a reviewer, and it is `scoreConcept` on the live layout.** `POST /plan-projects/:id/design/review`
takes the *elements* rather than reading the stored plan, because the question is asked mid-redesign
about a garden saved nowhere; side-effect free, like `/validate`. Everything it stands on
(`analyseSite`, `readDesignFor`, `scoreConcept`) is pure and query-free, so the endpoint needs no
database and its test needs nothing running. `readDesignFor` had been written for exactly this and
had zero call sites.

**`POST /:id/assistant/redesign` is the planner with no model in front of it.** The reviewer has
already decided what is wrong and which element it is about, so there is no sentence to interpret —
which means no key, no rate limit (that budget caps a bill this route does not incur) and no prose.
It takes `elements` too: a reviewer asks while the editor is holding a gesture open and nothing has
been saved, and planning against the stored layout produced corrections computed from widths the
user had already changed. **Found by measurement, not by reading the code.**

**The loop is `repair.ts`'s shape, performed where a person can see it**: worst repairable fault,
one change, measure again, keep it **only if the total actually rose** by the same 0.002, bounded at
two passes. A change that is not kept is still played — the user watched the reviewer try something,
and quietly leaving it in while saying it did not help would be the reviewer marking its own
homework. Every dependency is injected, so the gate is tested with no server, no clock and no canvas.

**Three repairs are performable and seven are not, and which is which was measured.** `shrink-terrace`,
`widen-path` and `drop-optional` are faults whose fix the scorer fully specifies. The three *move*
kinds are not: the scorer says what is wrong and never where the thing should go instead, and mapped
to "towards the boundary" across four generated fixtures the planner refused **every one** with "It
is already as far that way as it will go" — the things these faults are about are against a fence
already. `UNPERFORMABLE` names all seven with a reason, the way `repair.ts` names its own two.

**A correction has to clear the fault it was aimed at.** A flat 1.3 factor on a path pinched to
0.5 m gives 0.65 m, which is still too narrow — so the fault survived, the score did not move, and
the loop wound back its own correction. It looked like a reviewer with nothing to say rather than one
aiming too low. `intentsFor` reads the element and computes the factor that reaches a metre. Measured
after: two pinched paths widened, 0.851 → 0.862 → 0.872, both kept.

**A fault is a code *and* its subjects.** Keyed on the code alone, a plan with three pinched paths
had one widened and the other two written off as already tried — and the panel rendered two React
children with the same key. The same mistake twice, in the loop and in the list that narrates it.

**On a generated plan the reviewer usually finds nothing it can fix, and that is the honest result
rather than a bug.** Generated plans score 0.85–0.90 and their remaining faults are the two the
design agent already records as out of reach: too many materials is a `materialFor` question, and
seating in shade wants a *second* sitting area in the sun. The reviewer earns its place on a plan
somebody has edited.

**The scorer gives the same answer for all three brief slots, so `review` takes no slot.** The
obvious signature takes the strategy a concept was designed to, so a retreat is not marked down for
entertaining badly. The briefs genuinely differ — A is `social`, B `open`, C `planted` — but scored
across four fixtures all three give **the same total to four decimal places and the same issues**: no
principle reads the fields that vary. Offering the parameter would have been a setting the design
ignores. There is a test pinning the limitation so it fails the day it stops being true.

**What is not built:** the planner has no `reroute` or `rotate` intent, which is what keeps three of
the seven unperformable repairs unperformable; and a vision critic returning `DesignIssue[]` in the
same schema is untouched. All in TODOS.md.

## One design agent: talking to the thing that does the work

**There were two AI panels on the editor and they did not know about each other.** "Ask Garden
Studio" was a chat that handed you a textual diff to tick and Apply; "AI designer" was a control
surface that could play a scripted demonstration or a review and nothing else. So the thing you
could talk to could not act, and the thing you could watch acting could not be talked to.
`DesignAgentPanel` is the join, and `AssistantPanel.tsx` and `AiActivityPanel.tsx` are gone.

**Sending performs. _This reverses_ the approve-first note above**, and the reversal is only
defensible because the net underneath it was built first — it did not exist as described:

- **The gesture bracket was per _run_, not per request.** A sentence the reviewer then corrected
  twice opened three brackets, so `endGesture` wrote three undo entries and one press of Undo took
  back only the reviewer's last tweak. `beginSentence` / `endSentence` on `ai-run-store` now wrap
  the request's run *and* every review pass. One bracket per thing the user said is the only version
  where "Undo takes the whole thing back" is true.
- **Stop deleted its own Undo.** `finish('cancelled')` set `revision: null`, and `undoRun` returns
  early without one — so the panel's offer to put it back was a sentence the product could not
  honour. Stop now keeps what has landed and writes a revision; `DesignRevision.complete` is what
  stops Replay offering to run the part the user stopped, and the Replay button is disabled on it
  rather than live and inert.
- **A revision died with the tab.** A redesign autosaves within the second, so a request the
  designer misread was unrecoverable after a reload. `layout.revision` persists one.

**The reviewer's wind-back cannot use the undo stack, and that is not an implementation detail.**
Inside a sentence the bracket is still open, so nothing about the run has reached `past` — `undo()`
would pop the entry *before* the sentence and take back an edit the user made by hand.
`undoLastRun` winds the elements back directly instead. Neither route emits telemetry: **the
reviewer winding back its own work is not a person rejecting the design**, in the one table that is
supposed to record what people did.

**The review pass that follows a request is scoped to what the request touched.** Asking for a
bigger terrace and watching the designer go on to move the store and rewrite the lighting is the
moment the user stops feeling they are driving. Faults outside the scope come back as `offers` —
chips carrying their own intents — and an offer whose `subjects` are not element ids is **dropped at
build time**, because `DesignIssue.subjects` is documented as "element ids where they exist, else
zone ids or feature names" and a chip that silently does nothing is worse than an absent one. The
scorer still reads the whole element list: scope decides what may be *acted on*, never what may be
looked at, or a subset would quietly change what composition is being judged.

**`composeOutcome` counts the garden, not the proposal.** The old `summarise` counted
`ProposedChange[]` — a claim about an outcome made before anything was attempted — so a request
whose last two lines the planner refused still announced four changes. It counts *elements that are
different*, because one line of a proposal can produce two operations and one operation can be played
and wound back, and neither is a change to the garden. `DesignRun.summary` is now left unset by
`runFromProposal`: a run cannot honestly describe its own result before it has run.

**Failures land in the bubble already on screen.** A separate error line beside a stranded
"thinking…" bubble is two pieces of state saying different things about one request — and the
abandoned bubble then goes into the history as something the designer supposedly said. A failed turn
is also left *out* of the history sent back: it carries a transport message, and quoting it as the
designer's own words is how a model comes to apologise for an outage it had no part in.

**Four turns of memory ship with the panel, not after it.** "A bit more" is the second thing anybody
types and with no history it resolves to nothing. Quoted under a heading in the one user turn rather
than replayed as alternating turns: **the designer's previous replies describe a garden that has
since been redrawn**, so sent as assistant turns they read as current fact and compete with the
inventory, which is the only description of the plan that is still true. History goes *before* the
inventory — we said this, the garden is now that, they want this.

**`GET /plan-projects/assistant/availability` is declared above the `:id` routes**, or Nest matches
`:id/...` first and `ParseUUIDPipe` rejects "availability" as a 400. It cannot tell a missing key
from a transient upstream failure — `toHttpException` maps four states to 503 — so the no-key copy
is shown only when the probe says so at load, and a 503 mid-conversation renders as a failed message.
A probe that cannot reach the server leaves `available` **null**, not false: an API that is not
running yet is not evidence about a key.

**Reduced motion is a first-class path, and it is why `applyProposal` survived the tick-and-apply
UI.** With `prefers-reduced-motion: reduce` the changes land at once through it instead of
animating — same bracket, same outcome message. Without it the feature is unusable for anyone with
vestibular sensitivity, who would otherwise have twenty seconds of movement they cannot opt out of.
`applyProposal` gained `withinGesture` for exactly this: a nested `endGesture` would close the
sentence early and split it into two undo entries.

**The demonstration goes through the conversation rather than round the side of it.** It was a button
that started a run on its own, which left the user with a garden changing, nothing saying why, no
Stop, and no record afterwards. `playRun` gives it the same bubbles, bracket and outcome every other
request gets, and it still calls no model — which is what keeps it working on a machine with no key.

**`MAX_RUN_MS` is 25 s and a long run is _scaled_, not truncated.** Twelve intents compile to more
than anybody will sit and watch. Zeroing the tail was the first design and is worse twice over: it
collapses several operations onto one instant, and it makes the last thing the user sees a jump —
which is the "spinner then a jump" this whole feature exists to replace. Scaling preserves every
ordering and gap in proportion.

**The at-work block is one element in two placements.** Sticky to the bottom of the transcript on a
wide screen; below `lg` the whole panel sits *under* the canvas and off the fold, so it becomes a bar
fixed to the bottom of the viewport — the one position Stop is always reachable from. A pinned copy
plus a static copy would be two things saying the same thing, and they would disagree the moment one
missed a frame. It also stays mounted after the run ends, because "stopped" is part of what that
message has to report. `devIndicators.position` moved to `top-right` because Next's dev overlay owns
the bottom-left corner the product now uses.

**Three intents were added, and each closes a request the vocabulary could not express:**

- **`reshape`** — move one side of an outline. "Make the border deeper" is not a `resize`: a resize
  scales about the anchor, so a bed running the width of the garden comes back longer as well.
  `edge` is a *relation* (towards or away from the house), never a screen axis, because a plot can be
  drawn at any angle. **Both halves or neither**: the ground it gains is taken off the neighbour with
  `FillService.subtract`, or the reshape is refused — a border deepened into a lawn that kept its
  outline is two elements claiming one piece of ground, and because the bed draws over the lawn it
  *looks* right, so nothing on screen would say the plan had stopped being true.
- **`attach`** — "take the furniture with it". Meaningful only beside a move or resize in the same
  request, so `Context.pending` carries elements as the intents so far will leave them. It emits
  **nothing** when the host did not move: a no-op line would be a change on the diff, an operation on
  the canvas and a count in the outcome, all for nothing happening.
- **`move` towards an element** — "nearer the seating", which the house, the fence and a zone
  centroid cannot express. Named by id, so still a relation.

**`clearOfOthers` now ignores anything standing on the element.** A dining set on a terrace overlaps
that terrace by design, so counting it as an obstacle made every furnished surface immovable and
unresizable — the planner refused with "there is no room around it to grow into" about a table the
user could see was on top of it. That is the fault `attach` exists to answer and it could not be
reached while the move was refused first.

**`polygonsIntersect` is the wrong predicate for "does the reshape take ground off this".** It
excludes touching, and a border and the lawn in front of it habitually share their left and right
edges exactly: every corner lands *on* the other's outline, nothing strictly crosses, and it answers
"no overlap" about two shapes that plainly meet. A bounding-box pre-filter (conservative, can only
over-include) plus the PostGIS difference is what decides. Same shape of trap as `ST_Overlaps`.

**`pushEdge` refuses a fold, and comparing the overall spread does not catch one.** A 1.5 m border
pulled back 3 m has a spread of 1.5 again with its two sides swapped — an outline folded through
itself, which has a perfectly ordinary vertex list and a quietly wrong area, so nothing downstream
would report it. The moved side has to still be on the far side of the one that stayed. Same class of
fault as `setEdgeLength`'s bow tie.

**The persisted revision is reachable, and until it was the promise it carries was untrue.**
`layout.revision` is written on every sentence and autosaves within the second, but the undo *stack*
deliberately does not survive a reload and the in-message controls read the run store, which is empty
on a fresh page. So the record sat in the document with nothing able to act on it — the "tick the
design ignores" defect again, and this one mattered because "a misread request is recoverable after a
reload" is half of what made removing the approve-first step defensible. `CarriedOverRevision` offers
it, on three conditions that each rule out a state where the offer would be wrong: no session
revision (the message that produced it already carries Undo), the fingerprint still matches
(`undoRevision` refuses otherwise, so the button would do nothing), and there is a record at all.

**Every model call reports what it cost, and the cache measurement is done.** `logAssistantUsage`
(`assistant/usage.ts`) is shared by all three assistants — counts only, never the prompt or the key,
and it **never throws**, because it runs on the success path of a request somebody is waiting on. It
warns in words when a declared breakpoint neither wrote nor read, which is the finding that would
otherwise be a zero easy to read past. The measurement itself is in the "prompt cache" note near the
top of this file: it works, and the estimate that said it might not was wrong.

## One subject, three ways to change it: the inspector is one surface

**The unified inspector was one component and still read as two products**, and the reasons were
all presentational: the property sheet had its own capped scroller with a `border-b` under it, the
conversation was left/right bubbles with a Sparkles avatar, the two were drawn in different shapes
(rectangular form controls against round pills), the AI's indigo was the identity of the bottom
half, the whole thing sat as a rounded card inside a padded aside, and the busy state swapped the
heading to "Changing the garden". Blur your eyes and there were two horizontal bands. `EditorInspector`
is now **header · one scrolling body · pinned footer** on one white surface with hairline dividers,
and everything under the header is something you can do to the subject it names: the precise verbs
(`SelectedElementPanel`), the recommended ones (`SmartSuggestions`), the record of the last one
(`RecentActivity`), and the imprecise one (`InspectorComposer`). `DesignAgentPanel` is gone;
`Pill.tsx` is the one small-action control where five inline copies of the class used to be.

**A smart suggestion is a typed action on the subject, not a sentence the designer said.**
`lib/smart-suggestions.ts` is pure: `suggestionsFor(subject, { elements })` reads the plan (is there
lighting already? is this patio already porcelain?) and returns entries whose `action` is a union of
a **direct edit** (`material` → `setMaterial`), a **request** (`send(text)`) and a **review**. The
component renders all three identically — art, title, detail — which is the visual argument that a
swatch, a suggestion and a typed sentence are three handles on one object. Request-kind entries are
*dropped* when `available === false` rather than disabled: a card that looks available and does
nothing is the fault this codebase keeps catching. `quickCommandsFor` is the same idea as chips —
sentences about "it", which the selection resolves. The garden's chips stay `latestSuggestions`,
because the server writes those and a second source of designer copy would drift.

**The working header names what the request was _about_, never the run's cursor.** The run drives
`selectedId` (that is how the canvas follows the work), so the old rule — claim nothing about the
selection while busy — still holds; what changed is that the subject of a live request is already
known, captured on `UserMessage.about` at send time. So "Patio · Updating…" over the stage checklist
is honest, and a demonstration or a garden-wide request reads "Garden · Updating…". The property
controls hide (a form you cannot use looks broken), the suggestions dim, the composer says
"Watching…". `AgentActivity` is mounted by the inspector always and hidden when idle, because
`ai-activity-panel` has to carry the run's final `data-status` after the work is over.

**The record is absent rather than empty, and the newest exchange is the only one shown in full.** A
"Recent change" heading over "nothing yet" is a section about the tool. Earlier requests fold under a
`<details>`; every testid the browser spec reads (`chat-user-*`, `chat-assistant-*`, `agent-outcome-*`,
`ai-review-outcome`, `ai-compare` / `ai-undo` / `ai-replay`, the offers) is still on the same kind of
element. When a run finishes the body scrolls to the outcome so Compare and Undo are in view; a new
selection scrolls to the top. The `element-area` figure lives in the header now, under the name.

## The selection is what "this" means

**The canvas knew which element you were pointing at and the designer did not.** `selectedId` has
always driven the Edit panel, and `ProposeRequest` carried `{ message, history }` — so "make this
bigger" arrived as the bare word "this" against an inventory of every element, and `rules.ts` quite
correctly had the designer ask which one was meant *about the element already selected on screen*.
The user had to name the thing they were pointing at. `ProposeRequest.selection` closes that.

**Measured against a live model on a real plan, before and after.** Same sentence, same garden:

```
no selection    "I can't tell which element you mean — the seating patio, the dining
                 pergola, the rear border or the lawn are the likely candidates."   0 changes
selection e1    "I'll enlarge the seating patio and bring the lounge set with it."  resize + attach
```

And a sentence with no noun in it at all — "use porcelain instead" — resolved to the selected patio
and came back as one material change. That is the whole feature: **the subject of the sentence is on
the screen, not in the words.**

**It is deixis, not a description of the garden, and that is why it may be on the request.** The
elements, zones, boundary, house and unit were deliberately taken *off* `ProposeRequest` so the
designer could never reason about a garden other than the stored one. The two things left are what
was *said* and what is being *pointed at*, neither of which the server can know. Ids only — the
selection renders as `id=…, "name", category` and nothing else, because the inventory a few lines
above already carries the size and the material, and a second description of one element is a second
thing to drift.

**No position, and there is a test standing over it.** `intent.service.test.ts` asserts the prompt
contains no `vertices`, no `x:` and no `centre`, and that test now runs *with* a selection so the
newest section is held to the same rule. Telling the model where the selected thing is would be the
one thing this architecture has refused everywhere else.

**The grammar budget is untouched, and deliberately so.** `INTENT_JSON_SCHEMA` is pinned at
`optionals <= 2`, `branches <= 11`, `objects <= 14`, `refs === 9` after the 400 that
*"the compiled grammar is too large"*. The selection is a **request** field — Zod only, never sent
to the model as a schema — and the model still answers with ordinary `target.elementIds`. So nothing
here needed `probe:assistant`. Anything that gives the model a new way to *name* the selection back
does.

**A stale selection is dropped in silence, not reported.** `renderSelection` resolves the ids
against the stored plan and drops what no longer exists, exactly as `planner.service.ts`'s `resolve`
does — a selection can go stale between the click and the send, and naming a ghost would have the
designer talk about something that is not on the plan. The heading disappears with it, because a
heading with nothing under it invites the model to wonder what was withheld.

**The section goes after the inventory, not before it.** The order is the order the request is
reasoned in: we said this, the garden is now that, they are pointing at this, they want this. First,
it would be an id with nothing yet to attach to.

**A hint, not a hard scope.** The rules say "this", "it", "that" and any subjectless instruction mean
the selection; they also say a sentence that plainly names something else wins, because somebody can
have the terrace selected and ask about the shed. Client-side filtering of changes to other elements
was the alternative and it refuses "move the shed next to this", which is exactly the sentence the
selection makes natural.

**The chip is a view of the selection, never a second copy of it.** There is one selected element;
the Edit panel below shows the same one; the × on the chip is the same `select(null)` that clicking
bare canvas performs. Pinned independently — the tempting Cursor-like design — it would be a second
answer to "what is selected", and the two would disagree the first time somebody clicked the plan.
It is hidden while a run is on, because **the run drives `selectedId` itself** (that is how the Edit
panel follows the work), so a chip reading off it would present the designer's own cursor as the
user's context.

**The review pass is scoped to the selection as well as to what changed.** A request made with the
terrace selected is a request about the terrace whether or not the terrace itself moved — one that
ended up only shifting its furniture is still work on that terrace. Union and dedupe. Scope still
decides only what may be *acted on*: the scorer reads every element, or a subset would quietly
change which composition is being judged.

**The transcript records what a sentence was about, with the name it had at the time.** "Make it
bigger" is unreadable a minute later, which is the price of letting the canvas supply the subject —
so `UserMessage.about` carries the id and the label, captured at send time. Looked up at render time
instead, a rename would rewrite history. The tag offers to select the element again only where it
still exists; where it does not it stays plain text, because a control that looks available and does
nothing is the fault this codebase keeps catching.

**`elementLabel` exists so one element has one name.** The `element.name ?? CATEGORY_COLOURS[…].label`
fallback was written out in four places; the chip, the transcript and the Edit panel now share one
function, or they would come to disagree about what an unnamed bed is called.

**"Ask the designer" is told whether there is one, rather than looking.** The button in the Edit
panel takes `agent` as a prop from `EditorScreen`, which is the same `concept !== null` that decides
whether the agent panel renders at all. The first version probed the DOM for the composer in an
effect — `react-hooks/set-state-in-effect` refused it, and the rule was right: whether a sibling
exists is the caller's knowledge, not something to discover after paint. Reaching the composer by
`data-testid` to *focus* it is the one liberty kept, because lifting a ref through the screen is real
plumbing for a cursor.

## The garden assistant

A sibling of `assistant/`, not a second AI system: same `AnthropicModule`, same
`toHttpException`, and the rate limiter was **extracted to `assistant/rate-limit.ts` so both share
one budget** — two buckets would have made the real ceiling quietly double the number written down.

**Structured JSON output, not tool calling, and that is a considered answer to the brief.** The
requirement is "a bounded set of editor actions with validated structured arguments", and a
discriminated union in a JSON Schema *is* that contract — enforced by the API rather than
requested. Tool calling would need a tool-result loop this feature does not want ("avoid long
conversational flows"), and would cost the three things `intent.service.ts` has earned: the cached
system-prompt breakpoint, the thinking-enabled regression test, and the JSON-Schema-vs-Zod
cross-check. Both are mirrored for `GARDEN_ACTION_JSON_SCHEMA`.

**`GardenAction` has no field that can hold a coordinate**, exactly as `DesignIntent` has none.
Position is a bounded enum of *places* — `back-left`, `along-right-fence`, `outside-back-door` —
and `assistant/garden/anchors.ts` resolves one to a point to *aim at*. There is a test that walks
the JSON Schema's property names and asserts none is `x`, `y`, `centre` or `points`.

**Anchors are resolved in the `DesignFrame` off the garden door**, the same frame the generator
composes in, so "back-left" means "far from the house, to the left as you look out" rather than
anything about the screen — a rotated house or a plot drawn off-axis still has a back-left corner
and it is the one the user means. **Mind the handedness**: +y is down the page, so the frame is
left-handed; facing +y your left hand points to **+x**, the way south-facing puts east on your
left on a map. `anchors.test.ts` pins it, because a plan with left and right swapped is a perfectly
ordinary-looking plan.

**The anchor is a preference, never an answer.** It is handed to `PlacementService.candidates` as a
new `near-point` affinity (a `reference` point instead of the house centre; the rest of that query
is untouched), and every candidate must then pass `featureIsLegal` **and** `clearOfOthers`. The
second is not redundant and the test that caught it says so: erosion by `inradius` guarantees a
*disc* fits, which under-estimates a rectangle, so a 2.5 × 2 m shed eroded by 1 m can still lap the
obstacle it was meant to clear. Erosion makes the sampling efficient; those two make it correct.

**Changes apply immediately — the one deliberate divergence from step 5's assistant.** There, a
diff rewrites a finished design and every line is worth reviewing. Here the user is describing a
garden that already exists, an approximate shed in roughly the right corner is the whole ask, and a
review queue between "I have a shed" and a shed appearing would make the assisted path slower than
drawing it by hand. The safety net is Undo: `features-store.applyAssistantChanges` is
`plan-editor-store.applyProposal`'s bracket — `beginGesture()`, raw `set` per change (never
`commit`, which would push its own entry), `endGesture()` — so **one sentence is one Undo**.

**A `scope` action is a separate undo entry**, because scope lives in `boundary-store` and features
in `features-store`, each with its own history. One history over both would make Undo mean
different things depending on which screen you were looking at. Recorded rather than hidden.

## Generation honours the redesign area

**Clipping the zones and the room covers most of it; six decisions escape both.** Almost every
placement bottoms out in `placement.candidates({ zone })`, a `FillService` method taking a zone
polygon, or `isPlaceable(…, context.room)` — so `FillService.clipRingsTo` clips the in-scope zone
polygons (one query for all of them) and `clipTo` clips the room, and everything downstream
inherits it. `clipToRoom` was renamed `clipTo`: it was always this operation, and naming it for its
first caller stopped being true the moment it had a second.

**Every surviving piece of a clipped zone is kept**, as a `GardenZone` per piece sharing the id,
with `area` and `centroid` recomputed (`rezone`). Dropping the smaller pieces would leave part of
the drawn area with no base fill — bare graph paper inside the area the user asked to have
designed. Duplicate ids are safe: nothing in `build` keys on the id from that array.

**`allZones` stays unclipped**, and `usableWidth` is measured on it. How much room there is to walk
past the house is a physical fact about the plot, not about what the user ticked — a 4 m side
return whose drawn area covers 2 m of it still has to reserve the access lane.

**`SCOPE_INSET` is 0.15 m and the derivation is the whole of it.** `clipTo` and `accentRegions`
simplify at `SIMPLIFY_TOLERANCE` (0.05 m) *without* re-clamping, so a bed clipped to the room can
end up centimetres outside it; with a hard containment guard downstream, every bed along the scope
edge would be refused outright rather than trimmed, and a plan would lose its planting for a reason
nothing on screen could explain. Three tolerances buys the margin. The visible cost is 15 cm of
untouched ground — 1.5 mm at 1:100, under the plan's own line weight. Clamping after every simplify
would be exact and would change what the *unscoped* path draws, which is the one thing this may not
do.

**"Inside the drawn area" lives in `placeable`**, beside the house rule and for the same reason: it
is a rule about what the generator may compose, not about what is legal — a user may drag a bed
outside their own area afterwards and the editor has to let them. That one signature swept fourteen
call sites. Five things `placeable` cannot see get their own guard: `routeBetween` (both endpoints
can be inside while the dog-leg swings out — and because routes are tried in order, refusing one L
lets the other be found, so this *improves* routing), the formal axis path, the front path, the
steps flight (it runs outwards past the terrace's edge), and lighting (a fitting is offset from the
thing it lights).

**Backward compatibility is structural, not numerical.** `scopePolygon` null ⇒ `scopeRing` null ⇒
every clip is `scopePolygon ? await clip(…) : identity` — **the query is never issued**, and not
"intersect with the boundary", which would re-simplify every zone and move coordinates on plans
that never asked for a scope. Every guard short-circuits on `scope === null` before any geometry
work. There is a test asserting `clipRingsTo` is never called on the unscoped path, which is what
fails the day somebody "simplifies" the null branch into `scopePolygon ?? boundary`.

**The strong test is a PostGIS difference, not a per-element containment check.** Union every
generated element, subtract the drawn area, demand under 0.01 m² remains — one query, every element
kind at once, and it cannot be fooled by a tessellated circle or a hairline bulge. The fixture area
leaves the fence (so `borderRegions` is genuinely clipped), leaves a whole zone out, and still
covers the garden door (so the grammar runs rather than the fallback).

**`reference-fixture.test.ts` now states a 30 s timeout, and so does `concepts.service.test.ts`.**
Each case generates three whole concepts against real PostGIS; Vitest's 5 s default was never a
budget either was written to, and they were timing out on machine speed rather than on anything
about the generator. The concept suite's largest case already sat at about 4.3 s, and giving a
garden its full complement of trees rather than five put it over — the generator doing more work
rather than doing it worse, since `placement.candidates` is the dominant cost in the whole
generator and it gets harder the more obstacles a plan carries.

## Trees: the trunk is what occupies the ground

**A tree's canopy is what it is drawn as; its trunk is what it takes up, and until Phase 5 the
system only knew the first.** `shape.radius` is the canopy, because that is what the drawing, the
schedule and the shadow model are about — and treating that circle as the shape that must fit
inside the boundary and clear of everything else meant a canopy could never cross a fence or reach
over a patio. Every tree in every generated plan therefore stood marooned in open ground with its
own radius of clearance round it, and the move that gives a real garden its enclosure and its
dappled terrace was unavailable. **A canopy is not a wall: it is the part of the tree that is
allowed to be over things.**

`packages/schema/src/plan/footprint.ts` is the one rule. `legalFootprint(element)` answers the
trunk for a canopy and the shape itself for everything else; `elementIsLegal` is `geometryIsLegal`
asked about the right one. **It has to reach all four deciders or it is worse than not existing** —
the editor's drag (`refusalFor` takes an element now, not a geometry), the AI run executor
(`resolveOperation`), the assistant's planner, and the server's PostGIS validator, which builds its
containment CTE from `legalFootprint` rather than `element.shape`. Miss one and the server refuses
the save of a plan the editor drew, with nothing on screen to say why or any way to put it right.

**What may overlap what is a composition question, and stays where it can see what the other thing
is.** `plantTree` tests the *trunk* against the obstacle set and the *crown* against buildings and
other crowns: a canopy over paving, a path or a border is the ordinary case and the whole point;
one through a shed or through another tree is not. Only the stem goes onto `obstacles`, so a bed or
a path laid afterwards runs under the branches.

**`TRUNK_FOOTPRINT_RATIO` is 0.12 and is deliberately not the renderer's `TRUNK_RADIUS_RATIO`.**
This one is the space a tree *takes* — root flare, and the ring you would not pave right up to — so
it is generous against botany; the renderer's sizes a dot under a sprite and answers to legibility.
Two numbers because they are two questions.

**The count is per square metre, not a cap.** `treeBudget` (`generation/layout/trees.ts`) is one
tree per 22 m² of designed area, between 3 and 12 — read off the reference's ten canopies over about
220 m², not chosen. A flat `MAX_TREES = 5` gave an estate the same three or four specimens a
courtyard got, which is the largest single reason our plans read as emptier than a designed one
however good the planting in the borders is. The module is shared and pure **because two places
plant trees and they have to agree**: `concepts.service` builds the plan somebody sees and
`design/layout-generator` previews fifty candidates to decide which plan that is. A preview that
plants five where realisation plants eleven scores a garden nobody will look at.

**A boundary backdrop walk, in both, at 5 m spacing inset 1.1 m.** Five metres is a screen rather
than an avenue; the inset is the trunk's own standoff, since the crown may cross the fence and the
stem may not. It is walked over the room's edges rather than written into each of the seven
compositions, because it is the same move in all of them and a template is about what makes its
composition *different* — the sketch's own points are still tried first, so a composition with an
opinion about where a specimen goes keeps it.

**`PreviewTree` carries the radius and the symbol, and a bare `Point` no longer would do.** The
species is chosen before the geometry (`treeSpeciesFor`, then the symbol's own footprint radius),
so a preview that forgot it would hand the scorer ten identical circles for a garden of hornbeams,
rowans and fruit trees — and canopy cover and what the crowns overhang are exactly what the extra
trees are judged on.

**`canopy` is the eleventh principle and the third conditional one.** Every other rule can be
satisfied by a garden with no trees in it, so a plan with three specimens in open lawn scored
exactly as well as one with a boundary of them, and the candidate loop — which only ever prefers
what it can measure — had no reason to choose the fuller garden. It scores the share of the room
under crown against a 0.15–0.35 band, **sampled rather than summed**, because crowns overlap by
design and adding their areas reports four trees as more shaded than eight whose canopies touch.
Conditional on the room being big enough for a tree to be a question at all, so a courtyard is not
marked down for a fact about its plot. Measured: 0.912 mean over the 117-concept harness.

**The gallery gained four boundary trees per garden, in every one of the nine.** Every pair holds
its contents constant, so a fixture that gains trees gains them on both sides of the pair. Down the
sides and never at the far end: a tree within `FOCAL_REACH` of the axis's end terminates the view,
which is the fault `planted-poor` and `family-poor` are built to exhibit, and a fixture change that
quietly repairs the fault a pair exists to show makes the pair agree about a garden nobody looked
at.

## Deeper borders, and what a border may take

**`BORDER_WIDTH` is 2.2 m and `borderDepth` caps at 3.5, and 1.5 was the bottom of that range
rather than the middle.** A bed a metre and a half deep holds two ranks of plants — something at
the back and something in front of it — which is a strip; a layered planting needs three. The
traced reference's own beds run 2.2 to 6.9 m, and this is the difference between planting that
reads as the body of the garden and planting that reads as an edging round a lawn.

**The lawn's floor wins over the border's profile.** `borderIn(scale, across, panelDepth)` in
`layout/sketch.ts` is that rule: a border takes what it wants of the span it shares with an open
panel only down to the point where what is left is still a lawn, and `LAWN_FLOOR` is an area as
well as a minimum side, so leaving 2.5 m across a 2.5 m strip is 6 m² and `lawnViable` rightly
refuses it. Without this the deepening argued against itself — on a wide shallow plot the extra
seventy centimetres came straight off a 3.2 m lawn, and a change meant to improve the planting
produced a garden with no open ground at all.

**`isCourtyard` asks its question at the *thinnest* border, and that is the other half.** Whether a
room can hold a lawn is a fact about the room; how deep the borders round it are is a preference,
and one `borderIn` already makes yield. Asking at the preferred depth made the two disagree the
moment the border deepened: a 9 × 10 m garden was reported as unable to hold a lawn, the courtyard
composition claimed it on that basis, and a plan that had been 38% hard came back **82%** — paved
corner to corner because the border we wanted was seventy centimetres deeper.

**`largestPanel` looks in the zones being measured, not across the whole plan.** `report.courtyard`
means "this plan has nowhere open at all" and it decides which set of bands a concept is judged by.
Scanning every element let a gravel front garden count as the back garden's open ground, so a
courtyard plan — paved by design, which is what a courtyard is — was judged as a garden, reported
as having no lawn, and failed a band it can never meet.

**The measured cost of the deeper borders, recorded rather than hidden.** Over the 117-concept
harness: composition-band compliance 72% → 64%, `route-through-planting` 53 → 77, mean score 0.863
→ 0.856 with the minimum rising 0.728 → 0.734, and repairs accepted on 15% → 23% of concepts. Both
regressions are one fact — there is more planting, and the routes were composed without knowing how
deep the beds would be. The routes are the thing to fix; they are laid from the sketch's own points
before `designedBeds` cuts anything.

**A structural plant budget scaled by planting, not a flat thirty.** A flat cap is a cap on the
whole plan, so a garden with four deep borders spent it on the first two and left the last ones as
bare texture — the beds furthest from the house, which is where the structure matters most. One
shrub per 5 m² of bed, floor 12, ceiling 60, and the ceiling stays because the placed-elements
panel still has to be scrollable.

**`naturalistic` and `pollinator` had no backdrop layer at all**, which made them grasses and
perennials all the way to the fence: a true description of a prairie planting and a bad one of a
British border, which is held up at the back by shrubs whatever the style at the front. `backdrop`
is also the role that becomes a *placed* element rather than texture, so a scheme without one gave
the user nothing structural to move and the drawing nothing with a silhouette.

**Shrub symbols are sized as the shrub is in five years, not as it arrives.** 1.2–1.4 m across is a
two-litre pot; a back-of-border viburnum or hydrangea is nearer two metres, and drawn at the smaller
size they read as infill among the infill — the one thing structural planting exists not to do.
`shrub-topiary` is the exception that stays the size it is bought at, because a topiary is defined
by being *held*: that is the whole of what it contributes, and it is why it belongs to the
architectural palette and nowhere else.

**`FeatureSpec.edging` exists for exactly one entry.** A kitchen garden is *built* of timber
sleepers, and `timber-sleeper` had sat in `EDGING_MATERIALS` since edging landed with nothing able
to choose it, because `edgingFor` answers by style and no style asks for sleepers. `stampEdging`
leaves an edging the element already carries alone, which is what makes a per-feature answer and a
per-style answer able to coexist.

## The layout grammar

**Every size in the grammar has a floor, and the floors are derived rather than declared.**
`TERRACE_FLOOR` is `hostFloor('seating')` — the footprint of the first thing `FURNISHINGS` puts on
a terrace, plus twice `furnish`'s own margin — so it moves when that list does. `PERGOLA_FLOOR` is
the smallest thing a pergola may hold. `terraceDepth` reads
`max(min(clamp(3.6 √scale, floor, 5.5), 0.35 × roomDepth), min(floor, roomDepth))`: the share cap
sits **above** the floor and the only thing that may cap the floor is the room itself. It used to be
`min(clamp(…, 2.4, 5), 0.35 × roomDepth)`, where the cap overrode the clamp's lower bound, and a
three-metre-deep garden got a **one-metre terrace across the whole width of the house** — the wide
fixture shipped "Seating patio 12.0 × 1.0 m". The width floor is capped by the room the same way, or
a 3.7 m wide room would be refused a terrace rather than given a narrower one.

**`Slot.minSize` refuses; it does not shrink.** `fitInSlot` stops its shrink loop at the slot's own
floor and returns `null` when the sized footprint is already under it. A pergola shrunk to 0.6×
linear is 36% of its area and nothing can sit under it, so the card says the feature was not
included instead. `terraceEndSlot` carries `PERGOLA_FLOOR` and its own `maxSize.depth`, because a
starved terrace used to starve the pergola beside it.

**A refused terrace is reported.** `fitInSlot` returning `null` for the terrace leaves `seating`
unsettled, so it falls through to the sampler like any feature — but the terrace, its furniture and
every path anchored on it are gone. `terraceRefused` says so in the concept's summary rather than
drawing a garden with no way out of the house.

**A lawn has to be a lawn.** `LAWN_FLOOR` is 2.5 m across and 12 m²; `isCourtyard` is now "no viable
lawn fits behind the terrace" rather than a depth comparison, and takes the room's width as well as
its depth. Below viability the panel is dropped and the far-room slot takes the strip. `lawnStart`,
`lawnEnd` and `rearBedDepth` are one set of functions the lawn's far edge and the rear bed both
read — they were `2b` in `rectilinear.ts` and `b` in `beds.ts`, which left a band of base turf
between the lawn and the bed on every plan.

**No sketched bed is thinner than `MIN_FILL_SIDE`.** `BED_MIN_DEPTH` imports it from
`generation/fill-limits.ts`, a leaf module `fill.service.ts` and the pure template layer both read,
so the templates stay database-free. Runners used to be drawn at a third of the border depth, which
PostGIS's sliver guard threw away in silence — so a small garden came out as a lawn, a patio and
nothing else. `designedBeds` now emits the rear border first (the one bed every garden has), then
the side beds only where the planting width can hold them, then `Terrace flank` beds beside the
terrace where the fence is far enough away.

**Zone roles are what a zone is _for_, and they are why the front and the sides stopped being turf.**
`layout/zone-roles.ts` classifies each zone `main | arrival | passage | secondary | remote`:
the room's zone is `main`, the front room's is `arrival`, and a side is a `passage` under
`PASSAGE_MAX_WIDTH` (5 m) measured **level with the house** — `usableWidth` clips the zone to the
band between the house's front and back wall planes, sharing `houseBand` with `sideReturn`, because
a side zone runs the full depth of the plot and its bounding box says 26 m of a strip that is 4.5 m
wide. A zone with nothing level with the house is `remote`, which is the old behaviour; never
`passage`, because gravel on ground nobody measured is worse than turf on ground nobody designed.

**A passage is an accent strip, never a base category — and that distinction is load-bearing.**
`computeZones` gives the side zones all four corners of the plot, so a whole-zone gravel base would
paint the back corners gravel, exactly where the shed and the kitchen garden go. `passageStrip` is
the zone clipped to the half-plane in front of the house's back wall: the way past the house and the
front corner, and nothing behind. The corners behind stay the palette's ground and are designed by
the room. The locked base, `groundCoverArea` and the schedule are untouched.

**The passage strip is not checked against the house, for the same reason the base fill is not.** A
zone's inner edge _is_ the house's wall plane, clipped in floating point, so a strip can overlap the
wall by a fraction of a nanometre — which had `geometryClearsHouse` accept one side return and
reject the other on a symmetrical plot, and the suburban plan came out paved down one side and turf
down the other. There is a test that both sides get the same strip.

**The front garden is the one zone whose base a role may change.** Its polygon is exactly the front
garden — fenced to the house's width, no corners — so `arrivalBase` can lay gravel over the whole of
it. `frontWantsLawn` allows turf only at 4 m deep and 25 m²; below that it is gravel **whatever the
budget**, because paving the front would claim a driveway the document cannot hold. Parking is a
step-1 capture and a version bump, deferred in TODOS.md.

**A passage's fence bed leaves the way past.** `passageBorderWidth` gives the full `BORDER_WIDTH`
where the passage is wide, less where a bed that deep would block it, and nothing where even a
1.2 m bed would. `concepts.service.ts` no longer asks `borderRegions` for a 0.45 m band in the main
zone: that call was **already dead** (anything under `MIN_FILL_SIDE` returns `[]`), so the designed
garden had never had a perimeter border and `designedBeds` was always its only planting.

**A side wide enough to be a room gets one.** `sideRoomRect` finds the largest rectangle in a
passage strip or a secondary side return after the access lane and the margins are taken out, capped
at `SIDE_ROOM_MAX` (4.2 m) — uncapped it drew 8.2 × 6.2 m of decking down one side of the L-shaped
plot, which is a yard rather than a room. One per plan, gated on seating being asked for and the
budget being above low.

**A plan is composed in a frame, not sampled in a zone.** `DesignFrame`
(`apps/api/src/plan/generation/layout/frame.ts`) puts the origin at the garden door, `u` running
out of the house and `v` along the wall, positive to the right when looking out. Every template
works in those coordinates and `toWorld` is the only place they turn back into plan metres —
which is also where a placed rectangle's rotation comes from (`frame.wallBearing`, never
`house.rotation`, so a custom outline and a rotated house both work). Nothing is stored: the
frame is derived every generation, like zones.

**The room is not a zone, and it could not be.** `computeZones` fences the back band to the
house's width and gives the corners to the sides, so a lawn drawn in the back _zone_ is three
strips with their own ground rather than a garden. `gardenRoom` is the plot clipped to the
half-plane beyond the door wall, trimmed by the zones' own cross fences only for a side that is
**not** in scope. Zones are untouched — every element still takes its `zone` from where its
centroid lands, and every zone still gets its base fill.

**Three concepts are three templates.** `TEMPLATES` in `layout/templates/` is the axis the
concepts differ on now; the archetype is what is left over. `recommendedIndex` maps the brief's
style to one — cottage to curved, formal to formal, everything else to rectilinear — and that slot
gets the balanced archetype. Two concepts that differ only in badge and material were the thing
users could see through.

**Slots first, sampler second.** `assignSlots` matches a requested feature to a slot by an ordered
preference table (seating to the terrace, storage to the utility corner, play to the far end of
the lawn), and `fitInSlot` tries the anchor, then nudges of 0.25 m along each axis, then shrinks to
0.6×. No sampling and no SQL. What will not fit falls through to the old `PlacementService`
sampler, which is also the whole placer when there is no room to sketch in — a plot with no house,
or one whose garden is out of scope.

**A far slot is measured from the terrace, not from the back fence.** `behindTerrace` centres a
slot in the strip that is actually free and shrinks it to fit. Anchored from the fence alone —
"2.3 m in from the border" — a nine-metre garden with a four-metre terrace put the play area's
anchor _inside_ the terrace, where no nudge could rescue it, and every plan that size lost its
feature to the sampler and its path with it.

**The terrace is a third of the room at most, and grows with `√scale`.** A terrace is a room for a
table, not most of the garden; at `4 × sizeFactor` it took 5.7 m of a 16 m plot and left the lawn
three metres deep behind it.

**`roomBehind` measures the width half a metre past the cut.** An L-plot's inner corner sits _on_
the line the terrace ends at, so clipping at exactly that `u` keeps a zero-depth edge running the
full width of the plot and reports the shallow limb as room the lawn can use. The probe is the
whole of the fix and it changes nothing on a rectangle.

**The shed notches the lawn rather than taking a band across it.** A utility bay spanning the back
of the garden cost the lawn four metres of depth on every plan that asked for a shed; the notch
costs it one corner, and `styleCorners` lets the notched polygon still take the style's corner
radius.

**Borders are `FillService.remainderPieces`, cut into runs.** Subtracting the lawn and the
features from a zone leaves an annulus and `PlanGeometry.polygon` cannot hold a hole, so the
remainder is split by two cut lines through the lawn's centre. A feature standing wholly inside a
run still leaves a hole, and that one `exteriorRing` flattens as it always has — safe **only
because the caller pushes the pieces before the lawn and the features**, so the thing that made
the hole is drawn over it. Keep that ordering. Each run takes its own planting material, which is
the variety the old fixed 1.5 m annulus could not have.

**Paths run between things, and `routeBetween` is one function.** Terrace to the far room, terrace
edge to the shed, gate to the terrace, front door to the street, plus the formal axis path.
`routeTo` is now a thin wrapper on it for the sampler's destinations.

**Ignored rings are matched by value, not by reference.** `geometryOutline` tessellates afresh on
every call, so the terrace outline a path is told to ignore is never the same array as the one in
`obstacles`. Matched by reference — which is what the first version did — every path was refused
for crossing the terrace it started on, and no plan the grammar drew had a single path on it. The
same trap is live in `fit.ts`, where `ignore` holds the very arrays `obstacles` holds and
reference equality is correct.

**Play bark belongs to the play area, not to the palette.** `FeatureSpec.material` pins a
material a feature always has. It used to come from `materialFor('gravel-mulch')` whenever the
brief mentioned play, which laid bark as the front garden's ground and as a low-maintenance
concept's gravel panel.

**The lawn panel is turf whatever the style.** A cottage garden used to draw its one mown panel as
`wildflower`; the meadow belongs in the borders, and the planting branch offers it there.

## The design agent

**There is a designer's reading of every plan now, and it runs after the plan rather than instead of
it.** `apps/api/src/plan/generation/design/` reads the site, reads the brief, writes a strategy and
then scores the finished elements against eleven landscape-design principles; `knowledge/` holds the
tables it reasons from. `build` calls it at the end and attaches `strategy`, `score` and
`explanation` to the concept. **Not one coordinate moves because of it** — `elements` is already
final when the agent sees it, every outline it reads came from `geometryOutline`, and deleting both
directories leaves the generator producing the identical plans in an arbitrary order.

**That ordering is the whole of Phase 1, and it is deliberate.** The scorer is calibrated against
the generator *as it stands* before anything about generation changes. A benchmark taken afterwards
can only confirm whatever the change did — the same argument `composition-rules.ts` already makes
for deriving its bands from a traced professional plan instead of from this generator's own output.

**Everything in `design/` and `knowledge/` is pure and query-free.** No SQL, no Nest, no canvas. That
is not tidiness: it is what will let a candidate loop afford to run the scorer fifty times, and it is
why the whole of it is tested in Node with no database. The PostGIS-derived parts of a generation
(the scope-clipped zones and rooms) stay in `build` and would be passed *in* to a future candidate
loop rather than reached for from inside it.

**`analyseSite` is the one answer to "what is this plot like".** The frame, the room, the zone roles,
which gate a side path starts at, which zone the grammar composes in — all of it existed already,
scattered through `build` and re-implemented a second time in `reference-fixture.test.ts`'s own
helpers. That test now calls `analyseSite`; a second copy of "where is the garden" is exactly how a
measurement stops agreeing with the thing it measures.

**Nothing is inferred that the document does not support.** No shade without `site.location`. No
neighbour behind a boundary nobody described — `SiteEdge.exposure` is `street | neighbour | unknown`
and the privacy principle scores nothing at all against `unknown`. No focal point named that the
garden does not contain. Same refusal, same reason, as `suggestedDoorWall` and `location` itself.

**A score is not one number, and a principle that cannot be measured is absent rather than zero.**
`DesignScore.categories` is partial; the weights are renormalised over whatever applied. The eight
principles that always apply sum to 1 and each conditional one sits on top at 0.05 — `sun` where
there is a location, `maintenanceFit` where an upkeep level was stated, `canopy` where the room is
big enough for a tree to be a question — so a plan is judged on between eight and eleven things and
none is penalised for what another knows.
`featureFit` is deliberately **not** in the weight table: a concept missing something the brief calls
essential has its total *capped* at 0.5 rather than reduced, because it is the wrong concept rather
than a worse one.

**The view cone is fifteen degrees, capped at half the room's width, and both halves are load-bearing.**
It is the primary sightline — what you are *looking at* from the doorway — not the field of vision,
which is most of a hemisphere. The first version used thirty degrees uncapped: on a fifteen-metre
garden that reaches seventeen metres across at the far fence, which is wider than the plot, so every
shed in every garden was "in the view" and the rule said nothing. `viewCone` is returned as a polygon
so "the shed must not be in the view" and "the play area should be" are one test read in opposite
directions.

**Grouping measures the group's diameter, not its radius from the centroid.** Two things at opposite
ends of a garden are each only half the distance from the point between them, so a dining terrace and
its pergola fifteen metres apart scored as a tidy seven-metre group. Furthest pair, every time.

**`FEATURE_LIBRARY` composes `FEATURE_SPECS` rather than copying it**, and a test asserts
`spec === FEATURE_SPECS[feature]` by *identity*. Dimensions live in one place; what the library adds
is behaviour — zone, clearance, access, visibility, and how badly each kind of garden wants the
thing. It is the fifth exhaustive `Record` over `DesiredFeature`, so adding a space on step 3 is
still a compile error until somebody answers what it is for.

**`brief.purpose` is read, for the first time in this project's life.** Only as keyword hints that
raise an intent's score, never as an override — the features are the strong signal and the prose
breaks ties — and every word that matched is kept on `Requirements.keywords` so the explanation can
say what it read. TODOS recorded "slot preferences are a fixed table rather than anything the brief's
_purpose_ text touches" as an open limitation; this is the first half of closing it.

**Capacity is a fact about the plot, not about the tick list.** `featureAttempts` multiplied the
*requested count*, which had the odd property that asking for more made more fit, and then cut the
list in **brief order** — so a fire pit ticked before a terrace could displace it. `capacityFor` is a
per-band number the budget adjusts, and `withinCapacity` cuts by tier with a reason, never an
essential. `featureAttempts` is still what the generator runs; the agent's version is what a
candidate loop will consume.

## The scorer reads the brief

**There is no universal definition of the perfect garden, and the scorer used to behave as though
there were.** One weight table, every concept, every client. The consequence was measured rather than
suspected: the three concept slots differ in `emphasis`, `primaryZone` and `circulation`, no
principle read any of those, and across four completely different briefs every garden in the gallery
scored the same to within **0.016**. Three cards judged against one standard are not three answers.

**`weightProfile` shifts the base table and renormalises** (`knowledge/weight-profiles.ts`). The
shift is a pair of small tables read off `intent` and `emphasis`, which are themselves derived from
what the user ticked — so nothing here is anybody's opinion at generation time, let alone a model's.
Multipliers run 0.7 to 1.6, because these are emphases rather than different scorers: a shed in the
sightline is a fault on an entertaining plan too. The eight principles that always apply are scaled
to sum to one and the three conditional ones keep their base share on top, so two gardens judged by
different profiles are still on one scale.

**The weights applied are on the score.** `DesignScore.weights` is optional, so a stored score still
parses, and it exists because a weighted mean whose weights are invisible cannot be explained: "why
did A score 0.82 and B 0.74" is answerable from `categories × weights` plus `issues` and from nothing
less. `issuesBySeverity` takes the same weights as its second key, which is how the repair stage came
to read the brief without knowing it exists.

**Four principles now read the fields that vary by slot**, and each is the smallest honest reading:

- **proportion ← `emphasis`**, through `knowledge/emphasis-bands.ts`, which *narrows* the traced
  bands and never widens them. Outside the traced band is `hard-excessive`: this plan is out of
  proportion for any garden. Inside it and outside the emphasis's is `composition-off-brief`: it is
  the wrong proportion for *this* one. The `open` narrowing asks for 0.20 lawn, deliberately just
  under the traced plan's own 0.21 — a narrowing that asked for more than the professional design
  has would be using the brief to argue with the one plan this system is calibrated against.
- **circulation ← `brief.circulation`**. Directness was rewarded unconditionally, which marked down
  every naturalistic plan for doing what its own brief asked; `perimeter` and `meander` get a 1.9
  detour tolerance against `direct`'s 1.4. Still bounded: twice round the lawn is a wander whatever
  the style.
- **hierarchy ← `primaryZone`**, measured on the room the concept says it is organised around rather
  than on whatever happened to be biggest. **An open panel is not a rival to a room**, and that is
  the whole of why the rule is safe — a lawn is the largest single thing in nearly every garden
  drawn, so counting it would report every concept built round dining or play as failing to be about
  that thing.
- **relationships ← `emphasis`**, through `RelationshipRule.group` and `EMPHASIS_RULE_WEIGHT`. The
  *severity* still reads the rule's own weight, so a fault does not change how bad it is depending on
  which slot it turned up in — only how much of the score it costs.

**`maintenanceFit` is the tenth principle, and it is a ceiling rather than a target.**
`cappedMaintenance` already decides that a stated upkeep level is the most a concept may ask, and
this is that rule measured: a garden asking less than was offered is not a fault, because somebody
who ticked "high effort" is saying they are willing rather than that they demand weeding. It is
conditional on `brief.upkeep`, which is the **resolved** level copied across by the brief builder —
reading `GardenBrief.maintenance` in the scorer would be the second source `resolveConstraints`
exists to prevent. The ceilings were calibrated against an ordinary garden rather than chosen: a
third planting, a third lawn and four borders measures about 0.65, so a medium ceiling of 0.6 would
have fired on nearly every good plan and therefore said nothing.

**Do not express an emphasis twice.** The pass made this mistake three times and the measurement
caught it each time — discounting `circulation` under `planted`, `proportion` under `social`, and
raising the bed-depth floor under `planted` were each a second expression of something the brief
already said through the detour tolerance, the emphasis bands and the planting band. The first two
put two of three cards on the same composition on a deep plot; the third scored a plan with legal
1.4 m borders **zero** for buildability. Each is recorded where it was removed.

**`BRIEF_WEIGHTS=0` runs the old fixed table**, for the reason `DESIGN_REPAIR=0` exists: brief-driven
weights change which candidate the loop picks, so a benchmark taken after they landed cannot say
which of two things moved a number. It is how the one repeated composition in the fixture set was
traced to the social profile rather than to the new principle.

**The gallery is the benchmark over the scorer, and it needs nothing running.** Nine gardens built by
hand on one plot (`design/evaluate/gallery.ts`, helpers in `test-garden.ts`), four good/poor pairs
that hold their contents constant plus a floor, each carrying the `GardenBrief` it answers. A scorer
that can only be exercised through a generator can only be calibrated against that generator's own
output, which is the circularity `composition-rules.ts` already refuses. `pnpm eval:scorer` prints
it; `scripts/eval-scorer.baseline.md` holds the before and after, and `gallery.test.ts` asserts the
relations. Nothing asserts an absolute number: a scorer pinned to 0.814 is one nobody can improve.

**The reviewer judges the plan against the strategy the user chose.** `slotOf` reads
`concepts.chosenConceptId` and that concept's `strategy.briefId`; there is deliberately no request
parameter, because a client passing a slot could disagree with the plan it is editing. That reverses
the note in `design-review.service.ts` that said the parameter would be a setting the design ignores
— it was, and now it is not.

**The plot the gallery is built on has the house across its full width**, which is not an accident: on
a plot with side returns the back zone is fenced to the house's width, so a border drawn against the
room's own edge is metres short of the fence and the style principle reads it as an island floating
in the middle of the garden. A terraced house is both an ordinary British garden and the one whose
room edges *are* its boundaries.

## A fault says what a correction would have to achieve

**The scorer could say what was wrong and never where the thing should go**, which is why seven of
the ten `RepairKind`s were unperformable in the editor. That was measured rather than assumed: the
only destinations an intent could name were the house, the boundary and a zone the scorer never
mentioned, and mapped to "towards the boundary" across four fixtures the planner refused every move
fault with "it is already as far that way as it will go" — the things these faults are about are
against a fence already.

**`DesignIssue.guidance` is what a valid correction would satisfy, and every field is a relation.**
Near these elements, clear of those, out of the view, screened from that edge, inside this host, at
least this wide, this much bigger. There is nowhere on it to put an x, a y, a centre or a ring — the
same property `DesignIntent`, `GardenAction` and `DesignBrief` have, and it is tested the same way by
walking the schema's property names. A distance is a relation rather than a position: "three metres
from the table" is true wherever the table is. The reviewer describes the relationship; the
deterministic planner finds geometry that satisfies it, and says so when nothing does.

**Every emitter that names a repair now names a destination for it**, and the two that never could
say why: `no-focal` is about nothing being at the far end, and nothing there has an id.

**The empty `subjects` list was the quiet half of the same defect.** Every proportion fault and both
featureFit faults carried none, and a repair resolves an issue to elements *through* its subjects —
so an issue about "the garden" resolved to no garden at all, and `drop-optional` was unreachable in
both repair layers despite being named by the scorer. A share is about the whole plan and the thing
to change is always the terrace or the grass; naming it is what turns a reading into a correction.
`missing-essential` names the **optional things standing in the way**, never the missing essential —
a feature that is not in the drawing has no id, and removing another essential to make room would be
answering the fault by committing it again. An empty list where nothing optional was placed is now
the correct answer rather than the old defect, and the test says so in those terms.

**`DesignIssue.source` names which critic found it**, defaulted to `geometry`. There is one critic
and it measures geometry; a vision critic reading the rendered picture would produce issues in this
same shape, and the point of the field is that the repair pipeline never has to know which it was.
It is stamped **once**, in `scoreSubject`, on the way out — the principles emit `MeasuredIssue`,
which is the issue without it, so thirty emitters are not thirty chances to write something else.

**`COMFORTABLE_ROUTE` moved from the web review loop to `circulation.ts`.** A path narrow enough to
complain about should come back wide enough to walk down, and the constant belongs with the
measurement that asks for it rather than with the client that used to guess. It is deliberately not
`MIN_ROUTE_WIDTH`, which is read off the narrowest route the generator draws on purpose: aiming at
it lands exactly on the threshold and the next rounding error puts the fault straight back.

## Rerouting and turning: the last two verbs

**The executor has animated a turn and a redraw since the operations schema was written, and nothing
upstream could ask for one.** `DesignOperation` has had `rotate` and `reroute` from the start,
`from-proposal` derives both from a geometry diff, and the only thing that ever produced either was
the hand-written demonstration — because `DesignIntent` had no way to say "square that up" or
"straighten that path". Both are now intents, and both are the same shape as every other one: a
relation, never a number that behaves like a position.

**`reroute` names an objective and never a line.** `direct`, `avoid` and `connect`. The planner
recovers the path's own ends, finds what they sit on, and asks **the generator's own router** for
every legal line between them — `routeCandidates` is `routeBetween` with the enumeration exposed, so
`routeBetween(request)` is exactly `routeCandidates(request)[skip]` and the order *is* the
preference. A rerouted path is therefore a path the generator could have drawn, checked against the
same boundary and the same obstacles. `follow-edge` was the obvious fourth objective and is absent
because the router cannot draw it: an objective the planner has to refuse every time is a tick the
design ignores.

**A path with nothing at its far end cannot be rerouted, and refusing is the answer rather than a
limitation.** Stepping stones across a lawn end where they end; there is nothing to route *to*. The
first version invented a small ring round the last point so the router had a destination, and it
shrank the path by `PATH_STANDOFF` every time — a change the user watches happen and cannot see, and
one that would eat the path if asked twice. `samePoints` compares to that same standoff for the same
reason.

**"Already the straightest line" is not a claim the router can make**, and a test asserting it was
wrong rather than a defect. A reroute searches from thirteen points along whatever the path leaves,
so a line that is straight from where it happens to start is very often not the shortest line between
the two things it joins. What is pinned instead is that a reroute never returns a longer route.

**`rotate` takes no angle, and that is the point.** A free rotation is the one number in this
vocabulary that behaves like a coordinate — "put it at 37°" is a position in the same way "put it at
x 4.2" is. What people say is "square it to the house", "line it up with the fence", "turn it to
match the pergola", so the intent is `to: 'house' | 'boundary' | 'element'` and the planner resolves
each against real geometry. Quarter turns only, nearest first, first that is legal and clear wins —
so a terrace moves as little as it can rather than spinning to whichever of the four the arithmetic
produced.

**`design/bearing.ts` is the one place a direction is read**, and it reads *what is nearest*: square
to the house on an L-shaped building means square to the wall you are standing by, not to whichever
wall the outline lists first. There was exactly one bearing in the system before it —
`frame.wallBearing`, computed inside the generator's design frame, which the assistant's planner does
not have — which is why `align` was unperformable.

**`terraceStarts` and `accessName` were two copies each**, one in the preview and one in realisation,
with a comment in each saying the other must search exactly as hard and produce exactly the same key.
They are in `circulation.ts` now. A preview that tried fewer starts reports a room as unreachable
that the built plan then reaches, and a repair keyed on a name the two spelled differently reaches
nothing.

## Repair: measuring several corrections rather than taking the first

**Every correction this system has ever made was first-fit, and the user watched it being wrong.**
The editor's review loop mapped a fault to one intent, the planner returned the first legal step in
that direction, the change was *animated*, and only then was it scored — and wound back about half
the time. So the designer was seen trying something a measurement taken two seconds earlier would
have ruled out.

**`POST /plan-projects/:id/design/repair` takes a fault and answers with the best change to it.**
`DesignRepairService` turns the issue's guidance into candidate *intents*, runs each through the same
`PlannerService` the chat uses, scores the result with the same reviewer, and returns the winner with
a `predicted` score — or nothing, with a reason and a count of how hard it looked. Side-effect free,
model-free and unrate-limited, for the same reasons `/assistant/redesign` is.

**Nothing in it writes geometry.** Every candidate is built by the planner from the ordinary intent
vocabulary and checked by the same `geometryIsLegal` the editor refuses on. The service *chooses*; it
does not place. That is what keeps "the planner is authoritative about geometry" true of a search
that happens somewhere else.

**Acceptance is three conditions and dropping any one has a name.** The fault has to get better, or
the loop is free to "fix" a pinched path by enlarging a terrace at the other end of the garden. The
total has to rise by the same 0.002 `repair.ts` uses, or a change that trades one fault for another
of equal weight counts as progress. And no *major* fault about another principle may appear, which is
the condition measured on what appeared rather than on how many.

**The prediction is a claim the client checks, not one it trusts.** The editor plays the run and
re-scores; the two can honestly disagree, because the plan the prediction was made against is not
always the plan the run landed on. What the prediction buys is the pass that never happens: a
correction nothing could improve is reported rather than performed.

**`REPAIR_CAPABILITIES` is one table where there were three.** `repair.ts` had `UNAVAILABLE`,
`review-loop.ts` had `UNPERFORMABLE`, and `intentsFor` had a third opinion expressed as the set of
`switch` branches somebody had remembered to write — so a repair kind was performable if and only if
all three happened to agree, and seven of the ten were not. A capability is stated per side because
the two genuinely differ: the generator adjusts a *candidate* and cannot turn a rectangle, because
every placement it makes inherits the frame's bearing; the editor changes *elements* and cannot
redraw the composition's beds.

**`add-route` is the one verb with no planner behind it, and the reviewer says so.** `route-missing`
is the third commonest fault in the harness and its subject is the thing nobody can reach rather than
a path — so the correction is to *lay* a route, and `DesignIntent.add` builds a footprint at a
sampled point, which is a different question. The refusal names the limitation rather than saying
"there is no legal change", which would sound like the plot's fault.

**An offer carries the fault and nothing else.** It used to carry the intents the reviewer had worked
out at offer time, against a plan the user then went on editing — so accepting a chip a minute later
applied an answer to a garden that no longer existed. The correction is measured when the chip is
pressed.

**Every line the panel says is read off something measured.** "Checking the composition" while the
score is in flight, the fault's own sentence, "Testing 8 corrections" from the count the server
actually scored, and then the operation labels the run already provided. `ReviewPass` gained
`played`, `considered` and `reason` so the bubble can report the third outcome the loop could not
have before: *looked, found nothing worth doing, did nothing*.

**`prepare.ts` and `from-proposal.ts` moved into `packages/schema/src/plan/run/`.** Both only ever
imported from the schema package, and putting them there is what makes one test able to run the
server's planner output through the client's executor — the gap recorded as "nothing joins the API
half to the web half". `apps/web/src/lib/ai-run/` keeps a re-export of each, so no import path in the
web app changed. Note this is **not** the cycle the "Visual AI agents" section refuses: that one was
about putting `operations` on `AssistantProposalSchema`, which would make `assistant.ts` and
`operations.ts` import each other. A third module depending on both is fine.

**`pipeline.test.ts` is the one test that joins the halves.** A fake Anthropic client's intents →
`IntentService` → the real planner against PostGIS → `runFromProposal` → `prepareRun`, asserting
`refused` is empty. That property — *the editor never refuses what the planner proposed* — is the one
an illegal operation would break, and it was previously asserted only about changes a test had
written by hand.

## Compositions, and choosing between them

**The three layout templates were always three composition archetypes, and nothing said so.** They
were picked by `index % 3`, so every plot got a terrace-and-lawn plan, a sweeping lawn and a formal
axis whatever its shape — which is why a nine-metre courtyard was offered an axis, and why every
test identifies a concept by matching its display name. `knowledge/archetypes/` names them
(`terrace_and_lawn`, `sweeping_lawn`, `formal_axis`), and `strategy.archetype` puts the name on the
wire. **The sketch functions themselves did not move**: `golden.test.ts` pins their output to a
nanometre, structure exactly, and it is deleted when the candidate loop lands.

**An archetype is a strategy, not a template, and `suitability` returning zero is a refusal that is
honoured.** A formal axis on a plot with no axis is not a worse plan, it is the wrong plan. Four
compositions were added because a fixture or a scenario showed the three could not express the plot:
`side_by_side` for a wide shallow room where there is no "behind the terrace", `linear_sequence` for
a corridor that wants its length broken into rooms, `courtyard` for a garden that is a room rather
than a view, and `destination_garden` for a deep plot whose point is the far end.

**`suitability` answers about the plot only; `rankArchetypes` folds in the style, evenly.** The first
version let four compositions return a site fit and three return a blended one — two scales wearing
one name. The 50/50 split is the argument rather than a tuning: weighting the site higher makes the
style cards decoration, weighting taste higher puts an axis on a plot with no axis. What stops it
being arbitrary is that **a refusal survives the blend** — the style never votes on a composition the
plot has already ruled out.

**Judge a front-to-back plan on the lawn it leaves, never on the aspect ratio.** A room twice as wide
as it is deep leaves a generous lawn at twenty metres deep and a two-metre strip at eleven; the ratio
is identical and the right plan is not. `lawnDepthBehindTerrace` computes it with the same helpers
the templates use, so the judgement and the drawing cannot disagree — and the tie between
terrace-and-lawn and side-by-side stopped being decided by a threshold nobody could defend.

**A zone is not a feature, and that is the point of the layer.** `planZones` builds the rooms from
the features that survived the capacity cut and the archetype places them; a room the composition
cannot host comes back with `rect: null` rather than being dropped, because the brief asked for it.
`Slot.zoneId` is what lets a feature be assigned to a *room* while the fitter goes on working in
slots. **The brief proposes a primary zone and the rooms dispose**: a primary zone the plan has
nothing to put in is the same silent fiction as a focal point the garden does not contain.

**For the three original compositions the zone plan is derived; for the four new ones it is
primary.** That asymmetry is deliberate and temporary. The originals compute their rectangles inline
and must go on producing identical numbers, so the plan is read back out of what they drew — it
cannot disagree with the sketch, because it *is* the sketch. All seven end up the other way round
once the candidate loop lands and the golden comparison is deleted.

**Every composition draws its open panel; `lawnCategory` decides what it is made of.** All four new
ones first gated the panel on `lawnAllowed` and drew *nothing* where grass was forbidden — 72% of one
fixture reading as base showing through. Gravel is the answer, never absence. The classic three had
this right; it is the single easiest thing to get wrong when adding a composition.

**Slot A is the best fit and is therefore the recommendation.** `recommendedIndex(style)` mapped a
style to a fixed slot, which meant something only while the slots were a fixed list. The style still
decides — it is 40% of every score — it just no longer decides by pointing at a position.

**A concept explains itself, and a decision is recorded by the pass that took it.** That is what keeps
it honest: a decision names the elements it produced, so a concept cannot claim the terrace went at
the doors unless a terrace element exists to point at. There is a test asserting every `subjects` id
is in the drawing. Note `placedSentence` drops the room when the feature's name already contains it —
"the play area in the play area" is said once.

## The candidate loop

**Nothing ever compared two arrangements of the same garden, because there was never a second one.**
The generator drew one plan per slot and offered it; a parameter like "which side gets the deep
border" could exist in a template and never be exercised, because nothing would have known which
answer was better. `design/choose.ts` is the loop: enumerate the compositions that suit the plot
against the variations each offers, preview every combination, score them with the same nine
principles the finished plan is judged on, and take the best that is not too like what the other
slots have already taken.

**A preview is deliberately not the plan.** `design/layout-generator.ts` lays the terrace, seats the
features, routes the sketch's paths and places the trees — the whole of what a *composition and its
parameters* decide. It does not run the sampler, cut the beds, compose the front garden or specify
the lighting, because none of those distinguish one candidate from another on the same plot. That
division is the only reason the loop is affordable: a preview issues **no query**, so the whole field
costs a few milliseconds where fifty realisations would cost a minute.

**What is chosen is a decision, not a drawing.** The winner is an archetype and a set of parameters;
the real pipeline then builds that plan properly. The preview is thrown away, which is why it can
afford to be a simplification — and why the finalist is rescored at the `realised` tier afterwards.

**The three slots are chosen together, never one at a time.** Being different is a property of the
*set*. A loop picking each slot's best independently would happily return the same plan three times,
which is worse than the accident it replaced — the old generator kept the promise only because it
drew all three templates and they could not help differing.

**A candidate is judged on its score *and* on its composition's fit, and dropping either has a
name.** Score alone throws the style away: on a deep plot a destination garden out-drew the
terrace-and-lawn plan a modern brief asked for, because a score measures how well an arrangement
worked and knows nothing about what was wanted. Fit alone is the state before the loop. The split is
0.65 score, 0.35 fit, and both are documented where they are applied.

**Repeating a composition costs more than being merely similar.** Three cards headed "Terrace and
lawn", "Terrace and lawn" and "Formal axis" read as a mistake even when the two share a name and not
a drawing, because a user cannot see a parameter. A repeat has to be markedly better rather than
marginally. On a plot that genuinely supports one composition the penalty is paid and the repeat
still appears, because a card saying nothing is worse.

**The diversity signature is taken from the placed result, never from the parameters.** Two
parameter sets that make no difference on a particular plot draw the same garden, and a signature
over the inputs would call them different. That is exactly how a comparison screen comes to show one
plan three times.

**`assignByPriority` tries a feature's own room before its slot ladder**, and the ladder is kept
rather than replaced: several features legitimately span rooms, and water is `axis-end`, then
`terrace-corner`, then `far-room`. Callers pass the features already in priority order, which is
what stops a fire pit ticked before a terrace taking the slot the terrace wanted.

**`mix` exists because a linear stride cannot be nested.** `conceptSeed(base, k)` adds a prime per
step, so `conceptSeed(conceptSeed(seed, i), k)` equals `conceptSeed(seed, i + k)` — candidate `k` of
brief `i` would share a seed with candidate 0 of brief `i + k`, and two different layouts would
sample identical points. There is a test for the collision.

**`routeBetween` and `closestPointOnRing` left the service, and `ST_ClosestPoint` went with them.**
Routing never needed a database: a route is four candidate polylines checked against rings the
caller already has. `routeFromHouse` finds its start point in TypeScript now, which is the same
answer to sub-millimetre and saves a query per destination per candidate. Before that, circulation
sat on the wrong side of the pure/PostGIS line and no preview could have drawn a path.

**The preview used to under-count routes, and closing that gap was half of the next phase.** The
realised pipeline gives every room it places a path from the terrace, and a preview that stopped at
the composition's own paths never drew those — so a layout chosen partly on its circulation acquired
two or three paths nobody had scored, and those are the ones that cross planting, because nothing
composed them. The preview draws them now, with the same thirteen starting points along the terrace
edge and in the same order, because a preview that searched less hard would report a room as
unreachable that the built plan then reaches.

## Repair: fixing a chosen plan rather than passing it over

**The loop could only ever choose.** A layout with one fixable fault — a store standing in the
sightline out of the doors, a path pinching past a bed — was ranked below one without it and
forgotten, which is the right answer only when a better arrangement happens to exist in the field.
On most plots it does not: the fault is in the best plan the plot supports, and the designer's move
is to fix that one thing. `design/repair.ts` takes the chosen candidate's worst repairable issue,
applies a change aimed at that issue's own subjects, redraws the whole layout, rescores it, and
keeps the result only if the total measurably rose and nothing critical appeared.

**A repair is targeted, never a parameter sweep, and that distinction is the reason the stage
exists.** Every value of every `CandidateParams` axis is already enumerated, previewed and scored —
so a "repair" that only moved a parameter would be searching a space the loop has exhausted, and
could not find anything it had already rejected. What is new is acting on *a subject the scorer
named*: move this feature, take the next approach to this path, leave this one thing out. None of
that can be enumerated, because it depends on the measurement.

**`LayoutAdjustments` is honoured by realisation as well as by the preview, and that is a rule
rather than an aspiration.** A repair accepted on a reading of a drawing the real pipeline then
ignores is a score claiming an improvement the garden does not have, which is worse than the fault
it hid. Adding a field to it means plumbing it into `concepts.service.ts` in the same change. The
empty value is `NO_ADJUSTMENTS` and a candidate carrying it draws exactly what it drew before the
stage existed.

**Repair comes after the choice, never before it.** Repairing the whole field would cost fifty times
as much for an answer the diversity filter throws most of away — and, worse, it would *converge* the
field, because every candidate improved towards one objective is every candidate becoming the same
plan. Choose for variety, then improve each choice on its own terms. The signature the next slot
must differ from is taken from the **repaired** preview, or slot B would be avoiding a plan that no
longer exists.

**A repair moves the thing; it does not lose it. The benchmark found this and it is the sharpest
lesson of the stage.** Barring the slot a store was in asks the fitter for its second answer — but
where there is no second answer the store simply goes unplaced, and a preview with no store in it
has no store standing in the sightline either. The relationship score rises, the loop accepts, and
the real pipeline hands the store to the sampler, which puts it back with none of the composition's
reasoning. On the long-narrow fixture that turned a plan scoring 0.83 into one scoring 0.72 while
every structural number said it had improved. `keepsWhatItPlaced` refuses any repair that drops a
feature, except the one operation that declares it means to.

**Two repair kinds are unavailable, and `UNAVAILABLE` says so rather than leaving a silent gap.**
`align` is a rotation fault, and every placement a composition makes inherits the frame's own
bearing — so `misaligned` can only ever be raised against something the sampler placed, which no
adjustment to a candidate reaches. `merge-beds` asks for different beds, and the beds are the
composition's own sketch: redrawing them would be rewriting the archetype rather than adjusting this
candidate of it.

**A repair helps about one time in six it is tried, and that is the gate working.** Over the eleven
scenarios: 102 candidates, 143 operations attempted, 25 accepted. On the fixture set 24 repairs land
across 15% of concepts. The stage cannot make a plan worse — at the limit it changes nothing and the
candidate it was handed stands — so the low acceptance rate is the measurement that says the
accept-only-on-improvement rule is load-bearing rather than decorative.

**What repair cannot reach is most of what the harness still reports.** The two commonest faults are
`too-many-materials` (84), which is a `materialFor` policy question rather than a layout one, and
`seating-in-shade` (72), which asks to move a terrace that goes across the garden doors because that
is what a terrace is. A north-facing garden's answer is a second sitting area in the sun, not a
displaced terrace, and nothing here composes one yet.

## The preview and the built plan place features in the same order

**They did not, and the divergence made the score a claim about a garden nobody saw.** The candidate
loop previewed and scored with `assignByPriority` over the agent's tier-ranked list; `build` then
drew the winner with `assignSlots` over the order the user happened to tick the cards in. A slot the
preview gave to the dining area could go to a fire pit at realisation. Both now use
`assignByPriority` over the same list.

It is also the answer to a fault recorded against the old generator in its own right: the placement
budget cuts whatever falls past it, and cutting in tick order means a fire pit ticked first can
displace the dining space the garden is *for*. `withinCapacity` ranks by tier and never cuts an
essential; anything it excluded is appended so it is still reported rather than silently absent.

**The measured cost is real and is recorded rather than hidden.** Aligning lifted privacy 0.987 →
1.000, buildability 0.970 → 0.989, style 0.863 → 0.872 and relationships 0.697 → 0.717, and it cost
the biggest fixture 1.5 s → 5.1 s. The design loop is not where that went — it is about 100 ms per
concept, measured — it is `placement.candidates`, which is the dominant query in the whole generator
(948 calls and 74 seconds of a full harness run) and whose feasible-region computation gets harder
when the arrangement changes. Reducing that is its own piece of work and is in TODOS.

## Traps Phase 2 paid for

**A route out of a gate must leave perpendicular to its fence, and nothing said so.** A gate sits *on*
the boundary, and `polylineStrip` gives a route square caps — so the strip round a first leg that runs
*along* the fence puts its own end cap through it and `withinRing(strip, boundary)` refuses the whole
route. The first side-by-side plan put the garden store against the house wall on the gate's side,
which is the one line the route could take, and the plan came out with a gate nobody could walk
through. The store is anchored to the far end of its strip now, leaving the band beside the house
clear. **Widening the lane was not enough and neither was steering the route with `via`** — both were
tried, and the fault was the direction of the first leg rather than the room it had.

**An access lane has to be wider than `PASSAGE_ACCESS_WIDTH`.** That constant is one metre, which is
what a person needs to walk past a house; the route drawn through it is the `access` circulation,
which `circulationFor` makes **1.2 m** wide. A lane sized by the first number cannot hold the second.

**Index-based coupling between three independent decisions.** The courtyard composition collected its
beds into a list, then named them by index *and* sized the floor by counting them. On a room too
shallow for a rear border — which is exactly what a courtyard is — the rear bed dropped out, the side
beds shuffled up, and the plan came out with a side bed labelled "Rear border" and a floor that
overlapped the right-hand one. Each bed is resolved by name now and the floor is what they leave.

**Do not invent a second answer to a settled question.** Three separate bugs, one shape: a lawn floor
of 4 m beside `LAWN_FLOOR.minDimension` of 2.5 (refused a perfectly good 26 m² lawn), a courtyard
area threshold of 90 m² beside `isCourtyard` (paved a 9 × 10 m garden corner to corner), and a route
width of 0.9 m beside `circulationFor`'s own 0.85 (reported a hundred routes as too narrow). Reuse
the rule; a second number is a divergence waiting to happen.

**A test that measures an implementation detail pins the wrong thing.** Three of this phase's
failures were expectations, not defects. `shape.cornerRadius` is zero on any panel the fill pass
re-cut — the curve is already in the points and rounding it again would round the rounding — so
reading the field measured whether the panel survived the clip. Vertex count is no better on its
own: a sweeping lawn is a 28-point ellipse whatever the style, so counting across compositions
measures which composition was chosen. The comparison has to hold the composition constant.

**Equal bands are the wrong shape for a sequence of rooms.** The first linear plan cut the length
into as many equal bands as would fit and gave the lawn the first one; on a 7 × 22 m room that is
three five-metre slices, two holding one feature apiece and nothing else — a third of the garden
reading as bare ground. A sequence of rooms is one generous room you use and a smaller one you walk
to, so the far room takes a modest share and the open ground takes the rest.

**A scenario fixture's `depth` is the plot, not the garden.** The wide-shallow scenario said `depth:
9` meaning the garden and got a plot with a 4 m house in it, leaving a room 4.5 m deep — not a wide
shallow garden but a courtyard, which the compositions correctly said. A fixture that does not match
its own expectation tests nothing.

**The 452-second test was contention, not a hang.** One concept test took seven and a half minutes in
a run where PostGIS was busy, and 3.2 s in isolation a minute later. CLAUDE.md already records that
two API test runs at once crawl; this is what it looks like from inside one of them. Check for a
second client before believing a timing.

## Traps the evaluation harness found

**`pnpm --filter @garden-studio/api eval:generator` is the benchmark TODOS asked for**, over 13 cases
× 3 seeds: validity, composition bands, design score per principle, feature inclusion, determinism
and latency by plot scale. It needs PostGIS up, it writes nothing, and **a case that fails to
generate is a row rather than the end of the run** — the first fault it ever found threw, and the
eleven cases after it were never measured, so the one run that had something to report produced no
report.

**`ST_UnaryUnion` threw on a self-intersecting obstacle ring, and three of the four call sites had no
guard.** `TopologyException: side location conflict`, which takes down the whole generation rather
than returning anything. Obstacle sets contain path strips, and `polylineStrip` mitres square — so a
route that doubles back sharply is a bow tie **by construction**. Every fixture before the L-shaped
scenario happened to have gentler corners. `unionOf` in `fill.service.ts` is now the one place it
happens and `placement.service.ts` imports it.

**Repairing each ring is four times faster than not repairing at all, and the collection form is the
slow one.** Measured on forty overlapping rings:

```
ST_UnaryUnion(ST_Collect(g))                 102 ms   (and throws on a bow tie)
ST_UnaryUnion(ST_MakeValid(ST_Collect(g)))   279 ms
ST_UnaryUnion(ST_Collect(ST_MakeValid(g)))    24 ms
```

Repairing first normalises each polygon, which leaves the union far less work. The middle form put
six concept tests over vitest's five-second default; the last one brought the rotated-house test from
4587 ms to 4259 ms, *faster than before the guard existed*. Do not "optimise" it back to one call.

**A scorer that disagrees with a considered decision elsewhere in the system is reporting a
difference of opinion as a defect.** Three of the harness's first findings were faults in the rules
rather than in the generator, and all three are worth knowing before adding a rule:

- **`MIN_ROUTE_WIDTH` is read off `circulationFor`'s own narrowest legitimate route**, not declared.
  A defensible 0.9 m sat one centimetre above the 0.85 m the generator deliberately gives a secondary
  stepping-stone path, and the harness reported a hundred "too narrow" routes that were policy.
- **A pinch point needs blockers on *opposite sides* of the route.** Taking the two nearest whatever
  their direction fires on every path laid alongside a bed — the commonest and most deliberate
  arrangement in a garden — and reported a hundred and sixty pinches on plans that had none.
- **"Too many materials" counts the *ground*.** Paving, gravel and turf are a composition decision; a
  timber shed and a mixed border are a structure choice and a planting choice. Counting all of them
  had every plan reporting six against a cap of three, a number nothing could ever meet.

**Every scenario put the house at the far end of the plot in +y, so every garden was north-facing and
every terrace was in shade.** True of the captured fixtures too, since `capture-fixtures.ts` uses the
same convention. A perfectly real kind of garden, and a bad thing for *all* the fixtures to be: a sun
rule that always fails is indistinguishable from one that discriminates. Two scenarios now carry
`orientation: 180`.

**Distance rules carry `SLACK` of a micrometre.** A centroid is computed by shoelace and a threshold
is a round number, so a pair placed at exactly the distance a rule asks for lands the wrong side of
it about half the time. "The barbecue is 3.0 m from the table, past the 3 m it wants" is a fault
nobody can act on and everybody stops trusting the tool over.

## Rendering with assets

**Assets are generated offline, checked in, and never required.** `tools/assets` asks an image model
(OpenAI `gpt-image-1`, over plain `fetch`, no SDK) for every family in
`apps/web/src/lib/materials/assets/asset-spec.ts`, post-processes with `sharp`, writes WebP files
under `apps/web/public/assets/` and a `catalogue.json` beside the code with what the renderer reads
(size, mean colour, a sprite's opaque reach, a texture's seam score). The **spec is the
specification**: the prompt is the sentence that says what `plant-shrub` is, and regenerating with a
better model is re-running the tool. The raw PNGs are kept in `tools/assets/raw/` (gitignored) so
`--reprocess` can redo the post-processing without paying for the pictures again. The key is read
from `OPEN_AI_API_KEY` in `apps/api/.env` (or `OPENAI_API_KEY`); no key prints what would be
generated and exits 0. Note the images-per-minute limit is 5: the provider retries 429s with
backoff, and `--concurrency 2` is about the most that does not just wait.

**The painters keep their geometry and change their paint.** `drawModule` still lays the tone and
the bevel a slab always had, then draws a face photograph into the same rectangle, cropped to the
module's aspect and tinted a third of the way to the palette tone; a board shows a strip of grain
from a seeded height. Joints, stagger, `gridRange` and therefore slab counts are untouched. Textures
are tiled in pattern space from the plan origin by the same `gridRange`, which is what keeps two
abutting patios continuous. A scatter unit becomes a sprite chosen and turned by two further draws
from the _same_ per-cell generator, after the four the blob path makes — so a bed with no sprites
draws exactly what it always did. **With no assets loaded the output is byte-identical to before**,
and there is a test for it.

**`textureIsMass` is decided by the manifest, not by what has loaded.** Gravel _is_ its texture and
the unit loop returns; a bed's texture is the soil its plants sit on and the loop continues. The
first version keyed this on "no sprites loaded" and every bed of grasses drew as bare soil while the
sprites were on their way.

**The asset version is in the raster cache key**, for the reason the light is: a surface drawn before
its texture arrived and after are different pixels, and without it the plan textures in patches.
`assetVersion()` is `'none'` until the preload settles and the catalogue's hash after, which puts
exactly one redraw between the two states. `useAssetPreload` runs once in `ProjectHydrator`.

**A contact shadow is a drawing convention, not a solar claim.** Every sprite and symbol stands on a
soft disc, proportional to the thing, pushed a little way away from `DrawPass.light`, never scaled
by height. It says "this stands up off the ground", which a plan symbol needs to say whether or not
the plan knows where on Earth it is. The fence's shade strip is the same class, and since
`presentationCast` landed so is the cast layer on an unlocated plan — what stays gated on
`site.location` is the *claim*, which `ShadowCast.source` carries. `SHADOW_OPACITY` went from 0.26
to 0.36 when the lawn became a photograph.

**Shadows are soft in both views, and the penumbra grows with the caster — _this reverses_ "soft is
Visualise's presentation choice; a diagram draws the hard edge".** A hard-edged shadow is what a
shadow looks like on the moon, and the 2D Plan is a drawing of a garden rather than a section
through one. `softnessMetres` is still a switch rather than a radius: the blur each bucket gets
comes from its occluder's character (`PRESENTATION_SHADOW_SOFTNESS` for built,
`FOLIAGE_SHADOW_SOFTNESS` for foliage) *and* its height, through `PENUMBRA_GROWTH_PER_METRE`, so a
kerb keeps its crisp line and a six-metre house gets an edge with air in it. Heights are quantised
into three bands (`HEIGHT_BANDS`) because every distinct softness is another opaque union, another
blur and another composite over a raster that reaches 4096²; measured at **3.1 ms against 0.9 ms**
for the hard path on the 56-occluder suburban fixture, on a cache miss only. The hard single-union
path is kept for a context with no `filter` support and for a caller that genuinely wants the union.

**`SceneOptions.shadows` is a view preference beside `maturity`, not a document field.** Off is a
real thing to want: a drawing somebody is about to measure, print or write on, and two layouts
being compared rather than one being admired. It withdraws the cast layer only — the contact discs
and the fence shade bands stay, because those say "this stands up" rather than "the sun is over
there". `shadowsVisible` in `plan-editor-store` has the same five edit points `gridVisible` does,
and the PNG export reads it so a download matches the view it was taken from.

**A canopy sprite is inscribed in the tree's radius by `canopySpriteBox`.** The catalogue records
how far a sprite's opaque pixels reach; the half-width is `radius / ratio`, so the furthest leaf
lands exactly on the circle the placer eroded by and the validator tessellates. Same rule as
`canopyRing`, same reason.

**Symbols are drawn where sprites cannot be.** A pergola, shed, gazebo or raised bed is whatever
rectangle the placer gave it, which no photograph stretches into, so `symbols/structures.ts` gives
posts, ridges, hips and rails as pure geometry and both the Konva canvas and the composer draw from
it. `SYMBOL_SPRITES` maps the rest to sprite families. A sprite is always fitted _inside_ the
element's rect or radius (`spriteBox`): the geometry of record is never the sprite's natural size.

**`furniture` was the eighth `ElementCategory`, and `DesignElement.symbol` a plain string.** Adding
the category was a compile error in nine records until each was answered — that is the point of
them being total. (`lighting` is the ninth, and adding *it* was a compile error in ten places: see
below, and note that `layerForElement`'s switch is total too without being a `Record`.)

Furniture has an outline for placing and selecting but is _counted, not measured_: the schedule
gives it items rather than square metres and `materialCostIndex` skips it — `COUNTED_CATEGORIES` is
where that is now said once, for furniture and lighting together. The
concept test's pairwise-disjoint rule excludes it and a second test demands each piece sit wholly
inside exactly one host, drawn after it. The assistant's `add` excludes the surfaces furniture may
stand on from its obstacles, or a dining set could only ever land on the lawn beside the patio.

**A retaining wall has two truthful drawings, and `RenderLevel.surface` is which.** A wall built of
something — coursed stone, brick — has a *top course* worth painting and gets the same module
treatment a patio does. A terrace retained in its own paving has no such course: it is an upstand of
the same stuff, and the honest drawing is the host's tone a shade darker. `DesignElement.retaining`
chooses between them and **absent is the default and the commoner answer**, because most raised
terraces really are retained in what they are paved with. `WALLING_MATERIALS` sits outside
`MATERIALS` for the reason `EDGING_MATERIALS` does: a retaining face is derived from an edge, so
there is no element to give a category to, and `categoryOf` files both as `paved-area`.

**Level changes are local, and that is a refusal rather than a simplification.** There is no ground
surface: no spot levels, no contours, no fall across the plot. All three come off a survey, which is
exactly the kind of fact `site.location` is nullable to avoid inventing — so a level change is not
"the garden falls 1:20 to the north", it is "this terrace is 340 mm up", stated per element on
`DesignElement.elevation` and true of nothing else. **Nothing anywhere infers a slope.**

**A retaining wall is not a thing anybody places; it is what the edge of a raised element *is*.**
`plan/levels.ts` derives the faces every read, for the same reason edging is derived from its bed: a
wall stored beside a terrace is a wall that gets left behind when the terrace moves. `levelBands`
excludes the sides against the **house** and nothing else — deliberately unlike `edgingRuns`, which
drops the boundary side too. A terrace raised against the fence really does need holding up there;
the fence is not doing it. It also skips a flight of steps, which carries an elevation but is the
thing that *resolves* a level change rather than one that needs holding back — retaining it draws a
wall across the very route down off the terrace.

**`elevation` adds to an occluder's `height`; it must not set `baseHeight`.** A raised surface
stands on a solid plinth of its own footprint, so a terrace at 340 mm casts the shadow of a 340 mm
wall round its edge. `baseHeight` would say the terrace *floats* and casts nothing at all — that
field means the underside of a canopy or a beam. A **sunken** area casts nothing, because what would
shade it is the ground standing proud around it and a local model has no ground to make an occluder
out of.

**`castsShadow` counts `elevation`, and leaving it out was a real bug found by a test.** A terrace is
flat, so `heightFor` is 0 and the whole element was filtered out of the shadow pass before anything
downstream could give it its plinth — the raised edge cast nothing, silently. A raised surface is a
wall as far as the sun is concerned, whatever it is in itself.

**A flight's tread count is derived from its own `elevation`, never stored.** `stepFlight` divides
the rise into whole risers near a 170 mm target, so a flight that climbs 450 mm draws three nosings
and one that climbs 900 draws five, and the drawing cannot disagree with the level change it serves.
**`ceil`, not `round`** — rounding to the nearest whole number of steps lets the riser overshoot by
half a step, and a 230 mm rise came back as one 230 mm riser, steeper than Approved Document K allows
for a private stair at all. Taking the ceiling means a flight can only err *shallow*. A property test
walks every rise from 100 mm to 2 m and holds the whole band.

**The generator lifts a terrace only where the style and the budget both ask, and never without a
way down off it.** Retaining is the dearest thing per square metre in a garden, so `terraceRise`
refuses below a high budget and outside the formal and modern styles. If `stepsFromTerrace` cannot
place a flight the terrace stays **on grade** rather than raised and stranded — a raised terrace you
cannot step off is worse than a flat one, and the generator is the only place that can tell. The
flight is cut **flush** against the terrace: two rectangles sharing an edge do not intersect by
`polygonsIntersect`, which tests a strict crossing, so a flush flight satisfies the concept suite's
disjointness rule with no fudge gap. Its depth is the *going* — risers × 350 mm — so the footprint
and the nosings come from one number.

**`PLAN_DOCUMENT_VERSION` is 3, and `MIGRATIONS[2]` is a deliberate no-op.** Nothing about the
document's shape changed; `elevation` has been on `DesignElement` for a long time. What changed is
its **meaning** — it was documented as "carried for costing later; nothing renders differently
because of it", and from here a raised element draws a retaining face and casts from the top of it.
A stored v2 plan means the same thing it always did, so there is nothing to rewrite. The version is
bumped so the change has a date, not because a row needs help.

**Edging is a field on the host, not an element — and it is `plan/edging.ts` that decides where it
goes.** `DesignElement.edging` records the *decision* ("this bed has a brick course"); the runs are
derived every read from the outline it follows. Storing the run instead would mean two things that
can disagree the moment the bed is dragged, and keeping them in step would put a dependency graph
inside the editor's `moveElementLive` / `resizeElementLive` / `rotateElementLive` — miss one and you
get a course floating beside a bed that has moved. Same argument as zones, openings and the roof.
The visible consequence is that edging cannot be selected or moved on its own, which is correct: you
edge a bed, you do not draw a line that happens to sit beside one. The known limit is a
**freestanding** run — a kerb along a drive with nothing either side — which this shape cannot
express and which the parking TODO will need.

**`EDGING_MATERIALS` is deliberately outside `MATERIALS`,** because `MATERIALS` is keyed by
`ElementCategory` and edging has none. `findMaterial` searches it as a second pass, and
`resolvePattern` files an edging course under `paved-area` — which is the true answer rather than a
fallback, since a brick course laid on edge is paving by every property the painters read, and
`CATEGORY_EDGES['paved-area']` is null so a course correctly gets no edging of its own.

**This pass is allowed to look at neighbours, and the reverted kerb was not.** The kerb failed
because it was stroked on each surface's *own clipped raster*, so it could not know a neighbour was
there and drew a line down the seam between two abutting patios; teaching it would have put every
surface's neighbours in the raster cache key. `edgingRuns` runs once over the whole element list,
before any rasterising, and returns geometry — so it can do the two things the stroke could not:
**drop the sides against the boundary and the house** (on the l-shape fixture that is 139 m of brick
rather than 196 m — 57 metres nobody would lay but everybody would be invoiced for), and **refuse an
edge two edged hosts share**, so an internal seam is one course rather than two stacked on each
other.

**Runs are chained, not per segment, and that is a drawing fix as much as a counting one.** A curved
bed is tessellated at two dozen points. One run per segment reported "73 runs" for a garden with six
beds — and `polylineStrip` cuts its caps square, so two dozen stubby strips leave a notch at every
vertex right round the curve. `chainsOf` joins consecutive kept segments into one polyline, wrap
included: a ring is walked from an arbitrary index, so a course passing through that index must not
come back as two runs butting into each other in the middle of a continuous edge.

**The generator edges accents and features, never a base fill.** A base fill is the *whole zone
polygon*, so its outline carries the zone's internal cross-fences as well as its perimeter — and
`edgingRuns` drops only the sides against the boundary and the house. Edging one would draw a brick
course straight across the middle of the garden where the side return meets the back, and nothing
downstream would object. `edgingFor` is the policy and it is restrained on purpose: formal takes
setts or brick, cottage brick, modern and low-maintenance steel, everything else nothing, and never
on a low budget.

**Edging is the only thing on the plan measured in metres,** so `ScheduleLine.lengthM` is nullable
rather than zero — a nought would read as "no edging here", where the honest answer for a patio is
that linear metres is not the unit it is bought in. `planSchedule` takes the boundary and the house
so the number it prints is the number somebody would order.

**`EDGING_WIDTH_MM` is presentation and nothing measures it.** The schedule measures a run by its
length, so the table is free to be a drawing convention where the product is not one — which matters
for exactly one entry: steel edging is a 3 mm blade, a fifth of a pixel at any zoom the plan
supports, and is drawn at 45 mm because that is the width it *reads* at. The other four are real
product widths.

**`lighting` is the ninth `ElementCategory`, and it is emphatically not `furniture`.** The obvious
saving was to reuse `furniture` — both are counted rather than measured, both stand on things — and
it is wrong for one specific reason the test suite already encoded: furniture is _hosted_, and
`concepts.service.test.ts` pins that every furniture element lies wholly inside exactly one built
feature. Lighting is the opposite by nature. A spike light stands in a planting bed, which is a
`fill`; a bollard runs beside a path, which is a polyline; a wall light is on the house, which is not
an element at all. All three are zero hosts, so calling a light furniture would have meant weakening
the rule that keeps a dining set on its patio. What the two _do_ share is said once, in
`COUNTED_CATEGORIES`: no area in the schedule, items rather than square metres, no weight in
`materialCostIndex`, and `null` in `KIND_BY_CATEGORY` so a lighting scheme cannot move the
composition bands. Adding the category was a compile error in **ten** places, not the nine the
furniture note quotes — `layerForElement`'s switch is total too and is not a `Record`.

**Night is a ramp, and it is gated on `site.location` — which since `presentationCast` is a
*stricter* gate than the cast layer's, not the same one.** `nightFraction` returns 0 in daylight, 1
once civil twilight has ended, and the real fraction between — and `null` without a location, for
the reason `shadowCast` refuses: there is no latitude that is true of anywhere, so there is no hour
at which an unlocated garden is dark. An unlocated plan therefore draws shadows and never draws
night, which is exactly the split `ShadowCast.source` exists to express. A
boolean was the first design and is visibly wrong: the time slider steps in fifteen minutes, so a
switch takes the whole garden from noon to midnight in one step, and dusk is the hour a lit garden
actually looks its best. `-6°` is not a tuned number — it is civil twilight, the standard definition
of when outdoor activity needs artificial light, which is the question being asked.

**A scene with an explicit `light` makes no claim about the night.** The judging sheets override
`light` to draw one plan at four times of day, so `buildRenderScene` answers `night: null` whenever
that override is present: an explicit light means the caller is driving the sun itself. The lighting
sheet therefore deliberately does _not_ pass one, which is the opposite of every other sheet.

**The fitting and the light it throws are two different things.** `RenderLight` carries a pool
radius and an intensity, and the fitting is an ordinary `RenderItem` drawn from its own sprite. That
split is the whole reason a 120 mm spike light works on a plan: the fitting is four pixels across at
a normal zoom and the pool is three metres, and it is the pool a reader sees. It is also why the
sprite prompts insist the fitting is **switched off** — a glow baked into a photograph would burn at
midday and fight the real pool after dark. `fx-light-pool` is procedural for the reason
`fx-soft-shadow` is: it is a gradient, and asking an image model for one buys banding and a colour
cast in place of four lines of arithmetic.

**Pools composite `lighter`; shadows must not.** Two lamps on one shrub really are brighter than one,
so the pools add. That is the exact opposite of the cast-shadow rule three sections above, and the
difference is physical rather than stylistic: shadow is the absence of a light source and cannot be
more absent, whereas two lamps are two lamps. `NIGHT_MAX_ALPHA` stops well short of 1 on purpose — a
plan is a document before it is a picture, and one that hid its own geometry after six o'clock would
be a worse drawing however convincing the night.

**Visualise needed no Pixi work at all, and that is the two-canvas split paying off.** The wash and
the pools are drawn at the end of `drawOverlay`, which both backends already share, and the overlay
canvas sits above the WebGL one — so a translucent wash there darkens the ground and planting Pixi
drew underneath it. Nothing in `render/pixi/` was touched.

**The generator places uplights and bollards, and deliberately no wall lights.** A pair either side
of the garden door is the obvious move and is left to the user: a wall light is mounted _on_ the
building, so a generated one would be the first thing this generator ever placed inside the house
footprint, and `geometryClearsHouse` being true of everything it emits is worth more than the
fitting. Recessed lights wait for steps to exist. Nothing at all on a low budget, because lighting is
a real cost with a real trench in it. Lighting is **not** pushed onto `obstacles` — a spike standing
among the planting it lights is the point of one, and treating a 120 mm fitting as an obstacle would
push a whole bed away from it.

**`lightingScheme` runs after `stampPlanting`, not merely after the features.** A tree is a bare
`planting-bed` point until the stamp gives it its species symbol, so the first version — which ran
before it — saw no trees at all and quietly specified bollards and nothing else. The stamp is
therefore resolved to a local rather than applied inline in the return. This is the same class of
bug as `openingCounter` not being re-seeded: everything works, nothing errors, and the output is
silently impoverished.

**A pergola throws slat shadows, and that is the one thing that says "pergola" from above.** In
plan a pergola is a grid of thin bars on whatever it stands on, and drawn alone that reads as a
painted pattern — the rafters have no thickness on the page and nothing says they are two and a half
metres over your head. The shadow *is* the rafters translated, the same construction `projectShadow`
uses, so there is no clipping and no second geometry: the stripes land under the structure and run
out beyond it exactly as far as the height and the light say. A convention in the contact-disc class,
so it is drawn whether or not the plan has a location.

**`dark-stained-timber` is the finish a garden building actually has.** Every shed, store and garden
room came out pale honey, because `softwood` is the cheap default and a photograph of untreated
softwood is what it is — so the most conspicuous object in the garden after the house was also the
brightest. A dark stain *recedes*, which is the whole reason a designer specifies one: a store you
notice is a store you are looking at instead of the garden. It leads the structure palette on modern
and low-upkeep briefs and shares the rotation elsewhere, so a plan with two buildings still differs
between them. Not a black: at this scale a true black shed is a hole in the drawing, and what is
being drawn is timber that has been *stained*, so the grain still reads through it.

**`furnish` is pure and centred.** An item is placed in the middle of its host with a 0.3 m margin,
inherits the host's rotation, may be turned a quarter to fit, and is verified by `geometryIsLegal`
like everything else. `FURNISHINGS` lists choices per feature and `furnish` walks the list until
one fits, so a small pergola gets the four-seater rather than nothing; the play area rolls, the
rest are indexed by the concept so the three concepts differ on purpose.

**`drawPlan` is the one composer** (`render-plan.ts`): concept thumbnails, the PNG export, the
judging sheets and a future hero-render input all draw through it, in the canvases' stacking order.
The thumbnails keep their SVG for SSR and jsdom and overlay the raster a frame after mount.

**Fills have no outline, and stripes are seeded from the material.** Both were invisible on flat
pale turf and became seams across a photograph of grass cut into zones. A lawn is one ground the
zones merely cut up.

**The cut edge was displaced by the pattern origin for as long as it existed.** It was stroked
after the context had been moved into pattern space, using raster coordinates — off the raster
entirely for any surface away from the plan origin, so nobody saw it, and a metre inside the
outline when the composer drew a plan with a margin, where it showed as a stray arc in every fire
pit. It is drawn in raster space now, with the clip still in force.

**The paving kerb was tried and reverted.** A 40 mm edging course in the joint colour round every
`paved-area` reads well on one patio and draws a line down the seam between two abutting ones —
exactly the continuity the shared-edge tests exist to protect. Paving stays `null` in
`CATEGORY_EDGES`.

**The seam score is a ratio, not an absolute.** Edge mismatch over the tile's own interior grain: a
seamless tile scores about 1 whatever its texture. An absolute measure called every lawn a bad seam
and passed a smooth pool with a real one. The tool blends (offset by half, fade the original back
over the middle) anything over 1.5; the test allows 1.6.

**The house's wall is `insetPolygon`, derived every render.** It refuses an outline too small for
the wall (edges that would run backwards after offsetting) and the caller draws the flat fill. The
door gap is cut half a wall _inside_ the outline, one wall thick, because the drawn wall is a band
inside the line the opening sits on.

**A path ends at the feature's edge, and that is why paths exist at all.** `servicePath` ran to
the patio's centroid, the patio was in `obstacles`, so the strip always entered an obstacle and was
refused — on every plan that ever asked for one. `routeTo` ends at the point on the destination's
outline nearest the house, pulled back 50 mm, ignores the house and the destination in the
obstacle check, and tries straight then the two L-shaped routes. Every far-from-house rect feature
is a destination as well as the first gathering place; a path under 1.5 m is refused as too short
to read as one, which is why a patio a stride from the house gets none. A path is _painted_, too:
polylines used to be handed to Konva as a stroke and never reached the surface painter, so
stepping stones drew as a grey lozenge. Both renderers now paint the strip `elementOutline`
tessellates.

**Accent corners follow the style, border pieces vary their planting, and beds get specimens.**
`styleCornerRadius` gives a cottage garden 1.2 m corners and a modern or formal one none — real
geometry, tessellated by `roundPolygon` for canvas and validator alike; border bands stay square
because they meet the fence. Each run of border takes `materialFor(..., index + order)` so the
planting changes where the border turns a corner. Two to four `specimen` shrubs stand inside
accent beds, placed by `candidates` with no obstacles and the shrub's own radius — which is
exactly "somewhere fully inside this bed". Not done from P7: planting drifts by wedge-splitting a
band in PostGIS, and formal symmetry.

## The render scene, and the two views

**`buildRenderScene` is the seam, and it exists because there were two drawings of one garden.**
`ElementDrawing.tsx` builds Konva nodes for the editor and the concept cards; `drawPlan` paints
the same picture into a 2D context for thumbnails, the PNG and the judging sheets. They shared the
geometry helpers and the surface painter but not the decisions _between_ them — which is how one
of them came to draw house openings and the other not to. `apps/web/src/lib/render/build-scene.ts`
makes every decision that is about the picture rather than about the paint, once, and leaves the
backends putting down pixels. It is pure: no canvas, no image, no React, so the whole of it is
testable in Node against plain data.

**It has no authority, and that is the load-bearing part.** Every outline on a `RenderScene` came
from `geometryOutline`, every height from `heightFor`. `quantities.ts` cannot see a `RenderPlant`.
Delete `lib/render/` and the plan is dimensionally identical and merely plainer, exactly as
`lib/materials/` already promised.

**One axis, `view: 'plan' | 'visualise'`, not a bag of flags.** Every difference between the two
views moves together and a half-visualised plan is a state nobody wants. Prompt §12's rule is kept
literally: 2D Plan prioritises editability, Visualise prioritises presentation, and switching
between them changes nothing about the design.

**Planting was clipped to its own bed, and that single fact was most of the visual gap.** The
painter drew a bed's plants _inside_ `clip(outline)`, so by construction no plant could cross its
bed's edge, no foliage could spill onto the lawn beside it, nothing could join a height order with
anything outside its own surface, and no plant could shadow anything but its own bed. Beds read as
cut-outs because they were. `render/plants.ts` lifts the placements out of the raster and emits
them as `RenderPlant[]` composited above the ground — the _same_ `samplePlanting` call, seeded the
same way, so plants land exactly where they always did and are simply drawn as things rather than
as texture. Measured coverage went from a scatter on mulch to 93% at mature.

**A plant's identity is `bedId:role:col,row`, and it is stable by construction.** Cells are
indexed from the world origin and every draw is spatially hashed, so editing one bed cannot
reshuffle another. There is a test asserting a neighbouring bed's plants are deep-equal across an
edit, which is the prompt's explicit requirement and was already true — it only needed saying.

**Maturity may scale the crown but must never touch `spread`.** `cellSize` is derived from
`PlantingLayer.spread`, so shrinking it renumbers every world cell and slides the whole bed
sideways as the user drags the slider. The crown multiplier is applied to `placement.spread`
_after_ sampling; density goes in as `share`.

**Thinning is monotone, and that is a property rather than a hope.** In `samplePlanting` the
acceptance draw sits at a _fixed position_ in each cell's sequence and `chance` scales linearly
with `share`, so lowering it can only remove plants: every survivor keeps the identical position,
spread, rotation and variant, because those draws come afterwards. `year-1 ⊆ year-3 ⊆ mature`
positionally, and there is a test on it. A young garden is the mature one with plants taken out,
not a different garden that happens to be sparser.

**`INSTANCE_DENSITY` is a presentation gain and is deliberately not folded into
`PlantingScheme.share`.** Those layers are handed to `samplePlanting` by the _generator_ too, to
place structural shrubs, so moving them would move real `DesignElement`s in generated concepts.
The scheme stays exactly as authored and only the picture changes. Saturating is harmless: the
sampler places at most one unit per cell.

**Both views instance their planting now — _this reverses_ "instanced mode is Visualise's".** A bed
painted inside `clip(outline)` is a cut-out by construction, and that clip was the largest single
reason the 2D Plan read as a diagram: no plant crossed its own edge, nothing spilled onto the lawn,
every border ended in a line no garden has. It was never what made the plan *measurable* — the
outline is still the geometry of record and still what selection, handles, dimensions and the
schedule use. Only the picture overhangs, exactly as a tree canopy always has.

**Which camera the planting draws from is passed down, never inferred.** `chooseAsset` resolves a
family in the plan camera and *then* swaps it for its elevated twin, so instancing the plan view
without saying which camera it is drawing to is precisely how `vis-*` art shipped into the 2D Plan
once before. `buildPlants` takes an `AssetCamera`; `audit:assets` fails on any leak.

**The plan view's `stack` holds its plants and nothing else.** The v2 renderer draws standing
things from the stack rather than from `scene.plants`, so a plan with an empty stack had no
planting under Pixi while the composer had it. `plantNodes` is what both views' stacks start from;
`buildStack` — which is where lift, extrusion, skins and the roof come from — is still called for
Visualise only, so none of that can reach the plan by a later edit to a flag. The test asserts
every node in a plan stack is a plant, rather than asserting the stack is empty.

**The planting was measured before it was tuned, and the numbers are the argument.**
`measure:render` counts the scene rather than the pixels — plants per m² of bed, mean drawn
diameter, the share under half a metre, sampled cover and canopy share — because a bed can match
the reference's saturation exactly and still read as a carpet of dots. It reported **8 to 15 plants
per m²** against a designed border's 5 to 7, with **71 to 83% of them under half a metre** and 14
to 30% bare ground. Too many, too small, and still not covering.

`INSTANCE_DENSITY` went 1.25 → **0.8** and a new `CROWN_FILL` of **1.45** multiplies the drawn
spread only, after the clamp and never `cellSize` — so the world grid, every plant's identity and
the `year-1 ⊆ mature` nesting are untouched while the gaps close. The bands in `SCHEMES` are
nursery sizes read as real plants (a mass perennial at 0.4–0.7 m is a pot; the geranium it stands
for is 0.6–1.0 m in its third year), and the garden this app draws is the mature one. Measured
after: **5.4 to 9.7 per m², mean 0.64–0.81 m, 6 to 25% under half a metre.** Cover goes as
`1 − exp(−λ·area)`, which is why fewer plants cover more.

**Every bed gets a shrub storey, because almost none of them had one.** `understoreyLayer` is the
render-only backdrop the generator cannot supply: `STRUCTURAL_ROLES` takes `backdrop` and
`specimen` out of the drawn stack because those are emitted as real elements, but there are at most
thirty of those in a whole plan and two of the six schemes — including `naturalistic`, the default
— declare neither role at all. Sized as a shrub actually is (1–1.8 m across, 0.9–1.9 m tall) rather
than as the largest perennial.

**A mature border closes, and the coverage band says so.** _This reverses_ the 70–95% band, which
was calibrated when the drawn plants were 0.45 m: reaching 95% then would have taken fifteen plants
per square metre, so the ceiling was really a cap on density. The old ceiling's argument — that
without gaps the planting reads as a flat mat — was right about the risk and wrong about the
remedy. What makes plants legible is that they *differ in size*, which is the metric that moved
from 80% to 20% under half a metre in the same change. Bare soil is not doing that work. The
first-year band is what still protects "visibly open".

**The mass LOD band ends where the plan zoom begins.** It ran 40 → 24 px/m, which put the ordinary
editing zoom of 32 exactly half way: every low plant drawn at half opacity *and* its mass blob at
half opacity, one over the other. Two representations of the same plants ghosted together is not a
transition — it is the mush that reads as noise at the zoom people work at. 32 → 24 now.

**A mat gets no contact disc.** `MIN_CONTACT_SHADOW_HEIGHT` is 0.55 m. A contact shadow says "this
stands up off the ground", and in a border at these densities the discs overlapped two and a half
times over — and since the layer is flattened and composited once, the bed did not get shadows, it
got a **flat 28% blue-grey wash**, which is most of why planting read as grey-purple whatever the
palette said. A spreading ground-cover mat *is* the ground there and has nothing standing off it.

**`#8d7a99` is gone from the `mixed-border` palette.** A desaturated mauve standing for the flower
colour a border has — one entry of five, so a fifth of every blob, every low-zoom mass and every
tinted sprite came out purple-grey, and at a distance a bed read as lavender gravel. A border is
mostly foliage; the flowers in it are accents drawn as flowers.

**`maturity` is a view preference in `ephemeralState()`, beside `gridVisible`** — same five edit
points, same trap. It changes how the picture is drawn and nothing about the design: no geometry
moves, no area changes, and the schedule cannot see it.

**The roof is derived, never stored, and never overhangs.** There is no roof form, pitch or storey
count anywhere in `PlanDocument` and none was added. `roofFor` reads the footprint: a hipped roof
is the outline and its own `insetPolygon` by half the span, the planes are the quads between them,
and gable-versus-hipped is the aspect ratio. `insetPolygon` returning `null` _is_ the flat roof, so
the degenerate case answers itself. **No eaves overhang**, deliberately: it would look slightly
better and would put drawn geometry outside the outline `houseFitsInside` measures, and a
presentation flourish that can make a legal house look illegal is not worth a millimetre of
shading. Note the ridge ring must be filled as a cap — held short of the true half-span so it stays
a line, it leaves a sliver no slope covers, and unfilled the roof reads as a frame.

**Both views draw a roof now, and _this reverses_ "only Visualise gets one".** The old rule was
protecting step 1, where a building the user is *positioning* has to read as the footprint they are
positioning — and it still does, because step 1 draws through its own Konva canvas and never calls
`buildRenderScene`. What it was also doing, unintentionally, was leaving every concept card, every
export and every judging sheet with a flat pale rectangle where the house is: the eye parses that as
another paved surface, so the drawing loses the one object that gives the garden its scale and its
orientation. **The overhang is the part that may not travel**, and it does not: the plan's roof is
drawn strictly within `housePolygon`, so nothing measurable changes. `build-scene.test.ts` states
that as the property — the plan's eaves *are* the wall line, Visualise's are outside it — rather
than asserting "the plan has no roof", which would pass on a build that had quietly stopped drawing
one.

**A roof hides the door, so the ground outside is marked instead.** No openings over a roof is
still right — from directly above you cannot see the doors beneath one — but the door is the single
most layout-determining object in a garden drawing: it is what the terrace is laid across and what
every path starts from. `drawThresholds` puts a short bar with its swing on the garden just outside
the wall, ground-floor doors only. A window is not a way out and an upstairs opening is not one
either, so neither gets a mark; a bar under every window would draw a dozen thresholds on a house
with one door and say nothing about where the terrace goes.

**`HouseFootprint.roofMaterial` is asked, not guessed.** Unlike the roof's *shape*, which the
footprint genuinely constrains, the covering is derivable from nothing — a guess would be inventing
a fact about somebody's house, which is the trap `site.location` exists to avoid. Three answers,
because at 1:100 there are three, offered as swatches in the house panel. An addition with a
default, so no migration and no version bump, and **nothing measures it**: it reaches the roof
painter and stops.

**`ROOF_SKINS` and `skin-roof-slate` are read at last**, tiled in each plane's *own* frame rather
than in screen space — a slate is 300 mm on every roof of every house at every rotation, and tiling
in screen space runs the courses across the drawing instead of along the eaves. The procedural
courses stay as the answer where nothing has loaded, which is every environment with no asset
library, including the golden tests. `skin-roof-felt` is the one that is still unread: it was
consumed the same way, looked at and reverted, because the family is quoted at 1.5 m and a whole
shed roof is two tiles by two — what reads is not felt but a dark slab quartered by its own seams.
A photograph earns its place where it is small against the thing it covers; where it is not,
geometry wins.

**A rooflight is drawn as glass, which means *light*.** The pane is paler than the covering and the
frame darker, because glass seen from above is the sky. The first version had it the other way
round on the reasoning that a window is a dark opening — true of a wall, false of a roof, and what
it actually drew was two holes punched through the building. One per plane over 30 m², so a hip end
and every plane of a small outrigger get none: the convention shows up where a roof is broad enough
for the eye to want something on it and nowhere else.

## PixiJS, and where it earns its place

**Pixi is a compositor, not a second painter.** Every surface it draws is a raster the existing
Canvas2D painter produced, through the same `getSurfacePattern` cache the Konva canvas uses,
uploaded as a texture. The two thousand lines of slab, board, scatter, hedge and water painting are
reused unchanged, so there is no second implementation of a material to drift from the first. That
is what keeps `render/pixi/renderer.ts` small.

**What WebGL is actually for here is the plant sprites.** A mature garden is a few thousand of
them and Visualise is a view you pan, zoom and drag a maturity slider through; Pixi batches
same-texture sprites so the count stops mattering. A one-shot still never needed this.

**Visualise is two canvases, and the split is a division of labour rather than a compromise.**
WebGL underneath for the ground, the shadow layer and the planting; a 2D canvas over it for the
objects, the house and the fence, drawn by `drawOverlay` — the same function `drawScene` calls.
Pixi earns nothing on the twenty-odd pergolas, benches and trees on a plan, and writing those a
second time in WebGL would mean two sets of drawing rules that can disagree. Both canvases draw
from one scene and one transform.

**Determinism lives in the scene because Pixi cannot be pixel-tested.** Pixi v8 has no supported
Node backend (`@pixi/node` died with v7), and the whole renderer suite runs through
`@napi-rs/canvas` in Node. So nothing in `render/pixi/` runs under Vitest, and that is handled
rather than ignored: `buildRenderScene` is pure and asserted on its own, the Canvas2D backend stays
the reference for the judging sheets, and the WebGL backend is left with nothing to be wrong about
except paint. Do not try to make the Pixi output byte-testable; make the scene testable instead.

**Three Pixi traps, and all three present identically: "this browser has no WebGL".** That shared
symptom is the thing to know. A dead WebGL context reports "Could not retrieve shader source",
`getProgramInfoLog() null` and every vertex attribute missing, whatever actually killed it — so
the error says nothing about the cause, and the first two below only happen in development, which
makes them look like a bundler problem. They are not. Pixi bundles fine under both Turbopack and
webpack, and no alias or transpile setting is needed; if you find yourself editing
`next.config.ts` to fix a blank Visualise, the cause is on this list instead.

- **The canvas is created in the mount effect, not rendered in JSX.** A canvas hands out one
  drawing context for its lifetime. React deliberately mounts, cleans up and mounts again in
  development, so a JSX-owned canvas is handed to a second Pixi `Application` after the first has
  destroyed its context. A fresh element per mount removes the question entirely. **This is the
  one that cost the most**, because it looks exactly like Turbopack mangling the GLSL — it
  reproduces under `next dev` and not under `next build`, which is a bundler-shaped fingerprint
  for a lifecycle-shaped bug.
- **`app.destroy({ removeView: false })`.** Pixi's default removes the canvas from the DOM. Even
  with the canvas created imperatively it is ours to remove, and removing it from under React's
  wrapper on the first of a double mount leaves the second drawing into nothing.
- **Never init at zero size.** A context created at 0 x 0 comes up and then fails the same way.
  The wrapper is waited for. The usual cause is a parent that is a block rather than a flex
  container, so `flex-1` resolves to no height at all.

**The two layers take their viewport from one measurement, and it must be CSS pixels.** The WebGL
canvas and the 2D overlay drawn over it each centre the view on `view.centre`, so they have to
agree about where the middle of the viewport is. Deriving it inside the Pixi backend as
`renderer.width / renderer.resolution` is a guess about which of the two Pixi's `width` already
is — and **the guess only shows on a display where they differ**. On a 1x screen the layers line
up perfectly; on a 2x one the ground and planting sit a fraction of the viewport up and left of
the fence, house and trees, and the garden appears twice, in two halves. Both now measure the same
wrapper element and are handed the same `ViewSize`, so they cannot disagree whatever the device
pixel ratio is. The lesson generalises: **anything that depends on device pixel ratio has to be
tested at a ratio other than 1**, because 1 is the value that hides the bug, and it is the value a
headless browser uses by default.

**One mask, redrawn — never a fresh `Graphics` per render.** Assigning a new mask leaves the
previous one behind as an ordinary child of `world`, and a mask is an opaque filled polygon, so
from the second render onwards the garden is covered by a white rectangle the size of the plot.
Unlike the three above this one draws happily; it just draws a white rectangle, and it appears on
the _second_ render, so it shows up when a control is touched rather than on arrival.

## Visualise is elevated: the projection, the stack, and the second asset camera

**Visualise draws an oblique elevated projection, and the whole of it is one number.** `RISE` in
`lib/render/camera.ts` is `tan(12°)`: a point `h` metres above the ground is drawn `h × RISE` metres
**up the screen**, and nothing else changes. The ground plane stays unforeshortened, every footprint
stays its true shape, and switching the view off removes the offset and leaves the plan. There is no
camera position, no vanishing point and no depth buffer.

Isometric and perspective were both rejected for the same reason: they rotate or distort the ground
plane, and the application rests on what you see being the footprint the validator measured. Under
perspective a footprint is a trapezium no rect can hold, and every placement, selection and
dimension in the editor would need a second coordinate system to answer in.

**Twelve degrees is a constant and not a control, because the assets are photographed at it.** The
elevated sprite library's prompt says "tilted twelve degrees from vertical" in words
(`docs/visualise-asset-style.md`, the `ELEVATED` preamble in `asset-spec.ts`). A slider would put the
drawn geometry at an angle the photographs do not share, so a shed would stand at a different
attitude from the sofa beside it. `camera.ts` holds the angle alone and imports nothing — `projection.ts`
re-exports it — because `asset-spec.ts` needs it too and is read by `tools/assets`, a package that
cannot resolve `@garden-studio/schema`. Same reason `zone-id.ts` is a leaf.

**Built things are extruded; placed things are photographed.** `extrude(outline, height, light)`
returns the top ring and the faces whose outward normal points down the screen, sorted far to near.
The criterion for which model a thing gets is not "is it big" but **is its shape arbitrary**: a shed
is whatever rectangle the placer gave it at whatever angle, so no photograph fits it, and its faces
are recomputed from its own outline every render — correct at every rotation by construction. A
dining set is a known object of a known size that a sprite can be fitted inside. `isBuilt` is that
line, and it is `category === 'structure'`.

**The lift is a rigid translation, so the plan drawing *is* the top of the elevated drawing.** Raise
the walls, translate the context up by `liftPx(height)`, then call exactly what the flat view calls.
A shed's two roof slopes, a gazebo's four hips, a pergola's beams, a retaining wall's top course and
the whole of `drawHouse` are drawn by the code that already draws them. **No symbol needed a second
version**, which is the entire reason this was a small change rather than a second renderer.

**`RenderScene.stack` is one depth-sorted list, and it is empty in the plan view.** Sorted
`(group, depth, layer, id)`, and the order of those keys is the design. Sorting by layer — ground
cover, perennials, shrubs, trees, as the flat view stacks a bed — puts every tree in front of every
shrub regardless of where the two stand, so a shrub at the front of a border draws *behind* a tree at
the back of it and the picture reads as a collage. Depth is the furthest-down-screen point of the
thing's own **footprint**, never its visual extent: what decides whether a tree is in front of a shed
is where the two stand, not how far the canopy reaches. Layer is the tiebreak and earns its place
there, because a generated plan aligns things constantly. `id` last makes the sort total.

**Lighting is the one thing not depth-sorted**, kept last for the reason already in `LAYER_ORDER`: a
spike light is 120 mm and the ones that matter most are uplighting a tree, so honest depth-sorting
would bury every one of them under the thing it lights.

**A boundary run takes the depth of its *furthest* point — the only thing in the stack that does.**
A side fence spans the whole plot, so on `depthOf` it sorts after everything and lays a line over the
border planted against it, which is exactly backwards. Taking the far end says the honest thing about
an object drawn as one piece: it reaches back to here, so everything nearer is in front of it. The
exact answer is to split each run into segments and sort each; it is not worth a dozen anti-aliased
seams down every fence.

**A wall running up and down the screen shows no face at all, and that is the price of the
projection rather than a bug.** Its normal has no y component, so a lift straight up the screen shows
neither of its long sides — only the end cap, a hundred millimetres wide. It reads as having height
through its posts, its shade band (`fenceShadeBands`, drawn first in the visualise branch for exactly
this reason) and, most of all, the shadow it casts. The alternative is leaning the lift diagonally,
which shows every wall and gives up the property everything here rests on.

**`HOUSE_WALL_TONE` is not `COLOUR.houseWall`.** That one is the dark slate the flat diagram strokes
its wall band in, which works when the band is two pixels. As a metre and a quarter of solid colour
under a slate roof the two read as one dark mass and the roof simply looks blurry at the bottom. A
warm off-white render instead, the same material `skin-render` is written for. The house is the one
thing in the garden with no `material`, so unlike every other face its tone has to be stated.

**The visible cost, accepted: a six-metre house hides 1.27 m of the garden behind it.** That is what
an elevated view of a building does, and the strip it hides is the one a photograph would hide too.

**Pixi still composites; the split moved.** Plants are batched WebGL sprites — thousands of them,
which is the load Pixi is there for. Everything else in the stack is **a raster the composer
painted**, cached per node per √2 zoom bucket per light per asset version, uploaded once. There are
tens of those, so batching would buy nothing and a WebGL shed would be a second implementation to
drift. Both go into one container in stack order, so a plant genuinely can be drawn in front of a
fence. A pan changes no key and costs no repaints.

**`drawOverlay` branches on the view, and in Visualise it draws only the stack, the access marks and
the night wash.** The objects/house/fence pass order is kept verbatim for the plan view. Plants are
drawn in `drawScene` only when the view is not visualise, or they would be drawn twice.

**Logical footprint versus visual bounds.** `RenderNode.bounds` is the footprint *and* the height
above it plus a margin — what has to be repainted, cached and uploaded. The footprint is what every
measurement, validation and schedule line is about. Nothing derived from `bounds` may reach
`houseFitsInside`, `geometryIsLegal` or `quantities.ts`.

**There are two asset cameras, and `assetsMatching` defaults to `plan`.** `AssetFamily.camera` is
absent on every family generated before this, so every existing query returns exactly what it
returned — which is what let the elevated library be appended without touching a call site. A query
cannot ask for "either": a caller that does not care which camera it gets is about to mix them in one
picture.

**Visualise resolves the plan sprite first and then swaps in its twin (`ELEVATED_TWINS`), rather than
running a second query.** A query is answered in manifest order and the sampler indexes into it with
a seeded generator, so two queries of different lengths put a *different plant* in each cell: the
same garden would be planted differently in the two views, and switching tabs would look like the
design had changed. Resolving once in the plan camera and translating keeps the cell, the species and
the variant, and gives the per-family fallback for free — a twin with no generated files keeps its
plan sprite, so a half-finished library and **no library at all** both draw.

**`elevatedTwin` keys on the catalogue, not the registry**: what has been generated, not what has
finished loading. Loading is asynchronous and per-wave, so keying on it would have a bed swap species
halfway through a preload.

**The camera separation held at every level except the one that mattered, and the 2D Plan shipped a
commit drawing the elevated library.** `EditorCanvas` built its scene with `view: 'visualise'`, and
that canvas is what renders when the tab is `plan` — so the flat diagram was drawn with `vis-*`
sprites, `skin-*` faces and the oblique lifted stack, and because Konva's own drawing is suppressed
once `richReady` flips, that was every visible pixel. **Every test passed**, and that is the whole
lesson: `assetsMatching` defaulted correctly, `buildPlants` ran only when instanced, `stack` was
empty outside Visualise, and each of those was pinned. None of them can see a caller asking for the
wrong camera. A guarantee that holds only while one call site passes the right string is not a
guarantee.

Three things came out of it, and the second is the one worth copying:

- **The test states the property, not the mechanism.** `build-scene.test.ts` asserts that a plan
  scene contains no elevated `assetId` *and* an empty `stack` — with a **control** asserting the same
  garden in Visualise does draw elevated art, because otherwise the test passes just as happily on a
  broken twin table or an empty catalogue.
- **The call site's answer is visible from outside.** `EditorScene` exposes `data-view`, and
  `visualise.spec.ts` asserts the Plan tab's scene is `plan`. Nothing below the call site could ever
  have caught this, so the assertion has to live above it — in a browser, which is where this class
  of bug already lives (see the Konva hit-testing note).
- **`audit:assets` asks the question in both directions.** It had `planCameraPlanting` — is Visualise
  still drawing flat art, a gap that degrades gracefully — and nothing asking whether the plan is
  drawing elevated art, which is not a gap but a wrong drawing. `elevatedInPlan` is on the one line
  the console prints, because a wrong camera is invisible unless something says so out loud.

**The corroborating half of that test went stale, and nothing noticed for a phase.** It asserted
`data-plants` was 0 on the plan scene, on the reasoning that planting is lifted out of the beds only
in Visualise — true when it was written and false the moment the planting rework instanced both
views, which is the change that stops the 2D Plan's beds reading as cut-outs. The browser suite is
not part of `pnpm test`, so it went a whole phase without being run. What is still true of the plan
camera and only of it is that its stack is **plants and nothing else**: `buildStack` is not called
on that path, so `data-stack` equals `data-plants` there and does not in Visualise. **Run
`pnpm exec playwright test` after anything that touches the scene**, not only after touching Pixi.

**The same divergence was one layer down in the shadows.** The composer softens a cast shadow only
in Visualise (`view === 'visualise' ? PRESENTATION_SHADOW_SOFTNESS : 0`) and both Pixi backends
hardcoded the soft value — so a plan's shadows were soft on screen and hard in the PNG. Soft is a
presentation choice; a diagram draws the edge. Worth knowing that the export disagreeing with the
screen is the *symptom* both faults shared, and the cheapest thing to check after touching either.

**The library is sorted by camera on disk: `public/assets/{plan,elevated}/{sprites,textures}`.**
_This reverses_ `docs/visualise-asset-style.md` §10, which made the `vis-`/`skin-` prefix the only
marker so that no second place had to be kept in step — right at a handful of files, wrong at 181
across two cameras. `assetFile` is the single place layout is decided and the generator **derives**
its output directories from that function rather than restating them. Be clear about what this does
not buy: nothing resolves an asset by path, so it cannot prevent the fault above. It buys a listing
that answers the question, and a `plan/` that can be preloaded on its own.

**An elevated asset's frame is derived, never declared.** `elevatedFrame` is
`{ w: metres.w, h: metres.h + heightMetres × RISE }`, and the bottom `metres.h` of the image is the
footprint in true plan. `elevatedAnchor` is the middle of that band, which is where the thing
actually stands — a plan sprite *is* its footprint so its anchor is the image centre, and assuming
the same here would float every object half its own height off the ground. A test pins `sizePx`
against the implied aspect, because a family whose declared size disagrees is padded to one aspect
and drawn at another.

**Elevated art is never `recolourable`.** The tint is a proportional multiply and these carry their
own light, so it would darken them exactly where they are already shaded. The plan families were
written flat and neutral *so that* they could be tinted; this is the opposite bargain, and variety
comes from the variant instead.

**Shadows are a hybrid, and it is the only split that survives rotation and a real sun.** The image
model bakes **self-shading only**; cast shadows stay procedural, world-space and height-aware. A
baked ground shadow rotates with the object and is fixed at one hour, so it would point the wrong way
the moment either changed. The accepted cost is that a sun in the south-east still meets art lit from
the upper left, which at this contrast reads as ambient rather than as a contradiction.

**A skin is the one elevated family lit flat.** A skin goes on a face whose brightness the renderer
computes from that face's own normal, exactly as the roof planes already are; baked light would be
light applied twice, and the two would disagree as soon as the sun moved.

**The foot band is a drawing convention in the contact-shadow class.** It earns its place most on the
faces the camera *cannot* see: without a mark where it meets the ground, an edge-on wall appears to
hover.

**`--strict` refuses an asset the QA pass complains about; the raw PNG is always kept.** Most of the
checks are judgements a number gets *mostly* right — a wide low planter legitimately has a broad
foot — so a tool that refused them by default would have the author tuning thresholds instead of
looking at pictures. `footAlpha` is the ground-plane detector: an object's own feet are a few percent
of the bottom edge and a baked patch of grass is most of it. `--audit` answers the question
`provenance.promptHash` was recorded for and nothing could ask until now: which files no longer match
the sentence that specifies them.

**A dry run writes nothing, including the catalogue.** It used to rewrite `generatedAt` every time,
which left the tree dirty for a command whose whole point is that it does nothing.

### Making a building read as a building

**A roof oversails its walls, in Visualise only, and that reverses an earlier refusal without
contradicting it.** The old note is still right about the *plan* drawing, where the roof is the
house's drawn extent and an overhang would put geometry outside the outline `houseFitsInside`
measures. In the elevated view the roof is already drawn a metre and a quarter up the screen, so the
question is no longer whether drawn geometry may leave the outline — it left by a factor of four —
but whether the building reads as one. `roofFor` takes an `overhang` defaulting to 0; only the
visualise branch passes `EAVES_OVERHANG`, and a garden building gets the smaller
`STRUCTURE_OVERHANG`. **Nothing derived from either may reach a measurement**, and nothing can.

**`insetPolygon` was generalised rather than copied.** It refused a negative distance, and the
offset maths — the winding probe, the corner intersections, the fold-through refusal — is subtle
enough that a second copy would be a second thing to get wrong. There is now a shared
`offsetPolygon` with `insetPolygon` and `outsetPolygon` over it, both keeping their old contracts.
**Reversing the ring does not outset**: it flips the winding *and* the edge direction, so the two
sign flips cancel and you get the inset back. That was the first attempt and it silently shrank the
roof.

**The eaves shade is a sliver drawn after the roof, never a copy of the roof drawn before it.** The
first version filled the whole roof outline offset down the screen and relied on the roof covering
it. That works for the house, whose roof is opaque, and fails completely for a shed, whose roof is
washed over its boards at `ROOF_ALPHA` on purpose — the shadow showed straight through and laid a
grey sheet over the whole building. Drawing the band explicitly on the edges `visibleEdges` returns
depends on nothing being opaque, which is the only version right for both.

**A garden building's boarding is drawn to the roof line, not to the footprint.** Same cause, second
symptom: grow the roof and the oversailing rim has no boards under it, so the translucent wash
composites over the grass and the shed comes out with a grey frame instead of eaves. Drawing the
boards to the eaves is also the truthful picture — what you see from above *is* the roof's own
boarding. The anchor and seed stay the element's, so the grain is continuous and deterministic, and
the footprint the validator checks is untouched because nothing reads this.

**Doors and windows are drawn on the wall faces the camera can see**, from the document's own
`sillHeight`, `floorLevel` and `OPENING_HEIGHTS`. Only where `normal.y > 0`: a wall facing away is
the back of the building, and drawing its glazing on the near side is the class of mistake that
makes a drawing quietly untrustworthy. **A frame inset by the same width in both directions is
invisible** — a metre *up* the wall is `RISE` metres of screen, so a 90 mm section inset by 90 mm of
height lands at a fifth of a pixel. The vertical inset is divided by `RISE` to ask for 90 mm *as
seen*. Note the consequence: the garden-facing wall of a house at the top of the plot is visible and
the one at the bottom is not, which is true of the reference photograph too.

**`PatternContext` grew a `transform`, and it is the one thing translate and rotate cannot do.** A
vertical face is a **parallelogram**: its base runs along the wall at the wall's own angle and its
height runs straight up the screen whatever that angle is. Those axes are not perpendicular, so the
frame has to be given as a matrix. Inside it one unit is one metre along the wall and one metre up
it, so a 120 mm board is 120 mm on every wall of every building at every rotation — tiling in screen
space instead runs the boards across the drawing rather than along the wall. Widening the interface
is safe on the grounds `strokeStyle` already established.

**A face's skin comes from what the renderer already knows, not from a new table.** A boundary has a
`BoundaryKind`, a retaining wall and a building have a material the user chose, and only the house —
which is not an element and has no material — needs a named default. So a shed the user made of
painted timber shows painted boards rather than a generic fence skin. `null` is the ordinary answer
and means the flat tone everything drew before.

**A building is lifted by at most one storey, and the shadow is not.** A two-storey house lifts its
roof 1.27 m up the screen, and every square metre of garden in that strip disappears underneath it —
on the reference fixture, the near half of a dining set. The projection is not wrong to do it; a real
aerial from the south hides the ground immediately north of a house the same way. But a garden plan
is a drawing of the *garden*, so `MAX_DRAWN_LIFT` caps it at 3 m. That number is measured off the
reference rather than chosen: the wall band there is about 7% of the roof's depth, which on a
nine-metre house is 0.63 m, and `3 × RISE` is 0.64 m. **`shadowOccluders` still reads `houseHeight`**,
so a two-storey house throws a two-storey shadow — how far a building shades its own garden is a
fact about the site, not a drawing convention.

**`footAlpha` is recorded, not judged, and that cost three false failures.** A high value means the
object is as wide where it meets the ground as its frame is — a ground plane for a sofa, and simply
the truth for a planter, a raised bed or a trampoline, each of which *is* a box or a disc. What
actually marks a baked ground is that it **spreads**: it reaches out past the object standing on it,
where legs and a pot's base never do. `spreadsAtTheFoot` compares the bottom band against a band
through the body and is blind to how wide the object happens to be. The same mistake was in the
audit script and in `catalogue.test.ts`; the rule now is that **pixel judgements live in the tool,
where the pixels are**, and the catalogue-level checks only ask whether the library still agrees
with the manifest.

**`--reprocess` never calls the model, and it used to.** The flag reads as "spend nothing", and it
re-ran the post-processing over existing raws — but a family with *no* raw fell through to
generation, so `--only vis- --reprocess` to re-measure a handful of finished assets quietly bought
every ungenerated family under that prefix. Found the expensive way. It now skips them.

**A flight of steps is the one standing thing that is not a prism.** Raised like everything else it
comes out a solid block the height of its top step, which hides that it is a flight at all — and the
whole reason a flight is in the plan is to *resolve* a level change, so drawing it as a block draws
the problem instead of the answer. `drawFlight` divides it into `risers` bands along its depth, band
`i` from the terrace sitting at `elevation × (risers − i) / risers`: the first band is flush with the
terrace and the step from the last band to the ground is the final riser, so `risers` bands give
`risers` risers. Every number comes from `stepFlight`, which is what the level change itself is
derived from. **The terrace end is the `−depth/2` end** — a convention `stepsFromTerrace` sets when
it places the flight beyond the terrace with the frame's own bearing, and which `stepNosings` already
counts from. Each band's tread is the flight's own surface raster clipped and lifted, so the paving
runs continuously up the steps instead of restarting on each one.

**Edging stands proud, and `EDGING_HEIGHTS` is exposed height rather than product height.** A kerb is
a 250 mm unit with half of it bedded; a steel edging is a 100 mm blade showing 50 mm. Quoting the
product would raise a kerb twice as far as one stands. It lives beside `MATERIAL_HEIGHTS` rather than
in it for the same reason `EDGING_MATERIALS` sits outside `MATERIALS` — edging is not an element and
has no category. In Visualise a course is an extrusion in the stack; in plan it stays the flat band
it always was. Small (50–200 mm, so a pixel or two) and worth it: a kerb with no side is a painted
stripe, and standing slightly proud of what it edges is the one thing a kerb is for.

**Nothing in the eleven fixtures has a level change, so `12-levels` is synthesised.** The generator
raises a terrace only on a formal or modern brief at a high budget and no fixture lands there, which
is exactly how levels, steps and walling came to be the last things nobody had looked at. The sheet
makes an ordinary edit to a real plan — `elevation`, `retaining`, and a `steps` element — rather than
re-capturing fixtures and changing every other sheet. Getting the flight's rotation backwards puts it
under the house, which is the quickest way to notice the convention above.

**A plant whose scheme role is `edge` has an id beginning `bed:edge:`, and so does an edging course.**
They never collide (a plant's always carries a `col,row`), but filtering a stack by `id.includes(':edge:')`
catches both — which is how a test for edging heights came to be reading planting. Filter on
`source.of` instead.

**`visibleEdges` is the one place the "which side faces the viewer" rule lives.** `extrude` builds
its faces from it and the eaves shade draws its bands from it. Two copies of that winding probe is
exactly how the walls and the shadow on them would come to disagree about which side of a building
is the front.

## Asset Library v2: one specification, composed prompts, a recorded lineage

**Every prompt is composed; no family carries one.** `asset-style.ts` holds the versioned visual
specification — `ASSET_SPEC_VERSION`, the two camera preambles, one template per kind of subject,
the global exclusions and the tint clause — and `composePrompt(family, variant)` is the only place
they meet. A family in `asset-spec.ts` names its `template`, writes its `subject` and, where the
variants are different things, lists `variantSubjects`. The tool, `elevated.test.ts` and
`asset-style.test.ts` all call the same function, so what is sent is what is tested. The old shape
baked the preamble into each family's `prompt` string, which is how the plan camera and the elevated
camera came to be written at different times to different standards, and how a regex reading the
variant list out of prose fell through for fifteen families and sent every variant the same
sentence.

**The subject must not restate the template.** A test refuses "transparent background", "degrees",
"cast shadow" and "watermark" in any subject: a subject that names the background or the light can
only ever disagree with the camera it is composed onto.

**Bump `ASSET_SPEC_VERSION` when a template's *meaning* changes**, never for a reworded subject —
`promptHash` catches that on its own. The catalogue records the version beside every generated
file, so an audit can say "drawn to 1.x" rather than only "something moved". A test holds
`docs/visualise-asset-style.md` to the same number.

**The catalogue has two records per file and they mean different things.** `generation` is written
only when a model is called — model, quality, the size actually requested and returned, spec
version, prompt hash, a digest of the raw — and `--reprocess` carries it forward untouched, because
the pixels are still the ones it describes whatever prompt is current. `processed` is rewritten on
every pass: post-process version, the QA pass's `warnings` and `defects`, any baked `correction`.
`--reprocess` used to restamp every entry with today's model and today's prompt hash, which erased
the one question the record exists to answer. The 48 files kept from the first library (faces,
tiles, skins, effects) still carry only the older `provenance`; they are byte-identical to what
their prompts say and predate the version.

**A defect is refused; a warning is recorded.** `--strict` refuses an opaque background, a cropped
object or one that would float above its footprint, and ships one with a halo or a broad foot while
writing the warning into the catalogue. One flat list left `--strict` choosing between refusing
every judgement and refusing nothing, which is why it was off.

**The model is a setting, dated.** `--model`, else `ASSET_IMAGE_MODEL`, else
`DEFAULT_MODEL = 'gpt-image-2.5-sunburst-2026-09-08'` — a snapshot so a regeneration a year on asks
the same model. `gpt-image-2` and later accept any size with both sides a multiple of 16 inside 3:1,
so the frame is requested at its own aspect with the long edge in 1024–2048 px and downsampled;
older models get the three presets. `--only` takes a prefix, a family, or one file by stem
(`plant-shrub-3`) for re-rolling a single bad variant.

**The model has a minimum pixel budget as well as a maximum, and a dropped connection is as
ordinary as a 429.** The first full run lost forty of a hundred and fifty pictures to two things
the provider did not handle: every narrow family (a lounger at 512×1024, a bench at 1024×384) came
back `400 Requested resolution is below the current minimum pixel budget`, and `fetch failed` was
thrown straight through after hanging for minutes, because the retry loop looked only at status
codes. `customSizeFor` now scales any request up to a megapixel at its own aspect, and a network
error is retried with the same backoff under a three-minute timeout. Re-roll what a run lost by
stem — `--force --strict --only vis-lounger-2` — rather than by prefix, or the pictures that
succeeded are bought again.

**Corrections at source live on `correction`, draw-time policy on `render`, and they must not both
say the same thing.** `render.saturation` is multiplied in by the renderer at every draw;
`correction.saturation` is baked into the file by `processTexture` from the raw and applied exactly
once however many surfaces overlap. Play bark moved from the first to the second. `render` also
replaced the renderer's hard-coded set of eight turnable texture ids: a policy about a family
belongs on the family.

**Regenerate in place; append, never insert or remove.** Every plan-camera family keeps its id and
its position, so `assetsMatching` keeps its length and order and no saved bed changes species. The
two shrub twins added are elevated, reached only through `ELEVATED_TWINS`, so they sit beside their
kin. `public/assets-v1/` (gitignored) is a copy taken before the first regeneration: the same
catalogue path under two roots is what `/asset-lab` compares.

**`/asset-lab` is where thirty assets are judged together.** Development only, like `/render-lab`.
A lineup of every family at one scale on one real ground, drawn with `elevatedFrame`,
`assetAnchor` and the contact-shadow constants rather than a fit of its own; per-family scale
ladder, rotation and variants; every file with its record and the v1 picture beside it; and a
fixture scene through the Canvas2D compositor. **The lineup effect has to depend on the image
version, not the image map** — the map is one object for the life of the page, and keyed on it
alone the canvas draws once before anything has decoded. Found on the first screenshot.

**Measured, after the 17–19 Sep 2026 regeneration** (155 files on `gpt-image-2.5-sunburst`, trees
at high and the rest at medium, in three waves plus a forty-file re-roll): the tool audit reports
nothing missing, stale or defective; `audit:assets` reports zero failures and five halo warnings on
pale objects; `measure:render`'s per-group saturation went tree 0.514 → 0.364, play 0.509 → 0.308,
plant 0.383 → 0.288, hedge 0.495 → 0.443, elevated 0.334 → 0.287, library mean 0.338 → 0.277 —
the outliers are gone and the whole library now sits a little *under* the traced target's 0.334,
which is the restrained side of the specification and the right side to err on. **The golden
images did not change**, because `render-plan.golden.test.ts` deliberately draws with no assets;
the sheets in `.plan-preview/` are where a regeneration is judged, against the copy in
`.plan-preview-baseline/`.

**`audit:assets` exits non-zero.** Missing files, orphan and duplicate entries, incomplete families,
a file whose pixels disagree with the catalogue, a shipped defect or elevated art in the 2D Plan
are failures; framing warnings are printed. It used to print everything and exit zero, so nothing
it found could stop a commit. `tools/assets --audit` adds the one question only the composer can
answer — which files were drawn from a prompt that has since changed — and exits non-zero too.

## Materials: idempotence, and why it matters

**A tint over a finished surface is not idempotent, and surfaces of one material overlap.**
`computeZones` gives a garden one base lawn per zone and an accent lawn is drawn over one of them
— a measured quarter of the suburban fixture's lawn is covered twice. While the palette was
multiplied over the _outline_ rather than into the tile, that second draw tinted again and the
overlap showed as hard-edged blocks of darker green across one continuous lawn. `tintTexture`
bakes it into the tile instead: the tile is opaque, so drawing it twice writes the same pixels.
There is a test that stacks two lawns and demands zero differing pixels. **Any new surface
treatment has to be idempotent or baked** — this is the second time the lesson has been paid for,
after `tintSprites`.

**Texture variants are chosen from the world cell, for the same reason.** A 1.5 m turf tile across
a 60 m² lawn is forty copies of one photograph and the eye finds the grid immediately. Choosing per
tile from several variants breaks it with no overlay — and keying the choice on the _ground_ rather
than on the surface means two lawns covering the same patch pick the same variant, so the overlap
stays invisible. Every texture family ships one variant today, so this draws exactly what it always
did; it is the drop-in point for a richer pack.

**The export is drawn at 2x and resampled down.** Everything here has a size floor — `lod.ts` stops
drawing a slab under three pixels — so detail does not fade at small scales, it stops. Drawing
large puts every floor twice as far away and the downsample averages the units into the pixels they
should have occupied, which is a genuinely different picture from drawing at the final size. Two,
not four: at 4x a 2400 px plan is a 368 MB canvas that Safari refuses, for a gain that is below the
floors again.

**The export's own finishing pass is gone, and _that reverses_ "it is not a look and must not become
one".** It was a contrast and saturation lift, plan view only, written to put back the separation
that compositing dozens of independently tinted photographs averages away — and it was exactly a
look, chosen rather than measured, pulling two of the scene grade's terms the other way. That is why
it had to be switched off for Visualise and left on for the plan, and two finishing passes
disagreeing about one picture is not a policy. `drawPlan` grades **both views** now, from the one
measured set of constants. A downloaded plan is therefore no longer byte-identical to one downloaded
before this work, deliberately.

## The grade, and the fourth term nothing could see

**One measured grade over every drawing.** `grade.ts` holds four terms and two applications: the
sheets, the thumbnails and the download take `applyGrade` on real pixels, and the live views take
`gradeCss()` on the one wrapper element that contains both their canvases — Visualise's, and now
`EditorScene`'s, which is where the Pixi canvas and the 2D overlay meet. As CSS on screen because
that repaints every frame of every drag and `getImageData` over the viewport per frame is a cost
the download does not pay. The Konva chrome is a *sibling* of that wrapper, so handles, guides and
the tape stay ungraded, which is right: they are the interface, not the garden.

**`WARMTH` is the fourth term, and the first measurement that could find it.** Saturation, luminance
and contrast are each computed over channels that have *already been collapsed* — HSV
`(max − min) / max`, Rec. 709 luma, the standard deviation of that luma — so a render and its
reference can match on all three and still be one golden and one blue. `measure:render` gained a
**colour balance** row (each channel against its own picture's mean, so brightness divides out) and
it read the reference 4.2% redder, 2.6% greener and 8.0% less blue than our render of the same
garden. The gains are that gap, normalised by the Rec. 709 weighted mean so luminance is left where
`BRIGHTNESS` and `CONTRAST` were solved to put it. Measured after: 0.0% on all three channels.

**CSS has no shorthand for a per-channel gain, so the warm term travels as an `feColorMatrix`.** The
alternative was applying it only where real pixels are processed and leaving the live view without
it — a grade the screen has and the download does not, which is the *symptom* two separate bugs in
these notes already shared. A CSS filter list accepts `url(#id)` alongside the shorthand functions,
so `GradeFilter` renders one and `gradeCss()` appends it last, in the order `gradePixel` applies it.
**`color-interpolation-filters="sRGB"` is load-bearing**: an SVG filter operates in *linearRGB* by
default, so the identical matrix gives visibly different pixels from the arithmetic unless it is told
otherwise — it fails by looking slightly wrong rather than by failing. `grade.test.ts` drives the
published matrix string rather than the constants, so a typo in `warmthMatrix()` is caught by the
same sweep.

**The constants were refitted when the grade reached the plan, and the refit was declined.** Fitted
against the graded *plan* rather than the graded Visualise picture, the solution is 0.918 / 1.234 /
0.690 and it closes every row: `saturation +1.0%, luminance 0.0%, contrast -0.0%`. Looked at, it is
visibly worse — the lawn goes flat and saturated and the paving bleaches. The statistic is not wrong;
it is **the wrong target for that term**: `contrast` is the standard deviation of luminance over the
plot, so it is a function of what the garden *contains* as much as of how it is graded, and a global
expansion cannot close a composition difference without damage. 0.932 / 1.152 / 0.773 is kept, which
measures closer than ungraded on all three and worse on none. Look at the sheet: the balance row may
be closed to zero and the others may not.

## Traps already hit

**`render:material` clears the whole of `.material-preview/`.** The plan sheets lived in a subfolder
of it for an afternoon and vanished on the next material run. They are in `.plan-preview/` now, and
`scripts/preview-dir.ts` is the one place the before/after carry-over lives.

**Postgres JIT must be off, and this cost an afternoon.** `remainderPieces` folds a lot of
geometry into constants, which Postgres then JIT-compiles: 1.4 s a query against 114 ms with
`SET jit = off`, so every generator test timed out while `EXPLAIN` reported 30 ms of execution.
Both clients pass `connection: { jit: 'off' }` — `db.module.ts` and `src/test/db.ts`.

**Two API test runs at once do not merely queue — they crawl and then fail.** `src/test/db.ts`
truncates `plan_projects` on the same Postgres `pnpm dev` uses, so two suites running together
truncate each other's rows mid-test while both hammer PostGIS. Observed: a generator test that takes
1.2 s alone took **903 seconds and failed**, and passed immediately on its own. The failure looks
like a defect in whatever you last touched, which is the trap — check for a second `vitest` before
believing it. This is the concurrency face of the two truncate notes below, and it bites when a
second agent or a second terminal is working in the repo at the same time.

**The API test suite used to delete the fixture projects too**, for the same reason and by the same
line. `capture:fixtures` creates real projects and the suite truncated the table, so a plan you were
about to screenshot in the browser was gone the moment the API tests ran. Fixed with the truncate
above; the fixture _files_ always survived either way.

**A zsh `--include=*.ts` glob in a Bash tool call fails with "no matches found".** Quote it or use
`grep -r --include='*.ts'`; the shell expands the glob before grep sees it.

**Konva must be client-only.** Konva's Node build `require`s the native `canvas` package,
which breaks `next build` during SSR. Every canvas is behind a `*CanvasLoader.tsx` using
`dynamic(..., { ssr: false })`. Keep it that way.

**The Zustand stores cannot be filled in on the server.** They are module singletons, so one
instance is shared by every request. `ProjectHydrator` therefore loads the plan in an effect and
renders a placeholder until it has, rather than hydrating during SSR. The first attempt did
hydrate in a `useState` initialiser and step 1 still server-rendered "Close the property
boundary" over a closed boundary — the screens' own render is not guaranteed to come after a
client parent's initialiser across an RSC boundary.

**Konva's `Stage` does not forward `data-testid`**, so `boundary-canvas` is on the wrapping div —
which exists before the stage has been measured and mounted. An e2e click on the strength of the
wrapper alone lands on nothing; wait for the `<canvas>` inside it first.

**Clicking the first corner again does not close a boundary in a test.** That click lands on the
corner's own drag handle, which stops the event before the stage's click handler sees it. Use the
`close-shape` button.

**A file not re-exported from `packages/schema/src/index.ts` does not exist.** The package has a
single `"."` export subpath, so the import just fails to resolve with no hint that the file is
sitting right there. Add every new module to the list in `index.ts`.

**`packages/schema` must not import itself in a cycle.** `plan/site.ts` needs the zone id and
`plan/zones.ts` needs the house footprint, which is why `ZoneId` lives in its own leaf module
`plan/zone-id.ts` — a direct cycle only breaks under one module evaluation order, which is the
worst kind of bug to chase.

**drizzle-kit stops to ask when a diff both adds and removes a table**, because it cannot tell a
create from a rename, and the prompt cannot be answered from a non-interactive shell. Split it:
generate with both tables present (unambiguous add), then remove the old one and generate again
(unambiguous drop). That is why there are migrations `0001` and `0002`.

**`apps/api/tsconfig.build.json` pins `include` to `src`.** Without it the root-level
`drizzle.config.ts` and `vitest.config.ts` are pulled into the build, TypeScript infers the
package root as the common source directory, and output lands at `dist/src/main.js` — where
`package.json`'s `start` script (`node dist/main.js`) cannot find it.

**`npx tsc --noEmit -p tsconfig.json` fails in `apps/api`** on the top-level `await` in the test
files' `connectTestDatabase()`. That is expected: use `tsconfig.build.json` to typecheck, and
Vitest (esbuild) to run the tests.

**Konva's `Stage` does not forward `data-testid`** to its container div. Test hooks go on a
wrapping element.

**`db.execute()` on the postgres-js driver returns a bare array**, not `{ rows }`. Write
`const rows = await db.execute(...)`, never `result.rows`.

**Casts in raw PostGIS SQL are load-bearing.** An untyped parameter in
`ST_Buffer(geom, radius, $n)` resolves to the `text` style-parameters overload and fails with
`Missing value for buffer parameter`; it needs `::int`. Cast raw parameters explicitly. The
validator no longer buffers anything, so the live example of this moves to the generator's
negative-buffer erosion when that lands.

**postgres-js returns `numeric` as a string.** Cast every numeric result column `::float8` (or
`::int`) in raw SQL, or arithmetic on it silently concatenates. The existing queries never hit
this because they only return `text[]`.

**drizzle-orm's `geometry()` column type is point-only** and silently ignores `srid`. Polygons
would need `customType` or raw SQL — not currently needed, since geometry is built in queries
rather than stored in columns.

**drizzle-kit does not generate `CREATE EXTENSION`.** The PostGIS extension line in
`apps/api/drizzle/0000_*.sql` was added by hand; preserve it if migrations are regenerated.

**The assistant request must flush the autosave first.** It carries no geometry — only the sentence,
the last few turns and the ids of what is selected; the server reads the stored plan — so asking
inside the 800 ms debounce window would have the assistant reasoning about a garden the user can no
longer see. `assistant-store.send` awaits `flushAll()` before it posts, and there is a test
asserting that order. Note the selection is read *before* the flush, for the same reason the history
is: a sentence is about the garden as it stood when it was typed, and `flushAll` awaits.

**Testing Library's auto-cleanup does not register without Vitest globals.** `apps/web`
keeps globals off, so `vitest.setup.ts` calls `afterEach(cleanup)` explicitly. Without it,
renders accumulate and queries hit duplicate elements.

**jsdom returns `null` from `getContext('2d')`.** Anything that has to draw takes a context as an
argument and the tests hand it an `@napi-rs/canvas` one — which is why `drawSurfacePattern` is split
from `renderSurfacePattern`. `@napi-rs/canvas` rather than `canvas`: it ships prebuilt binaries, so
it needs no node-gyp or Visual Studio Build Tools and cannot break `pnpm install` for a marker.

**The API test suite no longer truncates the dev database — _this reverses_ the note that said it
does.** `apps/api/src/test/db.ts` used to run `truncate table plan_projects` against the same
Postgres `pnpm dev` uses, so `pnpm test` silently deleted every plan you were looking at. It was
also a collision waiting for a second suite: vitest runs files concurrently, so the moment
`design-events.service.test.ts` needed rows of its own, the two files began deleting each other's
data mid-test — and serialising the API suite to fix it costs minutes rather than seconds. Each
suite removes only what it created now, and the helper is gone.

**`next dev` writes `apps/web/AGENTS.md` and re-creates it if deleted.** Its warning is real: this
Next.js has breaking changes from what a model remembers. Following it caught `reset` vs `retry` on
the error boundaries — Next 16 demoted `reset` (which re-renders without re-fetching) in favour of
`retry`, and `reset` is the name that comes to hand from memory. `global-error` also renders its own
document and gets **no** global styles, so its styles have to be inline.

**`pnpm install` can fail halfway from a shell without `node` on its PATH**, leaving the store in a
state only a second `pnpm install` fixes — any package with a postinstall step (esbuild's, for one)
will do it. This was written as "always use PowerShell, never the Bash tool", and that is too strong
on at least some machines: `node` and `pnpm` resolve fine from the Bash tool here, and every script
in this file — `pnpm test`, `build`, `lint`, `render:material`, `playwright test` — has been run
through it. Check `which node` before assuming either way; the hazard is the _install_, not running
a script.

## Conventions

- Zod for all validation, front and back — no class-validator. Request bodies go through
  `ZodValidationPipe` with the shared schemas.
- Prettier config is at the root and shared; ESLint is flat config per package.
- Test hooks use `data-testid`.
- British spelling in UI copy.

## Environment

- `apps/api/.env` — `DATABASE_URL`, `PORT`, `WEB_ORIGIN` (CORS origin for the frontend), plus the
  assistant's `ANTHROPIC_API_KEY` (blank is fine — see above), `ANTHROPIC_MODEL`,
  `ASSISTANT_TIMEOUT_MS` (**milliseconds** in the TypeScript SDK) and `ASSISTANT_ENABLED`; and
  `OPEN_AI_API_KEY`, read only by `tools/assets` at development time — the running app never uses it
- `apps/web/.env.local` — `NEXT_PUBLIC_API_URL`

Both have committed `.env.example` files. `.env` is gitignored and the example ships with the key
blank; never commit a real one.

## Git

The repository owner handles all git operations — do not commit, branch, or push unless
explicitly asked.
