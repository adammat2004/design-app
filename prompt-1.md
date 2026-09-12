I want to upgrade Garden Studio's visual renderer from its current strict top-down asset style to a much more polished 2.5D / elevated top-down landscape visualisation style.

Use the attached target Garden Studio design as the primary visual reference.

DO NOT immediately generate a random collection of assets or replace the current renderer.

First inspect our existing asset system, RenderScene architecture, scene schema, asset manifests, sizing/anchoring conventions, rotation behaviour, procedural surfaces, shadows, and how assets are currently loaded/rendered.

Then propose and implement a systematic asset upgrade.

## Goal

We want the final garden visualisation to look much closer to the attached reference.

The important characteristic is that the garden is still fundamentally a 2D structured plan, but objects visually communicate height and depth.

For example:

- trees have deep overlapping canopies
- sheds show their roof AND some visible wall faces
- pergolas show their roof structure and vertical posts
- furniture is viewed from an elevated angle
- raised planters show their top and sides
- pots have visible height
- planting feels layered and dense
- fences/walls communicate height
- objects cast coherent shadows

This should create a convincing "2.5D" garden visualisation without turning the application into a true 3D editor.

## Critical architectural rule

Geometry remains the source of truth.

Do NOT replace structured scene geometry with generated garden images.

Do NOT make AI-generated images the design itself.

The same logical object should still be represented by structured data such as:

{
  type: "pergola",
  x: ...,
  y: ...,
  width: ...,
  depth: ...,
  rotation: ...
}

The renderer determines how that object looks.

Our existing deterministic/editable architecture must remain intact.

## Plan vs Visual representation

Investigate whether we should explicitly support two representations:

PLAN
- clean top-down geometry
- measurements
- selection handles
- boundaries
- guides
- accurate footprints
- editing/mapping

VISUALISE
- elevated 2.5D assets
- realistic vegetation
- shadows
- textures
- overlapping planting
- depth
- more realistic structures

Both must consume the SAME underlying PlanDocument / scene geometry.

Conceptually:

                    PlanDocument
                         |
             -----------------------
             |                     |
       Plan Renderer        Visual Renderer
             |                     |
       precise geometry       2.5D assets
       measurements           shadows
       handles                textures
       guides                 vegetation
                              depth

Do not duplicate scene state.

## New asset library

We likely need a new asset library designed specifically for the Visualise renderer.

Do NOT simply perspective-transform our existing strict top-down assets.

Create assets specifically for the elevated camera style.

The entire library needs a strict visual specification.

### Camera

All assets should appear to be photographed/rendered from the same virtual camera.

Target:

- elevated top-down view
- approximately orthographic
- minimal perspective distortion
- enough elevation that vertical faces are visible
- still readable primarily as a plan

Use the attached reference to determine an appropriate visual angle.

Do not make assets strongly isometric.

Do not make them look like a conventional 3D video game.

They should resemble professional landscape architecture visualisations.

## Lighting

All assets must share one coherent lighting model.

Define:

- light direction
- approximate elevation
- shadow direction
- shadow softness
- ambient lighting level
- contrast range

For example, if light comes from upper-left, every asset must follow that convention.

Avoid assets with contradictory baked lighting.

Determine whether shadows should be:

A. baked into assets
B. generated separately by RenderScene
C. a hybrid

Prefer whichever gives us the most consistent results when objects are rotated.

Pay particular attention to rotation.

A shadow baked into an image may rotate incorrectly with the object if lighting is supposed to remain world-space.

Investigate this before deciding.

## Transparency

Object assets should:

- use transparent backgrounds
- have clean alpha edges
- contain no white/coloured background
- avoid unnecessary empty padding
- have predictable bounds

Do not include large shadows in the alpha bounds unless our rendering architecture deliberately requires this.

## Asset categories

First audit our existing catalogue.

Then categorise assets into approximately:

### Raster/image assets

Likely good candidates:

TREES
- deciduous tree
- ornamental tree
- olive-style tree
- multi-stem tree
- evergreen tree
- small ornamental tree

SHRUBS
- rounded evergreen shrub
- flowering shrub
- loose natural shrub
- architectural shrub

GRASSES / INDIVIDUAL PLANTS
- ornamental grass
- fern
- structural perennial
- flowering perennial clusters

STRUCTURES
- shed
- pergola
- gazebo
- greenhouse if supported
- garden room if supported

FURNITURE
- dining table + chairs
- outdoor sofa
- lounge chairs
- bench
- fire pit
- BBQ
- outdoor kitchen elements if supported

DECORATIVE
- planters
- pots
- raised beds
- water features
- other relevant objects

Do not create dozens of variations yet.

Create a strong foundational library first.

## Procedural elements

Do NOT convert everything into raster assets.

Elements that need arbitrary geometry should remain procedural or texture-based.

Likely examples:

- lawn
- paving
- decking
- gravel
- concrete
- bark mulch
- planting beds
- paths
- driveways

Investigate our current implementation and preserve procedural geometry where appropriate.

Improve textures/material rendering separately where required.

## Linear boundary elements

Investigate the best approach for:

- fences
- hedges
- walls
- edging

These need to follow arbitrary boundary/line geometry.

Do not simply use one giant image.

Consider:

- repeatable segment assets
- procedural extrusion-like rendering
- tiled textures
- caps/posts/corners
- height-aware shadows

They should visually communicate some height in Visualise mode.

## House

The house should NOT become a fixed raster asset.

Its footprint comes from user-mapped geometry.

Long term, we want to use structured property information such as:

- house footprint
- wall height
- doors
- patio/sliding doors
- windows
- potentially roof information

to create a believable elevated representation.

Investigate how the Visual renderer could procedurally create a simple 2.5D house from this data.

We do NOT need a full 3D house system in this task.

However, avoid making renderer decisions that prevent this later.

## Planting beds

This is particularly important.

The target reference has dense, overlapping planting rather than isolated symbols.

We already want planting beds to feel like designed compositions.

Investigate how the new asset library should support:

planting bed polygon
    ↓
deterministic placement system
    ↓
multiple shrub/plant assets
    ↓
controlled overlap
    ↓
different scales
    ↓
edge spill
    ↓
layering
    ↓
coherent shadows

We should NOT require users to manually place every individual plant.

The system should be capable of rendering a structured planting bed as a rich visual composition.

Individual plants can still exist as editable objects where appropriate.

## Depth ordering

Investigate how assets should overlap.

We need believable depth.

For example:

- planting can overlap bed edges slightly
- tree canopy can overlap objects beneath it
- furniture sits above paving
- planters sit above surfaces
- shed sits above gravel/paving
- pergola posts interact correctly with furniture beneath
- shadows render beneath their source objects

Define a deterministic z-order/layering system.

Do not rely on arbitrary insertion order.

## Asset sizing

This is critical.

Each asset must have real-world dimensional metadata.

For example:

tree:
nominalCanopyDiameter = 3m

shed:
nominalWidth = 2.4m
nominalDepth = 1.8m

diningSet:
nominalWidth = ...
nominalDepth = ...

The renderer should be able to scale assets based on metre-based scene geometry.

Do not size assets using arbitrary pixel values scattered through rendering code.

Investigate our current asset metadata and improve it if necessary.

## Asset anchoring

Define consistent anchors.

Examples:

tree:
anchor represents centre of trunk/canopy

shed:
anchor represents centre of footprint

chair:
centre of footprint

pergola:
centre of structural footprint

The visible elevated asset may extend beyond its logical ground footprint.

This is expected.

Therefore distinguish between:

LOGICAL FOOTPRINT
and
VISUAL BOUNDS.

This distinction will become important for selection, collision detection and rendering.

## Rotation

Investigate rotation carefully.

We need objects such as:

- sheds
- pergolas
- furniture
- planters

to rotate while still looking believable.

Determine whether:

- one elevated asset can rotate freely
- assets require discrete orientation variants
- some objects need 4/8 directional variants
- or another approach is better.

For approximately symmetric vegetation, arbitrary rotation is likely fine.

For strongly directional structures, a single 2.5D raster may look physically incorrect when rotated.

Do not ignore this issue.

Recommend a strategy per asset category.

## Asset generation specification

Before generating/replacing assets, create a reusable ASSET STYLE SPECIFICATION.

It should define:

1. camera angle
2. projection style
3. lighting direction
4. lighting softness
5. realism level
6. colour treatment
7. saturation
8. shadow policy
9. transparency requirements
10. object framing
11. ground contact
12. scale conventions
13. orientation conventions
14. asset resolution
15. alpha padding
16. file format
17. naming convention
18. metadata requirements

We should be able to give this specification to an image generation model repeatedly and receive assets that belong to the same visual system.

## Image generation prompts

Create reusable prompt templates for each major asset family.

For example:

TREE TEMPLATE
STRUCTURE TEMPLATE
FURNITURE TEMPLATE
SHRUB TEMPLATE
PLANT TEMPLATE
PLANTER TEMPLATE

Each template should enforce the global asset style specification.

Also determine what should be fixed globally versus varied per asset.

We need reproducibility and consistency more than artistic variety.

## Quality validation

Define an asset QA process.

Before accepting an asset, check:

- correct camera angle
- transparent background
- correct lighting direction
- realistic proportions
- no perspective mismatch
- no unexpected ground plane
- clean alpha
- no clipped leaves/objects
- appropriate visual padding
- consistent realism
- correct orientation
- compatible scale
- no text/logos/artifacts

Consider whether some checks can be automated.

## Asset manifest

Investigate whether the asset manifest should contain metadata similar to:

{
  id,
  category,
  variant,
  file,
  nominalWidth,
  nominalDepth,
  nominalHeight,
  anchor,
  visualBounds,
  rotationStrategy,
  renderLayer
}

Do not blindly use this schema.

Fit it to our existing architecture.

## Real products

We have also discussed eventually connecting designed objects to real purchasable products.

Do not implement this now.

However, make sure the distinction remains clear between:

GENERIC VISUAL ASSET
and eventually:
PRODUCT INSTANCE / PRODUCT METADATA

For example, a generic pergola visual can later potentially be replaced with the visual representation of a real pergola product while retaining the same structured footprint.

## Performance

The target scene may contain:

- dozens/hundreds of plants
- several trees
- multiple furniture objects
- procedural surfaces
- shadows
- structures

Investigate:

- asset resolution
- texture memory
- caching
- image loading
- lazy loading
- sprite atlases if appropriate
- Konva caching
- LOD strategies
- whether off-screen assets matter
- whether visual mode needs different performance treatment from plan mode

Do not sacrifice editing responsiveness for visual fidelity.

## Asset resolution

Recommend appropriate source resolutions.

They need to:

- look crisp when reasonably zoomed
- not consume excessive memory
- work on high-DPI screens

We don't need unnecessarily huge source images.

## Existing assets

Audit the current asset library.

Categorise each existing asset as:

KEEP
REGENERATE
REPLACE WITH PROCEDURAL RENDERING
REMOVE
NEEDS INVESTIGATION

Do not delete existing assets immediately.

We may still need them for Plan mode.

## Important product principle

Plan mode and Visualise mode serve different purposes.

PLAN MODE:
"Define and edit the geometry."

VISUALISE MODE:
"See what this garden could actually feel like."

Visualise should look substantially richer than Plan.

Do not compromise the visual renderer just to make it resemble the editing representation.

At the same time, Visualise must remain deterministic and editable.

## Target quality

Use the attached reference as the quality bar.

The key things to reproduce are NOT the exact individual assets.

Reproduce the visual principles:

- elevated top-down perspective
- visible object height
- dense planting
- natural overlap
- coherent shadows
- realistic materials
- clear structures
- rich vegetation
- strong ground contact
- consistent camera
- consistent lighting
- professional landscape visualisation quality

Avoid:

- flat CAD symbols
- obviously AI-generated whole-scene images
- inconsistent asset perspectives
- mismatched shadows
- floating objects
- clip-art appearance
- overly isometric objects
- cartoon styling
- random asset scales
- repetitive identical planting

## Implementation approach

Start by inspecting the codebase.

Then provide a concise plan before making major changes.

I want this approached in phases.

Suggested direction:

PHASE 1
Asset/rendering audit + global visual specification

PHASE 2
Create a small proof-of-concept 2.5D asset set:
- 2 trees
- 2 shrubs
- ornamental grass
- shed
- pergola
- dining set
- sofa
- planter

Integrate these into Visualise mode.

PHASE 3
Validate:
- camera consistency
- scaling
- rotation
- anchoring
- shadows
- depth ordering
- performance

PHASE 4
Expand the asset library.

PHASE 5
Improve procedural surfaces, planting composition and boundary rendering.

PHASE 6
Procedural/elevated house representation.

Adjust these phases after inspecting the actual architecture.

Do NOT attempt to regenerate the entire asset catalogue before validating the small proof-of-concept set.

## Before implementation

First report:

1. How our current assets are rendered
2. How assets are represented in the scene
3. How asset sizing currently works
4. How rotation currently works
5. How shadows currently work
6. How planting is currently composed
7. Which assets can be retained
8. Which assets need replacing
9. What needs to change in RenderScene
10. Your proposed global asset style specification
11. Your recommended rotation strategy
12. Your recommended shadow strategy
13. Any architectural concerns with this approach

Then propose the implementation plan.

The core constraint throughout:

**Improve visual fidelity without sacrificing deterministic geometry, editability, or the PlanDocument as the source of truth.**