import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  measureComposition,
  computeZones,
  elementOutline,
  pointInPolygon,
  type DesignElement,
  effectiveZoneIds,
  PlanDocumentSchema,
  readPlanDocument,
  type DesignScore,
  type GeneratedConcept,
  type PlanDocument,
  type PrincipleId,
} from '@garden-studio/schema';
import { compositionRules } from '../src/plan/generation/composition-rules.js';
import { ConceptsService } from '../src/plan/generation/concepts.service.js';
import { analyseSite } from '../src/plan/generation/design/site-analysis.js';
import {
  describeIssues,
  describeScore,
  scoreHeading,
} from '../src/plan/generation/design/report.js';
import { inclusionRate } from '../src/plan/generation/design/adapters.js';
import { SCENARIOS } from '../src/plan/generation/design/scenarios.js';
import { FillService } from '../src/plan/generation/fill.service.js';
import { PRINCIPLES, WEAK } from '../src/plan/generation/knowledge/principles.js';
import { PlacementService } from '../src/plan/generation/placement.service.js';
import { GeometryValidationService } from '../src/plan/geometry-validation.service.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE } from '../src/test/db.js';

/**
 * The evaluation harness.
 *
 * TODOS has carried this as the largest outstanding gap in the project for as long as there has
 * been a generator — "no benchmark, no user study, no measured numbers" — and the reason it was
 * worth waiting for is that a benchmark needs something to measure. Constraint satisfaction and
 * latency were always available; "is this a good garden" was not, until the design principles
 * existed to ask it.
 *
 * What it reports, per fixture and per concept:
 *
 * - **validity** — every concept passes the same `geometryIsLegal` that guards its own save.
 * - **composition** — the traced-target bands, the oracle that already existed.
 * - **design score** — the nine principles, with the faults found.
 * - **inclusion** — how much of what was asked for is actually in the drawing.
 * - **determinism** — the same document and seed produce byte-identical concepts.
 * - **latency** — wall time per generation, by plot scale.
 *
 * Run it with `pnpm --filter @garden-studio/api eval:generator`. It needs PostGIS up and it writes
 * nothing: a benchmark that changes the thing it measures is not one.
 *
 * **Take a baseline before changing the generator.** A score measured after a change can only
 * confirm what the change did; the number that means something is the one from before it.
 */

const SEEDS = [11, 12, 13];

/** The faults the composition principle reports, printed in full whatever their count. */
const COMPOSITION_CODES = [
  'feature-in-open-space',
  'route-crosses-panel',
  'hard-island',
  'orphan-feature',
  'one-sided',
  'panel-complexity',
  'geometry-mixed',
] as const;

interface Row {
  fixture: string;
  concept: string;
  archetype: string;
  seed: number;
  valid: boolean;
  compositionViolations: number;
  score: DesignScore | null;
  inclusion: number;
  elements: number;
  /** How many faults the repair stage fixed on this concept, as it reported them. */
  repairs: number;
  /** How many separate pieces of accent lawn the plan ends with: one is a lawn, three is leftovers. */
  lawnPieces: number;
  /** Features and routes the composition gave no reason for, on a plan that gives reasons at all. */
  orphans: number;
  /**
   * How much the planting's depth differs between the garden's sides, in metres: the deepest
   * planted side less the shallowest. `null` where fewer than two sides are planted at all.
   */
  borderSpread: number | null;
}

/**
 * A spread of at least this between the deepest and shallowest planted side counts as planting
 * with a depth per side: half a bed's worth, the difference between a screen and an edging.
 */
const BORDER_SPREAD = 0.75;

async function main(): Promise<void> {
  const connection = await connectTestDatabase();
  if (!connection) {
    console.error(DB_UNAVAILABLE_MESSAGE);
    process.exitCode = 1;
    return;
  }

  const service = new ConceptsService(
    new PlacementService(connection.db),
    new FillService(connection.db),
  );

  const cases = [
    ...loadFixtures(),
    ...SCENARIOS.map((s) => ({ name: s.key, document: s.document })),
  ];
  const rows: Row[] = [];
  const timings: { fixture: string; area: number; ms: number }[] = [];
  const failures: { fixture: string; seed: number; message: string }[] = [];
  let determinismFailures = 0;

  console.log(`\n${scoreHeading('fixture / concept')}\n${'─'.repeat(140)}`);

  for (const item of cases) {
    for (const seed of SEEDS) {
      const started = performance.now();

      /*
       * A case that cannot be generated is a *result*, not the end of the run.
       *
       * The first thing this harness ever found was a `TopologyException` out of `ST_UnaryUnion`
       * on an L-shaped plot, and an uncaught throw meant the eleven cases after it were never
       * measured — so the one run that had something to report produced no report. A benchmark
       * that stops at the first fault cannot measure the recovery from it either.
       */
      let concepts: GeneratedConcept[];
      try {
        concepts = await service.generate(item.document, seed);
      } catch (error) {
        failures.push({ fixture: item.name, seed, message: String(error).split('\n')[0] ?? '' });
        console.log(
          `  ✗ ${item.name} seed ${seed} failed to generate: ${failures.at(-1)!.message}`,
        );
        continue;
      }
      const elapsed = performance.now() - started;

      if (seed === SEEDS[0]) {
        const analysis = analyseSite(item.document);
        timings.push({
          fixture: item.name,
          area: Math.round(analysis.scale.designedArea),
          ms: elapsed,
        });

        /*
         * Determinism is checked once per fixture rather than on every seed: it is a property of
         * the generator, not of a particular roll, and generating a fourth set on every case would
         * add a third to the harness's runtime for no extra information.
         */
        const again = await service.generate(item.document, seed);
        if (JSON.stringify(stripScores(again)) !== JSON.stringify(stripScores(concepts))) {
          determinismFailures += 1;
          console.log(`  ✗ ${item.name} is not deterministic at seed ${seed}`);
        }
      }

      for (const concept of concepts) {
        rows.push(await measure(item, concept, seed, connection.db));
      }

      if (seed === SEEDS[0]) {
        for (const concept of concepts) {
          if (!concept.score) continue;
          console.log(describeScore(`${item.name}/${short(concept)}`, concept.score));
          for (const line of describeIssues(concept.score)) console.log(line);
        }
      }
    }
  }

  await connection.close();
  summarise(rows, timings, determinismFailures, failures);
}

/** The captured fixtures, where they have been captured. Skipped rather than fatal when not. */
function loadFixtures(): { name: string; document: PlanDocument }[] {
  const dir = resolve('../web/scripts/fixtures');
  const names = ['suburban', 'l-shape', 'courtyard'];
  const found: { name: string; document: PlanDocument }[] = [];

  for (const name of names) {
    try {
      found.push({
        name,
        document: readPlanDocument(
          JSON.parse(readFileSync(resolve(dir, `${name}.plan.json`), 'utf8')),
        ),
      });
    } catch {
      console.log(
        `  · ${name}.plan.json not captured; skipping. Run capture:fixtures with the API up.`,
      );
    }
  }
  return found;
}

async function measure(
  item: { name: string; document: PlanDocument },
  concept: GeneratedConcept,
  seed: number,
  db: Awaited<ReturnType<typeof connectTestDatabase>> extends infer T
    ? T extends { db: infer D }
      ? D
      : never
    : never,
): Promise<Row> {
  const candidate = PlanDocumentSchema.parse({
    ...item.document,
    layout: { ...item.document.layout, elements: concept.elements },
  });
  const validation = await new GeometryValidationService(db).validate(candidate);

  const zones = computeZones(
    item.document.site.vertices.map(({ x, y }) => ({ x, y })),
    item.document.site.house,
  );
  const ticked = effectiveZoneIds(item.document.site.selectedZoneIds, zones);
  const inScope = zones.filter((zone) =>
    (ticked.length > 0 ? ticked : zones.map((z) => z.id)).includes(zone.id),
  );
  const analysis = analyseSite(item.document);
  const report = measureComposition(concept.elements, inScope);

  return {
    fixture: item.name,
    concept: concept.name,
    archetype: concept.strategy?.archetype ?? '—',
    seed,
    valid: validation.violations.length === 0,
    compositionViolations: compositionRules(report, {
      roomDepth: analysis.roomDepth,
      lawnAllowed: concept.maintenance !== 'low',
    }).length,
    score: concept.score ?? null,
    inclusion: inclusionRate(item.document.brief, concept.elements),
    elements: concept.elements.length,
    repairs: concept.explanation?.repairs.length ?? 0,
    lawnPieces: concept.elements.filter(
      (element) => element.category === 'lawn' && element.role === 'fill' && element.fillKind === 'accent',
    ).length,
    orphans: concept.elements.some((element) => element.purpose)
      ? concept.elements.filter(
          (element) =>
            element.role === 'feature' &&
            !element.purpose &&
            !element.symbol?.startsWith('tree') &&
            element.category !== 'furniture' &&
            element.category !== 'lighting' &&
            element.category !== 'existing-feature' &&
            element.category !== 'planting-bed',
        ).length
      : 0,
    borderSpread: borderSpread(concept.elements, analysis),
  };
}

/**
 * Whether the planting has a depth per side or one depth all round — the property Phase 2 is about.
 *
 * For the garden's left, right and rear sides, sample seven points along the fence and walk in from
 * each until the ground stops being planting; a side's depth is the median. A plan that plants every
 * boundary to one depth has a spread near nought, however deep that depth is; one whose screen is
 * deep, whose flank is a mowing edge and whose backdrop is somewhere between has a spread of metres.
 */
function borderSpread(
  elements: DesignElement[],
  analysis: ReturnType<typeof analyseSite>,
): number | null {
  const frame = analysis.frame;
  const box = analysis.box;
  if (!frame || !box) return null;
  const beds = elements
    .filter((element) => element.category === 'planting-bed' && element.role === 'fill')
    .map((element) => elementOutline(element));
  const planted = (u: number, v: number) => {
    const point = frame.toWorld(u, v);
    return beds.some((ring) => pointInPolygon(point, ring));
  };
  const depthAlong = (at: (t: number) => { u: number; v: number }, inward: { u: number; v: number }) => {
    const depths: number[] = [];
    for (let k = 1; k <= 7; k += 1) {
      const start = at(0.15 + (0.7 * (k - 1)) / 6);
      let depth = 0;
      for (let step = 0.05; step <= 6; step += 0.1) {
        if (!planted(start.u + inward.u * step, start.v + inward.v * step)) break;
        depth = step;
      }
      depths.push(depth);
    }
    depths.sort((a, b) => a - b);
    return depths[3]!;
  };
  const sides = [
    depthAlong((t) => ({ u: box.uMin + (box.uMax - box.uMin) * t, v: box.vMin }), { u: 0, v: 1 }),
    depthAlong((t) => ({ u: box.uMin + (box.uMax - box.uMin) * t, v: box.vMax }), { u: 0, v: -1 }),
    depthAlong((t) => ({ u: box.uMax, v: box.vMin + (box.vMax - box.vMin) * t }), { u: -1, v: 0 }),
  ].filter((depth) => depth > 0);
  return sides.length >= 2 ? Math.max(...sides) - Math.min(...sides) : null;
}

function summarise(
  rows: Row[],
  timings: { fixture: string; area: number; ms: number }[],
  determinismFailures: number,
  failures: { fixture: string; seed: number; message: string }[],
): void {
  const scored = rows.filter((row): row is Row & { score: DesignScore } => row.score !== null);

  console.log(
    `\n${'═'.repeat(140)}\nSUMMARY over ${rows.length} concepts (${SEEDS.length} seeds)\n`,
  );

  console.log(
    `  generated at all         ${failures.length === 0 ? 'every case' : `${failures.length} FAILED`}`,
  );
  for (const failure of failures) {
    console.log(`    ✗ ${failure.fixture} seed ${failure.seed}: ${failure.message}`);
  }
  console.log(
    `  valid geometry           ${rate(rows.filter((row) => row.valid).length, rows.length)}`,
  );
  console.log(
    `  inside composition bands ${rate(rows.filter((row) => row.compositionViolations === 0).length, rows.length)}`,
  );
  console.log(
    `  deterministic            ${determinismFailures === 0 ? 'yes' : `NO — ${determinismFailures} fixtures`}`,
  );
  console.log(
    `  requested features drawn ${(mean(rows.map((row) => row.inclusion)) * 100).toFixed(0)}% (mean)`,
  );
  /*
   * What the repair stage actually did, rather than whether it is switched on. A loop that reports
   * no repairs across a hundred concepts is either finding nothing to fix or refusing everything it
   * tries, and those are very different states to be in.
   */
  const repaired = rows.filter((row) => row.repairs > 0);
  console.log(
    `  repairs accepted         ${repaired.reduce((total, row) => total + row.repairs, 0)} across ${rate(repaired.length, rows.length)} of concepts`,
  );

  if (scored.length > 0) {
    console.log(
      `\n  design score   mean ${mean(scored.map((row) => row.score.total)).toFixed(3)}   min ${Math.min(...scored.map((row) => row.score.total)).toFixed(3)}`,
    );
    console.log(
      `  weak (< ${WEAK})    ${rate(scored.filter((row) => row.score.total < WEAK).length, scored.length)}`,
    );
    console.log(
      `  with a critical fault    ${rate(
        scored.filter((row) => row.score.issues.some((issue) => issue.severity === 'critical'))
          .length,
        scored.length,
      )}`,
    );

    console.log('\n  by principle:');
    for (const principle of [...PRINCIPLES.map((p) => p.id), 'featureFit' as PrincipleId]) {
      const values = scored
        .map((row) => row.score.categories[principle])
        .filter((value): value is number => value !== undefined);
      if (values.length === 0) {
        console.log(`    ${principle.padEnd(16)} never applied`);
        continue;
      }
      console.log(
        `    ${principle.padEnd(16)} mean ${mean(values).toFixed(3)}   min ${Math.min(...values).toFixed(3)}   measured on ${values.length}/${scored.length}`,
      );
    }

    console.log('\n  commonest faults:');
    const counts = new Map<string, number>();
    for (const row of scored) {
      for (const issue of row.score.issues) {
        counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
      }
    }
    for (const [code, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`    ${code.padEnd(24)} ${String(count).padStart(4)}`);
    }

    /*
     * The composition faults, every one of them, even at nought. They are the numbers the
     * composition work is judged by, and a code that drops out of the top ten because it fell to
     * zero is the result being hidden by the table that should be reporting it.
     */
    console.log(
      `\n  lawn in one piece       ${rate(rows.filter((row) => row.lawnPieces <= 1).length, rows.length)}`,
    );
    console.log(`  orphans per concept      ${mean(rows.map((row) => row.orphans)).toFixed(2)} (mean)`);
    const spreads = rows
      .map((row) => row.borderSpread)
      .filter((spread): spread is number => spread !== null);
    console.log(
      `  planting depth varies   ${rate(spreads.filter((spread) => spread >= BORDER_SPREAD).length, spreads.length)} of plans planted on two sides or more (mean spread ${mean(spreads).toFixed(2)} m)`,
    );

    console.log('\n  by composition:');
    const byArchetype = new Map<string, number[]>();
    for (const row of scored) {
      byArchetype.set(row.archetype, [...(byArchetype.get(row.archetype) ?? []), row.score.total]);
    }
    for (const [archetype, totals] of [...byArchetype].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(
        `    ${archetype.padEnd(22)} ${String(totals.length).padStart(3)} concepts   mean ${mean(totals).toFixed(3)}   min ${Math.min(...totals).toFixed(3)}`,
      );
    }

    console.log('\n  composition faults:');
    for (const code of COMPOSITION_CODES) {
      console.log(`    ${code.padEnd(24)} ${String(counts.get(code) ?? 0).padStart(4)}`);
    }
  }

  console.log('\n  latency, one set of three concepts:');
  for (const timing of [...timings].sort((a, b) => a.area - b.area)) {
    console.log(
      `    ${timing.fixture.padEnd(22)} ${String(timing.area).padStart(6)} m²   ${timing.ms.toFixed(0).padStart(6)} ms`,
    );
  }
  console.log('');
}

/**
 * Scores are stripped before the determinism comparison.
 *
 * They are derived from the elements, so a difference in one always means a difference in the
 * other — including them would report the same fault twice and make the diff unreadable.
 */
function stripScores(concepts: GeneratedConcept[]) {
  return concepts.map((concept) => ({ ...concept, score: undefined, explanation: undefined }));
}

function short(concept: GeneratedConcept): string {
  return concept.strategy?.archetype ?? concept.name;
}

function rate(count: number, total: number): string {
  return `${count}/${total} (${total > 0 ? Math.round((count / total) * 100) : 0}%)`;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/*
 * `void` rather than a top-level await: the API package is CommonJS, and `tsx` transforms a
 * top-level await into a syntax error rather than into anything runnable.
 */
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
