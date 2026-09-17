# Scorer baseline — before Phase A

`pnpm --filter @garden-studio/api eval:scorer`, taken on the scorer as it stood before the
brief-driven weighting work. Nine hand-built gardens, no database, no generator.

**Take the baseline before changing the scorer.** A number measured after a change can only confirm
what the change did; the one that means something is the reading from before it. This file is that
reading, kept so an improvement is a diff rather than a claim.

## What it says

1. **It ranks composition well.** The three pairs whose faults are compositional separate by 0.30,
   0.34 and 0.40 — a store in the sightline, a route that wanders, play out of view, beds too thin to
   plant, a lawn cut in half. The scattered garden sits under all of them at 0.500, capped by the
   essentials gate.
2. **It cannot see upkeep.** `lowMaintenance-poor` is the good plan with grass where the gravel was
   and four materials instead of two, given to somebody who said they have no time. It scores
   **0.960 against 0.972** — a twelve-point gap where the other three pairs separate by thirty or
   more — because no principle reads a maintenance level at all.
3. **It does not read the brief.** Scored before the essentials gate, four completely different
   briefs give every garden in the gallery the same answer to within **0.016**. The three concept
   slots (`social`, `open`, `planted`) are identical to three decimal places on every row, which is
   the limitation `design-review.service.test.ts` already pins from the other end.

Both gaps are pinned by `gallery.test.ts`, written to fail when they close.

## The reading

```

The gallery plot
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
room 14.0 × 13.0 m   shape square   zones back   in scope back   designed 182 m²   edges v0:neighbour/1.8 v1:neighbour/1.1 v2:street/1.8 v3:neighbour/1.8

Every garden against its own brief, one row per concept slot
garden / slot               total      circ      group     prop      relat     priv      hier      style     build     sun       fit       issues
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
entertaining-good A social  total 0.94   circ 1.00  group 0.87  prop 1.00  relat 0.97  priv 1.00  hier 0.73  style 1.00  build 1.00  sun 0.80  fit 1.00  issues  0c  0M  0
entertaining-good B open    total 0.94   circ 1.00  group 0.87  prop 1.00  relat 0.97  priv 1.00  hier 0.73  style 1.00  build 1.00  sun 0.80  fit 1.00  issues  0c  0M  0
entertaining-good C planted  total 0.94   circ 1.00  group 0.87  prop 1.00  relat 0.97  priv 1.00  hier 0.73  style 1.00  build 1.00  sun 0.80  fit 1.00  issues  0c  0M  0
entertaining-poor A social  total 0.64   circ 0.63  group 0.84  prop 0.76  relat 0.27  priv 0.75  hier 0.17  style 0.78  build 1.00  sun 0.80  fit 0.94  issues  0c  9M 15
entertaining-poor B open    total 0.64   circ 0.63  group 0.84  prop 0.76  relat 0.27  priv 0.75  hier 0.17  style 0.78  build 1.00  sun 0.80  fit 0.94  issues  0c  9M 15
entertaining-poor C planted  total 0.64   circ 0.63  group 0.84  prop 0.76  relat 0.27  priv 0.75  hier 0.17  style 0.78  build 1.00  sun 0.80  fit 0.94  issues  0c  9M 15
family-good A open          total 0.96   circ 1.00  group 0.92  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  0
family-good B social        total 0.96   circ 1.00  group 0.92  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  0
family-good C planted       total 0.96   circ 1.00  group 0.92  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  0
family-poor A open          total 0.62   circ 0.00  group 0.85  prop 0.87  relat 0.60  priv 0.67  hier 0.42  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  8M 10
family-poor B social        total 0.62   circ 0.00  group 0.85  prop 0.87  relat 0.60  priv 0.67  hier 0.42  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  8M 10
family-poor C planted       total 0.62   circ 0.00  group 0.85  prop 0.87  relat 0.60  priv 0.67  hier 0.42  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  8M 10
planted-good A planted      total 0.95   circ 1.00  group 0.85  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  0
planted-good B open         total 0.95   circ 1.00  group 0.85  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  0
planted-good C social       total 0.95   circ 1.00  group 0.85  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  0
planted-poor A planted      total 0.55!  circ 0.50  group 0.82  prop 0.80  relat 0.00  priv 0.50  hier 0.50  style 0.78  build 0.50  sun 0.60  fit 1.00  issues  0c  4M 12
planted-poor B open         total 0.55!  circ 0.50  group 0.82  prop 0.80  relat 0.00  priv 0.50  hier 0.50  style 0.78  build 0.50  sun 0.60  fit 1.00  issues  0c  4M 12
planted-poor C social       total 0.55!  circ 0.50  group 0.82  prop 0.80  relat 0.00  priv 0.50  hier 0.50  style 0.78  build 0.50  sun 0.60  fit 1.00  issues  0c  4M 12
lowMaintenance-good A planted  total 0.97   circ 1.00  group 1.00  prop 0.97  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  0
lowMaintenance-good B open  total 0.97   circ 1.00  group 1.00  prop 0.97  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  0
lowMaintenance-good C social  total 0.97   circ 1.00  group 1.00  prop 0.97  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  0
lowMaintenance-poor A planted  total 0.96   circ 1.00  group 1.00  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 0.67  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  1
lowMaintenance-poor B open  total 0.96   circ 1.00  group 1.00  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 0.67  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  1
lowMaintenance-poor C social  total 0.96   circ 1.00  group 1.00  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 0.67  build 1.00  sun 1.00  fit 1.00  issues  0c  0M  1
scattered A social          total 0.50!  circ 0.00  group 0.93  prop 0.71  relat 0.00  priv 0.75  hier 0.69  style 0.78  build 1.00  sun 0.50  fit 0.79  issues  1c  7M 12
scattered B open            total 0.50!  circ 0.00  group 0.93  prop 0.71  relat 0.00  priv 0.75  hier 0.69  style 0.78  build 1.00  sun 0.50  fit 0.79  issues  1c  7M 12
scattered C planted         total 0.50!  circ 0.00  group 0.93  prop 0.71  relat 0.00  priv 0.75  hier 0.69  style 0.78  build 1.00  sun 0.50  fit 0.79  issues  1c  7M 12

What it found, on slot A
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

entertaining-good  —  Terrace across the doors, dining beside it, the barbecue within reach, the store out of the view, one route that arrives.
      (nothing)

entertaining-poor  —  The same seven things: a terrace too small for a table, the barbecue nine metres from it, the store in the sightline, a route that wanders.
    · route-missing            reroute [ep8]
    · route-detour             reroute [ep12]
    · route-through-feature    reroute [ep12 ep9]
    · leftover-pocket          enlarge-lawn []
    · lawn-fragmented          enlarge-lawn [ep2 ep3]
      leftover-pocket          merge-beds [ep4 ep5 ep6]
      relationship-unmet       move-to-zone [ep9]
    · bbq-far-from-dining      move-to-zone [ep10]
    · shed-in-view             move-to-zone [ep11]
      seating-exposed          move-to-zone [ep8]
      no-primary-space         — []
      no-focal                 move-destination []
    · view-blocked             move-to-zone [ep10]
    · view-blocked             move-to-zone [ep11]
      bed-islands              merge-beds [ep4 ep5 ep6]

family-good  —  Play in the middle of the view from the kitchen, well clear of the fire, on one continuous lawn.
      (nothing)

family-poor  —  The same six things: play hidden in the far corner, the fire two metres from it, the lawn cut in half by the shed.
    · route-missing            reroute [fp6]
    · route-missing            reroute [fp7]
    · route-missing            reroute [fp8]
    · leftover-pocket          enlarge-lawn []
    · lawn-fragmented          enlarge-lawn [fp3 fp4]
    · shed-in-view             move-to-zone [fp8]
    · play-near-hazard         move-to-zone [fp6]
      seating-exposed          move-to-zone [fp2]
      no-primary-space         — []
    · view-blocked             move-to-zone [fp8]

planted-good  —  Borders deep enough to plant on three sides, the seating screened from the low railing, water closing the view.
      (nothing)

planted-poor  —  The same six things: half-metre slivers, three beds adrift in the lawn, the sofa against the railing, the water out of sight.
    · route-missing            reroute [pp8]
    · leftover-pocket          enlarge-lawn []
      leftover-pocket          merge-beds [pp4 pp5 pp6]
    · shed-in-view             move-to-zone [pp9]
      relationship-unmet       move-to-zone [pp8]
      seating-exposed          move-to-zone [pp7]
    · view-blocked             move-to-zone [pp9]
      bed-islands              merge-beds [pp4 pp5 pp6]
      bed-too-narrow           merge-beds [pp3]
      bed-too-narrow           merge-beds [pp4]
      bed-too-narrow           merge-beds [pp5]
      bed-too-narrow           merge-beds [pp6]

lowMaintenance-good  —  Gravel where the lawn would have been, two materials, three deep beds, nothing to mow.
      (nothing)

lowMaintenance-poor  —  The same five things, well composed, and the wrong garden: a mown panel, fifty metres of lawn edge and four materials, for somebody with no time.
      too-many-materials       — []

scattered  —  The floor: every feature in its own corner, nothing connecting them, no open ground at all.
    · route-missing            reroute [sc3]
    · route-missing            reroute [sc4]
    · route-missing            reroute [sc5]
    · leftover-pocket          enlarge-lawn []
    · terrace-too-shallow      enlarge-lawn []
      leftover-pocket          merge-beds [sc6 sc7 sc8]
    · shed-in-view             move-to-zone [sc4]
    · play-not-visible         move-to-zone [sc5]
      seating-exposed          move-to-zone [sc3]
      bed-islands              merge-beds [sc6 sc7 sc8]
      seating-in-shade         move-to-zone [sc3]
    ✗ missing-essential        drop-optional []

Does it rank? Each pair holds its contents constant
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ok    entertaining-good      0.937   entertaining-poor      0.637   Δ 0.300
  ok    family-good            0.960   family-poor            0.617   Δ 0.344
  ok    planted-good           0.948   planted-poor           0.551   Δ 0.398
  ok    lowMaintenance-good    0.972   lowMaintenance-poor    0.960   Δ 0.012
  ok    scattered              0.500   under the worst of the pairs (0.551)

Does it read the brief? Slot A weighted mean before the essentials gate
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  garden                    entertaining          family         planted       lowUpkeep   spread
  entertaining-good                0.937           0.937           0.937           0.929   0.008
  entertaining-poor                0.637           0.637           0.637           0.629   0.008
  family-good                      0.955           0.960           0.960           0.944   0.016
  family-poor                      0.617           0.617           0.617           0.609   0.008
  planted-good                     0.948           0.948           0.948           0.940   0.008
  planted-poor                     0.551           0.551           0.551           0.551   0.000
  lowMaintenance-good              0.972           0.972           0.972           0.972   0.000
  lowMaintenance-poor              0.971           0.976           0.976           0.960   0.016
  scattered                        0.525           0.525           0.525           0.517   0.008

The score carries no weights: every garden is judged by one fixed table.

```

## The generator, the same day

`pnpm --filter @garden-studio/api eval:generator`, 13 cases × 3 seeds × 3 concepts. Here so the
scorer change can be judged on what it does to generation as well as on what it does to the gallery:
the candidate loop ranks on this scorer, so changing it changes which plan is offered.

```
  valid geometry           117/117 (100%)
  inside composition bands 82/117 (70%)
  deterministic            yes
  requested features drawn 86% (mean)
  repairs accepted         24 across 18/117 (15%) of concepts

  design score   mean 0.872   min 0.739
  weak (< 0.6)   0/117        with a critical fault  0/117

  circulation 0.879   grouping 0.922   proportion 0.988   relationships 0.717 (90/117)
  privacy 1.000       hierarchy 0.710  style 0.872        buildability 0.989
  sun 0.533 (99/117)  featureFit 0.945

  commonest faults: too-many-materials 84, seating-in-shade 75, route-through-planting 60,
                    route-pinch 52, relationship-unmet 50, route-missing 50, shed-in-view 31
  slowest: suburban 405 m² 5114 ms, overloaded 132 m² 5233 ms
```

---

# After the brief-driven weighting

The same nine gardens, the same script, after `weightProfile`, `maintenanceFit`, the emphasis bands,
the circulation-style detour tolerance, the primary-zone dominance reading and the emphasis-weighted
relationship rules.

## What changed

| | before | after |
|---|---|---|
| entertaining pair separation | 0.300 | 0.311 |
| family pair separation | 0.344 | 0.317 |
| planted pair separation | 0.398 | 0.394 |
| **upkeep pair separation** | **0.012** | **0.083** |
| **largest cross-brief spread** | **0.016** | **0.090** |
| the three concept slots | identical to 3 d.p. | differ on every garden |

The two numbers in bold are the phase. The upkeep pair is `lowMaintenance-poor`: the good plan with
grass where the gravel was and four materials instead of two, which has no composition fault the
scorer can see and is completely wrong for somebody with no time. It scores 0.969, 0.974 and 0.980
against the other three briefs and **0.890 against its own** — a garden marked down by the brief it
contradicts, which is a sentence that could not be written before.

The three composition pairs barely moved, which is the other half of the result: the weighting did
not buy discrimination by throwing away the discrimination that already worked.

## What it cost, on the generator

`pnpm --filter @garden-studio/api eval:generator`, same 13 cases × 3 seeds:

```
                          before    after
  valid geometry          117/117   117/117
  deterministic           yes       yes
  inside composition bands 82/117   84/117
  features drawn          86%       86%
  repairs accepted        24 (15%)  21 (15%)
  design score mean       0.872     0.860
  design score min        0.739     0.716
```

**The totals are not comparable and the drop is not a regression in the plans.** The same plans are
now measured against a tenth principle and against their own brief's bands, so the scale moved under
them; what is comparable is validity, determinism and band compliance, and band compliance improved.
Buildability came back 0.989 → 0.990 after the one over-strict rule was removed (see below).

Three findings worth acting on, recorded in TODOS rather than tuned away:

- **`no-primary-space` fires on 36 of 117 concepts.** A third of generated plans do not make the
  room the brief says they are organised around the most generous one. That is a fact about the
  zone planner rather than about the scorer.
- **`composition-off-brief` fires 42 times**, which is the same finding from the other end.
- **`maintenanceFit` has a minimum of 0.000**, so at least one low-upkeep brief is being answered
  with a high-upkeep garden despite `resolveConstraints` forbidding a lawn.

## Three times one mistake

Worth recording together, because the pass made the same error three times and the measurement
caught it each time: **do not express an emphasis twice.** Discounting `circulation` under `planted`,
`proportion` under `social`, and raising the bed-depth floor under `planted` were each the second
expression of something the brief already said elsewhere — through `brief.circulation`'s detour
tolerance, through the emphasis bands, and through the planting band. Each cost something real: the
first two put two of three cards on the same composition on a deep plot, and the third scored a plan
with legal 1.4 m borders **zero** for buildability.

## The reading

```

The gallery plot
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
room 14.0 × 13.0 m   shape square   zones back   in scope back   designed 182 m²   edges v0:neighbour/1.8 v1:neighbour/1.1 v2:street/1.8 v3:neighbour/1.8

Every garden against its own brief, one row per concept slot
garden / slot               total      circ      group     prop      relat     priv      hier      style     build     sun       upkp      fit       issues
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
entertaining-good A social  total 0.94   circ 1.00  group 0.87  prop 1.00  relat 0.97  priv 1.00  hier 0.74  style 1.00  build 1.00  sun 0.80  upkp 1.00  fit 1.00  issues  0c  0M  0
entertaining-good B open    total 0.93   circ 1.00  group 0.87  prop 1.00  relat 0.97  priv 1.00  hier 0.62  style 1.00  build 1.00  sun 0.80  upkp 1.00  fit 1.00  issues  0c  0M  1
entertaining-good C planted  total 0.94   circ 1.00  group 0.87  prop 0.99  relat 0.97  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 0.80  upkp 1.00  fit 1.00  issues  0c  0M  1
entertaining-poor A social  total 0.63   circ 0.63  group 0.84  prop 0.73  relat 0.29  priv 0.75  hier 0.20  style 0.78  build 1.00  sun 0.80  upkp 1.00  fit 0.94  issues  0c  9M 15
entertaining-poor B open    total 0.63   circ 0.63  group 0.84  prop 0.70  relat 0.27  priv 0.75  hier 0.11  style 0.78  build 1.00  sun 0.80  upkp 1.00  fit 0.94  issues  0c  9M 16
entertaining-poor C planted  total 0.64   circ 0.63  group 0.84  prop 0.67  relat 0.27  priv 0.75  hier 0.17  style 0.78  build 1.00  sun 0.80  upkp 1.00  fit 0.94  issues  0c  9M 15
family-good A open          total 0.96   circ 1.00  group 0.92  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  upkp 1.00  fit 1.00  issues  0c  0M  0
family-good B social        total 0.96   circ 1.00  group 0.92  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  upkp 1.00  fit 1.00  issues  0c  0M  0
family-good C planted       total 0.96   circ 1.00  group 0.92  prop 0.97  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  upkp 1.00  fit 1.00  issues  0c  0M  1
family-poor A open          total 0.64   circ 0.00  group 0.85  prop 0.87  relat 0.62  priv 0.67  hier 0.42  style 1.00  build 1.00  sun 1.00  upkp 1.00  fit 1.00  issues  0c  8M 10
family-poor B social        total 0.64   circ 0.00  group 0.85  prop 0.86  relat 0.60  priv 0.67  hier 0.50  style 1.00  build 1.00  sun 1.00  upkp 1.00  fit 1.00  issues  0c  8M 10
family-poor C planted       total 0.63   circ 0.00  group 0.85  prop 0.76  relat 0.60  priv 0.67  hier 0.42  style 1.00  build 1.00  sun 1.00  upkp 1.00  fit 1.00  issues  0c  8M 10
planted-good A planted      total 0.96   circ 1.00  group 0.85  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  upkp 1.00  fit 1.00  issues  0c  0M  0
planted-good B open         total 0.95   circ 1.00  group 0.85  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  upkp 1.00  fit 1.00  issues  0c  0M  0
planted-good C social       total 0.95   circ 1.00  group 0.85  prop 0.93  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  upkp 1.00  fit 1.00  issues  0c  0M  1
planted-poor A planted      total 0.56!  circ 0.50  group 0.82  prop 0.69  relat 0.00  priv 0.50  hier 0.50  style 0.78  build 0.50  sun 0.60  upkp 1.00  fit 1.00  issues  0c  4M 12
planted-poor B open         total 0.59!  circ 0.50  group 0.82  prop 0.80  relat 0.00  priv 0.50  hier 0.50  style 0.78  build 0.50  sun 0.60  upkp 1.00  fit 1.00  issues  0c  4M 12
planted-poor C social       total 0.53!  circ 0.50  group 0.82  prop 0.69  relat 0.00  priv 0.50  hier 0.50  style 0.78  build 0.50  sun 0.60  upkp 1.00  fit 1.00  issues  0c  4M 12
lowMaintenance-good A planted  total 0.97   circ 1.00  group 1.00  prop 0.97  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  upkp 0.96  fit 1.00  issues  0c  0M  0
lowMaintenance-good B open  total 0.93   circ 1.00  group 1.00  prop 0.80  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  upkp 0.96  fit 1.00  issues  0c  0M  0
lowMaintenance-good C social  total 0.97   circ 1.00  group 1.00  prop 0.97  relat 1.00  priv 1.00  hier 0.75  style 1.00  build 1.00  sun 1.00  upkp 0.96  fit 1.00  issues  0c  0M  0
lowMaintenance-poor A planted  total 0.89   circ 1.00  group 1.00  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 0.67  build 1.00  sun 1.00  upkp 0.01  fit 1.00  issues  0c  1M  2
lowMaintenance-poor B open  total 0.89   circ 1.00  group 1.00  prop 1.00  relat 1.00  priv 1.00  hier 0.75  style 0.67  build 1.00  sun 1.00  upkp 0.01  fit 1.00  issues  0c  1M  2
lowMaintenance-poor C social  total 0.89   circ 1.00  group 1.00  prop 0.98  relat 1.00  priv 1.00  hier 0.75  style 0.67  build 1.00  sun 1.00  upkp 0.01  fit 1.00  issues  0c  1M  3
scattered A social          total 0.50!  circ 0.00  group 0.93  prop 0.71  relat 0.00  priv 0.75  hier 0.64  style 0.78  build 1.00  sun 0.50  upkp 1.00  fit 0.79  issues  1c  7M 13
scattered B open            total 0.50!  circ 0.00  group 0.93  prop 0.71  relat 0.00  priv 0.75  hier 0.64  style 0.78  build 1.00  sun 0.50  upkp 1.00  fit 0.79  issues  1c  7M 13
scattered C planted         total 0.50!  circ 0.00  group 0.93  prop 0.71  relat 0.00  priv 0.75  hier 0.69  style 0.78  build 1.00  sun 0.50  upkp 1.00  fit 0.79  issues  1c  7M 12

What it found, on slot A
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

entertaining-good  —  Terrace across the doors, dining beside it, the barbecue within reach, the store out of the view, one route that arrives.
      (nothing)

entertaining-poor  —  The same seven things: a terrace too small for a table, the barbecue nine metres from it, the store in the sightline, a route that wanders.
    · route-missing            reroute [ep8]
    · route-detour             reroute [ep12]
    · route-through-feature    reroute [ep12 ep9]
      composition-off-brief    — [ep8]
    · leftover-pocket          enlarge-lawn []
    · lawn-fragmented          enlarge-lawn [ep2 ep3]
      leftover-pocket          merge-beds [ep4 ep5 ep6]
      relationship-unmet       move-to-zone [ep9]
    · bbq-far-from-dining      move-to-zone [ep10]
    · shed-in-view             move-to-zone [ep11]
      seating-exposed          move-to-zone [ep8]
      no-focal                 move-destination []
    · view-blocked             move-to-zone [ep10]
    · view-blocked             move-to-zone [ep11]
      bed-islands              merge-beds [ep4 ep5 ep6]

family-good  —  Play in the middle of the view from the kitchen, well clear of the fire, on one continuous lawn.
      (nothing)

family-poor  —  The same six things: play hidden in the far corner, the fire two metres from it, the lawn cut in half by the shed.
    · route-missing            reroute [fp6]
    · route-missing            reroute [fp7]
    · route-missing            reroute [fp8]
    · leftover-pocket          enlarge-lawn []
    · lawn-fragmented          enlarge-lawn [fp3 fp4]
    · shed-in-view             move-to-zone [fp8]
    · play-near-hazard         move-to-zone [fp6]
      seating-exposed          move-to-zone [fp2]
      no-primary-space         — [fp3 fp4]
    · view-blocked             move-to-zone [fp8]

planted-good  —  Borders deep enough to plant on three sides, the seating screened from the low railing, water closing the view.
      (nothing)

planted-poor  —  The same six things: half-metre slivers, three beds adrift in the lawn, the sofa against the railing, the water out of sight.
    · route-missing            reroute [pp8]
    · leftover-pocket          enlarge-lawn []
      leftover-pocket          merge-beds [pp4 pp5 pp6]
    · shed-in-view             move-to-zone [pp9]
      relationship-unmet       move-to-zone [pp8]
      seating-exposed          move-to-zone [pp7]
    · view-blocked             move-to-zone [pp9]
      bed-islands              merge-beds [pp4 pp5 pp6]
      bed-too-narrow           merge-beds [pp3]
      bed-too-narrow           merge-beds [pp4]
      bed-too-narrow           merge-beds [pp5]
      bed-too-narrow           merge-beds [pp6]

lowMaintenance-good  —  Gravel where the lawn would have been, two materials, three deep beds, nothing to mow.
      (nothing)

lowMaintenance-poor  —  The same five things, well composed, and the wrong garden: a mown panel, fifty metres of lawn edge and four materials, for somebody with no time.
      too-many-materials       — []
    · upkeep-heavy             merge-beds [lp2 lp3 lp5 lp4]

scattered  —  The floor: every feature in its own corner, nothing connecting them, no open ground at all.
    · route-missing            reroute [sc3]
    · route-missing            reroute [sc4]
    · route-missing            reroute [sc5]
    · leftover-pocket          enlarge-lawn []
    · terrace-too-shallow      enlarge-lawn []
      leftover-pocket          merge-beds [sc6 sc7 sc8]
    · shed-in-view             move-to-zone [sc4]
    · play-not-visible         move-to-zone [sc5]
      seating-exposed          move-to-zone [sc3]
      no-primary-space         — [sc3 sc5]
      bed-islands              merge-beds [sc6 sc7 sc8]
      seating-in-shade         move-to-zone [sc3]
    ✗ missing-essential        drop-optional []

Does it rank? Each pair holds its contents constant
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ok    entertaining-good      0.938   entertaining-poor      0.626   Δ 0.311
  ok    family-good            0.962   family-poor            0.644   Δ 0.317
  ok    planted-good           0.957   planted-poor           0.562   Δ 0.394
  ok    lowMaintenance-good    0.973   lowMaintenance-poor    0.890   Δ 0.083
  ok    scattered              0.500   under the worst of the pairs (0.562)

Does it read the brief? Slot A weighted mean before the essentials gate
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  garden                    entertaining          family         planted       lowUpkeep   spread
  entertaining-good                0.938           0.943           0.944           0.881   0.063
  entertaining-poor                0.626           0.647           0.666           0.628   0.039
  family-good                      0.959           0.962           0.962           0.890   0.072
  family-poor                      0.638           0.644           0.640           0.630   0.014
  planted-good                     0.946           0.952           0.957           0.881   0.076
  planted-poor                     0.514           0.575           0.562           0.551   0.061
  lowMaintenance-good              0.973           0.939           0.976           0.973   0.037
  lowMaintenance-poor              0.969           0.974           0.980           0.890   0.090
  scattered                        0.505           0.549           0.568           0.550   0.063

Weights applied, per slot
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  A social       {
  circulation: 0.156088545910324,
  grouping: 0.156088545910324,
  proportion: 0.11706640943274299,
  relationships: 0.19667156784700823,
  privacy: 0.09365312754619438,
  hierarchy: 0.09365312754619438,
  style: 0.039022136477581,
  buildability: 0.039022136477581,
  sun: 0.0641711229946524,
  maintenanceFit: 0.044563279857397504
}
  B open         {
  circulation: 0.1709489375523531,
  grouping: 0.15385404379711778,
  proportion: 0.17949638442997073,
  relationships: 0.12308323503769421,
  privacy: 0.08547446877617655,
  hierarchy: 0.10256936253141186,
  style: 0.042737234388088276,
  buildability: 0.042737234388088276,
  sun: 0.05405405405405405,
  maintenanceFit: 0.04504504504504504
}
  C planted      {
  circulation: 0.16305898658839835,
  grouping: 0.16305898658839835,
  proportion: 0.14675308792955852,
  relationships: 0.14675308792955852,
  privacy: 0.10598834128245893,
  hierarchy: 0.08152949329419917,
  style: 0.052994170641229466,
  buildability: 0.04076474664709959,
  sun: 0.05405405405405405,
  maintenanceFit: 0.04504504504504504
}

```

---

# After the whole phase

The scorer numbers above are unchanged by the work that followed the weighting — guidance on issues,
the two new intents, the repair endpoint and the web loop are all about *what is done* about a fault
rather than about how a garden is judged. The generator harness confirms it:

```
                          before A   after A   after the phase
  valid geometry          117/117    117/117   117/117
  deterministic           yes        yes       yes
  inside composition bands 82/117    84/117    84/117
  design score mean       0.872      0.860     0.860
```

What did change is what can be *done* about what the scorer finds. Measured over the gallery's
deliberately faulted gardens, through the real planner against PostGIS:

| fault | corrections scored | outcome |
|---|---|---|
| `bbq-far-from-dining` (entertaining-poor) | 4 | moved, 0.614 → 0.627 |
| `view-blocked` (planted-poor) | 3 | moved, 0.562 → 0.577, fault resolved |
| `shed-in-view` (scattered) | 4 | **nothing played** — none improved the plan |
| `seating-in-shade` (entertaining-good) | 1 | nothing played |
| `route-missing` (four gardens) | 0 | nothing to try: laying a route has no planner |

The third row is the phase in one line. Before this, that fault would have been answered by animating
one of the four and winding it back afterwards; the user watched the designer be wrong about half the
time. Now it is measured and reported, and eight of the ten repair kinds are performable in the
editor against three before.
