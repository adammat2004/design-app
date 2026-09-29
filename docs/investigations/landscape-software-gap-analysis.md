# Garden Studio: gap analysis against landscape-design software, with a roadmap

Written 29 Sep 2026 from a read of the repository as it stands on `visual-agents`, including the
uncommitted 3D-structure work. No code has been changed. **Once this is approved, the only action is
to save this document to `docs/investigations/landscape-software-gap-analysis.md`.** Every
recommendation below is a proposal, and each phase is a separate decision.

## Context

Garden Studio's architecture is stronger than its editor. The data model, the geometry discipline,
the generator and the AI planner all behave like serious design software. What a user touches on
step 5 still behaves like an AI layout generator with a property panel:

- You cannot draw a shape on step 5.
- You cannot edit a polygon's corners.
- There is no ⌘Z.
- There is no plant list.
- A new fence cannot be specified.
- The only deliverable is a PNG with no scale bar.

Most of the gap is **editor tooling and domain vocabulary**, not architecture. The recommended
closure is therefore mostly additive, and it keeps the three rules the codebase is built on:

1. Geometry is the source of truth.
2. The model writes intent, never coordinates.
3. Anything derivable is derived rather than stored.

---

## 1. Current architecture summary (from the code)

### The document

`PlanDocumentSchema` (`packages/schema/src/plan/document.ts`) is one Zod-typed JSONB row at
`PLAN_DOCUMENT_VERSION = 4`. Its sections are `site`, `features`, `brief`, `concepts` and `layout`.
Each wizard step owns exactly one section. `readPlanDocument` migrates stored rows on read. Zones are
derived by `computeZones` and never stored.

**`site`** (`plan/site.ts:155-214`) holds:

- boundary `vertices` (each with an id);
- `house` (outline vertices with ids, `walls[]` with external/party/garage kind, `openings[]`,
  `storeys`, `roofMaterial`);
- `gates[]` (edge id plus offset in metres, kind pedestrian/vehicle/open);
- `streetEdgeVertexId`;
- `boundaryStyles[]` (`{edgeVertexId, kind: fence|wall|hedge|railing|open, height?}`);
- `orientation`, `location | null`, `sun`, `scopePolygon`, `selectedZoneIds`.

**`layout.elements: DesignElement[]`** (`plan/concepts.ts:88-257`) is the design.

- **Shape** is one of `rect` (centre-anchored), `polygon` (with `cornerRadius`), `point` (with
  radius) and `polyline` (with width).
- **Nine categories:** lawn, planting-bed, paved-area, gravel-mulch, structure, water-feature,
  furniture, lighting, existing-feature.
- **Optional domain fields:**
  - `material` and `pattern` (origin and rotation);
  - `edging` and `edges` (per-run treatments);
  - `retaining`, `elevation` and `height`;
  - `symbol`, `plantId` and `bedId`;
  - `status`, `plantingStyle`, `hidden` and `purpose`;
  - `structure` (roof, sides, lighting, preset, floor).
- **Order and locking:** array order is the drawing order. `isLocked` is derived (it is true for
  base fills).

### Geometry

`packages/schema/src/geometry/` holds `primitives.ts`, `shapes.ts` (`circleRing`, `insetPolygon`,
`polylineStrip`) and `stations.ts`. The key plan-level files are:

- `plan/features.ts`: `geometryOutline` is the one tessellation shared by Konva, the composer, the
  schedule and PostGIS. `geometryIsLegal` is a containment check only.
- `plan/footprint.ts`: `legalFootprint` treats a tree's trunk, not its canopy, as what occupies the
  ground.
- `plan/along-edge.ts`: offsets for gates and openings.
- `plan/boundary/side-chains.ts` and `graph.ts`: sides, and what lies beyond each stretch of a side.
- `plan/edges/*`: rules, `resolveEdges` and `edit.ts`.
- `plan/levels.ts`: local retaining bands and `stepFlight`.
- `plan/quantities.ts`: `planSchedule`.

The server twin is `apps/api/src/plan/geometry-validation.service.ts`, which runs the checks in
PostGIS.

### Generator and design agent

These live in `apps/api/src/plan/generation/`. The pipeline is:

`analyseSite → DesignBrief → ZonePlan → GardenComposition → LayoutSketch → realise/ → scoreConcept`

It covers seven archetypes, a candidate loop (`design/choose.ts`) and targeted repair
(`design/repair.ts`). It is seeded, deterministic and benchmarked by `eval:generator`.

### AI

- **Design intents.** `DesignIntent` (`plan/assistant.ts:69-199`) has 12 verbs: resize, move,
  reshape, attach, material, recategorise, add, reroute, rotate, remove, edge and reduce-cost. None
  of them has a field that can hold a coordinate.
- **Planning.** `apps/api/src/plan/assistant/planner.service.ts` turns intents into
  `ProposedChange[]`, checked with the same `geometryIsLegal`.
- **Running.** `runFromProposal` → `prepareRun` → `DesignOperation` (`plan/operations.ts`, which
  has 12 leaf kinds plus `group`) is executed in the editor inside one gesture bracket, so a whole
  request is one undo entry.
- **Other AI surfaces:**
  - `GardenAction` (`plan/assistant-garden.ts`) serves step 2.
  - The review and repair endpoints (`/design/review`, `/design/repair`) are model-free.
  - `ProposeRequest.selection` is already an **array** of ids (`assistant.ts:322`), so the request
    is ready for multi-select.

### Renderer

`apps/web/src/lib/render/build-scene.ts` is pure. It produces a `RenderScene`
(`render/scene.ts:55-125`) containing:

- `ground`, `objects` and `plants`;
- `shadows`, `lights`, `edging`, `levels` and `boundaryRuns`.

Every item already carries a `visualLayer` (`render/visual-layer.ts`), which nothing uses yet.

The editor draws with Pixi (ground and planting) plus a Canvas2D overlay underneath Konva hit
shapes. `drawPlan` (`lib/materials/render-plan.ts`) is the one composer for thumbnails, the PNG and
the judging sheets.

### Editor

- **Layout.** `components/plan/editor/EditorScreen.tsx` has three columns: Add/Layers on the left,
  toolbar and canvas in the centre, and `EditorInspector` on the right.
- **Inspector.** It shows the Style / Size & Shape / Edges / Details tabs, plus `SmartSuggestions`,
  `RecentActivity` and `InspectorComposer` on the same subject.
- **Store.** `state/plan-editor-store.ts` keeps a single `selectedId` and 50-deep history.
  `refusalFor` checks containment only.

### 3D, AR and outputs

- **3D.** `plan/structure/*` holds pergola and gazebo definitions and `structureParts`, which is
  shared by the plan symbol, the shadows and the R3F workspace (`components/structure-3d/`).
- **AR.** `packages/ar-contract` is scene format v0. `apps/mobile` is a text-only skeleton. There
  is no scene builder.
- **Outputs.** The step 6 `ReviewScreen` shows the schedule, a cost band and the requested features.
  `exportPlanPng` produces a PNG with optional chips.

---

## 2. Capability matrix

Legend:

- **Current state:** S = Strong, A = Adequate, P = Partial, M = Missing.
- **Priority:** P0 = a fundamental design-tool gap; P1 = an important professional capability;
  P2 = a valuable enhancement; P3 = a future item, or unnecessary for the final-year project.

### Site modelling

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Boundary drawing and side lengths | **S**: presets, typed sides (`SideLengthsPanel`), measured corners, sanity band | same | Measured corners only accept 90/180/270° turns (`MeasuredCornerPanel`) | P1 |
| Angles and bearings | **P**: only right-angle turns | typed interior angle per corner | No arbitrary angle entry | P1 |
| House, walls, doors, windows | **S**: wall ids, `openings`, elevation strip, storeys, roof | same | No finished floor level | P2 |
| Gates, entrances, street edge | **S**: `Gate` on edge, kind, keep-clear depth | same | Driveway surface not drawn | P2 |
| Existing trees and features | **P**: `PlacedFeature` has kind, geometry and status only (`plan/features.ts:92`) | height, canopy, species, material | A kept tree gets height 1 m (`CATEGORY_HEIGHTS`) and casts almost no shadow | P1 |
| Image underlay / aerial / survey trace | **M**: memory records an aerial prototype, but none of it is in the code | user-supplied image underlay, calibrated by two points | Nothing to trace from | P1 |
| Scale from known measurement | **P**: `scalePlot` rescue only | two-point calibration of an underlay | See above | P1 |
| DXF / survey import | **M** | — | — | P3 |
| Levels and slope | **P**: per-element `elevation` only, deliberately local (`levels.ts`) | spot levels, house floor level, warnings | No datum and no ground | P2 |
| Neighbouring boundaries | **P**: per-side kind and height | who is beyond, overlooking | Exposure is `unknown` | P3 |

### Garden objects

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Surfaces as domain objects | **A**: material with real module/joint (`MATERIAL_PATTERNS`), pattern origin and rotation, edges, elevation, retaining, area | per-element bond and joint override | Bond and joint are fixed per material | P2 |
| Walls, fences, screens as *proposed* objects | **M**: boundaries are site data (kind and height); no freestanding wall or fence; no material, panel or post type | linear element with height, thickness, material, panel type | A landscape design cannot specify a new fence or a garden wall | **P0** |
| Planting beds | **P**: planting material plus `plantingStyle` scheme, drawn density only | contents (species mix), planting density, mulch | No plant list | **P0** |
| Individual plants | **P**: point elements with `symbol` and `plantId`; catalogue has **1 entry** (`plant-catalogue.ts`) | small species catalogue | Species are cosmetic | **P0** |
| Structures (pergola, gazebo) | **S**: definitions, presets, parts, 3D, resize rules | same | Only two types | — |
| Other structures (shed, garden room, greenhouse, steps) | **P**: `SymbolSpec` only | definitions as they pass the 3D admission rule | Shed first | P2 |
| Furniture and lighting | **A**: 12 + 4 symbols, hosted furniture, counted items | same | — | — |

### Add workflow

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Catalogue, groups, search | **A**: `AddFeaturePalette` with 34 entries, group chips and search | grouped as Surfaces / Planting / Boundaries / Structures / Furniture / Lighting | No Boundaries group; plants barely present | P1 |
| Draw polygon / path / rectangle | **M** on step 5 (a default rectangle is dropped); exists on step 2 | draw-to-create for every area and linear kind | You cannot draw a patio outline or a path | **P0** |
| Vertex editing (polygon, polyline) | **M** on step 5 (exists on step 2 via `EditableVertices`) | drag, insert and delete vertices; corner radius | Generated lawns and paths are uneditable except by moving them | **P0** |
| Repeat placement | **M**: `addElement` disarms | sticky placing (Shift or a toggle) | Five trees take ten clicks plus five palette trips | P1 |
| Duplicate / copy / paste | **P**: inspector button only; the copy is renamed by category | ⌘D, ⌘C/⌘V, name kept | — | P1 |
| Drag from palette | **M** | optional | Click-to-place is fine | P3 |

### Measurement and precision

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Width, depth, position typed | **A** (rect only) | all shapes | Polygon and path have none | P1 |
| Rotation typed | **P**: 0–359 slider | typed degrees plus 15° steps | — | P1 (quick) |
| Area | **S**: header, Layers list, `AreaSummaryPanel` | — | — | — |
| Perimeter / path length | **M** | shown for every shape | `polylineLength` exists and is unused | P1 (quick) |
| Tape measure | **P**: two clicks, unsnapped | snapped to vertices and edges; chained | — | P1 |
| Dimensions on the plan | **P**: plot sides only (`plotDimensionGuides`) | selected element's sides plus clearances to neighbours while dragging | — | P1 |
| User lock | **M** (`isLocked` is derived) | lock toggle | — | P2 |

### Snapping and constraints

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Grid snap | **P**: add and move only (`lib/grid.ts`) | all gestures | resize, rotate, nudge, duplicate | P1 |
| Alignment | **P**: guides shown but **not applied** on step 5 (`moveElementLive` never calls `snapDeltaToTargets`); world-axis bounding boxes only | applied, including rotated frames | Bug plus limitation | **P0** |
| Vertex, edge, midpoint, boundary, house snaps | **M** | yes | — | **P0** |
| 90° / 45° constraints | **P**: step 1 `nextDrawPoint` only | while drawing and editing vertices | — | P1 |
| Equal spacing, parallel, perpendicular | **M** | rotate-to-align covers most of it | — | P2 |
| Overlap prevention | **P**: containment only; `structureConflicts` for structures in resize; `clearOfOthers` in the API planner | one clearance policy with warnings, not refusals | Three implementations | P1 |
| One shared snapping service | **M**: snapping lives in 4 web stores plus `compose.ts snapTo` | `packages/schema/src/plan/snap/` | — | **P0** (architecture) |

### Edges and relationships

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Per-side, per-stretch edge treatment | **S**: `EdgeTreatmentPlan`, `EdgeRun` (side, anchor, from/to in metres), boundary graph, rules with reasons, `EdgesTab`, `EdgeEditLayer`, AI `edge` verb, schedule metres | — | The brief's premise is out of date: this is built | — |
| Freestanding linear run (kerb along a drive) | **M** (TODOS:232) | covered by the linear element above | — | P1 (with walls/fences) |
| Whole-run drag, kerb plus coping on a raised host | **M** (TODOS:229, 239) | — | Minor | P2 |
| Attached-to-house / adjacent-to-path | **S**, derived (`graph.facing`, `structurePins`, inventory `beside=[…]`) | keep derived | Expose it in the inspector | P2 |

### Layers and visibility

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| View toggles | **A**: snap, grid, shadows, zones, dimensions, labels | + measurements | "Zones" does not tint anything | P2 |
| Per-element hide | **S** (undoable) | — | — | — |
| Per-group visibility | **M**, though `visualLayer` is already on every render item | 8–10 groups with eye toggles | Filter in `buildRenderScene` | P1 (quick) |

### Planting system

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Species with metadata | **M**: 1 entry; no sun, evergreen or flowering data | about 80–120 species with mature size, sun, evergreen, flowering, form, spacing | — | **P0** |
| Bed contents / plant list | **M**: `PlantingScheme` roles are generic taxa | species mix per bed | — | **P0** |
| Plant quantities | **M**, deliberately: drawn density is not a planting density (`quantities.ts:70-84`) | counts from the catalogue's *real* spacing | — | P1 |
| Suitability for location | **M**, though the sun model (`sun.ts`, `shadowCast`) exists | shade-hours per bed vs the plant's sun needs | Differentiator | P1 |
| Growth view | **M** (removed with Visualise) | year 1 / mature scalar | — | P2 |

### Terrain

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Object levels, retaining faces, steps | **A** (local `elevation`, `levelBands`, `stepFlight`) | + datum | — | P2 |
| House floor level, spot heights, falls | **M** | datum, house floor level, a few spot levels, derived warnings | — | P2 |
| Full terrain / cut-fill | **M** | — | — | P3 |

### 2D / 3D / AR

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| One model, three views | **S** in principle; `structureParts` feeds 2D, shadow and 3D | — | — | — |
| Symbol → sprite / 3D model / AR key | **P**: four registries (`SymbolSpec` in schema; `SYMBOL_SPRITES`, `model-registry.ts` in web; `ModelKey` copy in ar-contract) | one representation table in schema, holding keys only | Drift risk grows with every symbol | P1 (arch) |
| Structure and roof geometry reachable by the AR builder | **P**: `symbols/structures.ts` and `render/roof.ts` are in web (TODOS:99) | in schema | Blocks the builder | P1 (arch) |
| AR scene builder / export | **M** | `.ar.json` download | Partner's roadmap | P2 |

### Materials

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Domain data | **A**: id, label, relative cost 1–4, real module and joint, heights; colour kept in web | + unit of measure, loose-fill depth, thickness | Gravel and bark cannot give m³ or tonnes | P2 |
| 3D / AR appearance | **P**: `STRUCTURE_FINISHES` is shaped like `ARMaterial`; ground surfaces reuse the 2D painter | appearance manifest per material (colour, roughness, texture key, tile size) | — | P2 |

### Quantities

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Area by material, slab/board counts, edging metres | **A** (`planSchedule`) | — | — | — |
| Net areas | **M**: areas overlap by design (TODOS:881) | net ground-cover per material | Needs polygon booleans | P1 |
| Fence / wall / retaining length, step count, path length, plant counts, lighting by type | **M**, although each is derivable today (`boundaryRuns().length`, `LevelBand.length`, `stepFlight`, `polylineLength`) | all of them | Quick wins | P1 |

### Outputs

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Review screen / schedule | **A** | + plant schedule, lengths | — | P1 |
| Plan image | **P**: 2400 px PNG; no legend, scale bar, north arrow or title block | a titled sheet | — | P1 (quick) |
| PDF design pack | **M**; server-side PDF is decided against (TODOS:1097) | client-side multi-page PDF | — | P1 |
| Dimensions plan / planting plan / lighting plan | **M** | three sheets from one composer | — | P1 / P2 |
| Share link / read-only viewer | **M**; no auth, API binds to all interfaces | read-only token view | Security first | P2 |

### Editing UX

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Keyboard shortcuts | **P**: Delete, Esc, arrows, Space, and only while the canvas has focus; no ⌘Z, ⌘D, ⌘C/⌘V | standard set, global | — | **P0** (quick) |
| Multi-select | **M** on step 5 (exists on step 2) | shift-click, marquee, group move/delete/duplicate/material | — | P1 |
| Undo / redo | **S** (gesture-bracketed, AI = one entry) | — | Keyboard only | — |
| Unified manual + AI inspector | **S** (`EditorInspector` "three handles on one subject") | — | Write paths still differ (below) | P1 |
| Zoom / pan | **A** | middle-mouse | Minor | P3 |
| Touch | **M** | — | — | P3 |

### Presentation

| Capability | Current | Expected | Gap | Pri |
|---|---|---|---|---|
| Presentation / client mode | **M** | chrome-free plan, sheet switcher, sun time | — | P2 |
| Before/after | **P**: AI-run compare; step 4 `CompareView` | existing vs proposed, concept vs edited | — | P2 |
| Sun time in the editor | **P**: `SunPanel` only on step 1 | in view settings / presentation | Quick | P2 |
| Design explanation and score | **P**: step 4 only; `score` shown nowhere | on review and in the pack | Quick | P1 |

### Differentiators, where Garden Studio is unusually strong

- Natural-language editing that performs visible, legal, single-undo operations. **S**
- A deterministic planner with typed intents and no coordinates. **S**
- An explainable composition: `explanation`, `purpose`, the scorer's `guidance`. **S** (under-shown)
- Automatic reasoning about edges and adjacency (the boundary graph). **S**
- One model feeding 2D and 3D for structures. **S** (AR pending)
- A sun model shared by shadows and scoring. **A**

The largest untapped differentiator is **plant suitability from the sun model**. The shadow engine
already knows where shade falls hour by hour, and no competing consumer tool connects that to a
species' needs.

---

## 3. Top 10 gaps (ranked)

### 1. No drawing or shape editing on step 5 (P0)

- **Current behaviour.** The palette drops a default rectangle (`NEW_ELEMENT_SIZE`, store `:446`).
  Polygons and polylines can only be moved. Handles exist for rectangles only
  (`EditorCanvas.tsx:624`).
- **Desired behaviour.** Draw a polygon or path; drag out a rectangle; drag, insert and delete
  vertices; adjust corner radius.
- **User impact.** A garden cannot be designed by hand, and a generated lawn's outline cannot be
  refined.
- **Technical impact.** Step 2 already has the draft pipeline (`addDraftPoint`, `CLOSE_DISTANCE`,
  `EditableVertices`) and `nextDrawPoint`. This means extracting them rather than inventing new
  code.
- **Complexity.** M.

### 2. No shared snapping or constraint service (P0)

- **Current behaviour.** Grid snapping applies on add and move only. Alignment guides are drawn and
  not applied, which is a bug. There are no vertex, edge, boundary or house snaps. Five separate
  snap helpers exist in web stores.
- **Desired behaviour.** One pure `snap()` in schema, used by every gesture, drawing tool, step 1,
  step 2 and the generator's composition.
- **User impact.** Precise work is impossible, and things never sit flush against the house or the
  fence.
- **Technical impact.** This is foundational for gap 1. It is pure and Node-testable.
- **Complexity.** M.

### 3. No planting system (P0)

- **Current behaviour.** `PLANT_CATALOGUE` has one entry. Beds are drawn from generic scheme taxa.
- **Desired behaviour.** A catalogue of about 100 species with a few fields each; beds that hold a
  species mix; plant counts from real spacing; a planting schedule.
- **User impact.** Without a plant list the output is a layout, not a garden design.
- **Technical impact.** Touches schema, generator (scheme → species), renderer (species form →
  sprite family), AI (a `plant` intent) and quantities.
- **Complexity.** M–L; the data entry dominates.

### 4. Walls, fences and screens cannot be designed (P0)

- **Current behaviour.** `boundaryStyles` is site data, one kind per whole side. There is no
  freestanding linear element.
- **Desired behaviour.**
  - Proposed boundary treatments in runs along a side.
  - Freestanding walls, fences, screens and hedges inside the garden.
  - Each with height, material and panel type.
  - Counted in metres.
- **User impact.** A new fence, garden wall or privacy screen is among the commonest things a
  garden design specifies.
- **Technical impact.** Adds a category plus a layout-owned boundary-run list (§4). Reuses
  `along-edge.ts` and `boundaryRuns`.
- **Complexity.** M.

### 5. Precision readouts are missing (P1)

- **Current behaviour.** No perimeter or length. No element dimensions on the plan. Rotation is a
  slider. The tape measure does not snap.
- **Desired behaviour.** Side lengths drawn on the selected shape. Live clearances to the nearest
  neighbour and to the fence while dragging. Typed rotation. Typed side lengths for polygons (reuse
  the `SideLengthsPanel` idea). A snapped tape.
- **User impact.** This is what makes it feel like a design tool rather than a drawing canvas.
- **Complexity.** S–M, after gap 2.

### 6. No professional deliverable (P1)

- **Current behaviour.** A PNG with chips; a review screen.
- **Desired behaviour.** A client-side PDF design pack (§7, Phase 3).
- **User impact.** The final artefact is what a client, a contractor or a marker holds.
- **Technical impact.** Reuses `drawPlan`, `planSchedule` and `explanation`. Needs a legend, scale
  bar, north arrow and title block drawn on canvas, and a PDF library.
- **Complexity.** M.

### 7. Editor table-stakes (P0/P1)

- **Current behaviour.** No ⌘Z/⌘D/⌘C/⌘V. Shortcuts work only while the canvas has focus. There is
  no multi-select and no repeat placement.
- **Desired behaviour.** A global shortcut layer; `selectedIds` with marquee and shift-click; sticky
  placing.
- **User impact.** The editor feels like a prototype without these.
- **Technical impact.** The multi-select store change is the only invasive part. The AI already
  accepts an array selection.
- **Complexity.** S for shortcuts; M for multi-select.

### 8. Quantities incomplete (P1)

- **Current behaviour.** Missing today:
  - net areas;
  - boundary and wall lengths;
  - retaining length;
  - step count;
  - path length;
  - plant counts;
  - loose-fill volume.
- **Desired behaviour.** A typed takeoff in schema.
- **Technical impact.** Mostly reads of functions that already exist. Net areas need polygon
  booleans (§5).
- **Complexity.** S for lengths and counts; M for net areas.

### 9. Site capture accuracy (P1)

- **Current behaviour.** No underlay to trace from. Measured corners only accept right angles.
  Existing trees have no height or species, so a kept 12 m oak is drawn as a 1 m object.
- **Desired behaviour.** A user-uploaded image underlay with two-point scale calibration. Typed
  corner angles. Height and canopy on existing features, flowing into shadows.
- **Technical impact.** User-supplied images avoid the licensing blocker recorded for aerial tiles.
- **Complexity.** M.

### 10. Layer visibility (P1, quick)

- **Current behaviour.** Six view toggles and a per-element eye, but no group visibility.
- **Desired behaviour.** About ten groups with eye toggles, filtered in `buildRenderScene` on the
  `visualLayer` that every item already carries.
- **Complexity.** S.

**Just outside the top ten:** a datum and levels (P2), and presentation mode (P2).

---

## 4. Data model changes (all additive; version bump only where meaning changes)

Every change below is an optional field, or a union that only gains members. Stored plans therefore
parse unchanged, and `PLAN_DOCUMENT_VERSION` stays at 4 unless noted. Material, symbol and species
ids stay plain strings, for the reason `concepts.ts:127` gives.

### 4.1 Linear elements: walls, fences, screens, hedges, kerbs

The first part is a new category, which forces the ~10 total `Record`s to answer for it:

```ts
// concepts.ts — ElementCategorySchema gains:
'enclosure', // shape: polyline (width = thickness), measured in metres

// DesignElement gains (read only for 'enclosure'):
enclosure: z.object({
  kind: z.enum(['fence', 'wall', 'screen', 'hedge', 'railing', 'kerb']),
  panel: z.string().optional(),     // 'closeboard' | 'slatted' | 'hit-and-miss' | 'trellis-top' …
  postSpacing: z.number().positive().optional(), // metres; absent = product default
  coping: z.string().optional(),    // walling capping material id
}).optional(),
// height → existing `height`; material → existing `material`; thickness → shape.width
```

The second part is proposed treatment of the **plot boundary**, owned by `layout` because it is a
design decision rather than a survey fact:

```ts
// concepts.ts — LayoutSection gains:
boundaryTreatments: z.array(z.object({
  id: z.string(),
  edgeVertexId: z.string(),          // same key as gates — resolved through boundaryPolygon
  from: z.number(), to: z.number(),  // metres from the edge's start, as along-edge.ts
  kind: BoundaryKindSchema, height: z.number().positive().optional(),
  material: z.string().optional(), panel: z.string().optional(),
  status: z.enum(['keep', 'replace', 'new']).default('new'),
})).default([]),
```

`boundaryRuns()` then resolves in two layers: the site style underneath and the proposed runs on
top. It follows the gate rules already in `along-edge.ts` (split, merge, rescale, and "unplaced
rather than moved"). The freestanding kerb from TODOS:232 becomes an `enclosure` with `kind: 'kerb'`.

### 4.2 Plants

`plant-catalogue.ts` grows into a typed catalogue with a small, fixed field set:

```ts
export const PlantSpeciesSchema = z.object({
  id: z.string(), common: z.string(), botanical: z.string(),
  form: z.enum(['tree', 'shrub', 'perennial', 'grass', 'groundcover', 'climber', 'hedge', 'bulb']),
  symbol: z.string(),                 // plan drawing (existing SymbolId)
  matureHeight: z.number(), matureSpread: z.number(), yearsToMature: z.number().int(),
  sun: z.array(z.enum(['full', 'part', 'shade'])).min(1),
  evergreen: z.boolean(),
  flowering: z.array(z.number().int().min(1).max(12)).default([]), // months
  colour: z.string().optional(),      // flower/foliage note, text not hex
  spacing: z.number().positive(),     // metres centre-to-centre when mass planted — a REAL density
  maintenance: MaintenanceLevelSchema, tags: z.array(z.string()).default([]), // pollinator, scented…
});
```

Beds gain optional contents. Absent contents mean the scheme draws as today:

```ts
planting: z.object({
  mix: z.array(z.object({ speciesId: z.string(), share: z.number().min(0).max(1) })).max(12),
  mulch: z.string().optional(),       // bark / gravel material id
}).optional(),
```

- Individual plants stay as point elements with `plantId`; `bedId` is already derived by
  `associatePlants`.
- Plant count for a bed is `area × share / spacing²`. This comes from the catalogue's real spacing,
  so the warning in `quantities.ts:70-84` about drawn density is respected rather than broken.
- The renderer maps species `form` to the existing sprite families; no new art is needed to start.

### 4.3 Materials

These are additions to `Material` in `materials.ts`, all optional and all domain data:

```ts
measure?: 'area' | 'length' | 'count' | 'volume'; // default from category
depthMm?: number;        // loose fill: gravel 50, bark 75 → m³ in the takeoff
thicknessMm?: number;    // paving thickness, useful for levels and later costing
```

- An **appearance manifest** for 3D/AR would be a separate schema file shaped like
  `STRUCTURE_FINISHES` / `ARMaterial`: `{ baseColor, roughness, textureKey, tileSizeM }` per
  material id. It must not go on `DesignElement`, because rendering stays out of the document.
- The per-element bond override becomes `pattern.bond?` (optional). Pattern is already
  presentation-anchoring data, and the bond is a design decision in the same sense.

### 4.4 Levels (a small, achievable model)

```ts
// site.ts — SiteSection gains:
levels: z.object({
  // Datum 0 = finished ground at the garden door — the same origin the AR contract uses.
  houseFloor: z.number().default(0.15),                 // FFL above datum
  spots: z.array(z.object({ id: z.string(), at: PointSchema, level: z.number() })).max(40).default([]),
}).optional(),
```

- `elevation` keeps its meaning: it is relative to local grade, which is the datum when there are no
  spots. **No version bump.**
- `groundLevelAt(point)` is derived and pure: inverse-distance or triangulated over the spots, and 0
  where there are none.

### 4.5 Existing features

`PlacedFeature` gains `height?`, `spread?`, `speciesId?` and `material?`. `concepts.service.ts:466`
copies them onto the `existing-feature` element, so a kept tree casts its true shadow and counts in
the scorer's canopy principle.

### 4.6 Representation keys: one table, keys only

```ts
// plan/representation.ts (schema)
export const REPRESENTATION: Record<SymbolId, {
  plan: { kind: 'sprite'; family: string } | { kind: 'parts' } | { kind: 'procedural' };
  model3d: { kind: 'parts'; builder: StructureBuilderId } | { kind: 'model'; key: string } | null;
  ar: { kind: 'solid' } | { kind: 'model'; key: string } | { kind: 'plants'; key: string };
}>;
```

- Each consumer keeps its own loader: `SYMBOL_SPRITES` becomes a lookup into this table, and so do
  `model-registry.ts` and the ar-contract `ModelKey`.
- A test demands that every `SymbolId` has all three entries. That test is what prevents the drift
  that already cost a rafter-count bug.

### 4.7 Editor-only state (not the document)

- **User lock.** `locked?: boolean` on `DesignElement` is a real design decision (it holds a
  hard-landscape element still while the AI works), so it **is** on the document. The AI planner and
  `resolveOperation` must refuse to touch locked elements.
- **Group visibility, snap settings and sun-time preview** are view state in the store, not the
  document. `site.sun` stays the persisted time.

### 4.8 Derived quantities are never stored

This is explicit, as it already is for the review screen.

---

## 5. Shared geometry services

All of these are pure, live in `packages/schema`, and are tested in Node.

| Service | Home | What it provides | Consumers |
|---|---|---|---|
| **measure** | `geometry/measure.ts` (new; wraps `polygonArea`, `polylineLength`, `edgeLength`) | area, perimeter, path length, side lengths, min distance between two outlines, clearance to the boundary | inspector, size badge, dimension overlay, takeoff, scorer (replacing local copies), AI inventory |
| **snap** | `plan/snap/` (new) | `snap(query, targets, opts) → { point, source, guides }`. Target providers: grid; boundary vertices, edges and midpoints; house corners and walls; element vertices, edges, midpoints and centres; alignment lines in world **and** in the element's or house's local frame. `constrainAngle(prev, p, {steps: 90/45/15, relativeTo})` answers "relative to the house wall" by reusing `apps/api/src/plan/generation/design/bearing.ts`, which is pure and should **move into schema** so the editor can reach it | step 5 gestures and draw tools, step 1 (`nextDrawPoint` migrates), step 2 (`features-store` migrates), the generator's `compose.ts snapTo`, and the planner (aligning an `add` or `move` result to a neighbouring edge) |
| **legality** | exists (`geometryIsLegal`, `elementIsLegal`, `legalFootprint`, PostGIS twin) | unchanged | editor, planner, executor, validator |
| **clearance policy** | `plan/clearance.ts` (new) | a table saying which categories may overlap which (structure↔structure no; furniture must be hosted; enclosure↔surface ok), returning **warnings**, not refusals | editor (amber warning), planner (replacing `clearOfOthers`), structure resize (`structureConflicts`), scorer |
| **adjacency / relationships** | exists: `boundary/graph.ts`, `structure/surroundings.ts`, `associatePlants` | expose `relationsOf(id)` (touches, facing house or fence, stands on, contains) | inspector "Beside" row, AI inventory, edge rules, takeoff |
| **attachment along an edge** | exists: `along-edge.ts` | reuse for boundary-treatment runs | step 1/5 side editors, boundary resolve |
| **polygon booleans** | new dependency in schema (a pure clipping library) | union, difference, intersection | net-area takeoff, AR builder's disjoint surfaces (TODOS:72), levels. It must not replace PostGIS for generation |
| **takeoff** | `plan/takeoff.ts` (extends `quantities.ts`) | area, net area, length, count, volume, plant counts, grouped for sheets | review screen, PDF pack, AI answers ("how much paving?") |
| **sun exposure** | `plan/exposure.ts` (new, over `shadowCast`) | shade-hours per sample point for a representative day set | plant suitability, the scorer's sun principle, the inspector |

**Rule.** Snap first, then check legality. A snap never lands a gesture in an illegal state: if the
snapped result is illegal, use the unsnapped result and draw no guide.

---

## 6. Editor redesign implications (interaction architecture, not visuals)

### Add

- The palette gains a **Boundaries** group and a real **Plants** group, backed by the catalogue and
  filterable by sun, height and evergreen.
- Arming an area kind offers **Draw** (polygon or rectangle drag) or **Drop default**. Arming a
  linear kind always draws.
- Placing is sticky while Shift is held, or with a "repeat" pin.

### Select

- `selectedId` becomes `selectedIds[]` plus a primary. Marquee and shift-click are ported from step
  2 (`FeaturesCanvas.tsx:202-245`).
- The inspector shows shared properties across a mixed selection (material across surfaces). Group
  move, delete and duplicate each form one gesture bracket.
- The AI chip shows "3 selected". `ProposeRequest.selection` already carries up to 8 ids.

### Inspect

Keep the four tabs, with these additions:

- Size & Shape gains **perimeter and length**, **typed rotation**, and **typed side lengths** for
  polygons.
- Details gains **lock**.
- Plants gain a **Planting** tab: species mix, counts, and a suitability badge from sun exposure.

### Measure

- The tape snaps through the snap service.
- While the selection is dragged, live clearance to the nearest neighbour and to the fence is shown.
  This is the single most "CAD-like" cue.
- The Dimensions toggle draws the selected element's side lengths. Plot dimensions remain.

### Edit, as one write path for people and the agent

Today the two paths differ:

- Manual edits go through store actions plus `refusalFor`.
- AI edits go through `applyProposal` plus `resolveOperation`.

The recommendation is to converge them on **commands shaped like `DesignOperation`**:

- `move`, `resize`, `rotate`, `reshape`, `setProperty`, `add` and `remove` all resolve through
  `resolveOperation` with `source: 'user' | 'agent'`.
- The result is one legality rule and one undo labelling ("Undo resize Patio"), with telemetry for
  free.
- Live drag frames stay as they are; only the committed result becomes an operation.

This is what makes "one editor, two ways of changing the same subject" true in code as well as in
the UI.

### Keyboard

The shortcut layer moves from the canvas `div` to a window-level handler that ignores text inputs:

- ⌘Z and ⇧⌘Z
- ⌘D, ⌘C and ⌘V
- Delete
- Esc, which also cancels placing and measuring
- R for +15°, ⇧R for +90°
- V, H and M to switch tools
- ? for help

### Use AI

- New intents are needed for the new vocabulary: `plant` (a species or a mix into a bed, by a
  relation such as "shade-tolerant, evergreen"), `enclosure` (add or replace a fence run on a named
  side), and `configure` (already in TODOS).
- Every new intent needs `probe:assistant` and re-pinned budget tests (currently 12 branches, 15
  objects, 2 optionals, 10 refs).
- To conserve grammar budget, consider folding `plant` into `add` with a `speciesQuery` field rather
  than adding a new branch.

### Present

A `/plan/[id]/present` route (§7, Phase 3).

### Fix now: four comment/code mismatches the survey found

1. The store comments say labels and dimensions are on by default; they are off.
2. `moveElementLive` claims to snap to alignments; it only shows them.
3. The help text says "Nothing can overlap the house", which is no longer true.
4. The "Zones" tooltip says it tints the zones; it only adds labels.

---

## 7. Recommended implementation roadmap

The codebase suggests a slightly different order from the brief's:

- **Edges are already built**, so the old Phase 2 is lighter than expected.
- **The planting catalogue should come before outputs**, because a design pack without a planting
  schedule is weak.
- **Snapping must come before drawing tools**, because drawing without snapping produces imprecise
  shapes that then need fixing.

### Phase 0: quick wins (about a week in total; each is S and independent)

| Quick win | Where |
|---|---|
| Global ⌘Z / ⇧⌘Z / ⌘D / Esc | `EditorCanvas.tsx:317-386` handler moves to window scope |
| Apply alignment snapping on drag | call `snapDeltaToTargets` in `moveElementLive`, store `:754-769` |
| Grid snap on nudge, duplicate and resize | store |
| Typed rotation field | `SelectedElementPanel.tsx:321-345` |
| Perimeter and path length readouts | `EditorInspector` header, `describeElement` |
| Duplicate keeps its name ("Lounger 2") | store `:1123-1146` |
| Sticky placing on Shift | `addElement` |
| Group visibility | filter by `visualLayer` in `buildRenderScene`, plus a Layers panel of eye toggles |
| PNG gains scale bar, north arrow, legend and title strip | `export-plan.ts` |
| Takeoff lines for boundary length, retaining length, steps and lighting by type | `quantities.ts`, reading `boundaryRuns`, `levelBands`, `stepFlight` |
| Show `explanation` and `score` summary on the review screen | `ReviewScreen.tsx` |
| Fix the four mismatches in §6 | — |

**Definition of done:** every item has a unit or e2e test; goldens are unchanged except the PNG
sheet chrome.

### Phase 1: professional editor foundations

- **Objective:** a user can build a whole garden precisely without the AI.
- **Tasks:**
  1. Snap service in `plan/snap/` with target providers and angle constraints (move
     `generation/design/bearing.ts` into schema first); migrate step 1's
     `nextDrawPoint`, step 2's `features-store` and step 5 onto it.
  2. `measure.ts`.
  3. Extract step 2's draft-drawing pipeline (`addDraftPoint`, `CLOSE_DISTANCE`, `EditableVertices`)
     into a shared hook and component; add draw modes (polygon, path, rectangle drag) and vertex
     editing (drag, insert, delete, corner radius) to step 5.
  4. Multi-select (`selectedIds`) with marquee and group gestures.
  5. Dimension overlay: side lengths of the selection and live clearances.
  6. User `locked`, honoured by the planner and the executor.
  7. The command convergence in §6 (can trail the rest).
- **Dependencies:** none. Task 1 blocks tasks 3 and 5.
- **Relevant files:**
  - `apps/web/src/state/plan-editor-store.ts`
  - `components/plan/editor/EditorCanvas.tsx`, `ShapeHandles.tsx`, `SelectedElementPanel.tsx`
  - `lib/grid.ts`, `lib/guides.ts`, `lib/boundary-geometry.ts`
  - `state/features-store.ts`, `components/plan/features/FeaturesCanvas.tsx`
  - `plan/run/prepare.ts`
- **Risks:**
  - The multi-select refactor touches every `selectedId` reader, including the AI run, which drives
    `selectedId`.
  - Konva hit-testing bugs are only findable in a browser (see the CLAUDE.md gate-handle lesson),
    so budget e2e time.
- **Definition of done:** an e2e test draws an L-shaped patio snapped to the house wall, a path to a
  gate, and a bed, types a rotation, multi-selects and duplicates, and undoes everything by keyboard.
  The snap service has property tests (snapping is idempotent; it never snaps into illegality).

### Phase 2: garden-domain intelligence

- **Objective:** objects carry the data a landscape designer specifies.
- **Tasks:**
  1. `PlantSpecies` catalogue of about 100 UK-garden species (data entry, reviewed once).
  2. Bed `planting.mix`, the Planting tab, and plant counts from spacing.
  3. Plant palette group with filters.
  4. `exposure.ts` suitability badge.
  5. Generator: map scheme roles to species by tags and sun (`knowledge/` gets a style→species
     table; `treeSpeciesFor` reads the catalogue).
  6. `enclosure` category plus `layout.boundaryTreatments`; draw fences and walls as linear
     elements; step 5 side editor for proposed treatments.
  7. Material `measure` and `depthMm`.
  8. `PlacedFeature` height, spread and species.
  9. AI: `plant` and `enclosure` intents (or folded into `add`), each with `probe:assistant`.
- **Dependencies:** Phase 1 drawing tools (linear draw) for task 6. The catalogue is independent and
  can start immediately.
- **Relevant files:**
  - `packages/schema/src/plan/plant-catalogue.ts`, `planting.ts`, `concepts.ts`, `materials.ts`,
    `boundary-style.ts`, `boundary-styles.ts`
  - `apps/api/src/plan/generation/constraints.ts`, `knowledge/`
  - `assistant/intent-schema.ts`, `planner.service.ts`
  - `lib/render/plants.ts`, `visual-layer.ts`
- **Risks:**
  - Adding a category is a compile error in about 10 Records. That is intended, but the scorer and
    the composition bands must decide what an enclosure means.
  - Generator changes need an `eval:generator` baseline taken **before** the change.
  - The plant catalogue must stay small; accuracy of its data matters more than size.
- **Definition of done:**
  - A generated concept names real species per bed.
  - The inspector edits a mix.
  - The schedule lists plants with counts.
  - A fence run can be added on part of a side and is counted in metres.
  - `eval:generator` is no worse than baseline.

### Phase 3: professional outputs

- **Objective:** a Garden Design Pack worth handing to a client or a contractor.
- **Tasks:**
  1. `takeoff.ts`, including net areas via polygon booleans.
  2. A sheet composer: title block, legend, scale bar, north arrow, drawn on canvas by `drawPlan`
     plus chrome.
  3. Sheets: plan; dimensions plan (plot sides plus key element dimensions); planting plan (symbols
     keyed to a plant schedule); lighting plan (fittings plus schedule); hardscape and materials
     schedule; design summary (brief, explanation, what was included).
  4. **Client-side PDF** (e.g. `jspdf` with canvas images), respecting "server-side PDF rendering"
     being decided against.
  5. Presentation route `/plan/[id]/present`: no chrome; switch between plan, planting and lighting
     sheets; sun-time slider; before/after (existing features vs design, and concept vs edited via
     `layout.pristine`).
- **Dependencies:** Phase 2 for the planting schedule. The plan, dimension and hardscape sheets can
  ship before it.
- **Relevant files:**
  - `lib/materials/export-plan.ts`, `render-plan.ts`
  - `components/plan/review/*`
  - `packages/schema/src/plan/quantities.ts`
- **Risks:**
  - Canvas size limits (Safari) for A3 at 150 dpi. The export already downsamples from 2×, so tile
    if needed.
  - True-scale print (T15) depends on paper size and must be stated as "1:100 at A3", never claimed
    for screen.
- **Definition of done:**
  - One click produces a PDF of 5–6 pages from a fixture plan.
  - Every figure in it traces to a `takeoff` function with a test.
  - A render-sheet test covers the title block.

### Phase 4: spatial depth (levels, and more structures)

- **Objective:** a sloping garden can be described honestly.
- **Tasks:**
  1. `site.levels` (datum, house floor level, spot levels) captured on step 1 as an optional panel.
  2. `groundLevelAt`.
  3. Warnings: patio within 150 mm of the house floor level, and a retaining height implied by
     `elevation − groundLevelAt`.
  4. Level labels on the plan, e.g. "+0.45".
  5. Steps derived between levels.
  6. Takeoff: retaining area in m² (length × height).
  7. Shed, then garden room, as structure definitions (following the admission rule in memory and
     TODOS).
- **Dependencies:** the schema is independent. The takeoff builds on Phase 3.
- **Relevant files:** `plan/levels.ts`, `site.ts`, `apps/api/src/plan/generation/levels.ts`,
  `plan/structure/definitions.ts`, `parts.ts`.
- **Risks:**
  - Drifting into terrain engineering. Stay local, with warnings rather than grading.
  - The generator must keep treating no-spots as flat, byte-identical.
- **Definition of done:**
  - A fixture with three spot levels shows derived retaining heights and a step flight, and exports
    them on the dimensions sheet.
  - Unlevelled plans hash identically.

### Phase 5: shared representation and AR handoff

- **Objective:** no rewrite is needed when AR arrives.
- **Tasks:**
  1. `plan/representation.ts` (§4.6), with sprite, model and AR key lookups migrated to it.
  2. Move `symbols/structures.ts` and the geometry half of `render/roof.ts` into schema (TODOS:99).
  3. Material appearance manifest.
  4. `buildARScene(document)`, pure, using polygon booleans for disjoint surfaces.
  5. "Download AR scene" (`.ar.json`) on the review and present screens.
  6. Bind the API to 127.0.0.1 **before** any share link.
- **Dependencies:** polygon booleans (Phase 3). The partner owns `apps/mobile`.
- **Relevant files:** `packages/ar-contract/src/*`, `apps/web/src/lib/materials/assets/material-assets.ts`,
  `lib/structures/model-registry.ts`, `docs/ar/ar-architecture.md` §13.
- **Risk:** coordinating with the second developer. Keep the contract stable (v0 → v1 only with
  tests).
- **Definition of done:** golden `ARScene` JSON for every fixture in CI; the phone opens a downloaded
  file.

### Major architectural work vs quick wins

- **Architectural (plan carefully, with an ADR note in CLAUDE.md):**
  - snap service;
  - multi-select;
  - command convergence;
  - `enclosure` category and boundary treatments;
  - plant catalogue and bed contents;
  - polygon booleans;
  - representation table;
  - levels datum.
- **Quick wins:** all of Phase 0. They can land independently and will be noticed immediately.

---

## 8. What NOT to build

- **Irrigation, drainage and lighting circuit engineering.** Fitting count and position is enough.
- **Structural calculation**, foundations and posts. Use the product dimensions only.
- **A horticultural database.** Build about 100 species with ten fields, not thousands; no soil pH
  engine and no hardiness maps.
- **A full terrain model**: no contours, TIN editing, cut/fill volumes, or survey-grade levels.
  Use spot levels plus warnings.
- **BIM / IFC, DXF export or survey import.** An image underlay is the proportionate answer.
- **Ray-traced or photoreal rendering, or a whole-garden 3D walkthrough.** This matches the decision
  of 28–29 Sep 2026: 3D stays a configurator for tall structures.
- **Costing in currency** (already decided against). Quantities are defensible; prices are not.
- **Server-side PDF** (already decided against).
- **Real-time multi-user collaboration**, accounts and auth beyond a read-only share token.
- **Seasonal visualisation.** The existing TODO correctly prefers a maturity scalar.
- **A general CAD layer system**: no user-created layers, layer ordering or per-layer styles. Fixed
  groups with eye toggles are enough.
- **Parametric constraints solving** (equal spacing, parallel/perpendicular as persistent
  constraints). Use snapping at gesture time plus the AI's `rotate to: house|boundary|element`.

---

## 9. Final target product

> **A focused residential landscape-design tool with an AI designer built into the editor**: every
> shape is real, measured geometry; every object carries the data a designer would specify; and
> manual controls and natural language are two ways of issuing the same checked operations.

An example workflow at the end of the project:

1. **Map the property.**
   - Start from a rectangle preset, or trace over an uploaded photo of a survey calibrated by one
     known measurement.
   - Type side lengths and corner angles.
   - Place the house, doors, windows, gates and the street side.
   - Optionally drop three spot levels and the house floor level.
2. **Record existing features.** Keep the 8 m birch (with height and spread, so it casts its real
   shadow), mark the shed for removal, and outline the area to redesign.
3. **Give a brief.** Pick spaces and a style from pictures, a budget and a maintenance level, and
   write a sentence of purpose.
4. **The AI proposes layouts.** Three composed concepts, each explaining why it is shaped the way it
   is, with a score and what it could not fit.
5. **Choose one.**
6. **Edit it.**
   - Drag the terrace edge until it snaps flush to the house wall.
   - Redraw the path's corners.
   - Select three beds and switch them to a shade-tolerant mix.
   - Or say "move the fire pit nearer the seating and edge the patio in steel where it meets the
     lawn". This plays as visible operations and undoes with ⌘Z.
7. **Precision is maintained.** Live clearances to the fence while dragging, typed dimensions and
   rotation, snapping to vertices, edges and walls. The editor refuses what would leave the plot.
8. **Objects carry meaning.**
   - The patio knows its porcelain module, joint, bond and per-stretch edging.
   - The new fence knows it is 1.8 m hit-and-miss along 6.2 m of the left side.
   - Each bed knows its species and how many of each to buy, and warns when a sun-lover sits in four
     hours of afternoon shade.
9. **Quantities are automatic.** Net paving area and slab count, lawn, gravel volume, edging and
   fence metres, retaining face, steps, and plants by species, all derived and never stored.
10. **One design in several views.** The plan in 2D. The pergola configured in 3D among its real
    surroundings. The same document exported as an AR scene for the phone app.
11. **Export and share.** A Garden Design Pack PDF (plan, dimensions, planting plan and schedule,
    lighting, hardscape schedule, design summary), a chrome-free presentation view with sun time and
    before/after, and later a read-only share link.

---

## Verification of this analysis

- Every "current" claim cites a file. The three surveys read these directly:
  - `concepts.ts`, `site.ts`, `quantities.ts`, `plant-catalogue.ts`, `boundary-style.ts`,
    `assistant.ts`;
  - `EditorCanvas.tsx`, `plan-editor-store.ts`, `EditorToolbar.tsx`, `SelectedElementPanel.tsx`;
  - `build-scene.ts`, `export-plan.ts`, `ReviewScreen.tsx`, `model-registry.ts`, `ar-contract`.
- Spot-checked by hand:
  - there are no `georeference` or `lib/geo` files;
  - `planSchedule` has no boundary or plant lines;
  - `ProposeRequest.selection` is an array;
  - `snapDeltaToTargets` is not called in the step 5 store;
  - the toolbar has a measure tool and a dimensions toggle.
- **Doing this deliverable** means saving this file to
  `docs/investigations/landscape-software-gap-analysis.md`. No code changes. Each roadmap phase would
  get its own plan with its own `eval:generator` baseline and golden-image check before
  implementation starts.
