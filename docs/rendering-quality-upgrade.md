# Rendering-quality upgrade: implementation and acceptance

Status: **v2 is a development preview, not a signed-off production replacement.** The existing
uncommitted renderer, schema, assets and editor work is retained. No document migration is needed.

## Implemented foundation

- `buildRenderScene` compiles deterministic, source-traceable primitives into explicit passes.
  Identity, clipping, visual bounds, depth, LOD and dependency keys stay inside the render layer.
- The new Pixi compositor owns browser design pixels. Canvas2D consumes the same scene and shared
  painters for exports, the reference view and WebGL-loss fallback. Visualise no longer paints the
  standing stack a second time on its overlay canvas.
- Ground materials, tangent-following courses, cast shadows, contact shadows, night ambient,
  ground light receivers, standing objects and emissive fixtures have explicit ownership and order.
- Low planting has stable world-space drift groups and a continuous mass/sprite transition from
  24 to 40 CSS pixels per metre. Higher vegetation remains individually depth-sorted. Structural
  plants remain authored elements, and preview changes do not regenerate saved planting geometry.
- Course geometry uses world modules, joints and authored start phase. Render-only miter/bevel joins
  preserve width at bends, and shared borders still come from authoritative `edgingRuns` geometry.
- Open pergolas have separate posts and overhead beams. Optional boundary fragmentation retains
  source-element traceability, but stays **off by default** pending its crossing/seam gate.
- Material variation is deterministic and world-anchored. Only approved isotropic texture families
  receive rotations/mirroring; directional surfaces keep their orientation. Global grading is unchanged.
- Renderer-owned GPU textures bypass Pixi's global cache, receive explicit destruction, and plant
  textures use mipmaps. Raster caches are bounded. Cached camera moves reuse retained world objects.
- Visualise time and maturity are ephemeral. Export uses the preview time and active renderer version,
  without persisting generated plants, passes, lighting effects or render fragments.
- Asset audit metadata now records declared/reviewed camera compliance, shadow policy, transforms,
  resolved anchors, effective density and replacement status. Defaults do not claim a visual review.

## Preview and comparison controls

Development defaults to v2; production defaults to legacy. `?renderer=v2` or `?renderer=legacy`
overrides the browser choice without saving it. `NEXT_PUBLIC_GARDEN_RENDERER` is the build-time
rollout default, documented in `apps/web/.env.example`. No deployment configuration was changed.

Visit `/render-lab?renderDiagnostics` on the development server. This route is unavailable in
production. It compares Pixi and Canvas2D at the same viewport, DPR, time, maturity and scale.

The fixed fixtures are target, naturalistic, formal, courtyard, narrow, levels, dense, reference,
and courses. The course sheet contains a straight run, ring, sampled S-curve, concave and acute
corners, short endpoint, sleeper corner, multiple rows, and two hosts sharing one edged seam.
At 32 px/m the complete sheet fits; 64 px/m is a close inspection, not a full-plot capture.

The planting preview offers **Individual plants**, **Low-tier masses**, and **Hybrid LOD**.
It only changes alpha for eligible low vegetation. It does not flatten trees/shrubs, modify scene
identity, invalidate rasters, or persist any setting. Use target and naturalistic side by side before
approving hybrid massing. It is a diagnostic control, not a new editor option.

`Depth fragments` enables the boundary-segmentation prototype. Do not interpret the legacy toggle
as an original-renderer performance baseline: it uses the legacy Canvas painter in the new host.
`LegacySceneRenderer` is retained for an explicit original-implementation profiling exercise.

## Reproducible checks

Run from the repository root; the Visualise flow also requires the existing API and database:

```sh
pnpm --filter @garden-studio/web test
pnpm --filter @garden-studio/web exec tsc --noEmit
pnpm --filter @garden-studio/web build
pnpm --filter @garden-studio/web audit:assets
pnpm --filter @garden-studio/web exec playwright test e2e/render-quality.spec.ts e2e/visualise.spec.ts
```

The quality suite captures eight fixed fixtures at 16/32/64 px/m and DPR 1/2, compares night output
at three maturities, and checks both renderers in all three planting preview modes. RGB mean error
must be below 7/255; this tolerates browser antialiasing but is **not** approval of either image.
It also checks unchanged scene revisions and zero raster misses when switching planting previews.

The Visualise flow checks actual navigation, editing then persistence, time/maturity, pan/zoom/fit,
mobile layout, clean export, browser errors, and forced WebGL loss with a working Canvas fallback.
Its persistence baseline is established after the explicit edit; subsequent presentation actions
must leave the whole serialized PlanDocument byte-equivalent.

Generated quality captures and JSON reports live in ignored `apps/web/.render-quality/`.
Actual-app screenshots and mobile metrics are in `apps/web/.plan-preview/`. These are local review
artifacts, not committed, approved golden baselines. The ordinary plan golden tests remain separate.

## Performance evidence and its limits

Each measured frame reports scene compilation, CPU frame submission, surface/shadow/node raster
times and misses, cache hits, sprite/culling counts and estimated retained texture bytes. With
`renderDiagnostics`, the browser also keeps a bounded 240-sample history in
`window.gardenRenderDiagnostics`; the canvas exposes its latest `data-render-metrics`.

The dense-fixture test exercises 20 cached pans, warms a zoom/maturity working set, then repeats
20 cycles. It checks no pan rerasterization, CPU pan p95 <=16.7 ms, and <=5% retained texture/heap
growth. Heap samples explicitly collect garbage; GPU memory is an RGBA/mipmap estimate, not a
driver measurement. The actual mobile viewport check has a 33 ms CPU submission limit.

These checks **do not** establish presented-frame latency, real-device mobile performance, a
complete local-edit benchmark, or <=10% regression against the original Phase 0 renderer. Those
remain rollout gates. Do not compare these CPU timings directly with a GPU presentation budget.

### Local verification record — 14 September 2026

- Full web unit suite: **1,217 tests / 74 files passed**, including unchanged 2D-plan goldens and
  18 course-raster checks for continuous coverage, circular holes and short butt caps.
- Quality browser suite: **6 tests passed**. Each DPR checks 24 day fixture/zoom combinations,
  three night/maturity comparisons and six planting-mode comparisons.
- Production build, TypeScript and changed-file ESLint passed. The actual Visualise browser flow
  passed separately, including byte-equivalent persistence, export and forced Canvas fallback.
  Its emulated mobile cached-pan CPU p95 was **0.4 ms** (not a real-device GPU measurement).
- Worst mean RGB difference: **2.889/255 at DPR 1**, **2.627/255 at DPR 2**. Night alone stayed
  below **0.784/255**. These are compositor agreement measurements, not reference approval.
- Dense cached-pan CPU p95: **1.9 ms / 1.7 ms** at DPR 1/2. Retained texture estimates were
  **42,901,831 / 81,866,723 bytes**, with **0% growth** after 20 cycles. Post-GC heap decreased
  by approximately **3.3% / 3.4%**. Final scene compilation measured **36.4 / 37.1 ms**.
- The asset audit found **181 files, 90 families and 21 elevated families**, with no missing files,
  incomplete families or framing warnings. Core fixture camera fallbacks remain listed in its JSON.

Visual inspection of the course sheet exposed tapered right/acute corners. The render-only
miter/bevel correction restores width without modifying saved centrelines; tests pin the right-angle
intersection, bounded acute bevel, closed ring and single shared course. This does not yet approve
all real-world brick cuts or multi-row corner bonds.

## Remaining acceptance gates

1. Review the course sheet closely at DPR 1/2, including joints around bevels, closed-loop phase,
   caps, shared-edge corners and multi-row bends. Geometry finiteness and parity alone cannot prove
   physically correct construction or absence of visible overlaps.
2. Approve planting hierarchy, mass shape and continuous zoom transitions on target/naturalistic
   fixtures. Review sparse first-year and dense mature states; do not hide asset/species gaps in masses.
3. Complete core elevated family coverage and visual asset QA. Audit output still reports plan-camera
   fallbacks. The perennial-spire generation pilot is an unregistered review candidate, not a finished
   three-variant family. Existing asset IDs and catalogue choices are unchanged by that pilot.
4. Exercise crossing fences, vegetation, furniture below pergolas, house eaves, retaining walls and
   level changes. Keep boundary splitting gated until seam-free DPR 1/2 captures and <=10% frame-time
   cost are demonstrated. Whole-house and whole-run sorting still have unsupported crossing cases.
5. Approve reference/golden sheets, extend lighting overlap/clipping adversarial cases, and record
   original-baseline versus v2 presented-frame and memory comparisons on supported hardware.
6. Only after visual and performance approval, opt production into v2 and schedule removal of the
   temporary legacy implementation. Do not remove fallback support merely because a build passes.

No runtime image generation, external rendering service, full 3D engine or new saved schema is used.
