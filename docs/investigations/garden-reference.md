**Garden realism and editor reference investigation — 5 September 2026**

The strongest next step is one representative garden rendered convincingly through the existing editable plan system, followed by the editor layout changes. The app already has geometry, photographic assets, planting schemes, shadows, and movable plants. The remaining work is composition, render ordering, art direction, and presentation.

The reference visually resembles a near-overhead architectural render with depth, detailed foliage, and an editor over it. Its production method cannot be established from the screenshot. A full 3D scene is an option for its richer depth, but the current 2D renderer has specific shortcomings to resolve before deciding that a replacement is necessary.

**Evidence and limits**

Inspected the current working tree, including the ongoing planting changes and the existing implementation plan. Rendered all three saved fixtures through `drawPlan`; all 114 catalogued local assets loaded successfully. Also executed `shadowOccluders` against each fixture's trees; the source and compiled package both exclude them.

| Saved fixture | Elements | Placed plants, including trees | Trees | Tree cast-shadow occluders |
| --- | ---: | ---: | ---: | ---: |
| Suburban | 30 | 7 | 2 | 0 |
| L-shaped | 24 | 6 | 2 | 0 |
| Courtyard | 11 | 2 | 2 | 0 |

Fresh rendered evidence: [suburban](/private/tmp/garden-reference-investigation/suburban-current.png), [L-shaped](/private/tmp/garden-reference-investigation/l-shape-current.png), [courtyard](/private/tmp/garden-reference-investigation/courtyard-current.png). These temporary files show the current renderer on saved layouts; concepts were not regenerated through the API.

Browser inspection was unavailable: no browser surfaces were connected and the in-app browser was unavailable. Editor findings below are from source inspection, not a live interaction or performance test. Application source was not changed. The API test suite was not run; the repository records that it truncates the development database.

**What accounts for the visual gap**

| Reference | Current evidence | Required change |
| --- | --- | --- |
| Garden occupies most of the central view; house is a narrow context strip | Whole-property renders devote substantial space to the house and front garden | Offer “Fit garden” alongside “Fit plot”; compare the same garden extent and screen scale |
| Lawn, beds, terrace and destinations form one composition | Most main-garden beds are the space remaining after other features are placed | Design beds and lawn together, with explicit planting bays, focal points and circulation |
| Foliage has distinct light, dark, flowering and architectural groups | Infill looks muted and repetitive, with flatter shading than the large tree sprites | Preserve foliage contrast; tune grouping, scale and colour at normal viewing size |
| Shadows connect plants and structures to surrounding surfaces | Trees are excluded; beds cast as whole polygons; feature surfaces paint over the shadow pass | Separate ground receivers, shadow casters and raised objects |
| Edges feel physical and structures have depth | Persistent feature outlines, simple shed/pergola geometry, repeated hedge discs and a flat house footprint | Material-aware edges, slat shadows, roof detail and richer boundary rendering |
| Image-led catalogue and focused property panel | Category icons, generic shape thumbnails, dense controls and long element lists | Reuse render assets for cards and make controls specific to the selected object |

**Confirmed renderer issues to address first**

1. **Trees currently lose their cast shadows.** `shadowOccluders` skips `isPlantSymbol(element.symbol)`, whose membership includes all five tree symbols. The comment assumes the surrounding bed's shadow covers the plant; that does not hold for a tall tree or a plant moved onto lawn. Restore tree occluders, then decide a separate policy for low infill and individual shrubs. Existing contact shadows remain, so this is specifically a missing directional shadow. See [shadows.ts](../../packages/schema/src/plan/shadows.ts) and [symbols.ts](../../packages/schema/src/plan/symbols.ts).

2. **Render ordering confuses design role with physical height.** `firstFeatureIndex` inserts shadows between `fill` and `feature`. In the suburban fixture, the patio, stepping-stone paths and play surface are all features, so their opaque surfaces are painted after shadows. A structure also combines its ground surface and overhead geometry in one drawing. Build a shared pass resolver that draws ground surfaces before their received shadows and elevated objects afterward. Use it in both the Konva editor and the export composer. See [render-plan.ts](../../apps/web/src/lib/materials/render-plan.ts) and [EditorCanvas.tsx](../../apps/web/src/components/plan/editor/EditorCanvas.tsx).

3. **Tinting flattens planting detail.** Despite comments describing a multiply treatment, `tintSprite` uses a solid `source-atop` colour wash at strength `0.3`. For opaque pixels, this reduces within-sprite RGB differences to 70% of their original values. The later asset prompts also request desaturated foliage without strong highlights or shadows. Compare untinted, lighter-tinted and luminance-preserving versions on the same bed before replacing assets. Keep directional ground shadows separate from leaf-scale depth. See [sprite-tint.ts](../../apps/web/src/lib/materials/sprite-tint.ts) and [asset-spec.ts](../../apps/web/src/lib/materials/assets/asset-spec.ts).

4. **Planting exclusions exist but are not connected to the painter.** The sampler accepts exclusion outlines, but `paintPlantingLayer` calls `samplePlanting(outline, layer, seed)` without them. The browser surface hook and export composer do not supply neighbouring plant footprints. Consequently, moving a structural shrub does not create the promised gap in the bed's infill. Feed relevant local exclusions into both rendering paths and their cache keys, with a defined refresh policy during dragging. See [planting-sample.ts](../../packages/schema/src/plan/planting-sample.ts), [render-surface-pattern.ts](../../apps/web/src/lib/materials/render-surface-pattern.ts) and [use-surface-pattern.ts](../../apps/web/src/lib/materials/use-surface-pattern.ts).

5. **The clean render still draws technical outlines.** `drawSurface` strokes non-fill surfaces at a fixed 1.75 pixels, including stepping-stone path ribbons. These white/light boundaries contribute to the cut-out appearance. Separate physical material edges from selection and measurement overlays, keeping outlines on selected objects where useful. See [render-plan.ts](../../apps/web/src/lib/materials/render-plan.ts).

**Garden composition and assets**

The earlier work already changed the base fill to `palette.base`, added asymmetric borders to the rectilinear template, and created movable structural plants. Those are useful foundations. They do not yet introduce explicitly designed beds: [LayoutSketch](../../apps/api/src/plan/generation/layout/sketch.ts) has terrace, lawn, slots, paths and trees, but no bed collection. The main-garden branch still calls `remainderPieces(zone − rooms)` in [concepts.service.ts](../../apps/api/src/plan/generation/concepts.service.ts).

Add designed bed shapes to the sketch and coordinate them with the lawn before fitting and validating. Give the reference-like concept a generous central lawn, an asymmetric specimen bay, a terrace-edge bed, a utility corner and a distinct seating destination, sized to the actual brief and available space. Keep the formal template intentionally formal. The [curved template](../../apps/api/src/plan/generation/layout/templates/curved.ts) currently uses 28 samples, a fixed 13% wave amplitude and a gate-dependent phase; varying a sinusoid alone will not produce a family of deliberately composed gardens. The L-shaped fixture also needs a useful second garden area where it currently shows a large field of planting.

Judge planting by recognisable groups and height hierarchy, not a global density increase or decrease. The reference is lush, but individual crowns, flower groups and dark gaps remain legible. Its important assets include a red-leaf specimen tree, varied green crowns, bold-leaved shrubs, flowering perennials, a convincing pergola and furnished seating areas. Start with a small curated set, consistent overhead framing and lighting, accurate footprint fitting, clean transparency and restrained colour correction. Preserve deterministic asset choices across rerenders. A richer catalogue comes after these assets work together in one scene.

**Editor changes, after the garden pass**

| Area | Proposed implementation |
| --- | --- |
| Shell | Adapt [EditorScreen](../../apps/web/src/components/plan/editor/EditorScreen.tsx) to continuous left/canvas/right panes, with less outer padding. Move the concept name and summary above the canvas; condense the wizard and bottom navigation during editing. |
| Left catalogue | Separate Add to garden and Layers tabs. Replace category icons with asset-backed cards grouped into structures, surfaces, planting, furniture and features. The current symbol list is headed “Furniture” even when it contains plants; fix the grouping. Reuse the existing search and filters in [AddFeaturePalette](../../apps/web/src/components/plan/editor/AddFeaturePalette.tsx). |
| Layers | Make planting groups collapsible, ideally by bed. Persist an optional bed association with clear behaviour when a plant moves outside its bed. The current [PlacedElementsList](../../apps/web/src/components/plan/editor/PlacedElementsList.tsx) only groups by broad category. |
| Inspector | Show an actual asset preview, plant type/species, height, canopy diameter and X/Y for plants; width/depth and rotation for structures. Move elevation and technical detail to an expandable section. Remove raw element IDs from the default view. Extend [SelectedElementPanel](../../apps/web/src/components/plan/editor/SelectedElementPanel.tsx) and its store actions. |
| Species and replacement | Current tree symbols describe broad types, not botanical species. An exact Japanese maple selector needs a persisted plant-catalogue identity and corresponding asset, not just a renamed generic tree. Symbol replacement should retain position and use explicit sizing rules. |
| Status | Keep/remove/replace exists for surveyed features, but is absent from `DesignElement`. Define the meaning for proposed objects before adding that control and persistence. |
| Canvas controls | Compact plan/measure/grid controls, zoom and fit at the canvas edges, restrained labels and handles for the selected object. Keep measurements and hit targets aligned with the geometry. |
| Assistant | Retain the existing structured edit-and-review flow, with a smaller entry panel and useful suggestions beneath the inspector. |

The existing [VisualisePanel](../../apps/web/src/components/plan/editor/VisualisePanel.tsx) displays a clean export of the same 2D drawing. It is not a separate photorealistic renderer. Likewise, the database's concurrency `revision` is not saved design-version history; matching the reference's version picker requires snapshots, not a cosmetic dropdown.

**Recommended delivery sequence**

1. **One reference garden as a visual benchmark.** Build a fixture at approximately the reference's stated 12.5 × 14 m garden extent, using editable geometry and representative features. Treat screenshot proportions as illustration, not survey measurements. Render the same scene at normal editor scale and close scale so layout quality and rendering quality can be judged separately.
2. **Repair the rendering passes and depth.** Restore tree shadows, correct shadow receivers, connect infill exclusions, reduce flat tinting and remove unnecessary path outlines. Add soft contact shading and pergola slat shadows through shared render logic. Distinguish decorative lighting from the existing location/time-based sun study.
3. **Improve composition and a small asset set.** Introduce designed beds, purposeful planting groups and the missing focal assets. Then apply the generator changes to suburban, courtyard and L-shaped plots with different briefs.
4. **Reshape the editor.** Deliver the shell, image catalogue, grouped layers and object-specific inspector, preserving undo/redo, geometry validation and autosave.
5. **Assess whether a richer preview is still needed.** A Three.js scene can use the same plan data with an orthographic camera, actual structure geometry and shadow receivers. This is a separate camera/material/model pipeline, although the dependencies are already installed. An AI impression is another possible preview, with plan-revision tracking and clearly separated illustrative output; it should not supply editable geometry or measurements.

Keeping the first iteration on Konva is an engineering recommendation based on the existing implementation. Its documented layer separation, caching and drag isolation support this approach; keep expensive visual passes cached and the number of actual canvas layers small. See [Konva performance guidance](https://konvajs.org/docs/performance/All_Performance_Tips.html). The optional 3D route is supported by Three.js's [orthographic camera](https://threejs.org/docs/pages/OrthographicCamera.html) and [shadow rendering](https://threejs.org/manual/en/shadows.html); neither alone guarantees the reference's art quality.

**Acceptance criteria**

- The benchmark reads as one composed garden at normal editor size: a clear lawn, distinct destinations and varied planting groups.
- A tree's shadow reaches adjacent ground, including patios; changing its height affects the shadow under the same sun conditions.
- Moving a shrub preserves its editability and updates nearby infill without rerandomising the whole garden.
- Editor, concept thumbnail, clean preview and export agree on assets and draw order.
- Selected-object fields edit the corresponding geometry, survive reload and participate correctly in undo/redo.
- Browser checks at representative desktop widths and a narrow viewport verify usable canvas space, keyboard access and responsive panels. Profile dragging with a representative plant count before setting a measured frame-time target.
- Run focused renderer, schema and editor checks, then generator/database checks against an isolated test database. Visual comparison against the reference remains necessary even when the tests pass.

## Implementation — 7 September 2026

Implemented the first four delivery stages in the existing editable 2D pipeline:

- Shared ground, shadow and raised-object passes for the editor, concepts and exports. Trees cast raised-crown shadows; pergolas have visible timber slats and separate slat/post shadows. Furniture and canopy variation remains stable when moved.
- Nearby footprints clear bed infill, with exclusions included in raster cache keys. Lower tint strength retains more foliage detail, and technical surface outlines no longer appear in clean exports.
- Explicit asymmetric/formal/curved beds, lawn subtraction, maintenance-aware planting, structural shrubs with bed membership, and a named Japanese maple with a generated local WebP asset. Base ground is never an implicit planting bed. Broad L-shaped returns can receive a furnished retreat when an entertaining brief and high budget support it.
- A flatter editor shell, Add/Layers tabs, image catalogue, grouped bed plants, compact action/settings menus, fit-garden control, and species/canopy/position/status fields. Rejected numeric edits restore the accepted value. Status records work intent; it does not hide or delete the object. Replacement preserves the footprint; new named plants use catalogue dimensions.
- A 12.5 × 14 m garden benchmark (plus a 5 m house strip), alongside refreshed suburban, courtyard and L-shaped fixtures. Run `pnpm --filter @garden-studio/web render:plan` for normal/close comparisons in `apps/web/.plan-preview`.

Validation: 904 frontend tests, 255 schema tests and 92 focused API/layout/PostGIS tests pass. Schema/API builds, frontend TypeScript and package lint pass. The Webpack production build passes. Turbopack could not complete because its CSS worker was denied a local port in this execution environment; the Webpack fallback excludes Konva's unused Node canvas backend. Database verification used only read-only generation/geometry suites; project-table truncation suites were not run. No saved projects were overwritten.

Browser automation exposes no browser surfaces in this session. Desktop/mobile walkthroughs and an interactive drag performance profile remain unverified. Component tests cover inspector edits and rejected coordinates; store tests cover species/status/dimensions, undo/redo and rehydration. Raster output was inspected directly.

Existing plans receive rendering and editor improvements immediately. Newly composed beds and side retreats require generating new concepts; existing user layouts are preserved.

The richer-preview assessment remains separate: these changes improve a measured top-down plan, but do not reproduce the reference's full 3D lighting, roof geometry, furniture variety or photographic foliage depth. If that finish is required, the next substantial step is an orthographic 3D scene with authored models/materials driven by this same plan geometry. No AI impression or new 3D pipeline was added in this iteration.
