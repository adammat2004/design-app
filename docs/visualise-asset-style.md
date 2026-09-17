# The Visualise asset style specification

This is the contract every **elevated** asset is generated against. It exists so that the same
sentence can be handed to an image model a year apart and come back with a picture that belongs to
the same garden as the ones already checked in. Reproducibility and consistency are worth more here
than artistic variety: a library of fifty assets that agree is a visualisation, and a library of
five hundred that disagree is a collage.

It applies to the `vis-*` and `skin-*` families in
[`asset-spec.ts`](../apps/web/src/lib/materials/assets/asset-spec.ts). It does **not** apply to the
plan-camera families (`plant-*`, `tree-*`, `furniture-*`, `face-*`, `tex-*`), which keep their own
strictly-overhead specification and keep drawing 2D Plan exactly as they do today.

Renderer QA and rollout status are tracked in [the rendering upgrade acceptance notes](rendering-quality-upgrade.md).
The manifest's optional `render` fields distinguish **declared** camera/lighting intent from a
**reviewed** image. The asset audit reports resolved anchors, full-frame pixel density, safe
transforms, ground-shadow verification and replacement status; defaults are deliberately conservative.
A complete file set is not evidence of visual compliance. Elevated sprites are not freely mirrored
or rotated to conceal a lighting mismatch, and directional material skins are not randomly turned.

---

## 1 · The camera

Every elevated asset is drawn from **one** virtual camera:

| | |
|---|---|
| Attitude | looking down, tilted **12° from vertical** towards the viewer |
| Projection | **orthographic** — parallel verticals, no convergence, no lens distortion |
| Consequence | the footprint is an unforeshortened plan; the object's front face is visible below its top |

Twelve degrees is the number the renderer uses too, as `RISE = tan(12°) ≈ 0.21` in
[`projection.ts`](../apps/web/src/lib/render/projection.ts): a point *h* metres above the ground is
drawn `h × RISE` metres up the screen. **The constant and the prompt are the same fact stated
twice**, and they must be changed together or a photographed shed will not sit on a drawn one.

The angle is deliberately shallow. Strongly isometric art (30°+) turns the drawing into a picture of
a model village: footprints stop being readable, a plan stops being a plan, and every object starts
hiding the one behind it. Twelve degrees is enough that a 2 m fence shows 42 cm of face and a shed
shows its front wall, and little enough that a patio is still a patio.

## 2 · Lighting

One sun, stated once, obeyed by everything:

| | |
|---|---|
| Direction | from the **upper left** — screen azimuth 315° |
| Elevation | about **55°** above the horizon |
| Softness | soft, hazy daylight; a visible but gentle self-shadow with no hard terminator |
| Ambient | high; nothing in shadow goes black, shadow-side detail stays readable |
| Contrast | restrained — a landscape visualisation, not a sunlit photograph |

This matches `LIGHT_DIRECTION` in [`light.ts`](../apps/web/src/lib/materials/light.ts), which is
what lights slab bevels, blob highlights, water crests and roof planes. Two suns in one drawing is
the single most obvious way a render gives itself away.

## 3 · Shadow policy — the hybrid, and why

**Self-shading is baked. Ground shadows are not, ever.**

| | Baked into the asset | Drawn by the renderer |
|---|---|---|
| The object's own light and shade | ✅ | |
| Contact shadow (the object stands on the ground) | | ✅ `fx-soft-shadow` |
| Cast shadow (the sun at 16:20 in June) | | ✅ `render-shadow-layer.ts` |

A baked ground shadow is wrong twice over. It **rotates with the object**: a shed turned 90° would
throw its shadow east. And it is **fixed in time**, so it would contradict the cast-shadow layer the
moment the user touched the time slider. Both are visible errors that no amount of art quality
rescues. So the model is told, every time: *no cast shadow, no ground plane, no contact darkening*.

### The cost, measured rather than assumed

The accepted cost is that the assets are lit from a fixed direction and the scene's sun is not.
**This is bigger than it first looks and it is worth stating in numbers.** On the suburban fixture —
Manchester, day 172, 15:00 — `lightDirection` resolves to `{ x: −0.91, y: +0.41 }`: the sun is to
the **left and below**, low in the west. Every procedurally shaded thing in that plan is lit from
there, and every generated sprite in it is lit from the upper left. That is two suns in one drawing,
which the renderer's own rule ("one light reaches everything") exists to forbid.

Three things keep it tolerable rather than fatal, and they should be understood before anyone
"fixes" it:

1. **An unlocated plan has no disagreement at all.** With `site.location` null the scene uses
   `LIGHT_DIRECTION`, which is the upper left — exactly what the art is baked to. Most plans are
   unlocated most of the time.
2. **The art is deliberately low-contrast and high-ambient**, so its baked light reads as form
   rather than as a sun. A strongly lit asset would make the mismatch obvious; a gently shaded one
   reads as ambient occlusion.
3. **The cast shadows are still right.** They are the strongest light cue in the picture and they
   follow the real sun, so the *scene* never contradicts itself about where the sun is — only the
   objects' own shading does, and at a lower amplitude.

The alternatives were considered and are all worse: shading everything with the fixed drawing light
throws away the time-of-day slider; asking the model for flat art throws away the form that is the
whole point of an elevated library; rotating a sprite to face the sun spins the object. Mirroring a
sprite horizontally when the sun crosses to the right is the one cheap partial fix available, and it
is worth trying for vegetation before anything more drastic.

## 4 · Realism and colour

- **Realism**: photoreal landscape-visualisation render. Not a photograph (a photograph brings its
  own camera and its own sun), not a game asset, not an illustration, never cartoon or clip-art.
- **Colour**: natural, slightly desaturated — about 10% below a photograph. Neutral white balance,
  no colour grade, no warm or cool cast.
- **Saturation**: mid. Foliage greens are never neon; timber is never orange.
- **Why desaturated**: elevated art is `recolourable: false` (see §8), so what the model returns is
  what the plan shows. Slightly muted art sits together; saturated art fights.

## 5 · Transparency and framing

- Fully **transparent** background. No white, no colour, no checkerboard, no vignette.
- Clean anti-aliased alpha. No white fringe, no halo, no matte line.
- The object **centred horizontally**, its **front facing screen-bottom**, filling the frame with no
  more than 4% margin.
- **No ground plane, no plinth, no base disc, no reflection.**
- Nothing clipped at any edge.

## 6 · The frame, and what "size" means

This is the rule that makes one placement routine work for a pot and for a tree.

```
image width   = metres.w                      ← the footprint's width
image height  = metres.h + heightMetres × 0.21 ← the footprint's depth, plus the lift
```

The **bottom `metres.h` of the frame is the footprint** — the ground the object actually stands on,
drawn in true plan. Everything above it is the object's height, leaning up the screen. So:

```
      ┌──────────────┐  ▲
      │   canopy /   │  │  heightMetres × RISE
      │   roof /     │  │
      │   back       │  ▼
      ├──────────────┤  ▲
      │  footprint   │  │  metres.h
      └──────────────┘  ▼
      │◄─ metres.w ─►│
```

The renderer's job is then trivial and identical for every family: put the **anchor** on the
element's ground anchor, scale so the frame's width covers `metres.w` metres, and draw. The anchor
defaults to the centre of the footprint band — `{ x: 0.5, y: 1 - (metres.h / 2) / frameHeight }` —
and a family whose foot is not there says so explicitly.

A tree is the interesting case and it falls out of the same rule: `metres.w` is the canopy spread,
`metres.h` is the canopy spread too (the canopy's own ground shadow footprint), and `heightMetres`
is the trunk height to the crown centre. The canopy therefore overhangs the anchor in every
direction, which is exactly what a real tree does and exactly what the reference shows.

## 7 · Orientation

- The **front** — the face a person approaches, the side of a shed with the door, the front of a
  sofa — faces **screen-bottom**.
- The long axis runs left to right.
- One asset per family per variant. Directional variants are a fallback, not the default; see
  "Rotation" below.

## 8 · Metadata every family carries

| field | meaning |
|---|---|
| `camera: 'elevated'` | which specification this was drawn to; absent means `'plan'` |
| `metres: { w, h }` | the **footprint** in metres, not the image's coverage |
| `heightMetres` | how tall the thing is; with `RISE` this gives the frame's height |
| `anchor: { x, y }` | where the object stands inside its own frame, as a fraction |
| `recolourable: false` | always, for elevated art — see below |
| `variants` | how many to generate |

**Elevated art is never recolourable.** The tint path (`SPRITE_TINT`, `MASS_TEXTURE_TINT`) is a
proportional multiply, and a multiply darkens what is already dark — so shaded art goes muddy
exactly where the shading is. The plan-camera families were written flat and neutral *so that* they
could be tinted; elevated families carry their own light instead. Per-plant variety comes from the
variant, the crown scale and a ±6% lightness wash, never from a multiply.

## 9 · Resolution and format

| family group | source | format |
|---|---|---|
| plants, shrubs, grasses | 512 px on the long side | WebP, alpha, quality 90 |
| trees | 1024 px | WebP, alpha, quality 90 |
| furniture, planters, pots | 768 px | WebP, alpha, quality 90 |
| skins (extrusion faces) | 512² | WebP, opaque, quality 88 |

Lossy rather than the lossless the plan sprites use. The plan library is already 25 MB for 99
sprites, and this one will be larger and more detailed; at quality 90 with alpha the difference is
invisible at every zoom the plan supports and the payload is roughly a fifth.

Bigger source images are not better. Everything here has a size floor in
[`lod.ts`](../apps/web/src/lib/materials/lod.ts), and a 2 m shrub at the editor's default zoom is
52 px across — a 512 px source is already 10× oversampled, which is the headroom a 200 px/m close
zoom needs and no more.

## 10 · Naming

```
family id   vis-<subject>              skin-<subject>
file        elevated/sprites/vis-<subject>-<n>.webp
            elevated/textures/skin-<subject>-<n>.webp
```

`vis-` marks the camera on the id, so a query and a catalogue row both say which specification a
family was drawn to without looking anything up. It is also what `--only vis-` matches, which is a
plain `startsWith` on the id and is unaffected by anything below.

**The directory is camera-first, and _this reverses_ the flat `sprites/` ⁄ `textures/` layout this
section used to specify.** The old reasoning was that the prefix already said everything a directory
could, so a second place to keep in step would be pure cost. That held while the elevated library was
a handful of files. At 181 files across two cameras — 149 plan, 32 elevated — the cost changed sides:
"which of these am I looking at" became a question a listing should answer, and `plan/` is now a unit
that can be deployed, measured or preloaded on its own while `elevated/` is not.

There is exactly one place the layout is decided — `assetFile` in `asset-spec.ts` — and the
generator derives its output directories from that function rather than restating them. Nothing
resolves an asset *by* path: the catalogue's `file` field is the only path the renderer reads, and a
stale entry falls back to the procedural pattern rather than erroring. That is what made the move a
one-function change plus a catalogue rewrite.

---

## Prompt templates

Every prompt is `ELEVATED` + a subject sentence + (where there is more than one) a variant sentence
the tool appends. `ELEVATED` is a single constant in `asset-spec.ts` and encodes §§1–5 and §7. What
is **fixed globally**: the camera, the light, the background, the framing, the colour treatment, the
shadow refusal. What **varies per asset**: the subject, its species or material, its size in words,
and what distinguishes the variants.

| template | adds to `ELEVATED` | families |
|---|---|---|
| `ELEVATED_TREE` | a single tree with a visible trunk, canopy overhanging it, foliage depth and layered branches | `vis-tree-*` |
| `ELEVATED_SHRUB` | a single shrub, a rounded mass with visible depth and a dark shaded underside | `vis-shrub-*` |
| `ELEVATED_PLANT` | a single herbaceous plant or grass, a clump with visible height | `vis-perennial-*`, `vis-grass*`, `vis-fern` |
| `ELEVATED_FURNITURE` | a piece of garden furniture, its own materials, seen from the front-above | `vis-dining-*`, `vis-sofa-set`, … |
| `ELEVATED_PLANTER` | a container with a visible rim and side, planting standing out of it | `vis-planter`, `vis-pot-*` |
| `SKIN` | an opaque, seamless material for a vertical face | `skin-*` |

`SKIN` is the odd one out and deliberately so: it is a **texture**, lit flat like the existing
`face-*` families, because it is drawn onto a face whose shading the renderer computes from the
face's own normal. A skin with baked light would be lit twice.

### What the first trial taught, and why `ELEVATED` reads the way it does

The first version of the preamble said the camera was "tilted twelve degrees from vertical towards
the viewer, so the top of the object and a little of its front face are both visible". It is an
accurate sentence and it produced a picture at roughly thirty degrees: the table top came back
visibly foreshortened, which is the one thing this projection cannot accept, because a foreshortened
top is no longer a footprint in true plan.

The lesson generalises to any prompt for an unusual camera. **A model does not measure an angle; it
matches a description to pictures it has seen.** "Twelve degrees" names a camera almost nothing is
photographed from, so it gets rounded towards the nearest familiar one — the three-quarter product
shot. What worked was describing the *result* instead, and saying what it is not:

- name the family of view: "a near-nadir aerial view", "almost directly overhead";
- state the consequence for the geometry: "the top surfaces are seen in true plan: square on, their
  real shape, NOT foreshortened";
- bound the thing that varies: "only a narrow sliver of the front faces shows below the top, about a
  tenth of the object's height";
- and rule out the attractors by name: "NOT a three-quarter view, NOT an isometric view, NOT a
  product photograph taken from the side".

The numeric angle stays in the sentence, because it costs nothing and it is the one place a reader
can check the prompt against `RISE`. It is simply not what does the work.

---

## Quality assurance

### Automated, in `tools/assets` (`--strict` refuses; otherwise warns)

| check | what fails |
|---|---|
| background transparent | any of the four corner pixels is opaque |
| no ground plane | opaque pixels in the bottom 2% of the frame outside the footprint width |
| clean alpha | mean saturation of the edge band (alpha 10–60) far from the interior's — a coloured fringe |
| not clipped | opaque pixels touching any frame edge after trimming |
| fills the frame | trimmed width under 90% of the frame width |
| bounds recorded | `opaqueBounds` written to the catalogue for every elevated sprite |
| prompt current | `provenance.promptHash` matches the family's prompt today |

### By eye, on the contact sheet (`pnpm --filter @garden-studio/web audit:assets`)

Each asset drawn at 64 px/m over its own footprint outline with a cross on its anchor. Check:

1. the camera angle matches its neighbours — no asset noticeably flatter or more isometric
2. the light comes from the upper left
3. proportions are believable against the footprint drawn under it
4. the front faces screen-bottom
5. the foot sits on the footprint, not above or below it
6. no text, watermark, logo or model artefact
7. realism consistent with the rest of the sheet

**Reject and regenerate rather than accept and adjust.** An asset that is nearly right is the one
that makes the whole sheet look wrong, because the eye finds the odd one out before it finds
anything else.

---

## Rotation strategy, per category

| category | strategy | why |
|---|---|---|
| **Built rectilinear things** — house, shed, pergola, gazebo, raised bed, steps, fence, wall, hedge, retaining faces | **Procedural extrusion. No asset at all.** | The footprint is whatever rectangle or polygon the user or the placer gave it, at any rotation. A photograph stretched into it would put its posts in the wrong places and its baked side face on the wrong side. Extruding the real outline is correct at every angle by construction, and the existing `face-*`/`tex-*` textures skin the faces. |
| **Vegetation** — plants, shrubs, trees, grasses, round pots | One asset per variant, **rotation clamped to ±15°** | Roughly symmetric about the vertical, so a small rotation adds variety without rotating the baked light noticeably. A full rotation would. |
| **Furniture** — dining sets, sofas, loungers, benches, bbq, fire pit, parasol | **One asset, free rotation** | The visible front face is `height × RISE`: 0.16 m for a 0.75 m table, which is 4 px at the editor's default zoom and 10 px close up. A face on the wrong side is a few pixels of gentle shading. Escalate a specific family to four directional variants only if the rotation judging sheet shows it failing. |

The rule underneath all three: **an elevated raster may be rotated only as far as its baked light
can bear.** Anything that cannot bear it is drawn, not photographed.

---

## Generic asset versus product instance

An elevated asset is a **generic visual**. The element's `symbol` and `material` are its logical
identity, the asset is one resolution of that identity into pixels, and the footprint belongs to
neither. That separation is what lets a specific purchasable pergola later replace the generic one
for the same structured footprint without touching the geometry, the schedule or the validator.
Nothing in this specification should be read as describing a product, and no asset should be named
after one.

---

## Composition targets

Everything above specifies how one asset is **made**. This section is the other half, and until
September 2026 the repo did not have it: what the **composed picture** should measure. Without it
there was no grade, no shadow character, no density target and no success criterion, so every
quality argument was a matter of taste and nothing could be checked twice and get the same answer.

**The success criterion, which this repo had never written down:**

> A user switching to Visualise should believe they are looking at a photograph of their garden
> within five seconds.

### How to measure it

```bash
pnpm --filter @garden-studio/web measure:render
```

Three quantities, over the plot and nothing else. Naming the exact definition matters, because
"saturation" is at least three different numbers:

| | definition |
|---|---|
| saturation | HSV, `(max − min) / max`, averaged per pixel |
| luminance | Rec. 709 luma over 255, averaged per pixel |
| contrast | the standard deviation of that luminance |

### The targets, and the control that produces them

| | saturation | luminance | contrast |
|---|---|---|---|
| `target_design.png`, inside the plot | 0.334 | 0.422 | 0.190 |
| ours, graded, same garden | 0.333 | 0.422 | 0.190 |

**Measure against `fixtures/target.plan.json`, never against another fixture.** That file is
`target_design.png` traced by hand, so it is the *same garden* — same layout, same lawn share. Mean
saturation over a garden is partly a function of how much of it is grass, so comparing the reference
against the suburban or l-shape plan measures composition as much as colour. `measure:render` prints
the control row first and labels it, and the other fixtures are context only.

**And crop inside the plot.** `target_design.png` is a screenshot of the whole application: a top
nav, a left palette of element cards and a right properties panel, all near-white. White is
zero-saturation and high-luminance, so a crop that catches chrome drags the reference toward
"desaturated and bright" and invents a gap that is not there. `measure:render` samples inside an
explicit quadrilateral and reports the near-white fraction of every region, and warns if the target
region goes above 5%.

**This is not a hypothetical.** The design review that commissioned the grade measured the target at
0.243 saturation and concluded we were 44% over, and specified "desaturate ~30%, lift luminance
~10%". Measured like-for-like the raw gaps were **+1.1% saturation, +10.0% luminance, −6.7%
contrast** — no colour gap at all, and we were *brighter* than the reference, not darker. Shipping
the original brief would have moved the render away from the target on two axes out of three while
the measurement applauded.

### The grade

`materials/grade.ts`, applied twice from one set of constants, because Visualise on screen is two
stacked DOM canvases and the judging sheets have no DOM at all. `grade.test.ts` holds the CSS and
the arithmetic to within one channel step of each other and of the filter specification.

`SATURATION` is below 1 **only to compensate for what `CONTRAST` does on the way past** — expanding
contrast widens `max − min` faster than it moves `max`, which lifts measured saturation from 0.338
to 0.408 on its own. Retune them together or not at all: a contrast of 1 with a saturation well
under it desaturates a render that was already correct.

### Shadow character

| occluder | softness | tone |
|---|---|---|
| built: house, walls, fence, shed, pergola, raised terrace | 0.06 m | `SHADOW_TONE` |
| foliage: trees, hedges, planted mass | 0.45 m | `FOLIAGE_SHADOW_TONE`, lighter |

0.06 m is the geometrically correct penumbra for a **hard** occluder — the sun subtends about half a
degree, so the blur at the ground is roughly distance × 0.009. It was applied to everything,
including tree canopies, and a canopy is porous: light comes through it and its shadow is the
softest, lightest thing in a real garden photograph.

Lightness is a **tone**, never a second opacity. The layer is composited once at `SHADOW_OPACITY`,
and that single composite is the only reason two overlapping shadows read as one shadow instead of
doubling. The invariant is therefore stated as: **where two shadows overlap the result is the darker
of them, never their sum.** Buckets are drawn foliage first, built second, so the darker wins — which
is what physically happens, since a canopy in front of a wall cannot un-block the sun.

Exactly two characters, and the cap is not stylistic: the shadow raster reaches 4096² at about
67 MB, Safari has been recorded refusing a canvas at 368 MB on the export path, and each character
costs a blur pass. Two buckets share one scratch canvas, so peak allocation is what it always was.

### Planting density

Mature crown coverage sits at **96.5%**, against an assertion band of 70–97% in
`render/plants.test.ts`. `PLANTING_REPORT=1 pnpm test` prints where inside the band we actually are,
at all three maturities.

**There is no headroom and none is wanted.** The ceiling is a recorded decision: a mature bed still
shows dark gaps between crowns, and without them planting reads as one flat mat rather than as
individual plants. Note also what the measure is — the union of crown *discs*, not rendered alpha —
so it is an upper bound on visual coverage, and pushing it toward 100% saturates the interior long
before it fills the bed's edge, which is structurally unreachable by adding plants: placements must
be centred inside the polygon and the understorey is deliberately held off the edge.

### The material distinguishability floor

Check it **against the palette, before grading, not against the rendered pixels**. A finished PNG
carries no material segmentation, so "lawn did not collapse against planting" is not a question an
image can answer without a label buffer that does not exist. `measure:render` reports mean saturation
per asset family group for this reason.

The current outlier is worth knowing: the `play` family measures **0.509** mean saturation against a
catalogue mean of 0.340 and a target scene of 0.334, which is why a bark play area is the loudest
object in any plan that has one. That is an asset correction, not a render one.
