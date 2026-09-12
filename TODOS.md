# TODOS

Deferred work, with enough context to pick it up cold. The setup script reads the first
few unchecked boxes and prints them, so keep the most relevant item near the top.

Full decision record for the current scope:
`~/.gstack/projects/adammat2004-design-app/ceo-plans/2026-08-30-plan-realism.md`
Implementation plan: `~/.claude/plans/can-you-look-at-peaceful-lemon.md`

---

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
- [ ] **S5 services and structures.** `greenhouse`, `bin-store`, `log-store`, `water-butt`,
      `compost-bin`. The first three are rectangles with regular structure, so they are geometry
      following `shedRoof`/`gazeboRoof` and need no photographs — only `tex-glass-roof`. The last
      two get sprites. An outdoor tap is deliberately excluded: 100 mm is under every floor in
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
      planting because the room is a half-plane: a second room per limb would design it. Slot
      preferences are a fixed table rather than anything the brief's _purpose_ text touches. The
      curved template's kidney is one wave shape at one phase. Effort: M each.

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

- [ ] **Evaluation harness.** Benchmark over the generator: constraint satisfaction rate,
      requested-feature inclusion rate, determinism, latency by plot scale. The codebase is
      unusually ready for this — generation is seeded and `geometryIsLegal` is a ready-made
      oracle. **This is the biggest remaining risk to the mark** and nothing else in the plan
      addresses it. **Priority: P1 once Phase 2 lands.**

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

- [ ] **Verify the live Anthropic call.** `ANTHROPIC_API_KEY` is now present in `apps/api/.env`
      and the path has never been exercised — every assistant test mocks the SDK. Check
      `usage.cache_read_input_tokens` on the first real call before claiming the caching win.
      Note `CLAUDE.md` still says there is no key; correct that at the same time.

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
