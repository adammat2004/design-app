# Professional landscape visualisation — 9 September 2026

## Investigation and implementation plan

The existing RenderScene / Canvas2D / Pixi architecture stays. Inspection of the current
reference, suburban, courtyard and L-shaped judging fixtures identifies a combination of
composition, painter integration and source-art limitations.

| Bottleneck | Evidence | Change |
| --- | --- | --- |
| Disconnected destinations | The reference's shed and fire bowl have no paths; routing starts at a single terrace point and tests only three connections. Most routes use the same 1.2 m stepping-stone ribbon. | Route from several legal terrace edges, ignore furniture contained by the departure/arrival room, and choose access/utility/secondary surfaces from constraints. |
| Rooms float inside lawn | Pergolas are tried beside an already house-width terrace, fail there and fall back into central free space. Fire rooms are only large enough for a bowl. | Prefer a sized destination slot where side space is insufficient; provide usable fire seating and an optional budget/area-gated lounge destination. |
| Planting stays a strip | The bed function draws two full-length strips and a rear strip. Its width cap suppresses focal depth; every bed has the same scheme. | Asymmetric major bays and shorter room-framing beds, with a protected usable centre and small-garden limits. Clip through the existing PostGIS pipeline. |
| Duplicate planting in Visualise | Both Canvas `drawSurfacePattern` and Pixi's raster cache re-resolve the full planting stack instead of consuming `RenderSurface.layers`. | Carry resolved layers through the painter/cache, including keys, asset version and pixel ratio. Only ground surfaces go through Pixi; existing object overlay remains. |
| Missing middle scale | Infill uses 0.25–0.8 m crowns while structural layers are sparse and excluded from infill; cottage has no backdrop layer at all. | Add a restrained render-only shrub layer in deep beds, excluding real structural plants. Preserve world identities, maturity nesting and quantities. |
| Flat roofs and noisy turf | Roof planes are solid fills, gable form is named but not actually derived differently, turf repeats one 1.5 m photograph. | Footprint-aligned simple ridges/hips, slate courses and eave detail; restrained continuous turf modulation after opaque base paint. |
| Presentation space and controls | Two editor headers, editing sidebars and a large Visualise introduction compete with the garden. Resize updates WebGL alone; no reset-fit control. | Compact header; hide editing panels during Visualise; small floating presentation controls, fit/zoom, resize alignment and preserved camera across tab switches. |

## Phases and exact modules

1. **Scene/painter correctness:** `materials/render-surface-pattern.ts`, `pattern-cache.ts`,
   `render-plan.ts`, `render/pixi/renderer.ts`. Focused raster/cache tests and baseline sheets.
2. **Composition:** `generation/layout/{beds,sketch,templates/*,assign}.ts`,
   `generation/{concepts.service,furnish,archetypes}.ts`; small pure policy helpers as needed.
   Deterministic geometry/furniture/palette tests, read-only PostGIS generation and fixture capture.
3. **Presentation:** `render/{plants,roof}.ts`, shared painters, `VisualiseView`,
   `VisualisePanel`, `EditorScreen`. No schema or quantity changes. Regenerate and inspect sheets.
4. **Verification:** expand representative fixture coverage to narrow/wide/formal/naturalistic/
   premium briefs; browser check at desktop/mobile and DPR 2, maturity, pan/zoom, fit, tab switching,
   console errors and document stability. Run frontend/schema suites and focused API suites/builds.

## Assets

The manifest already supports 3–6 variants for common vegetation families. Do not duplicate
that system or regenerate the library. Audit actual catalogue coverage and produce a contact
sheet plus a targeted replacement list. Prioritise overly circular shrub crowns, inconsistent
foliage lighting and furniture/shed detail. New source art is separate from code improvements.

## Risks and controls

- Preserve a useful lawn and protect small gardens: cap bay depth from available width/depth;
  extra rooms require brief intent, budget and physical clearance.
- Keep furniture wholly contained, disjoint and clear of openings. Reuse legality predicates.
- Routes use their actual width in collision tests; no decorative geometry becomes authoritative.
- No `Math.random`, persisted presentation geometry, runtime generation or quantity edits.
- Reuse textures and batches; dispose transient Pixi nodes and obsolete textures. Judge performance
  in the browser rather than assuming a higher sprite count is the bottleneck.
- Test only read-only API generation/geometry suites against the existing database. Persistence
  tests require a separate database because their setup truncates projects.

## Results

To be completed after implementation and visual verification.
