# TODOS

Deferred work, with enough context to pick it up cold. The setup script reads the first
few unchecked boxes and prints them, so keep the most relevant item near the top.

Full decision record for the current scope:
`~/.gstack/projects/adammat2004-design-app/ceo-plans/2026-08-30-plan-realism.md`
Implementation plan: `~/.claude/plans/can-you-look-at-peaceful-lemon.md`

---

## In flight — professional-render programme (plan: `~/.claude/plans/i-want-to-upgrade-happy-penguin.md`)

Closing the gap between our drawing and `target_design.png`. The gap was traced to five causes,
ranked by how much of the picture each accounts for: planting that reads as dots rather than plants,
nothing attached to the ground, trees too few and too small to give the garden scale, the house and
boundaries drawn as outlines rather than built things, and borders too shallow to layer. The asset
library is **not** among them — that was measured before and after the v2 regeneration.

- [x] **Phase 2 — shadows, everywhere and soft.** `presentationCast` gives an unlocated plan the
      drawing's own light (`conventionalCast`, 0.55 m per metre, away from `LIGHT_DIRECTION`) while
      `ShadowCast.source` keeps every *solar* claim — time of day, shade study, night, lighting —
      gated on a real location. Soft in both views, with the penumbra growing with the caster's
      height in three bands; **3.1 ms against 0.9 ms** on the 56-occluder suburban fixture, on a
      cache miss only. A **Shadows** view toggle in the toolbar, the Visualise controls and the PNG
      export. Goldens re-captured; the courtyard fixture is where the change is worth looking at.
      **The trap:** fall back on `site.location`, never on a null cast — a located garden at
      midnight must stay dark, or the convention draws a second sun over the night wash.
- [x] **Phase 1 — measure what the planting actually is.** `measure:render` gained a planting table
      read off the scene rather than the pixels: plants per m² of bed, mean drawn diameter, the
      share under half a metre, sampled cover and canopy share. It found 8–15 per m² against a
      designed border's 5–7, 71–83% of them under half a metre, and 14–30% bare — which is the
      whole diagnosis in four numbers, and none of it was visible to a colour statistic.
- [x] **Phase 3 — the planting rework.** `INSTANCE_DENSITY` 1.25 → 0.8 and a new `CROWN_FILL` 1.45
      on the drawn spread only; a real shrub storey in every bed (1–1.8 m); both views instanced, so
      the 2D Plan's beds stop being cut-outs and foliage crosses onto the lawn; the mass LOD band
      moved to 32→24 so the editing zoom no longer draws both representations at half opacity; no
      contact disc under a mat (`MIN_CONTACT_SHADOW_HEIGHT`); the mauve out of the mixed-border
      palette. **Measured**: 5.4–9.7 per m², mean 0.64–0.81 m, 6–25% under half a metre. The
      browser parity and performance suite passes at DPR 1 and 2.
- [ ] **Still open from phase 3.** Flowers are hard-coded off in instanced mode (`plants.ts`
      `flower: null`) and the material's `flowers.share` is dropped by the layered path, so a border
      has no flower accents at all in either view; the palette never reaches an instanced sprite
      (`SPRITE_TINT` is applied only inside the raster painter), so the tonal ladder `tones.ts` was
      tuned for does not exist where the plants now are; and the low-zoom "mass" is still one blob
      per plant in the contacts pass rather than one merged drift.
- [x] **Phase 4 — seam shading and grounding in the plan view.** `'seams'` is a pass in
      `RENDER_PASSES` between the courses and the cast shadows, drawn by `renderSeamLayer` in both
      backends: every ground feature's outline gets a soft band of shade on the ground just outside
      it, blurred and then punched back out with `destination-out` so the interior stays clean. It
      cannot be done inside a per-surface raster — a surface is clipped to its own outline and
      cannot see what it meets — which is the same reason the paving kerb was reverted. The plan
      view builds its stack too, so contact discs and foot bands ground the editor's objects.
- [x] **Phase 5 — trees.** The species is chosen **before** the geometry, so a rowan is a rowan's
      width; the **trunk** is the legal footprint and the canopy is presentation
      (`packages/schema/src/plan/footprint.ts`), which is what finally lets a crown hang over a
      terrace, a path or a fence; the count is `treeBudget(designedArea)` — one per 22 m², 3 to 12,
      from the reference's own ten canopies over 220 m² — instead of a flat cap of five; and a
      **boundary backdrop walk** plants along the room's own edges at 5 m spacing, inset 1.1 m, in
      `concepts.service` and in the preview alike. A **`canopy` principle** scores the share of the
      room under crown against a 0.15–0.35 band, so the candidate loop prefers the fuller garden
      rather than merely tolerating it. **Measured**: canopy 0.912 mean over 117 concepts, 33
      `sparse-canopy` faults, all still valid and deterministic with no critical faults.
      **The trap:** `legalFootprint` has to reach *all four* deciders — the editor's drag, the run
      executor, the assistant's planner and the PostGIS validator — or the server refuses the save
      of a plan the editor drew.
- [x] **Phase 6 — the generator's planting.** `BORDER_WIDTH` 1.5 → 2.2 m and `borderDepth`'s
      ceiling 2.5 → 3.5, because a metre and a half holds two ranks of plants and a layered border
      needs three; a `backdrop` shrub layer in the `naturalistic` and `pollinator` schemes, which
      had grasses and perennials all the way to the fence; shrub symbols sized as the shrub is in
      five years rather than as it arrives, plus `shrub-topiary` for the architectural palette; the
      structural-plant cap scaled by planted area (one per 5 m²) instead of a flat thirty; each
      designed bed taking its own planting material; steel edging for the default style at a dear
      budget and `timber-sleeper` reachable at last, on the veg patch that is built of them.
      **The trap it paid for:** a deeper border took the lawn under `LAWN_FLOOR` and a 9 × 10 m
      garden came back paved corner to corner. `borderIn` is the rule — the lawn's floor wins over
      the border's profile — and `isCourtyard` asks its question at the *thinnest* border, because
      whether a room can hold a lawn is a fact about the room and not about what we would like to
      plant round it.
- [ ] **The cost of phase 6, measured and not hidden.** Composition-band compliance fell 72% → 64%
      and `route-through-planting` rose 53 → 77 over the 117-concept harness; mean score 0.863 →
      0.856, min 0.728 → 0.734, repairs accepted 15% → 23% of concepts. Both regressions are the
      same fact: there is more planting and the routes were composed without knowing how deep the
      beds would be. The routes are the thing to fix — they are laid from the sketch's own points
      before `designedBeds` cuts anything — and the planting band may want re-deriving from a
      re-traced target, which is phase F2 and still open.
- [x] **Phase 7 — the house, the boundaries and the shed as built things.** The 2D Plan draws a
      **roof** (at zero overhang, so nothing measurable changes) with the slate skin consumed, ridge
      and hip capping, a fascia and a rooflight per plane over 30 m²; the door is not hidden under
      it but marked on the ground outside, which is what a landscape drawing does. `roofMaterial` is
      on the house and offered as three swatches in step 1. `MAX_DRAWN_LIFT` 3 → 4.5, so the
      elevated wall is tall enough to carry its own openings. A boundary in plan gets a lit edge and
      a cast band **whose reach states its height**, which is the only cue a flat band has; a hedge
      face is skinned with `tex-hedge-top`. A `dark-stained-timber` structure material, which is
      what a garden building actually is and what the generator now specifies for modern and
      low-upkeep briefs. A pergola throws **slat shadows**, which is the one thing that says
      "pergola" from above.
- [x] **Phase 8 — the grade, and the fixtures re-captured.** `measure:render` gained a **colour
      balance** row, because saturation, luminance and contrast are each computed over collapsed
      channels and none of them can see warmth. It measured the reference 4.2% redder and 8.0% less
      blue than our render, so the grade gained a fourth term, `WARMTH`, solved from that and
      normalised to leave luminance alone. The grade now covers **both views** and the legacy
      `finish()` in `export-plan.ts` — a look somebody chose, pulling two of the grade's terms the
      other way — is deleted. Fixtures re-captured, sheets and goldens regenerated.
- [ ] **Two things phase 7-8 measured and left.** The `cover` and `bare` columns in
      `measure:render`'s planting table count **plant sprites only**, so a bed under a tree reads as
      bare: the re-captured suburban fixture shows 36% cover against 27% canopy, and most of that
      gap is canopy rather than soil. And the grade's `contrast` term is fitted to a whole-plot
      standard deviation, which is a function of what the garden *contains* as much as of how it is
      graded — closing it to zero was tried, achieved, and looked visibly worse (see `grade.ts`).
      Both are measurement questions rather than drawing ones.
- [ ] **What phase 7 did not do, with reasons.** The generator does **not** set `boundaryStyles` to
      hedge on the rear edge for cottage briefs: boundary styles are a step-1 `site` field, one
      section per step written by the one screen that owns it, and generation rewriting the user's
      description of their own fence is the kind of silent inference `suggestedDoorWall` exists to
      avoid. The honest shape is a chip that *offers* it. And `skin-roof-felt` is still unread: it
      was consumed, looked at and reverted, because at 1.5 m a whole shed roof is two tiles by two
      and reads as a dark slab quartered by its own seams (recorded in `draw-symbol.ts`).
- [ ] **Still deferred: F2, the re-traced target.** `target.plan.json` is a thin trace — it carries
      about six per cent canopy where the photograph has ten trees — so `COMPOSITION_BANDS` and the
      new `CANOPY_BAND` both rest on a reading of the reference that under-counts its planting and
      its trees. Re-tracing is what would let either be tightened.

## In flight — visual AI agents (plan: `~/.claude/plans/i-want-you-to-rippling-tide.md`)

All six phases are built and verified. A shared `DesignOperation` schema, a pure executor, the
gesture-bracketed store integration, overlays, the activity panel, a scripted demonstration, the
assistant's diff playable as a run, and a design reviewer that finds a fault and fixes it under the
same accept-only-on-improvement gate the generator's own repair stage uses. See "Visual AI agents"
in CLAUDE.md for the decisions and the measurements behind them.

The two panels became one: you talk to the designer and it performs the work on the canvas. See
"One design agent" in CLAUDE.md, and note that the safety net it rests on did not exist as described
until Phase A built it — one bracket per sentence, Stop writing a revision, and a revision that
survives a reload.

Phase 2 landed the design intelligence: the scorer reads the brief and there is a benchmark over the
scorer itself; a fault says what a valid correction would achieve; the reviewer measures several
corrections and plays the best or none; `reroute` and `rotate` complete the vocabulary. Eight of the
ten repair kinds are performable in the editor, against three before.

What is left is mostly what the new measurements *found*: a third of generated plans do not honour
the room they claim to be organised around, and the one repair verb with no planner behind it is
laying a route — which is the third commonest fault in the harness.

Phase B gave the designer the canvas selection, so "make this bigger" has a subject. See "The
selection is what 'this' means" in CLAUDE.md. What that opened up rather than closed:

- [ ] **Multi-select on the canvas.** `ProposeRequest.selection` already carries up to eight ids
      and the prompt already words itself for a set, so the wire and the model are done; what is
      missing is the gesture. Shift-click touches `selectedId`, the handles, delete, nudge and the
      properties panel, which is why it was left out rather than folded in.
- [ ] **Place a new thing *at* the selection.** "Put a bench here" is the obvious next sentence and
      `add` cannot express it: `affinity` is an enum of relations to the house and the boundary with
      no element in it. Adding one costs grammar budget on a schema already pinned at
      `optionals <= 2` — run `probe:assistant` before assuming it compiles.
- [ ] **The two planners disagree about an id that names nothing.** Step 5's `resolve` drops it in
      silence; the garden planner reports it as unplaceable. A stale selection is now a second way
      to reach that path, which makes the silent one worth closing.

- [x] **Phase 0 — measurement.** One editor scene build is ~34 ms on a 50-element garden, almost
      entirely planting (1,355 plants; 1.3 ms with instancing off). Settled the frame path.
- [x] **Phase 1 — schema, executor, store.** `operations.ts`, `lib/ai-run/`, `ai-run-store`,
      `endGesture({ silent })`, `allocateElementId`, the autosave-during-gesture fix.
- [x] **Phase 2 — the visual language.** `MotionGroup`, `AiOverlayGroup`, the label chip, the
      activity panel, the interaction lockout, the compare banner.
- [x] **Phase 3 — the whole vocabulary.** Reshape with vertex matching, the three-phase reroute,
      add and remove transitions, staggered groups, the demonstration script.
- [x] **Phase 4 — revision controls.** Stop, Skip, Compare, Undo, Replay, and four design events.
- [x] **Phase 5 — real operations from the assistant.** `runFromProposal` (client-side, in
      `lib/ai-run/from-proposal.ts` — putting it in the schema would have made `assistant.ts` and
      `operations.ts` import each other) and a **Watch** button beside Apply on the diff. No new
      field on the wire and no second model call.
- [x] **Phase 6 — the review loop.** `POST /:id/design/review`, `POST /:id/assistant/redesign`
      (model-free), and `lib/ai-run/review-loop.ts` with the accept-only-on-improvement gate.
      Measured: two pinched paths widened, 0.851 → 0.872, both kept.
- [x] **One design agent.** `DesignAgentPanel` + `AgentActivity` replace `AssistantPanel` and
      `AiActivityPanel`; sending performs rather than proposing; four turns of memory; the review
      pass scoped to what the request touched, with the rest offered as chips; `composeOutcome`
      counting the garden rather than the proposal; a reduced-motion path through `applyProposal`;
      `GET /plan-projects/assistant/availability`; a 25 s run cap; a bottom sheet below `lg`.
- [x] **Three of the missing intents.** `reshape` (an edge and a distance, with the neighbour giving
      up the same ground through a new `FillService.subtract` — both halves or neither), `attach`
      (furniture travels with the host it stands on), and **`move` towards another element**.
      `clearOfOthers` also stopped counting a surface's own furniture as an obstacle, which had made
      every furnished terrace immovable.
- [x] **`reroute` and `rotate`.** Both intents, both through the generator's own primitives:
      `reroute` names an objective (`direct`, `avoid`, `connect`) and picks among the routes
      `routeCandidates` enumerates; `rotate` names what to be square to and the planner tries the
      quarter turns nearest where the thing already sits. No angle and no points anywhere in either.
      `align` is performable now because of the second.
- [x] **`DesignIssue` says what a valid correction would achieve.** `IssueGuidance` — near these,
      clear of those, out of the view, screened from that edge, this much bigger — every field a
      relation and none of them a position, tested by walking the schema's property names. The three
      move repairs are performable, `drop-optional` is reachable now that its emitters name the
      optional things standing in the way, and `REPAIR_CAPABILITIES` replaced the three tables that
      agreed only by hand.
- [x] **The reviewer measures several corrections instead of taking the first.**
      `POST /:id/design/repair` scores candidates with the real scorer and answers with the best or
      with nothing and a reason, so a change that helps nothing is never animated. `ReviewPass`
      carries `played`, `considered` and `reason`; the panel narrates from them.
- [x] **One test joins the two halves.** `pipeline.test.ts`: a fake model's intents → the real
      planner against PostGIS → `runFromProposal` → `prepareRun`, asserting the executor refuses
      nothing. `prepare.ts` and `from-proposal.ts` moved into the schema package to allow it, with
      re-exports so no web import changed.

- [ ] **Laying a route, which is the one repair verb with no planner behind it.** `route-missing` is
      the third commonest fault in the harness (59 of 117 concepts) and its subject is the thing
      nobody can reach rather than a path, so the correction is to *lay* a route. `DesignIntent.add`
      builds a footprint at a sampled point; a route is a line between two things. The router is
      already pure and already enumerates (`routeCandidates`), so what is missing is the intent and
      the planner branch — and `terraceStarts` is now shared, which is what that branch needs.
      The reviewer names the limitation rather than reporting "no legal change". **Effort: M.**
- [ ] **A move search that can clear the view cone.** Measured on the gallery: `shed-in-view` and
      `play-not-visible` generate three or four legal candidates and none of them improves the plan,
      because a `move` steps by `MOVE_LADDER` fractions towards one target and a shed moved a third
      of the way is still in the sightline. `bbq-far-from-dining` and `view-blocked` do land, so the
      mechanism works; what is coarse is the set of destinations. **Effort: M.**
- [x] **The scorer can tell the three concepts apart.** The weights follow the brief
      (`knowledge/weight-profiles.ts`), four principles read the fields that vary by slot, and
      `maintenanceFit` is the tenth principle. `DesignScore.weights` carries what was applied so the
      total can still be explained, and the reviewer judges a plan against the strategy the user
      chose. **Measured** by `pnpm --filter @garden-studio/api eval:scorer` over nine hand-built
      gardens: cross-brief spread 0.016 → 0.090, the upkeep pair 0.012 → 0.083, the three slots
      identical to three decimal places → different on every garden, and the composition pairs
      unchanged at 0.31–0.39. Before and after are in `scripts/eval-scorer.baseline.md`.

Three things the new principles found in the generator, which are faults in the *plans* rather than
in the scorer, and are the obvious next pieces of work:

- [ ] **`no-primary-space` fires on 36 of 117 generated concepts.** A third of plans do not make the
      room the brief says they are organised around the most generous one. `zone-planner.ts`
      positions the rooms and nothing sizes them by importance, so the primary zone gets whatever
      the composition's sketch gives it. **Effort: M**, in the zone planner.
- [ ] **`composition-off-brief` fires 42 times**, which is the same finding measured by area: an
      `open` concept that comes back under a fifth lawn, or a `planted` one under a quarter planting.
      The templates draw one composition per archetype whatever the emphasis. **Effort: M.**
- [ ] **`maintenanceFit` has a minimum of 0.000 across the fixture set**, so at least one low-upkeep
      brief is answered with a high-upkeep garden even though `resolveConstraints` forbids it a lawn.
      Worth finding: the demand is mostly planting share and bed count, neither of which the
      low-maintenance path caps. **Effort: S to diagnose.**
- [ ] **Two of three cards can share a composition *and* a lawn panel.** On the deep 20 × 30 m
      fixture the modern set comes back with two `destination_garden` concepts whose realised lawn
      outline is identical, though the plans differ everywhere else (56 elements against 49,
      different furniture, a second water feature in one). `choose.test.ts` passes, because the two
      **previews** genuinely differ — it is realisation that collapses them, since the lawn panel is
      `remainderPieces` of the same zone. The diversity signature is taken from the preview and
      cannot see that. Pre-existing; the brief-driven weights exposed it by pushing two slots onto
      one archetype, and `BRIEF_WEIGHTS=0` still gives three. **Effort: M.**
- [ ] **A vision critic behind the same interface.** The loop consumes `DesignIssue[]`, which now
      carries `source: 'geometry' | 'visual'` and is stamped once in `scoreSubject` rather than at
      thirty emitters — so a critic that returns issues from a rendered picture drops straight in and
      the repair pipeline cannot tell which produced what.
      The client renders the PNG (`DownloadPlanButton` already does) because the composer lives in
      the web app, and posts it with the element inventory; one vision call in `intent.service.ts`'s
      style returns issues validated so every subject is a real element id and every code is in
      `DesignIssueCodeSchema`. Tested with a fake client, never a live call. **Effort: L.**
- [ ] **Memoise the planting sample in `buildRenderScene`.** The measurement above says a scene build
      is ~34 ms and nearly all of it is re-sampling every bed, whether or not any bed changed. A cache
      keyed on the bed's outline, layers and maturity would cut a drag frame and an operation
      boundary by an order of magnitude. Not specific to this feature — it is the cost of every drag
      in the editor today. **Effort: S.**
- [x] **Decide whether a revision should outlive the session.** Decided and built, and the answer
      splits: **Undo and Compare persist; Replay does not.** `layout.revision` holds one record —
      the request, the garden `before`, and an `afterFingerprint` — reached from the panel by
      `CarriedOverRevision`. Not `layout.revisions` capped at three, as the plan first said: measured,
      one element list is 17KB against an 18.6KB document, so three records holding both sides would
      quadruple every autosave payload. The hash is what tells "still what the designer left" from
      "edited since", which is what `undoRevision` gates on. Replaying a redesign the next day would
      need the whole prepared timeline stored and nobody has asked for it.

## In flight — plan realism

- [x] **Phase 0 — foundations.** Green build and test, one-command `script/setup`, CI, TODOS.
- [x] **Phase 1 — schema and refactor.** Height manifest, `site.location`, `site.sun`,
      `DrawPass`/`RenderPass`. Proved byte-identical against the previous render.
- [x] **Phase 2 — render.** Sun model (suncalc), shadow layer, planting `form` axis, LOD policy,
      cut edges, water, one light everywhere, dev HUD, `before/` history, three diagrams.
- [ ] **Phase 3 — deliverable.** In progress. - [x] T18 error boundaries; API-down told apart from 404 (verified in the browser) - [x] T22 label truncation - [x] T17 project list, landing copy corrected, e2e flow added - [ ] T14 plan view with labels, legend and a quantity schedule - [ ] T15 print at true scale, chunked with progress - [x] T21 stale CLAUDE.md claims corrected and the decisions recorded

## In flight — the missing-products plan (plan: `~/.claude/plans/can-you-do-some-starry-willow.md`)

The gap analysis behind this: the vocabulary was strong on **areas** and **objects** and had nothing
for two other classes a real design is specified in — **linear products** (no linear quantity existed
anywhere) and **the third dimension** (`elevation` was a documented dead field). Plus two catalogue
gaps, lighting and depth.

- [x] **S1 assets that needed no model change.** `face-stone-setts` — the material every front path
      and access route is forced to, and the only paving with no photograph — plus
      `plant-shrub-topiary`, and top-ups on `tree-conifer`, `tree-japanese-maple` and the three
      one-variant timber faces. `plant-climber` was **pulled**: `taxonomy.test.ts` caught that
      nothing draws climbers, and generating them would pay for pictures the app never reads. It
      lands with a boundary-planting pass.
- [x] **S2 lighting.** `lighting` is the ninth `ElementCategory` — **not** `furniture`, because
      furniture is _hosted_ and a fitting is not (see CLAUDE.md). Four fittings, three finishes, a
      procedural `fx-light-pool`, `nightFraction` as a dusk ramp gated on `site.location`, and a
      generator scheme of uplights at trees and bollards down the longer paths. This is what makes
      the second half of Visualise's 24-hour slider mean anything: before it, 11 pm drew noon.
      `pnpm render:plan` writes `04-lighting-hours.png`.
- [x] **S3 linear products.** `DesignElement.edging` names a product; `plan/edging.ts` derives the
      runs from the outline they follow, dropping the sides against the fence and the house and
      refusing a seam two beds share. On the l-shape fixture that is 139 m of brick rather than
      196 m. First linear quantity in the app (`ScheduleLine.lengthM`). Five faces generated.
- [x] **S4 level changes.** `elevation` is drawn at last: a derived retaining face
      (`plan/levels.ts`), a shadow cast from the top of the plinth, and a flight of `steps` whose
      treads come from the rise. The model is **local** — no ground surface, nothing infers a slope.
      `retaining` names a walling material (stone, brick, rendered block) or keeps the plain
      upstand. `PLAN_DOCUMENT_VERSION` 3, no-op migration.
- [ ] **S5 services and structures.** ~~`greenhouse`~~, `bin-store`, `log-store`, `water-butt`,
      `compost-bin`. The first three are rectangles with regular structure, so they are geometry
      following `shedRoof`/`gazeboRoof` and need no photographs — only `tex-glass-roof`. The last
      two get sprites.
      **`greenhouse` landed early**, with the step-3 redesign: it is a requestable space now, so it
      needed a `SymbolId`, a `FEATURE_SPEC` and a drawing. It reuses `shedRoof` and adds
      `glazingBars` plus a glass wash rather than taking a `tex-glass-roof` texture — which is the
      cheaper answer and the one that survives an arbitrary rotation. `garden-room` and `hot-tub`
      came with it. The four left here are unaffected. An outdoor tap is deliberately excluded: 100 mm is under every floor in
      `lod.ts`.
      **Blocked in part:** the plan says "fold these into the arrival grammar", and the arrival
      grammar is not built — it is its own item below. So this splits into the objects (which ship
      hand-placeable on their own) and the placement, which waits.
      **Effort:** S for the objects, M for the placement once arrival lands.
- [ ] **A freestanding linear run.** Edging is a field on its host, so it cannot express a run with
      nothing either side — a kerb along a drive. That is exactly what the parking/driveway item
      needs, and it is the one thing the derived shape gives up. Answer is an element carrying a
      `hostId`, with the sync cost that implies. **Effort:** M, and only worth it with parking.
- [ ] **Climbers, and planting on a vertical surface.** Nothing covers a fence, a wall or a
      pergola, so every boundary in every plan is bare. Needs a drawing pass before the asset
      family is worth generating — see S1. **Effort:** M.

## In flight — drafted.ai-level plans (plan: `~/.claude/plans/i-am-making-a-steady-wadler.md`)

- [x] **P0 composer + `render:plan`.** `drawPlan`, three captured fixtures, judging sheets.
- [x] **P1 asset pipeline.** `tools/assets`, 82 files at the time, catalogue, registry, preload,
      cache key. (147 now — see the missing-products plan below.)
- [x] **P2 textured surfaces.** Faces per module, tiled textures, water, stripes over turf.
- [x] **P3 planting and trees.** Sprites per scatter unit, canopies inscribed, contact shadows.
      The paving kerb was tried and reverted (it drew a line down every shared edge).
- [x] **P4 furniture and structures.** `furniture` category, `symbol`, `furnish`, palette.
- [x] **P5 house, fence, labels.** Wall + floor, doors on steps 4/5, fence shade, no chip on furniture.
- [x] **P6 concept cards and PNG export.** Raster cards over the SVG; Download on steps 5 and 6.
- [x] **P7 generator composition, most of it.** Accent corners by style (`styleCornerRadius`),
      a different planting per run of border, `routeTo` paths to the gathering place and every
      far-from-house feature (and the finding that no path had ever been placed — see CLAUDE.md),
      specimen shrubs in beds, paths painted as stepping stones.
- [x] **P7 remainder, by another route — the layout grammar (run 2).** Planting drifts, formal
      symmetry and door-relative routing all fell out of composing the plan instead of sampling it.
      Step 1 captures access (gates on boundary edges, the street edge, front and patio doors,
      `AccessPanel`); the generator designs in a `DesignFrame` off the garden door, in a room that
      is the plot behind that wall; three layout templates (rectilinear, curved, formal) replace
      three archetypes as the axis the concepts differ on; features are fitted to slots before the
      sampler is asked; borders are `FillService.remainderPieces` (the annulus cut into runs) and
      each run gets its own planting; paths run terrace → far room, terrace → shed, gate → terrace,
      and front door → street. Not done: wedge-split drifts _within_ a run.

- [ ] **Layout grammar, next.** The deep limb of an L-plot beyond the door wall is left as border
      planting because the room is a half-plane: a second room per limb would design it. The curved
      template's kidney is one wave shape at one phase. Effort: M each.
      **Half done:** the brief's _purpose_ text is read now — `inferIntent` takes keyword hints from
      it, which is what turns a flat tick list into a ranked one. It still steers no slot directly;
      that waits on the zone planner.

- [ ] **Source art for the finer paving.** The slab and sett face photographs in
      `apps/web/public/assets/` were generated against 600 mm and 900 mm modules; they are now
      cover-fitted into 400 mm slabs, 300 mm setts and the pack's mixed units, so each unit shows a
      smaller crop of the same stone and the grain reads slightly large. Regenerate the paving
      families through `tools/assets` with prompts written for the new sizes — the spec _is_ the
      specification, so this is re-running the tool, not new code.
      **Effort:** S, and it needs `OPEN_AI_API_KEY`. Nothing is broken without it: the procedural
      pattern is what draws when a photograph is missing.

- [ ] **The fence border vanishes inside a deeply inset redesign area.** `borderRegions` grows its
      annulus from the **boundary** by `BORDER_WIDTH` (1.5 m), so a custom redesign area inset more
      than that from the fence intersects the annulus in nothing and the side and remote zones lose
      their planted borders entirely — they read as bare base fill.
      **Why it is not just widened:** growing the band from the *scope ring* instead would put a bed
      along the interior edge of the drawn area, which is defensible design but a different claim
      from "a border hugs the fence", and it would need its own `ST_NumInteriorRings` reasoning for
      an annulus that is no longer anchored to the plot.
      **Effort:** S–M, in `fill.service.ts` and the border pass of `concepts.service.ts`.

- [ ] **A concave redesign area makes plans sparser.** `localBox` is the *bounding box* of the
      clipped room, so an L- or U-shaped drawn area has the templates propose geometry across the
      notch; `fitInSlot` then refuses it and the feature falls through to the sampler. The plan is
      still legal and still inside the area — it is just less composed the more concave the outline.
      Same class as the existing L-plot limitation. `roomBehind` mitigates it where a template calls
      it. **Effort:** M.

- [ ] **A `scope` action from the garden assistant is a separate undo entry** from features added in
      the same sentence, because scope lives in `boundary-store` and features in `features-store`.
      One history over both stores would make Undo mean different things depending on which screen
      you are looking at, so this is recorded rather than "fixed". **Effort:** M if ever wanted, and
      it needs a cross-store transaction concept that does not exist today.

- [ ] **A Mediterranean style direction.** The style cards are pictures now, and "Mediterranean" is
      the one obviously missing look — gravel, olives, terracotta, clipped evergreens against pale
      render. It was deliberately *not* added with the rest of the brief redesign, because
      `StyleDirection` ids are branched on in a dozen places and a new one that falls through to
      the defaults would draw a garden identical to Modern. A card that produces the same plan as
      the card beside it is worse than no card: it makes the whole selector look like decoration.
      **Shape:** the id, then its own branches in `resolvePlantingStyle` (a Mediterranean palette),
      `materialFor` (gravel ground, terracotta or limestone paving), `TREE_PALETTES` (olive, fig),
      `styleCornerRadius` and `edgingFor` — plus a `style-mediterranean` photograph in
      `brief-art.ts`. **Effort:** M, and mostly palette work rather than layout.

- [ ] **The driveway surface.** *Everything but the paving is done*: a driveway is a `Gate` with
      `kind: 'vehicle'`, placed on a side from that side's editor, 3 m wide, drawn as a double gate,
      kept clear to a car's five metres by `gateThresholdDepth`, and never chosen as the side path's
      start (`sidePathGate`). No `site.parking` field and no version bump were needed after all,
      because the gap in the boundary is a fact about the side and the existing key already said
      which side. What is left is `front.ts` drawing a paved drive from that opening to the house,
      with the front path joining it — the suburban fixture already has a drive to judge it on.
      **Why:** the drive is the most visible difference between the traced target's front garden
      and any generated one. A front too small for a lawn is gravel today, which is honest but
      plain. Inferring a drive silently would draw a car space on plots that have none — the same
      mistake `suggestedDoorWall` and `site.location` exist to avoid.
      **Effort:** M. Independent of everything below.

- [ ] **Compose the arrival and the wide side, and tighten the composition bands.**
      **Why:** `COMPOSITION_BANDS` is asserted on the garden proper only. Over the whole plot the
      traced target shows 2% of base ground showing; generated plans show 5-46%, and the courtyard
      fixture's own room sits at 37-40%. The gap is the front garden (a path across a lawn) and the
      part of a wide side return that no room reached.
      **Shape:** an arrival grammar (bin standing, a bed against the street, a threshold) and a
      second room per secondary side; then re-derive the bands from the target and assert them on
      the whole plot rather than the room.
      **Effort:** M. Run `COMPOSITION_REPORT=1 pnpm --filter @garden-studio/api test reference-fixture`
      for the current table.
- [ ] **P8 optional AI hero render.** Segmentation map + plan PNG → image model, stored in a
      `plan_renders` table keyed on `revision`, gated on `RENDER_API_KEY` exactly like the assistant,
      labelled "AI impression — not the plan". Effort: M.

## Deferred by the Visualise image-quality pass (Sep 2026)

Three findings from the measurement pass. The first is the largest remaining lever on how the render
looks; all three are recorded rather than done because each is a different kind of work from the
grade and the shadows that shipped.

- [x] **Correct the over-saturated asset families at source, not at render time.** Done in the
      Asset Library v2 pass (17 Sep 2026): `AssetFamily.correction.saturation` is baked into the
      file by `processTexture` from the raw and recorded as `processed.correction`; play bark
      carries 0.68 there instead of at draw time. The plant and tree families were regenerated to
      the version 2.0 specification rather than re-processed, which is where the rest of the
      saturation went. The original note follows for the reasoning.
      **What:** re-post-process the checked-in assets so the catalogue's mean colours sit near the
      reference, starting with the outliers `measure:render` prints.
      **Why:** the loudest object in any plan that has one is the bark play area, and the cause is
      measurable rather than arguable — the `play` family means **0.509** saturation against a
      catalogue mean of 0.340 and a target scene of 0.334. `tree` (0.514), `hedge` (0.495) and `tex`
      (0.468) are the other outliers. A runtime grade cannot fix this: it moves the whole scene
      together, so pulling the bark down drags the lawn with it. Note the bark play area is a
      `feature`, not a `fill`, which is why the design review's "recede the base fills" rule would
      not have touched it — that rule was dropped for exactly this reason.
      **Pros:** fixes the cause; costs nothing at runtime; improves 2D Plan, the concept cards and
      the export equally, which a Visualise-only grade cannot.
      **Cons:** touches checked-in binary; changes 2D Plan, so it needs its own decision about
      whether the plan drawing may change, and the new golden gate will (correctly) fail until that
      decision is made. `--reprocess` has misfired once before by generating families that were
      meant to be excluded — check the guard before running it.
      **Context:** `tools/assets --reprocess` redoes post-processing from the kept raw PNGs with no
      image-model spend, and `pnpm --filter @garden-studio/web measure:render` prints the per-family
      table to aim at. **Depends on:** nothing. **Effort:** M.

- [x] **Flatter baked light in the vegetation art.** Done in the Asset Library v2 pass (17 Sep
      2026): specification 2.0's elevated camera asks for "gentle low-contrast self-shading only, a
      soft gradient across the object rather than a distinct lit side and dark side", and every
      elevated sprite was regenerated to it on `gpt-image-2.5-sunburst`. Judge it on
      `.plan-preview/asset-elevated-qa.png` and the `/asset-lab` lineup.
      **What:** regenerate the elevated vegetation sprites with softer, less directional baked
      shading.
      **Why:** the art is lit from the upper left and a located plan's sun moves, measured at about
      110 degrees of disagreement on the suburban fixture. Mirroring a sprite when the sun crosses
      was specified, reviewed and **cut**: Visualise has a time slider stepping in fifteen minutes,
      so the flip is a step function and the whole garden would jump in one step — a louder artefact
      than the constant offset it removes, and it fixes only the left-right half. Less directional
      art removes the whole problem instead of half of it, with no artefact.
      **Pros:** no runtime cost, no discontinuity, fixes the up-down half too.
      **Cons:** an asset regeneration with real image-model spend, and flatter art has less form, so
      it trades one kind of realism for another and needs judging on a contact sheet.
      **Context:** CLAUDE.md records the current fixed offset as reading ambient rather than as a
      contradiction, which is why this is an improvement and not a bug fix. **Depends on:** the
      asset correction above — same pipeline, do them in one pass. **Effort:** M.

- [ ] **`designedBeds` floors leave a small back garden with no planting.**
      **What:** give `layout/beds.ts` floors that degrade rather than bail.
      **Why:** the back garden's planting comes only from `designedBeds`, which stops below 3 m wide
      or 1.4 m deep, so a small plot gets a lawn, a patio and nothing else, and nothing on screen
      says why. **Do not "fix" this by reviving the main zone's `borderRegions` call** — that call
      existed, was dead (anything under `MIN_FILL_SIDE` returns `[]`), and was deliberately removed;
      `concepts.service.ts:1688-1702` carries the comment explaining it. The image-quality plan
      listed reviving it as a task and it was dropped on this evidence.
      **Pros:** the actual cause of the bare-small-garden complaint; verified, with a 10/10
      confidence prior learning behind it.
      **Cons:** generator geometry rather than rendering, so it moves generated output and forces a
      fixture recapture and a composition-band recheck.
      **Context:** prior learning `design-app-main-zone-border-call-is-dead`, 2026-09-10.
      **Depends on:** nothing. **Effort:** M.

- [ ] **Nothing exercises a near-empty plan in Visualise.**
      **What:** a fixture with a boundary, a house and almost nothing else, on the judging sheet.
      **Why:** every fixture is a fully generated design, so the sheets say nothing about what a
      user sees immediately after step 1, which is the first Visualise anyone ever opens. The grade,
      the shadow buckets and the depth-sorted stack are all untested against a scene with no
      planting and no surfaces.
      **Pros:** covers the first-run experience, which is the one nobody is looking at.
      **Cons:** one more fixture to keep captured, and it will mostly draw grass.
      **Context:** raised by the design review's states pass. **Depends on:** nothing.
      **Effort:** S.

## In flight — the elevated Visualise (plan: `~/.claude/plans/read-prompt-1-md-and-plan-kind-music.md`)

- [x] **Phase 1 — the specification.** `docs/visualise-asset-style.md`; `AssetFamily.camera` and
      `heightMetres` with `assetsMatching` defaulting to `plan`, so no existing query changed its
      answer; the `ELEVATED` preamble and six prompt templates; `elevatedFrame`/`elevatedAnchor`;
      `opaqueBounds` and `footAlpha` on the catalogue; `--strict` QA and `--audit` in
      `tools/assets`; the elevated QA contact sheet in `audit:assets`.
- [x] **Phase 2A — the code foundation.** `lib/render/camera.ts` and `projection.ts` (`RISE`,
      `lift`, `extrude`, `visualBounds`, `depthOf`); `RenderScene.stack` with `RenderExtrusion`,
      `RenderObject` and `RenderHouse` nodes; the Canvas2D stack painter; Pixi drawing the same
      stack with per-node cached rasters. **Gate held:** all 22 plan-view judging sheets are
      byte-identical.
- [x] **Phase 2B, the consumer.** `elevatedPlacement` places a sprite on its own frame at its
      anchor, `elevatedFamilyFor` translates an element's symbol or tree species to its twin,
      `chooseAsset` swaps a plant's family after resolving it in the plan camera, and `foldRotation`
      narrows vegetation to ±15° because an elevated sprite carries its own light. Both backends
      call the same placement function, which is how they are kept in agreement given Pixi cannot be
      pixel-tested.
- [x] **The elevated library is generated — 28 sprites and 4 skins.** Trees, shrubs, grasses,
      every piece of furniture, the play equipment, the planters and the four structure skins.
      **Note for the record:** the plant families were generated by accident, on a `--reprocess`
      run that was meant to re-measure finished assets and instead bought every family with no raw.
      The flag is fixed and the pictures are good, but they were not asked for.
- [x] **Three plan families share one elevated twin.** `vis-shrub-architectural` and
      `vis-shrub-topiary` exist and are generated (Asset Library v2, 17 Sep 2026); `ELEVATED_TWINS`
      points each plan family at its own.
- [ ] **The interim lift stays for anything with no twin**, and should: a plan sprite drawn at half
      its own height reads as standing up and costs nothing. It is only an approximation, so expect
      a family to look slightly better the day its twin lands. Nothing to do until the library is
      complete, at which point the branch can be deleted.
- [x] **The house as a building.** An eaves overhang (`EAVES_OVERHANG`, visualise only, built on a
      new `outsetPolygon` in the schema's geometry helpers), the shade the eaves throw on the wall
      below, and the doors and windows drawn on the wall faces the camera can see — every number
      from the document's own `sillHeight`, `floorLevel` and `OPENING_HEIGHTS`. **Trap worth
      keeping:** a frame inset by the same width horizontally and vertically is invisible, because
      a metre up the wall is `RISE` metres of screen. Divide the vertical inset by `RISE`.
- [x] **Sheds and gazebos as buildings.** `STRUCTURE_OVERHANG` on the four roofed symbols, the
      eaves shade below it, and the boarding drawn to the roof line rather than to the footprint.
      **Two traps, same cause, both recorded in CLAUDE.md:** a shed's roof is a translucent wash
      over its boards, so a shadow drawn beneath it shows through, and an oversail with no boards
      under it composites over the grass as a grey frame.
- [x] **Materials on the faces.** `PatternContext` gained `transform`, which is what a
      parallelogram face needs and translate/rotate cannot give; `paintSkinnedFace` tiles a material
      along the wall at its real size at any rotation. Skins resolve from what the renderer already
      knows — a boundary's kind, an element's own material, a named default for the house. The four
      `skin-*` textures are generated.
- [x] **Steps, retaining walls and kerbs in 2.5D.** A flight descends as `risers` banded treads
      rather than rising as a block; edging courses are extruded by `EDGING_HEIGHTS`, which is
      **exposed** height not product height; retaining walls were already extruded and are now
      visible on a sheet. `12-levels.png` is synthesised from the reference fixture, because no
      captured fixture has a level change at all.
- [ ] **Roof detail is what is left of the house.** Ridge and hip capping, more tone variation
      across the slates, possibly a rooflight. **Effort:** S-M, no new assets.
- [ ] **No fixture exercises levels, so only the synthesised sheet does.** Worth capturing a
      formal-at-premium fixture next time `capture:fixtures` is run, so a real generated plan with a
      raised terrace joins the eleven. **Effort:** S, needs the API up.
- [ ] **The rotation and depth judging sheets (Phase 3).** `05-rotation` (one shed, sofa, dining
      set and tree at 0/45/90/180/270) and `06-depth` (a canopy over a roof edge, a border against
      the near and far fences, a dining set under a pergola). The furniture rotation decision —
      one asset or four directional variants — is meant to be made on that sheet and cannot be
      made before the art exists. **Effort:** S.
- [ ] **Two suns: the art is lit from the upper left and a located plan's is not.** Measured on the
      suburban fixture (Manchester, day 172, 15:00) `lightDirection` is `{-0.91, +0.41}` — the sun is
      low in the west, below and left — while every generated sprite is lit from the upper left.
      An *unlocated* plan has no disagreement at all, the art is deliberately low-contrast, and the
      cast shadows still follow the real sun, so it is tolerable rather than fatal. The cheap partial
      fix is mirroring a sprite horizontally when the sun crosses to the right; the expensive ones
      all give up either the time slider or the form the elevated library exists for. **A decision,
      not a bug.** See the style doc's "The cost, measured rather than assumed".
- [ ] **A side fence shows no face, by construction.** A wall running up and down the screen is
      edge-on to a vertical lift. It reads through its posts, its shade band and its cast shadow.
      Revisit only with evidence from a real plan that it is not enough; the fix is leaning the
      lift diagonally and it costs the measurable-footprint guarantee. **Effort:** L, and probably
      wrong.
- [ ] **Product catalogue and estimate** (deferred by decision: designs first). `symbol` and the
      furniture materials are what it keys on.
- [ ] **Small:** every furniture palette button shares the armchair icon; the PNG download click
      has no e2e test (the drawing does); the sun-lit/unlit shed pitches deserve a felt texture;
      the lawn's zone base fills still repeat the same tile phase across the seam (correct, but a
      keen eye can find it).

- [x] **Nobody has clicked any of this.** Done: the app was driven with Playwright. Shadows
      appear once a location is set, the time slider moves them correctly, the sun panel is
      reachable from step 1, a missing plan and a stopped API now show different screens, and a
      saved plan can be found again from the front door. No page or console errors.

- [ ] **`next dev` rewrites `apps/web/AGENTS.md` on every run.** It is a generated file that keeps
      reappearing as an uncommitted change. Its warning is real and was worth heeding — following
      it caught `reset` vs `retry` in the error boundaries — so commit it rather than fight it.
      **Effort:** trivial.

---

## Findings worth acting on

- [ ] **T9 is smaller than estimated — it needs a `form` axis, not a new symbol layer.**
      **Why:** looking at `.material-preview/08-materials-close.png` shows the blob renderer
      already does the hard part — irregular lobed outlines, per-unit tone, a highlight scaled
      from the unit's own outline, size range, overlap. What is missing is that every planting
      material uses the _same round blob_ and differs only in size, density and hue. That is
      why `ornamental-grasses` reads as pale cauliflower and `hedging` reads as loose blobs
      rather than a clipped mass.
      **Shape:** add `form` to the scatter pattern in `material-patterns.ts`. `blob` is the
      current behaviour (shrubs, ground-cover). Two genuinely new forms are needed:
      `tufted` (radiating linear strokes — grasses) and `clipped-mass` (continuous body with a
      defined edge — hedging). `wildflower` and `mixed-border` already work because colour
      variation substitutes for form.
      **Effort:** revises T9 down from 3-4 weeks. Re-estimate once `tufted` is prototyped.
      **Blocked by:** Phase 1 (`RenderContext`).

- [ ] **The whole-plan preview (T19) should render a shadow-hours sheet.**
      **Why:** a throwaway script that drew the same plot at 09:00, 12:00, 16:00 and 19:00 was
      how the shadow layer got verified, and it was far more informative than any single frame —
      the noon ratio of 0.58 visibly matches `1/tan(60 degrees)`, and the 19:00 frame is the one
      that shows the house throwing a diagonal across the garden. Four frames across a day should
      be a permanent case in the preview script, not something rebuilt each time.
      **Blocked by:** nothing. Small once T19's whole-plan rendering exists.

- [ ] **A blob's shading threshold compares a radius against a full-dimension constant.**
      **Why:** `drawBlob` skips its highlight when `radius < MIN_SHADED_PX` (12), where the module
      path compares the module's full width against the same 12. So a blob 16 px across goes
      unshaded while a slab 16 px across is lit. Probably over-conservative for planting.
      **Not changed** when the LOD policy was unified, deliberately: that refactor's gate was that
      it altered no pixels, and it was proved byte-identical against the previous run. Correcting
      it is a tuning decision to make on its own, with the contact sheet open.
      **Effort:** S.

- [ ] **The API test suite truncates the dev database.**
      **Why:** `apps/api/src/test/db.ts` runs `truncate table plan_projects`, against the same
      Postgres `pnpm dev` uses. So `pnpm test` silently deletes every plan you were looking at,
      which cost time twice while verifying the review screen. Not wrong — the tests need a clean
      table — but it should either use a separate database or say so in the README.
      **Effort:** S.

- [ ] **The schedule cannot give net areas, only drawn ones.**
      **Why:** ground cover is the full zone with everything laid over it, so the table groups by
      layer and says the groups overlap rather than pretending to a net figure. The exact remainder
      IS computable — `FillService.accentRegions` already does it server-side with PostGIS — but
      deriving it on the client from element areas would lean on the generator's disjointness
      guarantees, which the editor breaks the moment someone drags one bed over another.
      **Fix when:** the print sheet needs orderable quantities. Compute it on the server.
      **Effort:** M.

- [ ] **`shrubs` density leaves too much soil showing at plan scale.**
      **Why:** `{density: 2.4, sizeRange: 700-1250mm}` reads as sparse blobs on brown at the
      zoom the plan is actually judged at. `material-patterns.ts` documents the rule that
      `density x mean unit area` must stay appreciably above 1 so units overlap — worth
      re-checking that arithmetic for shrubs specifically against the contact sheet.
      **Effort:** S. Tune and look, no new code.

---

## Deferred from the CEO review

- [ ] **Sun-aware generation.** Once `site.location` and the height manifest land, the PostGIS
      placer could put seating in afternoon sun and shade-tolerant planting in the house's
      shadow, and defend both. This is the real research contribution and it is deliberately
      out of scope for the current pass.
      **Blocked by:** Phase 1 (heights + location must be in `packages/schema`, which they are
      being put in specifically so the server can read them).

- [x] **Evaluation harness.** `pnpm --filter @garden-studio/api eval:generator`, over 13 cases × 3
      seeds: constraint satisfaction, composition bands, design score per principle, requested-feature
      inclusion, determinism and latency by plot scale. Built on the design agent, because the three
      easy measures were always available and "is this a good garden" was not.
      **Baseline, on the generator as it stood:** 117/117 valid, deterministic, mean score 0.851
      (min 0.748), no critical faults, 85% of requested features drawn, 129 ms – 5.2 s per set of
      three. Take a fresh baseline before changing the generator: a number measured afterwards can
      only confirm whatever the change did.
      **It found a crash on its first run** — `ST_UnaryUnion` throwing `TopologyException` on a
      self-intersecting path strip, on an L-shaped plot, at three of four call sites. Fixed, and the
      fix is four times faster than not guarding at all (see CLAUDE.md).

- [x] **Functional zones and layout archetypes.** Seven compositions, each answering for itself
      whether a plot can hold it, with the style weighed evenly against the site and a refusal
      honoured. Four are shapes the three templates could not express (side-by-side, linear
      sequence, courtyard, destination). Zones position the rooms and features are fitted inside
      them; `Slot.zoneId`, `strategy` and a real `explanation` are on the wire. The template
      geometry did not move — `golden.test.ts` pins it to a nanometre until the candidate loop lands.
      **Measured**: mean score 0.851 → 0.865, relationships 0.50 → 0.66, `route-missing` 59 → 46,
      `shed-in-view` 43 → 31, suburban fixture 4.6 s → 1.2 s.

- [x] **Candidates and scoring between them.** `design/choose.ts` enumerates every suitable
      composition against its variations, previews each with no query (`design/layout-generator.ts`),
      scores the field and picks the best that is not too like the other slots'. Routing left the
      service (`design/circulation.ts`) and `ST_ClosestPoint` went with it; `assignByPriority` tries
      a feature's own room before its slot ladder; `rng.mix` fixes the seed collision nesting
      `conceptSeed` would have caused.
      **Measured**: worst plan 0.680 → 0.739, eight of eleven comparable fixtures up, mean flat at
      0.865, every case still valid and deterministic. The mean is flat because the preview and the
      realised plan differ — see the next item.

- [x] **Repair, and closing most of the preview/realised gap.** `design/repair.ts` takes a chosen
      candidate's worst repairable fault, changes the one thing the scorer named, redraws the layout
      and keeps it only on a measured rise with nothing critical introduced. What it accepts travels
      into realisation as `LayoutAdjustments` rather than staying a preview-only fiction. Two thirds
      of the gap closed with it: the preview now draws the access-guarantee paths the real pipeline
      adds, and both sides place features in the same priority order through `assignByPriority`.
      **Measured**: 24 repairs across 15% of concepts; relationships 0.668 → 0.717, privacy 0.987 →
      1.000, buildability 0.970 → 0.989, mean 0.865 → 0.872, minimum held at 0.739. One plan went
      0.74 → 0.92. A repair is accepted about one time in six it is tried, which is the gate working.
      **What the benchmark caught in my own loop**: barring a slot can leave the feature *unplaced*,
      and a preview with no store in it has no store in the sightline either — the score rises, the
      sampler puts the store back at realisation, and the plan is worse. `keepsWhatItPlaced` is the
      guard and there is a test named after the fixture that found it.

- [ ] **`placement.candidates` is the dominant cost of generation, and nothing has ever profiled it.**
      948 calls and 74 seconds of a full harness run — more than every other query put together, and
      four times `remainderPieces`. It computes `zone − union(obstacles)` eroded by the footprint's
      inradius and samples it with `ST_GeneratePoints`, and it gets markedly slower when the
      arrangement is more complex: aligning the preview and the built plan cost the suburban fixture
      1.5 s → 5.1 s with no change to the number of calls. Worth attacking before anything else about
      performance, and worth knowing that the pure design layer is *not* the cost — the whole
      candidate loop is about 100 ms per concept, measured. **Effort:** M.

- [ ] **Two faults the repair stage cannot reach, and both want their own answer.**
      `too-many-materials` (84, the commonest by a distance) is not a layout fault at all — a modern
      plan uses paving, setts, turf and gravel against a cap of three, so it is `materialFor` reusing
      the terrace's paving for routes. `seating-in-shade` (72) asks to move a terrace that goes
      across the garden doors because that is what a terrace is; the designer's answer on a
      north-facing plot is a *second* sitting area in the sun, which nothing composes yet.
      **Effort:** S for the materials policy, M for the second sitting area.

- [ ] **Realising a runner-up per slot, so the choice is made on realised scores.** The other third
      of the preview/realised gap. Three finalists plus one runner-up each, tier-2 scored, better
      kept — which needs `realise.service.ts` extracted from `concepts.service.ts`, still 2,300 lines
      of deciding and drawing. Blocked on the query cost above: six realisations at today's prices is
      ten seconds on the biggest fixture. **Effort:** M for the extraction, S for the selection.

- [ ] **A circulation graph, rather than a list of paths per composition.** Routes are still whatever
      each composition's sketch lists, plus a guarantee that every feature gets one. The zone planner
      already produces `ZonePlan.adjacency` — which rooms should connect — and nothing reads it.
      Deriving the routes from it is what would let the scorer's circulation principle and the
      generator agree about what a route is *for*, and is the other half of `route-missing` (49) and
      `route-dead-end` (18). **Effort:** M.

- [ ] **The side lounge still lives in `concepts.service.ts`** rather than in the zone planner. It
      resolves in world space through `sideRoomRect`, and moving it would put world geometry inside
      a layer that is deliberately pure and frame-local. It belongs with `realise.service.ts` being
      extracted. **Effort:** S, once that extraction exists.

- [x] **`golden.sketches.json` — kept, not deleted.** The plan said to delete it once sketches varied
      on purpose. They do vary now, and the golden still pins the three original compositions at
      their **default** parameters, which is exactly the case a future change to the shared sketch
      helpers would break silently. It costs one file and 85 fast assertions, and it is the only
      thing standing between `terraceDepth`/`lawnStart`/`behindTerrace` and an unnoticed regression.
      Regenerate with `CAPTURE_TEMPLATE_GOLDEN=1`, and only ever with a reason.

- [x] **The strategic brief from a model.** `assistant/design-brief/` — one call per generation,
      cached on the rendered inputs so rerolling a slot pays nothing, reconciled field by field by a
      pure function in the design layer, and gated off by `DESIGN_BRIEF_LLM`. Every failure path
      returns the deterministic brief, so generation cannot fail because of the model; there is a
      test walking all seven. Writing it also closed a gap it would otherwise have widened:
      `archetypeShortlist` was written by the brief builder and read by nothing, so a model writing
      into it would have been the third "tick the design ignores" in these notes.
      **Measured**: benchmark unchanged with the flag off, which is the point. The first attempt at
      making the shortlist count — a tenth of a point of bonus — cost mean 0.872 → 0.868 and the
      worst plan 0.739 → 0.680, so it was cut back to deciding only between compositions the plot
      scores level.
      **Not verified on this path**: no live call has been made through the strategic brief itself.
      The prompt cache it shares with the other two assistants *has* been measured and works — see
      the cache note in CLAUDE.md — and `logAssistantUsage` reports this call's own usage when it
      runs. This is the call where cost matters most: once per generation, not once per question.

- [ ] **Maturity toggle (year 1 vs year 5)**, NOT a seasonal toggle. A density-and-size scalar
      over the planting forms. Answers "how long until it looks like this", which is the second
      question every real client asks after cost. The seasonal framing was rejected: it
      multiplies palette work by four, entangles with the sun model, and makes a horticultural
      claim the catalogue cannot support (it holds `mixed-border`, not species names).
      **Effort:** ~3 days once forms exist.

- [ ] **3D preview.** `three`, `@react-three/fiber` and `@react-three/drei` are installed and
      entirely unused. The height manifest from Phase 1 is exactly what R3F would need, and the
      property now carries the rest of it: `house.storeys` through `houseHeight`, per-side
      `BoundaryRun.height`, and every door and window with an offset, a width and a sill. What is
      still missing is a ground model, which is a deliberate refusal — see `levels.ts`.
      Either build it or drop the dependencies — carrying an unused 3D stack is bundle weight
      and a question a marker will ask.

- [x] **Drag a gate or a door along its side on the plan.** `AttachmentHandle` does it for both,
      projecting the pointer onto the parent segment so the thing cannot leave it; end handles
      resize and appear only once the span is big enough to have ends worth grabbing. `SegmentTrack`
      gives a side the same unrolled strip the wall has. Not done: dragging on *touch* — the stage
      still binds mouse events only, which is a pre-existing gap.

- [x] **Verify the live Anthropic call, and measure the prompt cache.** Done, and it **reverses**
      the guess that preceded it. Two calls with the identical system prefix against `claude-opus-5`:
      the first wrote 1,417 tokens into the cache and read 0, the second wrote 0 and read **1,417**.
      So the breakpoint on `ASSISTANT_RULES` earns its place. The estimate that said it might never
      hit was wrong twice: it took ~800 tokens from a characters-over-four heuristic where the real
      tokenisation is 1,417, comfortably over the 1,024-token minimum. `logAssistantUsage`
      (`assistant/usage.ts`) now reports input, output, cache write and cache read on every call
      from all three assistants, and warns in words when a breakpoint neither writes nor reads —
      so this cannot quietly stop being true. Counts only: never the prompt, never the key.

- [ ] **Write a DESIGN.md.** Every review of this project's UI calibrates against `globals.css` and
      prose, so each panel re-decides its own spacing, type sizes and control heights from scratch —
      which is how the editor came to have two AI panels in two visual registers. A written system
      would have made that a diff rather than a discovery. **Effort: S**, and it pays for itself on
      the next panel.

- [x] **Feedback telemetry.** `design_events` (jsonb payload, cascading from the plan),
      `POST /plan-projects/:id/events`, and a batching fire-and-forget emitter in
      `apps/web/src/state/design-events.ts`. Eight kinds — concept chosen and regenerated, element
      added, moved, resized and deleted, layout reset, plan exported — each stamped with the
      composition the garden was drawn from, which is what turns "somebody deleted a shed" into a
      statement about a *composition*. One event per gesture, the same unit the undo stack uses.
      **Nothing in `generation/design/**` reads it, deliberately**: a scorer consuming its own
      feedback closes the loop and stops being inspectable.
      **It also fixed a trap recorded twice in CLAUDE.md**: the shared test helper truncated
      `plan_projects`, which deleted the developer's open plans and — once a second suite wrote rows
      — deleted the neighbouring suite's data mid-test, because vitest runs files concurrently. Each
      suite cleans up only what it created now and the helper is gone.

- [ ] **Read the table.** The events are collected and nobody has asked them anything. The first
      questions worth asking are the cheapest: which composition is chosen most, which is rerolled
      most, and which element category is deleted first after a concept is taken. A script beside
      `eval:generator` reporting those three would be the first time the generator has been measured
      by something other than its own scorer. **Blocked by:** having any real usage at all.
      **Effort:** S for the script, and the rest is a user study.

- [ ] **Mobile / responsive.** Not mentioned anywhere in the codebase or any review. A garden
      plan on a phone is a real question (pinch-zoom on Konva, panels that do not fit).

---

## Smaller

- [ ] `.vscode/extensions.json` recommending Prettier and ESLint. `.gitignore` already writes
      `!.vscode/extensions.json`, so the intent was recorded and never acted on.
- [ ] Sub-headings and a generated table of contents for `CLAUDE.md`'s "Decisions worth
      knowing" — 490 unindexed lines carrying most of the document's value.
- [ ] Correct three stale `CLAUDE.md` claims: the API key IS present; `node` IS on the Bash
      tool's PATH (v24.20.0 — the PowerShell warning applies to `pnpm install` postinstall
      steps, not to running scripts); the landing page copy contradicts the README on
      persistence.

---

## Decided against — do not revisit without new information

- **Devcontainer.** Would permanently kill toolchain drift, judged heavier than the problem.
- **Full Renovate / Dependabot version PRs.** Security advisories only. Revisit once CI is
  green and the 963 tests actually gate upgrades.
- **CONTRIBUTING.md, issue templates, examples/.** No contributor audience exists.
- **Material-pair edge table.** 784 combinations that cannot be tuned or tested. Edges are
  keyed on the 7-category pair instead.
- **Server-side PDF rendering.** Would add an unauthenticated endpoint spawning a headless
  browser on an API that has no auth and must stay on localhost.
- **Costing in currency.** `Material.cost` is a relative 1-4. Quantities are defensible,
  prices are not.
