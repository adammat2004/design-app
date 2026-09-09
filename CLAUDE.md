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
  (`apps/web/src/lib/materials/`). Five pattern types — `grid`, `board`, `scatter`, `stripe`,
  `water` — cover twenty-six of the twenty-eight materials (all but `powder-coated-steel` and
  `existing`), and the generator now assigns a
  material to every element it places. `scatter` carries a `form` axis (`blob`, `tufted`,
  `clipped-mass`) so a grass is a different _shape_ from a shrub rather than a different shade. `pnpm --filter @garden-studio/web render:material` writes PNGs to a gitignored
  `.material-preview/` to look at; the contact sheet is the one to judge by.
- **the plan reads as an enclosed garden**: a fence with posts round the boundary, feature chips
  without zone labels, and a size badge on the selected shape.

- **a generated concept contains a garden**: a planted border hugging the fence and up to five
  trees, on top of the base fills, accents and requested features.
- **symbols for the things that are not surfaces**: tree canopies, a fire pit, pergola beams. One
  `ElementDrawing` component draws every element, shared by step 4 and step 5.
- **plot dimensions** outside the fence with arrowheads, and a grid that is clipped to the plot and
  can be turned off.
- **one sun over the whole drawing**: `site.location` plus `site.sun` feed `suncalc`, and the same
  unit vector lights slab bevels, plant crowns, water crests and a real cast-shadow layer. Set a
  location in step 1's Sun and shade panel and the shadows appear; leave it unset and the plan
  keeps the conventional top-left drawing light and says nothing about shade.
- **a schedule of materials on step 6**: areas, slab and board counts, the budget asked for against
  what the materials came to, and which requested features made it in. Every figure is derived from
  the geometry at read time; nothing is stored.
- **a way back to a saved plan**: `/projects` lists them, and the landing page links to it.

- **the plan draws with photographs and sprites**: slab and board faces, seamless tiles of gravel,
  turf, bark and water, top-down plant and tree-canopy sprites, and furniture sprites, all generated
  once by `tools/assets` with an image model and checked in under `apps/web/public/assets/` (82
  files, ~9 MB). The app never calls an image model; a missing file means the procedural pattern
  draws instead, so everything works with no key. See "Rendering with assets" below.
- **furniture is a category**, `symbol` is a field, and the generator furnishes what it places: a
  lounge set on the seating patio, a dining set under the pergola, a barbecue in the outdoor
  kitchen, a bowl in the fire pit, a swing on the play area; a store is a `shed`, a veg patch a
  `raised-bed`, a pergola a `pergola`. The editor's palette offers twelve pieces of furniture.
- **the house is drawn as a building**: a wall of real thickness round a floor, doors shown on
  steps 4 and 5 as well as step 1.
- **concept cards show the real render**, drawn by the same composer as everything else, and the
  editor and the review screen can **download the plan as a PNG** with its feature chips.
- **`pnpm render:plan`** writes whole-plan judging sheets from three captured generator fixtures
  (`apps/web/scripts/fixtures/`, refreshed by `pnpm capture:fixtures` with the API up).

- **step 1 captures how you get in and out**: patio and front doors, a side gate on a boundary
  edge, and which fence faces the street, all in an Access sub-step whose every inference is a
  one-tap chip. The generator reads all four.
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

**Not built yet:** printing at true scale, a navigable 3D preview, and the optional AI
photo-render. React Three Fiber is installed but unused — the WebGL that shipped is PixiJS, and it
draws the same top-down scene rather than a camera. There is also **no evaluation of any kind** — no benchmark over the generator, no user
study, no measured numbers beyond the generation timings quoted above. That is the largest
outstanding gap in the project and it is not a feature.

**No _automated_ Anthropic call has ever been made** — every assistant test injects a fake client
(`Pick<Anthropic, 'messages'>`), constructing real `Anthropic.*Error` classes only to check the
error mapping. Everything up to the request is exercised. `apps/api/.env` now carries a key and
`ASSISTANT_ENABLED` is unset (so, enabled), which means the running app _is_ live-capable; whether
a real call has been made through the UI is not something the repository records. The first one is
still worth watching — check `usage.cache_read_input_tokens` before claiming the caching win.
Server-side `fallbacks` remains off for the same reason: it cannot be tested here.

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

**The house's corners and walls carry ids, and `PLAN_DOCUMENT_VERSION` is 2 because of it.**
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

**`site.orientation` is read by the sun model.** Degrees clockwise from screen-up to true
north, defaulting to 0. The compass was a _drawing_ for most of this project's life — it pointed up
and no code consulted it. `shadowCast` consults it now. Defaulting to 0 means every stored plan is
unchanged and the compass keeps pointing exactly where it did.

**Orientation is not enough for a sun, and `site.location` is the gate.** Which way the plot is
turned says nothing about where on Earth it is, and solar altitude is a function of latitude —
shadow length is `height / tan(altitude)`. So `location` is nullable and **null means the app makes
no solar claim at all**: no cast shadows, and the conventional top-left drawing light everywhere.
There is no latitude that is true of anywhere, and a plausible guess would have the design built
confidently around a fact the user never stated. Offered, not applied, exactly as
`suggestedDoorWall` handles the inferred patio door.

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
`ST_Contains`); what was missing was any way to *get* there. The typed width and depth refused
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
construction. Note that at a realistic zoom a 10 mm joint on a 600 mm slab is well under a pixel —
it only ever lands as a slight darkening of its neighbours, so **do not write a test that thresholds
those pixels.** The suite uses a high-contrast fixture with a fat joint for structural assertions
and the shipped palette only for determinism.

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
They also have to go through `placement.candidates` and be pushed onto `obstacles`, because the
concept tests require every feature footprint to be pairwise disjoint.

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

## The layout grammar

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

## Aerial mapping ("Find my property")

**An optional way to make the same `SiteSection`, not a second model.** Step 1 opens on a choice —
trace over aerial imagery, or enter measurements — and both paths run the same store, the same
tools and the same checklist. Nothing after step 1 can tell which was used, and that is checked by
the aerial store tests parsing the result with `SiteSectionSchema`. The manual path is unchanged.

**The imagery is a Konva layer, not a map SDK.** `ImageryLayer` draws Web Mercator raster tiles as
`KonvaImage`s inside the existing stage, positioned by the same `metresToPx` every handle uses. A
MapLibre canvas underneath would have been a second camera to keep in step with the eased zoom on
every frame, a second WebGL context with the three Pixi traps, and a renderer no test can reach —
for the sake of tile fetching, which `lib/geo/tiles.ts` and `tile-cache.ts` do in a few hundred
lines. Fetches are deferred while `useCanvasViewport` reports `zooming`; drawing from the cache
carries on, with the parent tile standing in for one still loading.

**The imagery has no authority, and it is never stored or exported.** Nothing measures off it;
`drawPlan` never sees it; delete `lib/geo/` and `ImageryLayer` and the plan is dimensionally
identical. Provider terms forbid screenshots in place of live tiles anyway.

**Never measure in Web Mercator metres.** They are inflated by `1 / cos(latitude)` — ×1.67 at
Dublin, ×1.61 at London — so a 10 m fence would read 16.7 m. `lib/geo/local-frame.ts` is a local
tangent plane about `site.georeference` using the **WGS84 radii of curvature** (a mean sphere is
0.33% short east–west, 65 cm across a 200 m garden). The truncation error across a 200 m plot is
8 mm. Tiles are placed through the *same* `toLocal`, so imagery and geometry agree by construction;
a placed tile is 0.24% shorter than wide because Mercator is spherical and the frame is not, and
there is a test pinning that so nobody "fixes" it.

**`site.georeference` is the only persisted field, and the first corner is where it is fixed.**
It is the WGS84 position of local (0, 0); the frame's rotation is `orientation`, which already
means screen-up-to-north, so no bearing is stored. While the user is still finding their roof the
imagery is centred on an ephemeral `imageryAnchor` (a search result, or the browser's location);
the first click calls `georeferenceAt` with that point's lat/lng and `translateOrigin` shifts the
viewport by the same amount so the photograph does not move. Corner A is therefore (0, 0) and what
the document keeps is a point on the user's own fence, never a geocoder's result — which at least
two providers' terms forbid storing. There is **no re-normalisation** after close: nothing assumes
the plot sits at the origin, and a test pins that zones and areas are translation-invariant.

**`georeferenceAt` applies the sun location rather than offering it** — the one exception to the
"offered, not applied" rule, because the user has just pointed at their garden on a photograph.
It only fills `location` if it is null, so a hand-set one wins; `setLocation(null)` clears the sun
alone and `clearGeoreference` ("Remove location data") clears both. It also puts `orientation` at
0 and locks the field: the photograph is north-up and a turned frame would rotate the sun but not
the picture. `localFrame` takes the orientation anyway, for the day the tiles rotate too.

**Grid snap comes off for tracing and back on for measuring.** A real fence is not on a half-metre
grid and forced right angles fight the picture; both are per `mappingMethod`, which is ephemeral
and **derived on load** by `mappingMethodOf` — a plan with a georeference was traced, one with
corners and none was measured — so a stored flag cannot go stale. The grid, the car and the plot
fill step aside while imagery is showing; zone tints drop to 35%.

**A traced side is an estimate until it is typed or ticked.** `checkedEdgeIds` (ephemeral) drives
the "est." badge in `SideLengthsPanel` and the "Check measurements" row in the checklist, which
never gates Continue. Correction is `setEdgeLength`/`reflowEdge` unchanged — pin the preceding
corner, slide the following one, with `ReflowHint` showing which — and typing a length marks the
side checked even when the number did not change.

**The server side is one seam, configured in `.env`.** `GET /imagery/config` hands the browser a
tile template, a credit line and a zoom range; `GET /imagery/tiles/:z/:x/:y[@2x]` proxies tiles
(default, keeps keys server-side, same-origin so no canvas tainting); `POST /geocode` is a POST so
the address is never in a URL an access log keeps. Every provider serves `(z, x, y)` tiles, so
"which provider" is `IMAGERY_TILE_TEMPLATE` and nothing in the browser knows. `IMAGERY_DELIVERY=
direct` exists for providers whose terms forbid proxying; then the template goes to the browser as
is and any token in it must be URL-restricted. Two geocoders: `nominatim` (keyless, strict usage
policy — the search box submits on Enter, not per keystroke) and `esri` (keyed, `forStorage=false`).
Nothing configured ⇒ 503 ⇒ the aerial card disables itself and says so, exactly like the assistant.
Addresses are never logged, never stored, never put in a project name; the results list shows
labels only and upstream errors are never echoed because they can contain the query.

**Licensing decides whether this can ship, not code.** As of September 2026: Mapbox Product Terms
§1.6 permit tracing satellite imagery into vector data only for non-commercial use or OSM (§2.7.2
forbids storing temporary geocodes, §1.9/§2.8.1 forbid proxying and screenshots); Google forbids
tracing building outlines outright; Esri and MapTiler restrict derivatives to non-commercial use;
Azure Maps has no tracing clause found; Tailte Éireann (MapGenie, 25 cm national) and OS MasterMap
Imagery / Bluesky via resellers are bespoke licences. The provider seam is what makes the eventual
answer a configuration change. Do not add a map SDK to "fix" any of this.

**Test the imagery at a device pixel ratio other than 1.** The aerial e2e spec sets
`deviceScaleFactor: 2`; `imagery-status` carries `data-loaded`/`data-total` because a canvas cannot
be queried. `tileZoomFor` never lets `MIN_SCALE` hit a provider's minimum zoom, and above
`maxZoom` tiles are simply drawn larger — the chrome says "sharpest at about N m across".

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
the plan knows where on Earth it is. The cast-shadow layer — the one that says where the shade falls
at four o'clock — stays gated on `site.location`. The fence's shade strip is the same class.
`SHADOW_OPACITY` went from 0.26 to 0.36 when the lawn became a photograph.

**A canopy sprite is inscribed in the tree's radius by `canopySpriteBox`.** The catalogue records
how far a sprite's opaque pixels reach; the half-width is `radius / ratio`, so the furthest leaf
lands exactly on the circle the placer eroded by and the validator tessellates. Same rule as
`canopyRing`, same reason.

**Symbols are drawn where sprites cannot be.** A pergola, shed, gazebo or raised bed is whatever
rectangle the placer gave it, which no photograph stretches into, so `symbols/structures.ts` gives
posts, ridges, hips and rails as pure geometry and both the Konva canvas and the composer draw from
it. `SYMBOL_SPRITES` maps the rest to sprite families. A sprite is always fitted _inside_ the
element's rect or radius (`spriteBox`): the geometry of record is never the sprite's natural size.

**`furniture` is the eighth `ElementCategory`, and `DesignElement.symbol` a plain string.** Adding
the category was a compile error in nine records until each was answered — that is the point of
them being total. Furniture has an outline for placing and selecting but is _counted, not measured_:
the schedule gives it items rather than square metres and `materialCostIndex` skips it. The
concept test's pairwise-disjoint rule excludes it and a second test demands each piece sit wholly
inside exactly one host, drawn after it. The assistant's `add` excludes the surfaces furniture may
stand on from its obstacles, or a dining set could only ever land on the lawn beside the patio.

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
The scheme stays exactly as authored and only the picture gets denser. Saturating is harmless: the
sampler places at most one unit per cell.

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
floors again. The finishing pass is a small contrast and saturation lift done as arithmetic on the
pixels rather than through `context.filter`, which is unsupported in places and fails silently
where it is — a filter that worked on one browser and not another would make the export quietly
differ. It is not a look and must not become one.

## Traps already hit

**`render:material` clears the whole of `.material-preview/`.** The plan sheets lived in a subfolder
of it for an afternoon and vanished on the next material run. They are in `.plan-preview/` now, and
`scripts/preview-dir.ts` is the one place the before/after carry-over lives.

**Postgres JIT must be off, and this cost an afternoon.** `remainderPieces` folds a lot of
geometry into constants, which Postgres then JIT-compiles: 1.4 s a query against 114 ms with
`SET jit = off`, so every generator test timed out while `EXPLAIN` reported 30 ms of execution.
Both clients pass `connection: { jit: 'off' }` — `db.module.ts` and `src/test/db.ts`.

**The API test suite deletes the fixture projects too.** `capture:fixtures` creates real projects and
`pnpm test` truncates the table, so a plan you were about to screenshot in the browser is gone the
moment the API tests run. The fixture _files_ survive; re-run the capture to get projects back.

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

**The assistant request must flush the autosave first.** It carries only the sentence — the server
reads the stored plan — so asking inside the 800 ms debounce window would have the assistant
reasoning about a garden the user can no longer see. `assistant-store.send` awaits `flushAll()`
before it posts, and there is a test asserting that order.

**Testing Library's auto-cleanup does not register without Vitest globals.** `apps/web`
keeps globals off, so `vitest.setup.ts` calls `afterEach(cleanup)` explicitly. Without it,
renders accumulate and queries hit duplicate elements.

**jsdom returns `null` from `getContext('2d')`.** Anything that has to draw takes a context as an
argument and the tests hand it an `@napi-rs/canvas` one — which is why `drawSurfacePattern` is split
from `renderSurfacePattern`. `@napi-rs/canvas` rather than `canvas`: it ships prebuilt binaries, so
it needs no node-gyp or Visual Studio Build Tools and cannot break `pnpm install` for a marker.

**The API test suite truncates the dev database.** `apps/api/src/test/db.ts` runs
`truncate table plan_projects` against the same Postgres `pnpm dev` uses, so `pnpm test` silently
deletes every plan you were looking at. Not wrong — the tests need a clean table — but seed any
plan you are inspecting _after_ the last test run, not before.

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
