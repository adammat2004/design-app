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
  (`apps/web/src/lib/materials/`). Four pattern types — `grid`, `board`, `scatter`, `stripe` —
  cover twenty of the twenty-seven materials, and the generator now assigns a material to every
  element it places. `pnpm --filter @garden-studio/web render:material` writes PNGs to a gitignored
  `.material-preview/` to look at; the contact sheet is the one to judge by.
- **the plan reads as an enclosed garden**: a fence with posts round the boundary, feature chips
  without zone labels, and a size badge on the selected shape.

- **a generated concept contains a garden**: a planted border hugging the fence and up to five
  trees, on top of the base fills, accents and requested features.
- **symbols for the things that are not surfaces**: tree canopies, a fire pit, pergola beams. One
  `ElementDrawing` component draws every element, shared by step 4 and step 5.
- **plot dimensions** outside the fence with arrowheads, and a grid that is clipped to the plot and
  can be turned off.

**Not built yet:** costing and the review screen's numbers, and the 3D preview. React Three Fiber
is installed but unused. Step 6 is still a signpost card that reads no plan data.

**No live Anthropic call has been made yet** — the assistant's server tests mock the SDK, and
there is no key in `apps/api/.env`. Everything up to the request is exercised; the first real
call is worth watching (check `usage.cache_read_input_tokens` before claiming the caching win).
Server-side `fallbacks` was deliberately left off for the same reason: it cannot be tested here.

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
parallel `walls[]`. The ids exist so things can be *attached* to a wall: a door recorded as "0.9 m
along this wall" survives a move and a rotation with positional identity, but not a resize — which
rewrites every coordinate — and not a corner being inserted on a custom outline, which renumbers
every edge after it and silently moves every opening on them to a different wall. That is the
failure this codebase least tolerates, and it is the same reason `BoundaryVertex` has an id.

Consequences worth knowing:

- **`MIGRATIONS[1]` is the first migration that does real work.** Every earlier shape change was an
  addition with a default, which Zod fills for free; this one changes an element *type*, so a stored
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
  door hanging off the end of the building is geometry that *looks* valid, which is worse than one
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
task into an easy 1D one, and the horizontal axis *is* `offsetAlongEdge`: the number under the
pointer and the number in the document are the same number. It is plain DOM rather than Konva —
a ruler with draggable blocks is React's job, and it keeps the panel out of the `ssr: false` dance.
The vertical axis is illustrative only, which is why sill height is typed and never dragged.

**The panel lives inside step 1's house tools and never gates Continue.** A mandatory screen about
door positions would be a regression for every user whose answer is "the patio doors are in the
middle of the back wall". `HouseOpenings.tsx` draws the plan-view echo — gaps in the wall, swing
arcs on hinged doors — because otherwise the strip is a form whose effect the user never sees.

**The inferred patio door is offered, not applied.** `suggestedDoorWall` picks the wall facing the
back garden using the same bearing `computeZones` does, and the panel puts it behind a one-tap chip.
The whole value of an opening is that the generator *trusts* it: a wrong silent door has the design
built confidently around a fiction the user never stated and cannot see they should check.

**Legality about a wall lives in `fitsOnWall`, not in the panel.** Two openings cannot share wall,
an opening must sit wholly on its wall, and a party wall holds nothing. Reclassifying a wall
*removes* the openings that are no longer legal on it rather than hiding them — a door left on a
party wall would have the generator route a path to a doorway into next door's kitchen. Note these
edits deliberately do **not** go through `commitHouse`: that guard is about the footprint leaving
the plot, and none of them move it.

**`openingCounter` is re-seeded in `hydrateBoundaryStore`,** alongside `vertexCounter`. Miss it and
the first opening added after a reload takes an id already in use.

**A side gate is a `FeatureKind`, not an `Opening`.** An opening is keyed on a *wall id* and the
boundary has vertices, not walls; reusing it would make `wallId` mean a house wall in one place and
a boundary edge in another — the ambiguity `ZoneId` got its own module to avoid. As a feature it is
placed on step 2 with everything else physical and the existing placement and validation machinery
handles it unchanged.

**`site.orientation` exists, and nothing reads it yet.** Degrees clockwise from screen-up to true
north, defaulting to 0. The compass on every canvas has always been a *drawing* — it points up and
no code consults it — so height shadows, sun-aware placement and "which windows face the light" all
needed the field to exist before they could be built. Defaulting to 0 means every stored plan is
unchanged and the compass keeps pointing exactly where it did.

**Step 1 opens on a shape, not on a blank grid.** `plot-presets.ts` builds a rectangle (12 × 8 m by
default) or an L, and corner-by-corner drawing is the escape hatch for irregular plots rather than
the mandatory route. Drawing a scaled polygon on an empty grid asks the user to *originate* a
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
canvas and the validator. Right angles are held relative to the *previous side*, not to the world
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
*physical* size is known, which in a browser it is not. Metres-across needs no calibration and is
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
concept. Layout elements are checked for containment and house clearance only — exactly what
`geometryIsLegal` checks on the client.

**Nothing in generation reads the brief for a design decision — it reads `DesignConstraints`.**
`resolveConstraints` (`apps/api/src/plan/generation/constraints.ts`) is called once per concept and
everything downstream takes its answer. This is not tidiness: the card's badge used to come from
`archetype.maintenance(brief)` while `fillPalette` read `brief.maintenance`, so a brief saying
*medium* produced a concept badged **Low** with a lawn under it. One call means there is no second
source left to diverge from. The rule lives here rather than in a prompt for the same reason
coordinates do — "low maintenance means no lawn" is a thing that can be *checked*.

The forbidden list is applied to the palette's **result**, not folded into its tables. Even when
badge and palette agreed, a `gravel-mulch` base took `['planting-bed', 'lawn']` as its accents, so
lawn returned as an accent regardless. Filtering once, at the end, is what makes "no lawn" true of
the whole palette. `materialFor` filters the same way, because a brief that is both `formal` and
low-maintenance takes the formal branch and lands on `mixed-border`.

**A stated maintenance level is a ceiling, not a suggestion.** The archetypes declare their own
upkeep — the entertaining concept is `medium` whatever was asked — so without `cappedMaintenance` a
user who asked for low maintenance is still offered a medium-upkeep concept among the three. Capping
rather than overriding: an archetype may still come in *under* the ceiling, and the retreat stays low
on a medium brief.

**Feature footprints scale sub-linearly with the plot, exponent 0.35.** `FEATURE_SPECS` stays quoted
at suburban scale so the manifest still reads as "a dining pergola is 3.6 × 3.6 m", and `scaledSpec`
applies the factor at the point of use. Linear scaling gives a 130 m² pergola; no scaling gives the
defect that prompted this, a 13 m² pergola on 8,400 m². The surplus from `featureAttempts` becomes a
*second* of something in `REPEATABLE_FEATURES` rather than nothing — an estate given the same six
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
surface to its own corner guarantees two touching patios *miss* at the seam, which is the one thing
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
another element does not. `pattern.x/y` are differences in *metres*, so a pan changes neither — which
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
such guarantee, and `ST_SimplifyPreserveTopology` preserves topology but *not* containment, so the
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
editor drew textures while step 4 drew flat category colours, so the screen where the user *chooses*
a concept contradicted the next one. Interaction stays in the editor's wrapper; selection is drawn
as an outline *over* the shared drawing rather than by restyling it, so the drawing stays a pure
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
chippings are a *mass*: the units are texture on a body of the same stuff, so the ground behind them
is drawn from the middle of their own palette. Planting and meadow are *figure on ground*: plants on
soil, flowers in grass, where a darker ground is the point. Getting this backwards is what made the
first attempt's aggregates read as sparse dots scattered on mud, and there is a test either side of
the line — `palette.test.ts` holds the aggregate rule, the renderer's suite holds the coverage rule.

**Scatter densities are drawn densities, not planting schedules.** A border really planted at five a
square metre closes up in a season; drawn at five a square metre it reads as dots on soil, because a
plan shows one instant and a garden is judged by how it will look. `density × the mean unit's area`
is kept appreciably above 1 so units overlap, and a test in `material-patterns.test.ts` pins it. Do
not read these numbers as a quantity to order.

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
in `apps/web/src/lib/materials/palette.ts` — for the reason `materials.ts` already gives about
colour being presentation. `resolvePattern` joins the halves, and returns `null` if either is
missing, which is the flat-fill path.

## Traps already hit

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

**Run `pnpm` through PowerShell, not the Bash tool.** `node` is not on the Bash tool's PATH here, so
any install with a postinstall step (esbuild's, for one) fails halfway and leaves the store in a
state only a second `pnpm install` fixes.

## Conventions

- Zod for all validation, front and back — no class-validator. Request bodies go through
  `ZodValidationPipe` with the shared schemas.
- Prettier config is at the root and shared; ESLint is flat config per package.
- Test hooks use `data-testid`.
- British spelling in UI copy.

## Environment

- `apps/api/.env` — `DATABASE_URL`, `PORT`, `WEB_ORIGIN` (CORS origin for the frontend), plus the
  assistant's `ANTHROPIC_API_KEY` (blank is fine — see above), `ANTHROPIC_MODEL`,
  `ASSISTANT_TIMEOUT_MS` (**milliseconds** in the TypeScript SDK) and `ASSISTANT_ENABLED`
- `apps/web/.env.local` — `NEXT_PUBLIC_API_URL`

Both have committed `.env.example` files. `.env` is gitignored and the example ships with the key
blank; never commit a real one.

## Git

The repository owner handles all git operations — do not commit, branch, or push unless
explicitly asked.
