You are working on Garden Studio, an AI-assisted residential garden design application.

I want you to act as a senior graphics engineer + frontend architect and plan and implement a major upgrade to our garden rendering system.

IMPORTANT:
Do not rewrite our concept-generation system.
Do not replace our structured geometry with AI-generated images.
Do not make the final plan a flattened image.
Every meaningful garden object must remain structured, measurable, editable and costable.

The goal is to make our generated garden designs visually approach high-quality professional top-down landscape visualisations: dense realistic planting, convincing materials, realistic roofs, furniture and structures, coherent lighting, soft shadows and visual depth.

Think of a high-end orthographic/top-down landscape architecture render rather than a CAD plan.

CURRENT ARCHITECTURE

Garden Studio is a six-step UK residential garden design wizard:

1. Map
2. Features
3. Brief
4. Concepts
5. Editor
6. Review

Routes:
- /plan/[id]/map
- /plan/[id]/features
- /plan/[id]/brief
- /plan/[id]/concepts
- /plan/[id]/editor
- /plan/[id]/review

Monorepo:
- apps/web — Next.js 16 App Router, Konva canvases
- apps/api — NestJS, persistence + PostGIS + concept generator
- packages/schema — Zod schemas + shared pure geometry

PlanDocument is stored as JSONB.

Concepts are lists of DesignElements in metres in a local planar coordinate system.

DesignElements include:
- lawn
- planting-bed
- paved-area
- gravel-mulch
- structure
- water-feature
- furniture
- existing-feature

Shapes:
- rect
- polygon
- polyline
- point

Other metadata includes:
- material
- symbol
- height
- plantingStyle
- pattern
- bedId
- plantId
- role
- fillKind

The generator is deterministic and should remain so.

We already have:
- deterministic geometry generation
- PostGIS placement
- DesignFrame
- layout templates
- designed planting beds
- structured planting schemes
- world-coordinate texture origins
- deterministic sampling
- structural planting elements
- material patterns
- vegetation/furniture sprites
- shared lighting
- calculated cast shadows
- contact shadows
- concept/editor shared scene semantics

The current rendering stack has two consumers:

1. Konva
ConceptCanvas + EditorCanvas through ElementDrawing.

2. Canvas2D
drawPlan(), used for:
- concept thumbnails
- PNG export
- visualise panel
- judging sheets

Rendering currently splits ground and object passes.

Materials support:
- grid
- board
- scatter
- stripe
- water

Assets are generated offline and stored under:
apps/web/public/assets/

We currently have roughly 80+ assets:
- face
- texture
- sprite

The running app does NOT call an image model.

PLANTING MODEL

Planting schemes already contain:

- backdrop
- mass
- mid
- accent
- edge
- specimen

Structural roles such as backdrop/specimen may become explicit DesignElements.

Other layers can currently be painter-generated.

Plant placement is deterministic using samplePlanting().

THIS IS IMPORTANT:
The existing planting architecture is a good foundation. Extend it instead of replacing it.

TARGET VISUAL QUALITY

We want the Visualise mode to look much closer to a professional top-down garden render.

Characteristics:

- realistic dense mature planting
- foliage overlapping into coherent masses
- very little bare soil in mature beds
- trees that feel integrated rather than pasted on
- realistic top-down furniture
- realistic pergolas/sheds/garden structures
- high quality paving
- non-repeating lawn
- realistic gravel/decking/material variation
- convincing roof over the mapped house footprint
- ambient/contact shadows
- global sunlight
- height hierarchy
- consistent lighting across every asset
- high quality downsampled final output

We do NOT need actual 3D scene navigation.

The result should remain a top-down/orthographic 2D representation.

PROPOSED ARCHITECTURE

I want you to investigate and implement an architecture where DesignElements remain the semantic source of truth but are transformed into a richer presentation scene:

PlanDocument
    ↓
DesignElements
    ↓
buildRenderScene()
    ↓
RenderScene
    ↓
high-fidelity renderer

RenderScene should contain presentation-only data such as:

- RenderSurface[]
- RenderPlant[]
- RenderObject[]
- RenderHouse
- render-only vegetation
- material instances
- shadow information
- visual height/layer
- asset variant
- deterministic rotation
- deterministic scale
- maturity

These presentation objects should NOT pollute PlanDocument unless there is a semantic reason to persist them.

For example:

type RenderPlant = {
    position: Point
    assetId: string
    radius: number
    rotation: number
    scale: number
    height: number
    visualLayer:
      | 'groundcover'
      | 'edge'
      | 'perennial'
      | 'grass'
      | 'shrub'
      | 'specimen'
      | 'tree'
}

The exact types should be designed after inspecting the current codebase.

WEBGL

I believe we should introduce PixiJS/WebGL for the presentation renderer.

Do NOT blindly rewrite the Konva editor.

My preferred initial architecture is:

                       PlanDocument
                            |
                    buildRenderScene()
                       /          \
                      /            \
             Konva editor       Pixi/WebGL
             interactions       Visualise
                                export

Investigate whether this is appropriate after inspecting the repository.

Unless you find a significant architectural problem, implement the new high-fidelity Visualise renderer in PixiJS.

Konva should remain responsible for:
- selection
- handles
- dragging
- resizing
- editing interaction
- measurement overlays
- editing UI

PixiJS should initially be responsible for:
- Visualise mode
- high-density vegetation
- large sprite counts
- filters
- masks
- material rendering
- visual compositing
- presentation shadows

Do not attempt a complete editor migration in this task.

RENDERING REQUIREMENTS

1. RENDER SCENE

Create a clear boundary between semantic scene data and visual scene data.

buildRenderScene() must:
- be deterministic
- not mutate PlanDocument
- derive all visual-only information
- use world-coordinate seeding
- produce stable output when unrelated elements are edited

Avoid sequence-dependent randomness.

For example, changing one bed should not visually reshuffle every other bed.

Use stable seeds derived from things such as:
- concept seed
- element id
- bed id
- world grid cell
- plant taxon
- render layer

2. DENSE PLANTING

This is one of the highest-priority changes.

A planting bed should no longer visually appear as:
soil texture + a few plants.

Instead use the existing planting layers to produce dense render-only planting.

Example:

planting bed
 ├ soil
 ├ groundcover
 ├ edge plants
 ├ mass plants
 ├ mid planting
 ├ accent planting
 ├ structural shrubs
 └ specimen plants

The majority of these can be presentation-only RenderPlants.

Structural plants that matter to the actual design should remain DesignElements.

Mature planting should frequently reach approximately 70–95% apparent vegetation coverage depending on the planting scheme.

Plants must overlap.

Do not draw every plant as an isolated icon.

Use height/layer information so:
- edge plants are low
- groundcover is lowest
- mass/mid plants overlap them
- shrubs overlap perennials
- specimens overlap shrubs where appropriate
- trees sit above everything

3. PLANT MATURITY

Introduce a visual maturity setting:

- Year 1
- Year 3
- Mature

This should affect presentation rather than fundamental garden geometry.

Maturity can influence:
- crown scale
- visual density
- overlap
- amount of exposed soil

Default Visualise mode can initially use Mature.

Do not make this a planting schedule calculation unless existing product requirements demand it.

4. VEGETATION ASSET SYSTEM

Audit the existing asset system.

The final appearance requires a coherent asset library.

Assets should have:
- consistent orthographic/top-down camera
- consistent lighting direction
- transparent backgrounds
- consistent physical scale
- similar colour grading
- consistent edge softness
- multiple variants per commonly repeated plant type

Use taxon-based asset matching.

Avoid hand-coding asset IDs throughout the renderer.

Where several assets satisfy a query, deterministically choose a variant.

Also apply subtle deterministic:
- rotation
- scale variation
- variation selection

Do not let repeated shrubs/ornamental grasses look like duplicated stickers.

Do not require us to regenerate all assets as part of this implementation, but design the system so a coherent new asset pack can be dropped in.

If useful, propose improvements to asset-spec.ts and the catalogue format.

5. MATERIALS

Upgrade visual materials without breaking their semantic representation.

PAVING

Add support for:
- multiple face variants
- deterministic per-module face selection
- subtle per-module tonal variation
- joints
- micro edge shading
- optional subtle weathering/dirt variation
- coherent lighting

Do not make adjacent surfaces lose course alignment.

The existing world-coordinate origin behaviour must remain.

LAWN

Avoid obviously tiled grass.

Combine:
- base turf texture
- low-frequency world-space variation
- fine grass detail
- optional mowing direction
- restrained irregularity

GRAVEL / MULCH

Avoid flat noise.

Maintain visible aggregate where zoom permits.

DECKING

Maintain board direction and continuity.

All visual variation must be deterministic.

6. HOUSE RENDERER

The current house representation is too diagrammatic for presentation mode.

Keep the mapped footprint as the semantic truth.

Create a visual RenderHouse representation that can produce a plausible top-down roof.

Support initially:
- gable
- hipped
- flat

Potential presentation metadata:
- roof type
- roof material
- number of storeys

Possible roof materials:
- dark tile
- slate
- red tile

For simple footprints, derive:
- roof planes
- ridge
- eaves
- shading
- roof material

The roof does not have to reconstruct the real house perfectly.

This is a garden design visualisation.

The purpose is to provide believable context while maintaining the mapped footprint underneath.

Do not modify measurement geometry to make the roof look good.

7. LIGHTING

Preserve the existing solar-light model.

But separate:

A. Solar/cast shadow
B. Ambient/contact shadow

Add convincing ambient/contact shading beneath:
- shrubs
- trees
- furniture
- pergolas
- sheds
- raised beds
- hedges
- house edges

This should create depth even when no real solar location is available.

Contact shadows should not pretend to be geographical solar calculations.

Treat them as a presentation convention.

Avoid double-darkening overlapping transparent shadows.

Use composite layers/masks where appropriate.

8. VISUAL HEIGHT HIERARCHY

Move beyond only ground/object distinction in the presentation renderer.

Conceptually support something similar to:

1 base
2 surfaces
3 groundcover
4 low planting
5 mid planting
6 furniture
7 structures
8 shrubs
9 trees
10 house/context
11 overlays/post-processing

Do not implement layers mechanically if a better Pixi container architecture exists.

The goal is correct compositing and visual hierarchy.

9. HIGH RESOLUTION OUTPUT

Presentation exports should support rendering above final output resolution.

For example:
- target 1600 × 1200
- internally render 3200 × 2400
- downsample cleanly

Investigate how best to implement this with PixiJS.

Avoid huge memory consumption.

10. FINAL COMPOSITING

Add a restrained global finishing stage if appropriate:
- small contrast adjustment
- subtle saturation correction
- optional light warmth
- controlled sharpening/downsampling

Do not turn the renderer into an Instagram filter.

The output should still look like an architectural visualisation.

11. PERFORMANCE

We may render hundreds or potentially thousands of vegetation sprites.

Take advantage of PixiJS:
- batching
- texture atlases if appropriate
- sprite containers / particle-style rendering where appropriate
- cached masks
- stable textures
- sensible LOD

Do not over-engineer prematurely, but architect for dense planting.

The visualiser should remain smooth on normal modern laptops.

12. EDITOR RELATIONSHIP

The editor must remain usable.

Do not make high-detail vegetation interfere with object selection.

In 2D Plan mode:
- prioritise editability and clarity

In Visualise:
- prioritise presentation quality

They are two views over the same plan.

Ideally switching between them does not regenerate or change the underlying design.

13. TESTING

Maintain determinism.

Add tests for:
- RenderScene stability
- deterministic asset choice
- deterministic plant sampling
- maturity behaviour
- unrelated edits not reshuffling unrelated planting
- no visual instance outside its legal bed where containment is required
- house roof generation
- world-space texture continuity

Do not use screenshot tests as the only protection.

Where useful, keep image regression/judging sheets as a secondary validation tool.

IMPLEMENTATION APPROACH

Before changing anything:

1. Inspect the relevant packages and renderer files.
2. Understand current scene-passes.ts, ElementDrawing, drawPlan, render-surface-pattern, asset catalogue, shadows, planting, samplePlanting and house rendering.
3. Identify which existing abstractions can be reused.
4. Identify technical debt or assumptions that would block this architecture.
5. Produce a concrete implementation plan.

Then implement in phases.

Do not create a huge rewrite.

I expect a staged migration.

Suggested direction:

Phase 1
- RenderScene abstraction
- PixiJS proof of concept
- render existing surfaces + objects in Visualise

Phase 2
- dense render-only planting
- deterministic variation
- maturity system

Phase 3
- improved material rendering

Phase 4
- procedural roof/house visualisation

Phase 5
- ambient/contact shadows
- hierarchy/compositing

Phase 6
- high-resolution export
- performance tuning
- finishing pass

You may alter these phases if repository inspection shows a better dependency order.

IMPORTANT DESIGN CONSTRAINTS

Do not:
- replace concepts with generated images
- introduce server-side image generation
- remove deterministic generation
- duplicate business geometry in the renderer
- make presentation geometry authoritative
- introduce Math.random() into rendering
- duplicate editor and visualiser semantic rules
- let visual plants become quantities automatically
- destroy world-space material continuity
- rewrite the whole editor to WebGL
- remove Canvas/Konva until there is a proven reason

The source of truth remains:
PlanDocument + shared geometry.

Renderer authority remains:
none.

VISUAL SUCCESS CRITERIA

When finished, a normal generated concept should visually read as a professionally landscaped residential garden rather than a CAD plan with textures.

In particular:

- planting beds should look densely planted
- plants should overlap naturally
- repeated vegetation should not look cloned
- trees should integrate with the rest of the planting
- paving should not look like a uniform grid
- lawns should not visibly tile
- the house should have a believable roof
- objects should feel grounded
- lighting should be coherent
- the whole scene should have clear depth hierarchy
- Visualise should look significantly richer than 2D Plan
- all semantic elements must remain editable when returning to the editor

START BY REVIEWING THE CURRENT IMPLEMENTATION.

Do not immediately code based solely on this prompt.

First give me:

1. your assessment of the existing architecture
2. where PixiJS should and should not be introduced
3. exact files/modules likely to change
4. proposed RenderScene architecture
5. migration phases
6. risks
7. performance considerations
8. what should remain untouched

Then proceed with implementation once the plan is internally coherent.

Use the existing project conventions and minimise unnecessary new abstractions.
