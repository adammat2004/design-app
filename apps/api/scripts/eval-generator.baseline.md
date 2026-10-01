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

## Phase 3 (shape language and proportion) and the rest of Phase 2

26 Sep 2026. The geometry-language rule reads edges and is set by the open space; per-language
footprints; the room a concept is about claims or outweighs the terrace; spare seats sized as
supporting rooms; round surfaces measured; the asymmetric plan; framing corners; a clear sightline;
sun and view preferences in placement. Scorer changes and generator changes are both in these
numbers. The row before is the committed baseline re-run from a worktree the same day, identical to
the section above. See "Phase 3" in CLAUDE.md.

```
SUMMARY over 117 concepts (3 seeds)

  generated at all         every case
  valid geometry           117/117 (100%)
  inside composition bands 87/117 (74%)
  deterministic            yes
  requested features drawn 89% (mean)
  repairs accepted         6 across 3/117 (3%) of concepts

  design score   mean 0.899   min 0.768
  weak (< 0.6)    0/117 (0%)
  with a critical fault    0/117 (0%)

  by principle:
    circulation      mean 0.967   min 0.750   measured on 117/117
    grouping         mean 0.997   min 0.941   measured on 117/117
    proportion       mean 0.965   min 0.692   measured on 117/117
    composition      mean 0.967   min 0.778   measured on 117/117
    relationships    mean 0.833   min 0.000   measured on 96/117
    privacy          mean 1.000   min 1.000   measured on 117/117
    hierarchy        mean 0.707   min 0.319   measured on 117/117
    style            mean 0.864   min 0.667   measured on 117/117
    buildability     mean 0.986   min 0.750   measured on 117/117
    sun              mean 0.543   min 0.200   measured on 99/117
    maintenanceFit   mean 0.764   min 0.000   measured on 117/117
    canopy           mean 0.863   min 0.000   measured on 117/117
    featureFit       mean 0.960   min 0.737   measured on 117/117

  commonest faults:
    too-many-materials         87
    seating-in-shade           81
    sparse-canopy              63
    composition-off-brief      39
    upkeep-heavy               34
    relationship-unmet         33
    no-primary-space           27
    panel-complexity           21
    route-dead-end             18
    feature-in-open-space      17

  lawn in one piece       117/117 (100%)
  orphans per concept      0.10 (mean)
  planting depth varies   36/45 (80%) of plans planted on two sides or more (mean spread 1.86 m)

  by composition:
    courtyard                6 concepts   mean 0.986   min 0.985
    destination_garden      27 concepts   mean 0.895   min 0.771
    formal_axis              6 concepts   mean 0.902   min 0.884
    linear_sequence          6 concepts   mean 0.792   min 0.768
    side_by_side             3 concepts   mean 0.932   min 0.932
    sweeping_lawn           30 concepts   mean 0.900   min 0.840
    terrace_and_lawn        39 concepts   mean 0.900   min 0.819

  composition faults:
    feature-in-open-space      17
    route-crosses-panel         0
    hard-island                 0
    orphan-feature             12
    one-sided                   0
    panel-complexity           21
    geometry-mixed              6

  latency, one set of three concepts:
    courtyard                  76 m²      188 ms
    small-entertaining         88 m²     1089 ms
    overloaded                132 m²      613 ms
    long-narrow               143 m²      721 ms
    side-gate-shed            176 m²      494 ms
    unlocated                 176 m²      469 ms
    l-shaped                  195 m²      610 ms
    modern-vs-natural         202 m²      590 ms
    natural-twin              202 m²      678 ms
    family-play               235 m²      892 ms
    wide-shallow              286 m²      555 ms
    l-shape                   298 m²      854 ms
    suburban                  405 m²     1085 ms
```

## Phase 4: compositions as candidates

26 Sep 2026. Each composition drawn in every language it speaks and with its lawn framed or not;
the brief states a language on the recommendation; the geometry principle reads it. The first
block is the same code with `DESIGN_DRAWINGS=0`, which enumerates as before, so the difference is
the enumeration alone. The two variety lines are new to the harness.

```
DESIGN_DRAWINGS=0
  inside composition bands 87/117 (74%)
  requested features drawn 89% (mean)
  design score   mean 0.897   min 0.768
    no-primary-space           27
  sets offering a straight and a curved garden   27/39 (69%)
  sets of three different compositions          27/39 (69%)
    geometry-mixed              6
```

```
SUMMARY over 117 concepts (3 seeds)

  generated at all         every case
  valid geometry           117/117 (100%)
  inside composition bands 84/117 (72%)
  deterministic            yes
  requested features drawn 89% (mean)
  repairs accepted         3 across 3/117 (3%) of concepts

  design score   mean 0.898   min 0.771
  weak (< 0.6)    0/117 (0%)
  with a critical fault    0/117 (0%)

  by principle:
    circulation      mean 0.969   min 0.750   measured on 117/117
    grouping         mean 0.997   min 0.941   measured on 117/117
    proportion       mean 0.967   min 0.692   measured on 117/117
    composition      mean 0.970   min 0.778   measured on 117/117
    relationships    mean 0.818   min 0.000   measured on 96/117
    privacy          mean 1.000   min 1.000   measured on 117/117
    hierarchy        mean 0.711   min 0.319   measured on 117/117
    style            mean 0.867   min 0.667   measured on 117/117
    buildability     mean 0.987   min 0.750   measured on 117/117
    sun              mean 0.540   min 0.200   measured on 99/117
    maintenanceFit   mean 0.775   min 0.000   measured on 117/117
    canopy           mean 0.831   min 0.000   measured on 117/117
    featureFit       mean 0.960   min 0.737   measured on 117/117

  commonest faults:
    too-many-materials         87
    seating-in-shade           84
    sparse-canopy              66
    composition-off-brief      45
    relationship-unmet         36
    upkeep-heavy               34
    no-primary-space           21
    route-dead-end             18
    panel-complexity           18
    shed-in-view               15

  lawn in one piece       117/117 (100%)
  orphans per concept      0.10 (mean)
  sets offering a straight and a curved garden   33/39 (85%)
  sets of three different compositions          30/39 (77%)
  planting depth varies   36/45 (80%) of plans planted on two sides or more (mean spread 1.83 m)

  by composition:
    courtyard                6 concepts   mean 0.986   min 0.985
    destination_garden      27 concepts   mean 0.898   min 0.771
    formal_axis              6 concepts   mean 0.887   min 0.875
    linear_sequence          3 concepts   mean 0.826   min 0.826
    side_by_side             3 concepts   mean 0.932   min 0.932
    sweeping_lawn           30 concepts   mean 0.891   min 0.800
    terrace_and_lawn        42 concepts   mean 0.894   min 0.811

  composition faults:
    feature-in-open-space      14
    route-crosses-panel         0
    hard-island                 0
    orphan-feature             12
    one-sided                   0
    panel-complexity           18
    geometry-mixed              9

  latency, one set of three concepts:
    courtyard                  76 m²      213 ms
    small-entertaining         88 m²     1343 ms
    overloaded                132 m²      610 ms
    long-narrow               143 m²      598 ms
    side-gate-shed            176 m²      527 ms
    unlocated                 176 m²      531 ms
    l-shaped                  195 m²      666 ms
    modern-vs-natural         202 m²      689 ms
    natural-twin              202 m²      760 ms
    family-play               235 m²      998 ms
    wide-shallow              286 m²      607 ms
    l-shape                   298 m²      755 ms
    suburban                  405 m²     1258 ms
```

## A seat in the sun where the terrace is in the shade

26 Sep 2026. The sun principle judges seating by its sunniest seat; the composition reserves a sun
seat where the terrace it drew is two-fifths shaded. `SUN_SEAT=0` withholds the seat, so the first
block is the scorer change alone on identical code.

```
SUN_SEAT=0
fixture / concept           total      circ      group     prop      comp      relat     priv      hier      style     build     sun       upkp      tree      fit       issues
  inside composition bands 84/117 (72%)
  requested features drawn 89% (mean)
  design score   mean 0.899   min 0.771
    relationships    mean 0.817   min 0.000   measured on 96/117
    sun              mean 0.582   min 0.200   measured on 99/117
    canopy           mean 0.831   min 0.000   measured on 117/117
    too-many-materials         87
    seating-in-shade           69
    geometry-mixed              9
```

```
SUMMARY over 117 concepts (3 seeds)

  generated at all         every case
  valid geometry           117/117 (100%)
  inside composition bands 84/117 (72%)
  deterministic            yes
  requested features drawn 89% (mean)
  repairs accepted         9 across 9/117 (8%) of concepts

  design score   mean 0.900   min 0.758
  weak (< 0.6)    0/117 (0%)
  with a critical fault    0/117 (0%)

  by principle:
    circulation      mean 0.964   min 0.750   measured on 117/117
    grouping         mean 0.998   min 0.969   measured on 117/117
    proportion       mean 0.964   min 0.692   measured on 117/117
    composition      mean 0.963   min 0.778   measured on 117/117
    relationships    mean 0.817   min 0.000   measured on 96/117
    privacy          mean 1.000   min 1.000   measured on 117/117
    hierarchy        mean 0.709   min 0.319   measured on 117/117
    style            mean 0.872   min 0.667   measured on 117/117
    buildability     mean 0.987   min 0.750   measured on 117/117
    sun              mean 0.659   min 0.400   measured on 99/117
    maintenanceFit   mean 0.777   min 0.000   measured on 117/117
    canopy           mean 0.804   min 0.000   measured on 117/117
    featureFit       mean 0.960   min 0.737   measured on 117/117

  commonest faults:
    too-many-materials         84
    sparse-canopy              66
    seating-in-shade           48
    composition-off-brief      45
    relationship-unmet         36
    upkeep-heavy               31
    panel-complexity           27
    no-primary-space           24
    route-dead-end             18
    route-missing              17

  lawn in one piece       117/117 (100%)
  orphans per concept      0.10 (mean)
  sets offering a straight and a curved garden   33/39 (85%)
  sets of three different compositions          30/39 (77%)
  planting depth varies   39/48 (81%) of plans planted on two sides or more (mean spread 1.84 m)

  by composition:
    courtyard                6 concepts   mean 0.986   min 0.985
    destination_garden      27 concepts   mean 0.901   min 0.758
    formal_axis              6 concepts   mean 0.896   min 0.875
    linear_sequence          3 concepts   mean 0.806   min 0.806
    side_by_side             3 concepts   mean 0.932   min 0.932
    sweeping_lawn           30 concepts   mean 0.894   min 0.813
    terrace_and_lawn        42 concepts   mean 0.895   min 0.786

  composition faults:
    feature-in-open-space      14
    route-crosses-panel         0
    hard-island                 0
    orphan-feature             12
    one-sided                   0
    panel-complexity           27
    geometry-mixed             12

  latency, one set of three concepts:
    courtyard                  76 m²      218 ms
    small-entertaining         88 m²     1343 ms
    overloaded                132 m²      591 ms
    long-narrow               143 m²      668 ms
    side-gate-shed            176 m²      523 ms
    unlocated                 176 m²      530 ms
    l-shaped                  195 m²      670 ms
    modern-vs-natural         202 m²      694 ms
    natural-twin              202 m²      735 ms
    family-play               235 m²      973 ms
    wide-shallow              286 m²      606 ms
    l-shape                   298 m²      736 ms
    suburban                  405 m²     1454 ms
```

## Phase 5: the templates retire, and realisation starts to leave `build`

28 Sep 2026. A composition that declines every variation is no longer offered where another
composed; a destination garden with nothing to walk to gets a garden seat at the far end; the four
newer compositions' hand-drawn plans are deleted; five realisation stages moved to `realise/`,
byte-identical. Hand-drawn concepts 21/117 -> 12/117.

```
SUMMARY over 117 concepts (3 seeds)

  generated at all         every case
  valid geometry           117/117 (100%)
  inside composition bands 84/117 (72%)
  deterministic            yes
  requested features drawn 89% (mean)
  repairs accepted         12 across 12/117 (10%) of concepts

  design score   mean 0.896   min 0.758
  weak (< 0.6)    0/117 (0%)
  with a critical fault    0/117 (0%)

  by principle:
    circulation      mean 0.964   min 0.750   measured on 117/117
    grouping         mean 0.988   min 0.810   measured on 117/117
    proportion       mean 0.966   min 0.800   measured on 117/117
    composition      mean 0.961   min 0.778   measured on 117/117
    relationships    mean 0.792   min 0.000   measured on 96/117
    privacy          mean 1.000   min 1.000   measured on 117/117
    hierarchy        mean 0.712   min 0.319   measured on 117/117
    style            mean 0.866   min 0.667   measured on 117/117
    buildability     mean 0.986   min 0.750   measured on 117/117
    sun              mean 0.671   min 0.500   measured on 99/117
    maintenanceFit   mean 0.773   min 0.000   measured on 117/117
    canopy           mean 0.794   min 0.000   measured on 117/117
    featureFit       mean 0.960   min 0.737   measured on 117/117

  commonest faults:
    too-many-materials         84
    sparse-canopy              72
    composition-off-brief      45
    seating-in-shade           42
    relationship-unmet         39
    upkeep-heavy               33
    panel-complexity           24
    no-primary-space           24
    route-dead-end             18
    route-missing              16

  lawn in one piece       117/117 (100%)
  orphans per concept      0.08 (mean)
  sets offering a straight and a curved garden   33/39 (85%)
  sets of three different compositions          27/39 (69%)
  planting depth varies   39/48 (81%) of plans planted on two sides or more (mean spread 1.86 m)

  by composition:
    courtyard                9 concepts   mean 0.977   min 0.959
    destination_garden      27 concepts   mean 0.892   min 0.758
    formal_axis              3 concepts   mean 0.875   min 0.875
    linear_sequence          3 concepts   mean 0.806   min 0.806
    side_by_side             3 concepts   mean 0.932   min 0.932
    sweeping_lawn           33 concepts   mean 0.891   min 0.813
    terrace_and_lawn        39 concepts   mean 0.890   min 0.786

  composition faults:
    feature-in-open-space      13
    route-crosses-panel         0
    hard-island                 0
    orphan-feature              9
    one-sided                   0
    panel-complexity           24
    geometry-mixed             15

  latency, one set of three concepts:
    courtyard                  76 m²      123 ms
    small-entertaining         88 m²     1353 ms
    overloaded                132 m²      696 ms
    long-narrow               143 m²      633 ms
    side-gate-shed            176 m²      567 ms
    unlocated                 176 m²      607 ms
    l-shaped                  195 m²      674 ms
    modern-vs-natural         202 m²      699 ms
    natural-twin              202 m²      743 ms
    family-play               235 m²      998 ms
    wide-shallow              286 m²      616 ms
    l-shape                   298 m²      754 ms
    suburban                  405 m²     1452 ms
```

## Phase 5, second half: the courtyard is the last resort, and the templates are gone

28 Sep 2026. The courtyard carves rooms off its floor and, drawn as the last resort, never declines;
it replaces the terrace-and-lawn template as what every composition falls back to, and is offered
under its own name where nothing composed. A repair may no longer turn a composed candidate into the
fallback. The composition measure no longer counts a gravel passage as open ground, and the reach
rule measures from the terrace. The classic templates, `golden.test.ts`, `designedBeds` and the
legacy assignment are deleted; two more realisation stages moved to `realise/`, byte-identical.

```
SUMMARY over 117 concepts (3 seeds)

  generated at all         every case
  valid geometry           117/117 (100%)
  inside composition bands 84/117 (72%)
  deterministic            yes
  requested features drawn 87% (mean)
  repairs accepted         9 across 9/117 (8%) of concepts

  design score   mean 0.903   min 0.758
  weak (< 0.6)    0/117 (0%)
  with a critical fault    0/117 (0%)

  by principle:
    circulation      mean 0.974   min 0.833   measured on 117/117
    grouping         mean 0.988   min 0.810   measured on 117/117
    proportion       mean 0.976   min 0.858   measured on 117/117
    composition      mean 0.970   min 0.826   measured on 117/117
    relationships    mean 0.811   min 0.000   measured on 96/117
    privacy          mean 1.000   min 1.000   measured on 117/117
    hierarchy        mean 0.736   min 0.500   measured on 117/117
    style            mean 0.866   min 0.667   measured on 117/117
    buildability     mean 0.987   min 0.750   measured on 117/117
    sun              mean 0.656   min 0.400   measured on 99/117
    maintenanceFit   mean 0.786   min 0.000   measured on 117/117
    canopy           mean 0.769   min 0.000   measured on 117/117
    featureFit       mean 0.954   min 0.737   measured on 117/117

  commonest faults:
    too-many-materials         84
    sparse-canopy              75
    composition-off-brief      42
    seating-in-shade           42
    relationship-unmet         33
    upkeep-heavy               27
    panel-complexity           24
    no-primary-space           21
    route-dead-end             18
    leftover-pocket            15

  lawn in one piece       117/117 (100%)
  orphans per concept      0.00 (mean)
  sets offering a straight and a curved garden   33/39 (85%)
  sets of three different compositions          27/39 (69%)
  drawn as the last resort                      9/117 (8%)   (mislabelled 0)
  planting depth varies   42/54 (78%) of plans planted on two sides or more (mean spread 1.84 m)

  by composition:
    courtyard               18 concepts   mean 0.969   min 0.944
    destination_garden      27 concepts   mean 0.892   min 0.758
    formal_axis              3 concepts   mean 0.875   min 0.875
    linear_sequence          3 concepts   mean 0.806   min 0.806
    side_by_side             3 concepts   mean 0.932   min 0.932
    sweeping_lawn           33 concepts   mean 0.885   min 0.803
    terrace_and_lawn        30 concepts   mean 0.902   min 0.786

  composition faults:
    feature-in-open-space       0
    route-crosses-panel         0
    hard-island                 0
    orphan-feature              0
    one-sided                   0
    panel-complexity           24
    geometry-mixed             15

  latency, one set of three concepts:
    courtyard                  76 m²       74 ms
    small-entertaining         88 m²      119 ms
    overloaded                132 m²      559 ms
    long-narrow               143 m²      628 ms
    side-gate-shed            176 m²      567 ms
    unlocated                 176 m²      621 ms
    l-shaped                  195 m²      695 ms
    modern-vs-natural         202 m²      762 ms
    natural-twin              202 m²     1255 ms
    family-play               235 m²     1017 ms
    wide-shallow              286 m²      606 ms
    l-shape                   298 m²      628 ms
    suburban                  405 m²     1498 ms
```

## Phase 2 of the gap analysis: species, mixes, enclosures, kept features (30 Sep 2026)

Taken before M5 (kept features) and again after M6 (the generator chooses species and mixes), on
the same machine the same afternoon. **Every row is identical**: mean 0.903, min 0.758, 72% inside
the bands, 87% of requested features drawn, sun 0.656, canopy 0.769, privacy 1.000, the same fault
counts and the same variety lines. That is the answer the design asked for, not a missed effect:

- a tree's species is chosen **after** its symbol, so its radius — and every placement made with
  it — is unchanged, and the canopy principle reads radii;
- a bed's mix goes on `planting`, not `material`, so upkeep and style (which read the material)
  are unchanged;
- the sun principle's shade comes from the site analysis (house and boundary), so a species'
  mature height changes the drawn shadow and not the score;
- privacy now also counts proposed enclosures and trees over `SCREENING_HEIGHT` between a seat and
  a low boundary, and every generated plan was already at 1.000 behind a 1.8 m fence.

Latency moved within its own noise (suburban 1441 → 1593 ms; the committed run above has
natural-twin at 1255 ms against 739 ms here before any change). The new cost is `bedExposure` for
each bed on a located plan, which samples two days of shadows at five points.
