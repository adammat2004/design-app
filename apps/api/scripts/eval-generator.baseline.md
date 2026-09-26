# Generator baseline, before the composition work

Captured 22 Sep 2026 on the `visual-agents` branch, **before** the `composition` principle landed and
before any generator change. Taken with `pnpm --filter @garden-studio/api eval:generator`. Every
later Phase 0 and Phase 1 run is compared against these numbers; a score taken after a change can
only confirm what the change did.

The per-concept rows are omitted; the summary is the comparison.

```
SUMMARY over 117 concepts (3 seeds)

  generated at all         every case
  valid geometry           117/117 (100%)
  inside composition bands 75/117 (64%)
  deterministic            yes
  requested features drawn 85% (mean)
  repairs accepted         30 across 27/117 (23%) of concepts

  design score   mean 0.857   min 0.734
  weak (< 0.6)    0/117 (0%)
  with a critical fault    0/117 (0%)

  by principle:
    circulation      mean 0.874   min 0.500   measured on 117/117
    grouping         mean 0.916   min 0.732   measured on 117/117
    proportion       mean 0.950   min 0.672   measured on 117/117
    relationships    mean 0.728   min 0.000   measured on 90/117
    privacy          mean 1.000   min 1.000   measured on 117/117
    hierarchy        mean 0.664   min 0.291   measured on 117/117
    style            mean 0.872   min 0.667   measured on 117/117
    buildability     mean 0.990   min 0.875   measured on 117/117
    sun              mean 0.552   min 0.200   measured on 99/117
    maintenanceFit   mean 0.784   min 0.000   measured on 117/117
    canopy           mean 0.912   min 0.000   measured on 117/117
    featureFit       mean 0.942   min 0.800   measured on 117/117

  commonest faults:
    too-many-materials         84
    seating-in-shade           78
    route-through-planting     77
    route-pinch                54
    composition-off-brief      45
    relationship-unmet         43
    route-missing              42
    no-primary-space           36
    upkeep-heavy               34
    sparse-canopy              33

  latency, one set of three concepts:
    courtyard                  76 m²      265 ms
    small-entertaining         88 m²     1113 ms
    overloaded                132 m²     1978 ms
    long-narrow               143 m²      482 ms
    side-gate-shed            176 m²      495 ms
    unlocated                 176 m²      527 ms
    l-shaped                  195 m²      865 ms
    modern-vs-natural         202 m²      627 ms
    natural-twin              202 m²      785 ms
    family-play               235 m²     1369 ms
    wide-shallow              286 m²      749 ms
    l-shape                   298 m²     1215 ms
    suburban                  405 m²     2346 ms

```

## Phase 0: the composition principle on, the generator unchanged

The same generator, scored with the twelfth principle. Elements, inclusion, determinism and latency
are unchanged; the scores move, and so does which repair is accepted. This is the number Phase 1 is
judged against.

```
SUMMARY over 117 concepts (3 seeds)

  generated at all         every case
  valid geometry           117/117 (100%)
  inside composition bands 75/117 (64%)
  deterministic            yes
  requested features drawn 85% (mean)
  repairs accepted         24 across 21/117 (18%) of concepts

  design score   mean 0.860   min 0.706
  weak (< 0.6)    0/117 (0%)
  with a critical fault    0/117 (0%)

  by principle:
    circulation      mean 0.867   min 0.500   measured on 117/117
    grouping         mean 0.999   min 0.934   measured on 117/117
    proportion       mean 0.948   min 0.672   measured on 117/117
    composition      mean 0.877   min 0.724   measured on 117/117
    relationships    mean 0.729   min 0.000   measured on 90/117
    privacy          mean 1.000   min 1.000   measured on 117/117
    hierarchy        mean 0.662   min 0.291   measured on 117/117
    style            mean 0.872   min 0.667   measured on 117/117
    buildability     mean 0.990   min 0.875   measured on 117/117
    sun              mean 0.552   min 0.200   measured on 99/117
    maintenanceFit   mean 0.784   min 0.000   measured on 117/117
    canopy           mean 0.907   min 0.000   measured on 117/117
    featureFit       mean 0.942   min 0.800   measured on 117/117

  commonest faults:
    too-many-materials         84
    route-through-planting     80
    seating-in-shade           78
    geometry-mixed             77
    panel-complexity           74
    route-pinch                57
    feature-in-open-space      47
    composition-off-brief      45
    relationship-unmet         43
    route-missing              42

  composition faults:
    feature-in-open-space      47
    route-crosses-panel        33
    hard-island                 0
    orphan-feature              0
    one-sided                   0
    panel-complexity           74
    geometry-mixed             77

  latency, one set of three concepts:
    courtyard                  76 m²      270 ms
    small-entertaining         88 m²     1150 ms
    overloaded                132 m²     1966 ms
    long-narrow               143 m²      560 ms
    side-gate-shed            176 m²      520 ms
    unlocated                 176 m²      538 ms
    l-shaped                  195 m²      876 ms
    modern-vs-natural         202 m²      663 ms
    natural-twin              202 m²      824 ms
    family-play               235 m²     1325 ms
    wide-shallow              286 m²      757 ms
    l-shape                   298 m²     1205 ms
    suburban                  405 m²     2270 ms

```

## All seven compositions composed, and Phase 2 (planting shaped by what it is for)

24–25 Sep 2026. The three classic compositions, then `destination_garden`, `linear_sequence`,
`side_by_side` and `courtyard` composed; the placement budgets aligned; the side-zone band stopped
at the garden room; screening beds only where a boundary is too low to screen; the pinch and reach
rules corrected. See "Composing a garden rather than placing features" in CLAUDE.md.

```
SUMMARY over 117 concepts (3 seeds)

  generated at all         every case
  valid geometry           117/117 (100%)
  inside composition bands 87/117 (74%)
  deterministic            yes
  requested features drawn 90% (mean)
  repairs accepted         6 across 6/117 (5%) of concepts

  design score   mean 0.891   min 0.781
  weak (< 0.6)    0/117 (0%)
  with a critical fault    0/117 (0%)

  by principle:
    circulation      mean 0.957   min 0.667   measured on 117/117
    grouping         mean 1.000   min 1.000   measured on 117/117
    proportion       mean 0.968   min 0.692   measured on 117/117
    composition      mean 0.941   min 0.667   measured on 117/117
    relationships    mean 0.799   min 0.000   measured on 99/117
    privacy          mean 1.000   min 1.000   measured on 117/117
    hierarchy        mean 0.673   min 0.317   measured on 117/117
    style            mean 0.869   min 0.667   measured on 117/117
    buildability     mean 0.986   min 0.750   measured on 117/117
    sun              mean 0.545   min 0.200   measured on 99/117
    maintenanceFit   mean 0.789   min 0.000   measured on 117/117
    canopy           mean 0.875   min 0.000   measured on 117/117
    featureFit       mean 0.962   min 0.789   measured on 117/117

  commonest faults:
    too-many-materials         81
    seating-in-shade           75
    sparse-canopy              60
    geometry-mixed             48
    relationship-unmet         39
    composition-off-brief      36
    upkeep-heavy               34
    no-primary-space           33
    panel-complexity           26
    feature-in-open-space      20

  lawn in one piece       117/117 (100%)
  orphans per concept      0.13 (mean)
  planting depth varies   45/48 (94%) of plans planted on two sides or more (mean spread 2.04 m)

  by composition:
    courtyard                6 concepts   mean 0.986   min 0.985
    destination_garden      27 concepts   mean 0.887   min 0.782
    formal_axis              6 concepts   mean 0.901   min 0.878
    linear_sequence          3 concepts   mean 0.810   min 0.810
    side_by_side             3 concepts   mean 0.931   min 0.931
    sweeping_lawn           27 concepts   mean 0.890   min 0.839
    terrace_and_lawn        45 concepts   mean 0.882   min 0.781

  composition faults:
    feature-in-open-space      20
    route-crosses-panel         3
    hard-island                 0
    orphan-feature             15
    one-sided                   0
    panel-complexity           26
    geometry-mixed             48

  latency, one set of three concepts:
    courtyard                  76 m²      192 ms
    small-entertaining         88 m²     1137 ms
    overloaded                132 m²      777 ms
    long-narrow               143 m²      529 ms
    side-gate-shed            176 m²      455 ms
    unlocated                 176 m²      490 ms
    l-shaped                  195 m²      473 ms
    modern-vs-natural         202 m²      729 ms
    natural-twin              202 m²      938 ms
    family-play               235 m²      800 ms
    wide-shallow              286 m²      686 ms
    l-shape                   298 m²      823 ms
    suburban                  405 m²     1149 ms

```
