# The asset style specification

This is the contract every asset in the plan library is generated against. It exists so that the
same sentence can be handed to an image model a year apart and come back with a picture that belongs
to the same garden as the ones already checked in. Reproducibility and consistency are worth more
here than artistic variety: a library of fifty assets that agree is a drawing, and a library of five
hundred that disagree is a collage.

It applies to every family in
[`asset-spec.ts`](../apps/web/src/lib/materials/assets/asset-spec.ts) — `plant-*`, `tree-*`,
`furniture-*`, `play-*`, `light-*`, `feature-*`, `face-*`, `tex-*`, `skin-roof-slate` and the two
procedural `fx-*` discs — and it is the specification the rules in
[`asset-style.ts`](../apps/web/src/lib/materials/assets/asset-style.ts) are written to. That module
is the rules in the form a model reads; this document is why they are what they are.

Nothing here is 3D. The AR app's 3D models (GLB) are a separate pipeline, sketched in
[`docs/ar/ar-architecture.md`](ar/ar-architecture.md) §9; the only image assets it reuses are the
seamless ground textures (`tex-*`, `face-*`).

The manifest's optional `render` fields state a family's renderer-only transform policy — whether a
texture may be quarter-turned or mirrored to break a tiling grid, whether it is desaturated at draw
time. Defaults are deliberately conservative (`quality.ts`). A complete file set is not evidence of
visual compliance; the contact sheets are.

---

## 1 · The camera

Every sprite is drawn from **one** virtual camera: strictly overhead, orthographic, no perspective,
no tilt, no foreshortening — the kind of cut-out placed on a professional landscape plan.

A sprite here **is its footprint**. The placer, the validator and the schedule all assume the picture
covers exactly the circle or rectangle of record, and the renderer fits a sprite *inside* that
geometry (`spriteBox`, `canopySpriteBox`), never the other way round. A camera that showed the side of
a thing would draw it larger than the ground it stands on.

## 2 · Lighting

Soft, flat, even, diffuse daylight with only gentle ambient shading — no distinct lit side, no
highlight, no terminator.

The plan lights things itself: slab bevels, blob highlights, water crests and roof planes all take
one light (`DrawPass.light`), which follows the real sun when the plan has a location and the
conventional top-left drawing light when it does not. Light baked into a photograph would be a
second sun, and two suns in one drawing is the single most obvious way a render gives itself away.
Flat art is also what lets the palette's tint reach the pixels (§4).

## 3 · Shadow policy

**No shadow is ever baked into an asset.**

| | Drawn by the renderer |
|---|---|
| Contact shadow (the object stands on the ground) | `fx-soft-shadow`, a procedural disc |
| Cast shadow (the sun at 16:20 in June) | the shadow layer, from each element's height |

A baked ground shadow is wrong twice over. It **rotates with the object**: a bench turned 90° would
throw its shadow east. And it is **fixed in time**, so it would contradict the cast-shadow layer the
moment the time of day changed. So the model is told, every time: *no cast shadow, no ground plane,
no base, no reflection*.

## 4 · Realism and colour

- **Realism**: photoreal landscape-visualisation render. Not a photograph (a photograph brings its
  own camera and its own sun), not a game asset, not an illustration, never cartoon or clip-art.
- **Colour**: natural, slightly desaturated. Neutral white balance, no colour grade, restrained
  contrast.
- **Recolourable sprites and textures are neutral and mid-toned.** A material's palette reaches a
  photograph only through a proportional multiply (`SPRITE_TINT`, `MASS_TEXTURE_TINT`), so the
  sprite supplies the *form* and the palette the colour. A strongly coloured photograph fights the
  tint; a multiply darkens what is already dark. `composePrompt` appends the tint clause to every
  recolourable sprite by rule.
- **Furniture and fittings keep their own colour.** They are never recoloured — tinting a teak
  dining set towards a planting palette would make it green — so they are asked for in their real
  finish.

## 5 · Transparency and framing

- Sprites: a fully **transparent** background. No white, no colour, no checkerboard, no vignette.
- Clean anti-aliased alpha. No white fringe, no halo, no matte line — a white halo tints to a
  coloured one.
- The object **centred**, filling the frame with a narrow margin, nothing clipped at any edge.
- **No ground plane, no plinth, no base disc, no reflection.**
- Faces, tiles and skins are opaque and fill the frame edge to edge.

## 6 · What "size" means

`metres` is the real-world size of one image. For a texture it is the ground one tile covers; for a
sprite it is the thing's natural footprint; for a face it is informational only, because a face is
stretched to whatever module the material manifest quotes. None of it is geometry: the element's
rect or radius is always the record, and the sprite is fitted inside it.

## 7 · Orientation

- Sprites are drawn with their long axis left to right. The renderer turns them with the element.
- One asset per family per variant.

## 8 · Metadata every family carries

The fields and their meanings are documented once, on `AssetFamily` in `asset-spec.ts`, and are
not restated here. The ones a family author has to get right are `metres`, `template`, `subject`,
`variants` and `variantSubjects` (one phrase per variant when the variants are different things),
and `recolourable`.

The specification a file was drawn to is versioned: `asset-style.ts` exports
`ASSET_SPEC_VERSION = '2.0'`, the catalogue records it beside every generated file, and a test holds
this document to the same number, so neither can move without the other.

## 9 · Resolution and format

| family group | source | format |
|---|---|---|
| sprites | 128–768 px on the long side | WebP, alpha, lossless |
| textures, skins | 512² | WebP, opaque, quality 88 |
| faces | 256–1024 px | WebP, opaque, quality 88 |

Bigger source images are not better. Everything here has a size floor in
[`lod.ts`](../apps/web/src/lib/materials/lod.ts), and a 2 m shrub at the editor's default zoom is
64 px across — a 512 px source is already several times oversampled, which is the headroom a close
zoom needs and no more.

## 10 · Naming

```
family id   <group>-<subject>
file        plan/sprites/<id>-<n>.webp
            plan/textures/<id>-<n>.webp      (textures, faces and skins)
```

There is exactly one place the layout is decided — `assetFile` in `asset-spec.ts` — and the
generator derives its output directories from that function rather than restating them. Nothing
resolves an asset *by* path: the catalogue's `file` field is the only path the renderer reads, and a
stale entry falls back to the procedural pattern rather than erroring.

---

## Prompt templates

Every prompt is composed by `composePrompt` in `asset-style.ts`:

    template  +  subject  +  variant clause  +  (tint clause)  +  (global exclusions)

The **template** is one of the keys of `STYLE.template` and carries everything fixed globally — the
camera (§1), the light (§2), the shadow refusal (§3), the colour treatment (§4), the background and
framing (§5) — plus, for `plant`, the framing sentence for its kind of subject. The **subject** is
the one sentence a family author writes. The **variant clause** names what each variant *is* from
`variantSubjects`, or asks for a different draw when the family has none. The templates themselves
are not restated here: read them in `asset-style.ts`, which is the single place they live, and which
`asset-style.test.ts` holds to this document.

The opaque templates — `face`, `tile` and `skin` — take neither the tint clause nor the exclusions,
so their prompts are exactly the sentences their files were generated from. `skin` is a `tile` seen
face-on; it now covers only `skin-roof-slate`, a roof plane tiled in its own frame, and its wording is
kept as generated so the file's prompt hash still matches.

---

## Quality assurance

### Automated, in `tools/assets` at processing time

Two lists, recorded beside every file in the catalogue as `processed.defects` and
`processed.warnings`. A **defect** is a picture the renderer cannot use as it is and `--strict`
refuses it; a **warning** is a judgement worth a person's eye and is never refused.

| check | defect or warning | what it means |
|---|---|---|
| background transparent | defect | any of the four corner pixels of a sprite is opaque |
| clean alpha | warning | the soft edge band is far from the interior colour — a halo |
| seamless | treated | a texture whose seam score exceeds 1.5 is offset-and-blended |

### Automated, on the library at rest (`pnpm --filter @garden-studio/web audit:assets`, exits non-zero)

Missing files, orphan and duplicate entries, families with fewer variants than declared, a file
whose pixels are not the size the catalogue says, and a shipped defect are **failures**.
`tools/assets --audit` adds the question only the composer can answer: which files were drawn from a
prompt that has since changed.

### By eye, on the contact sheets

Each family's variants side by side.

1. flat and even — no lit side, no baked shadow, no ground under the object
2. neutral, mid-toned foliage that the palette can tint; furniture in its own real colour
3. the object fills its frame and is centred, so it fills the circle or rectangle of record
4. the variants are genuinely different plants or finishes, not the same picture six times
5. no white fringe against a dark ground

And on the `/asset-lab` lineup: **do thirty of them look like they belong in the same garden?** That
is the test the whole specification exists to pass, and no single asset can pass it.

**Reject and regenerate rather than accept and adjust.** An asset that is nearly right is the one
that makes the whole sheet look wrong, because the eye finds the odd one out before it finds
anything else.

---

## Rotation strategy, per category

| category | strategy | why |
|---|---|---|
| **Built rectilinear things** — house, shed, pergola, gazebo, raised terrace, steps, fence, wall | **Drawn geometry. No photograph.** | The footprint is whatever rectangle or polygon the user or the placer gave it, at any rotation. A photograph stretched into it would put its posts in the wrong places. `symbols/structures.ts` draws posts, ridges and rails from the outline, correct at every angle by construction. |
| **Vegetation** — plants, shrubs, trees, grasses | **Free rotation** | Lit flat and roughly symmetric from above, so any turn adds variety and none contradicts the light. |
| **Furniture, fittings, play** | **Rotates with the element** | A product at a fixed size, fitted inside its element and turned with it. |
| **Isotropic textures** — turf, gravel, bark, water | **Quarter-turn and mirror, where the family says so** | Breaks the tiling grid; stated per family on `render`. Directional grain (boards, setts) is never turned. |

---

## Generic asset versus product instance

An asset is a **generic visual**. The element's `symbol` and `material` are its logical identity, the
asset is one resolution of that identity into pixels, and the footprint belongs to neither. That
separation is what lets a specific purchasable product later replace the generic one for the same
footprint without touching the geometry, the schedule or the validator. Nothing in this
specification should be read as describing a product, and no asset should be named after one.

---

## The material distinguishability floor

Check it **against the palette, before grading, not against the rendered pixels**. A finished PNG
carries no material segmentation, so "lawn did not collapse against planting" is not a question an
image can answer without a label buffer that does not exist. `measure:render` reports mean saturation
per asset family group for this reason, and that is where an over-saturated family — an asset
correction, not a render one — shows up.
