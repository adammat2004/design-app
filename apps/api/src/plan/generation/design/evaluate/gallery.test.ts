import type { DesignBrief, DesignElement, DesignScore, GardenBrief } from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../../archetypes.js';
import { resolveConstraints } from '../../constraints.js';
import { PRINCIPLE_WEIGHTS } from '../../knowledge/principles.js';
import { buildBriefs } from '../brief-builder.js';
import { interpretRequirements } from '../requirements.js';
import { analyseSite } from '../site-analysis.js';
import { GALLERY, GALLERY_PAIRS, GALLERY_SITE, gallery, type GalleryGarden } from './gallery.js';
import { evaluateDesign } from './index.js';

/**
 * Can the scorer tell a good garden from a bad one, and does it read the brief?
 *
 * `evaluate.test.ts` tests a rule at a time — build the fault, check it is reported — which proves
 * each principle fires and says nothing about whether the *total* ranks plans the way a designer
 * would. These are whole gardens, in pairs that hold their contents constant.
 *
 * **Every assertion is relational.** A scorer pinned to 0.814 is a scorer nobody can improve; what
 * has to stay true is that the well-composed garden beats the badly composed one, and that the
 * ranking is a fact about the design rather than about the order the elements happen to be in.
 *
 * Two of them pin a **gap rather than a guarantee**, and are written to fail the day it closes — the
 * same discipline `design-review.service.test.ts` keeps about the scorer being blind to the concept
 * slot. They are the measurement the weighting work is aimed at, and the numbers behind them are in
 * `scripts/eval-scorer.baseline.md`.
 */

const ANALYSIS = analyseSite(GALLERY_SITE);

function briefsFor(against: GardenBrief): DesignBrief[] {
  const constraints = resolveConstraints(against, ARCHETYPES[0]!, ANALYSIS.scale.designedArea);
  const requirements = interpretRequirements(against, ANALYSIS, constraints);
  return buildBriefs(against, requirements, ANALYSIS);
}

function scoreOf(
  garden: GalleryGarden,
  brief: DesignBrief,
  elements: DesignElement[] = garden.elements,
): DesignScore {
  return evaluateDesign({
    elements,
    analysis: ANALYSIS,
    brief,
    featureOf: garden.featureOf,
    tier: 'realised',
  });
}

/** Slot A of a garden's own brief: the reading the concept it answers would be judged by. */
function ownScore(key: string): DesignScore {
  const garden = gallery(key);
  return scoreOf(garden, briefsFor(garden.brief)[0]!);
}

/** The weighted mean before the essentials gate, which is where a brief could show up. */
function base(score: DesignScore): number {
  const applied = (score as { weights?: Record<string, number> }).weights ?? PRINCIPLE_WEIGHTS;
  let weighted = 0;
  let available = 0;
  for (const [id, value] of Object.entries(score.categories)) {
    const weight = applied[id];
    if (weight === undefined || value === undefined) continue;
    weighted += weight * value;
    available += weight;
  }
  return available > 0 ? weighted / available : 0;
}

/* ---------------------------------------------------------------- does it rank? */

describe('the gallery', () => {
  it.each(GALLERY_PAIRS)('prefers $better to $worse', ({ better, worse }) => {
    expect(ownScore(better).total).toBeGreaterThan(ownScore(worse).total);
  });

  it('ranks the pairs the same way whichever concept slot is asked', () => {
    for (const { better, worse } of GALLERY_PAIRS) {
      const good = gallery(better);
      const bad = gallery(worse);
      const briefs = briefsFor(good.brief);

      for (const brief of briefs) {
        expect(scoreOf(good, brief).total).toBeGreaterThan(scoreOf(bad, brief).total);
      }
    }
  });

  it('puts the scattered garden under every other garden', () => {
    const floor = ownScore('scattered').total;
    for (const garden of GALLERY) {
      if (garden.key === 'scattered') continue;
      expect(ownScore(garden.key).total).toBeGreaterThan(floor);
    }
  });

  it('finds nothing to complain about in the well-composed gardens', () => {
    for (const { better } of GALLERY_PAIRS) {
      expect(ownScore(better).issues).toEqual([]);
    }
  });

  it('says why about every garden it marks down', () => {
    for (const { worse } of GALLERY_PAIRS) {
      const score = ownScore(worse);
      expect(score.issues.length).toBeGreaterThan(0);
      for (const issue of score.issues) {
        expect(issue.message.length).toBeGreaterThan(15);
        expect(issue.message.endsWith('.')).toBe(true);
      }
    }
  });
});

/* ---------------------------------------------------------------- is it a fact about the design? */

describe('a score is a fact about the garden', () => {
  it('is the same answer twice', () => {
    for (const garden of GALLERY) {
      expect(ownScore(garden.key)).toEqual(ownScore(garden.key));
    }
  });

  it('does not change when two elements that do not overlap swap places in the list', () => {
    /*
     * Not a reversal of the whole list: array order *is* stacking order, so reversing it genuinely
     * changes which element covers which ground and `measureComposition` is right to notice. What
     * must not matter is the order of two things that do not touch.
     */
    const garden = gallery('family-good');
    const brief = briefsFor(garden.brief)[0]!;

    const swapped = [...garden.elements];
    const left = swapped.findIndex((element) => element.id === 'fg4');
    const right = swapped.findIndex((element) => element.id === 'fg5');
    expect(left).toBeGreaterThan(-1);
    expect(right).toBeGreaterThan(-1);
    [swapped[left], swapped[right]] = [swapped[right]!, swapped[left]!];

    const before = scoreOf(garden, brief);
    const after = scoreOf(garden, brief, swapped);

    expect(after.total).toBeCloseTo(before.total, 12);
    expect(after.categories).toEqual(before.categories);
    expect(after.issues.map((issue) => issue.code).sort()).toEqual(
      before.issues.map((issue) => issue.code).sort(),
    );
  });
});

/* ---------------------------------------------------------------- does it read the brief? */

describe('the scorer reads the brief', () => {
  /*
   * The first two tests here used to assert the opposite, and pinned the gap so they would fail the
   * day it closed. The numbers they were taken against are in `scripts/eval-scorer.baseline.md`:
   * four completely different briefs gave every garden the same answer to within 0.016, and the
   * upkeep pair separated by 0.012 where the composition pairs separated by 0.30 and more.
   */

  it('judges the same garden differently under different briefs', () => {
    const briefs = GALLERY_PAIRS.map(({ better }) => gallery(better).brief);

    const spreads = GALLERY.map((garden) => {
      const bases = briefs.map((against) => base(scoreOf(garden, briefsFor(against)[0]!)));
      return Math.max(...bases) - Math.min(...bases);
    });

    /* Not every garden: a plan with nothing to say either way is entitled to score the same. */
    expect(spreads.filter((spread) => spread > 0.03).length).toBeGreaterThanOrEqual(5);
  });

  it('marks down the garden that contradicts its own brief, under that brief alone', () => {
    /*
     * The sharpest measurement in the gallery. `lowMaintenance-poor` is the good plan with grass
     * where the gravel was and four materials instead of two: no composition fault the scorer can
     * see, and completely wrong for somebody who said they have no time. So it has to score well
     * under every brief except the one it was given.
     */
    const garden = gallery('lowMaintenance-poor');
    const own = base(scoreOf(garden, briefsFor(garden.brief)[0]!));

    const others = GALLERY_PAIRS.filter(({ better }) => !better.startsWith('lowMaintenance')).map(
      ({ better }) => base(scoreOf(garden, briefsFor(gallery(better).brief)[0]!)),
    );

    for (const other of others) expect(other).toBeGreaterThan(own + 0.05);
  });

  it('separates the upkeep pair on the principle that measures upkeep', () => {
    const good = ownScore('lowMaintenance-good');
    const poor = ownScore('lowMaintenance-poor');

    expect(good.total).toBeGreaterThan(poor.total);
    expect(poor.categories.maintenanceFit!).toBeLessThan(good.categories.maintenanceFit!);
    expect(poor.issues.map((issue) => issue.code)).toContain('upkeep-heavy');
  });

  it('carries the weights the total was made of, renormalised', () => {
    for (const garden of GALLERY) {
      const score = ownScore(garden.key);
      expect(score.weights).toBeDefined();

      /*
       * One weight per principle measured, and nothing for one that was not — `featureFit` aside,
       * which is scored and reported but never weighted, because it is the gate rather than a
       * category.
       */
      const weighed = Object.keys(score.categories)
        .filter((id) => id !== 'featureFit')
        .sort();
      expect(Object.keys(score.weights!).sort()).toEqual(weighed);

      const total = Object.values(score.weights!).reduce((sum, weight) => sum + (weight ?? 0), 0);
      expect(total).toBeCloseTo(1, 9);
    }
  });
});

/* ---------------------------------------------------------------- can it be acted on? */

describe('a fault says what a correction would have to achieve', () => {
  /*
   * The gap this closes was the largest one left in the design agent: the scorer could say what was
   * wrong and never where the thing should go, so seven of the ten repair kinds were unperformable.
   * These pin the property rather than the wording — a planner reads `guidance`, and what matters is
   * that it is there, that it names things that exist, and that it never contains a position.
   */

  const guided = GALLERY.flatMap((garden) =>
    ownScore(garden.key).issues.map((issue) => ({ garden, issue })),
  );

  it('names only elements that are on the plan', () => {
    for (const { garden, issue } of guided) {
      const ids = new Set(garden.elements.map((element) => element.id));
      const named = [
        ...(issue.guidance?.near ?? []),
        ...(issue.guidance?.awayFrom ?? []),
        ...(issue.guidance?.avoid ?? []),
        ...(issue.guidance?.connect ? [issue.guidance.connect] : []),
        ...(issue.guidance?.keepWithin ? [issue.guidance.keepWithin] : []),
      ];

      for (const id of named) {
        expect(ids.has(id), `${garden.key} ${issue.code} names ${id}`).toBe(true);
      }
    }
  });

  it('names only boundary edges the site actually has', () => {
    const edges = new Set(ANALYSIS.edges.map((edge) => edge.vertexId));
    for (const { garden, issue } of guided) {
      for (const edge of issue.guidance?.screenFrom ?? []) {
        expect(edges.has(edge), `${garden.key} ${issue.code} names ${edge}`).toBe(true);
      }
    }
  });

  it('tells a move where to go, every time it asks for one', () => {
    /*
     * The measured failure this is about: mapped to "towards the boundary" — the only destination an
     * intent could name — the planner refused every move fault across four fixtures with "it is
     * already as far that way as it will go", because the things these faults are about are against
     * a fence already.
     */
    const moves = guided.filter(({ issue }) => issue.repair === 'move-to-zone');
    expect(moves.length).toBeGreaterThan(0);

    for (const { garden, issue } of moves) {
      const guidance = issue.guidance ?? {};
      const says =
        guidance.near ||
        guidance.awayFrom ||
        guidance.nearAnchor ||
        guidance.awayFromAnchor ||
        guidance.inView ||
        guidance.outOfView ||
        guidance.sunlit ||
        guidance.screenFrom ||
        guidance.clearOfBoundaryM;

      expect(says, `${garden.key} ${issue.code} asks for a move and says nothing`).toBeTruthy();
    }
  });

  it('tells a resize how much bigger or smaller', () => {
    const sized = guided.filter(
      ({ issue }) => issue.repair === 'shrink-terrace' || issue.repair === 'enlarge-lawn',
    );
    expect(sized.length).toBeGreaterThan(0);

    for (const { garden, issue } of sized) {
      /*
       * `lawn-fragmented` is the exception and stays one: two lawns of similar size want joining,
       * and there is no factor on an area that expresses "these should be one panel".
       */
      if (issue.code === 'lawn-fragmented') continue;
      expect(issue.guidance?.targetAreaFactor, `${garden.key} ${issue.code}`).toBeGreaterThan(0);
    }
  });

  it('points a dropped feature at something that can be dropped', () => {
    /*
     * `drop-optional` was unreachable in both repair layers: its two emitters named nothing, and a
     * repair resolves an issue to elements through its subjects, so an issue about "the garden"
     * resolved to no garden at all.
     *
     * What it names is the *optional* things standing in the way, never the missing essential — a
     * feature that is not in the drawing has no id, and a repair that removed another essential to
     * make room would be answering the fault by committing it again. An empty list where nothing
     * optional was placed is therefore the correct answer rather than the old defect.
     */
    const dropped = GALLERY.flatMap((garden) =>
      ownScore(garden.key)
        .issues.filter((issue) => issue.repair === 'drop-optional')
        .map((issue) => ({ garden, issue })),
    );
    expect(dropped.length).toBeGreaterThan(0);

    for (const { garden, issue } of dropped) {
      const optional = new Set(
        briefsFor(garden.brief)[0]!
          .featurePriorities.filter((entry) => entry.tier === 'optional')
          .map((entry) => entry.feature),
      );
      const placed = garden.elements.filter((element) => {
        const feature = garden.featureOf.get(element.id);
        return feature !== undefined && optional.has(feature);
      });

      expect(issue.subjects.length, `${garden.key} ${issue.code}`).toBe(Math.min(8, placed.length));
      for (const subject of issue.subjects) {
        expect(placed.some((element) => element.id === subject)).toBe(true);
      }
    }
  });

  it('says which critic found it', () => {
    for (const { issue } of guided) expect(issue.source).toBe('geometry');
  });
});
