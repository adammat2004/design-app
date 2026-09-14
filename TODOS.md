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

- [ ] **Correct the over-saturated asset families at source, not at render time.**
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

- [ ] **Flatter baked light in the vegetation art.**
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
- [ ] **Three plan families share one elevated twin.** `plant-shrub`, `-architectural` and
      `-topiary` all map to `vis-shrub-evergreen`, so a bed that had three shrub photographs now has
      one. The fix is `vis-shrub-architectural` and `vis-shrub-topiary` families, not a code change.
      **Effort:** S, 5 images.
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
      **Not verified**: no live call has been made. `usage.cache_read_input_tokens` on the first one
      is the number that confirms the prompt-cache breakpoint is earning its place.

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
