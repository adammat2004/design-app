import type { DesignBrief, DesignIssue, DesignScore, GardenBrief } from '@garden-studio/schema';
import { ARCHETYPES } from '../src/plan/generation/archetypes.js';
import { resolveConstraints } from '../src/plan/generation/constraints.js';
import { buildBriefs } from '../src/plan/generation/design/brief-builder.js';
import { evaluateDesign } from '../src/plan/generation/design/evaluate/index.js';
import {
  GALLERY,
  GALLERY_PAIRS,
  GALLERY_SITE,
  gallery,
  type GalleryGarden,
} from '../src/plan/generation/design/evaluate/gallery.js';
import { interpretRequirements } from '../src/plan/generation/design/requirements.js';
import { describeScore, scoreHeading } from '../src/plan/generation/design/report.js';
import { analyseSite } from '../src/plan/generation/design/site-analysis.js';
import { PRINCIPLE_WEIGHTS } from '../src/plan/generation/knowledge/principles.js';

/**
 * How well the scorer tells gardens apart.
 *
 * The generator harness (`eval:generator`) measures the generator and needs PostGIS to do it. This
 * measures the **scorer**, on nine gardens built by hand, and needs nothing running at all — which
 * is the point: a scorer that can only be exercised through a generator can only be calibrated
 * against that generator's own output, which is the circularity `composition-rules.ts` already
 * refuses for the composition bands.
 *
 * Three questions, in the order they matter:
 *
 * - **Does it rank?** Every good/poor pair holds its contents constant and differs only in
 *   composition. A scorer that cannot separate those is not measuring design.
 * - **Does it read the brief?** The same garden is scored against every brief in the gallery. A
 *   planted garden judged by an entertaining brief should not score the same as one judged by its
 *   own — and today it does, which is the gap this harness exists to close.
 * - **Does it say why?** Every issue found on slot A is printed. A number with no sentence behind
 *   it is not something anybody can act on.
 *
 * Run it with `pnpm --filter @garden-studio/api eval:scorer`. It writes nothing.
 *
 * **Take the baseline before changing the scorer.** `scripts/eval-scorer.baseline.md` is the reading
 * from before, kept so an improvement is a diff rather than a claim.
 */

const ANALYSIS = analyseSite(GALLERY_SITE);

/** One brief per kind of garden in the gallery, named by what it asks for. */
const BRIEFS: { key: string; brief: GardenBrief }[] = [
  { key: 'entertaining', brief: gallery('entertaining-good').brief },
  { key: 'family', brief: gallery('family-good').brief },
  { key: 'planted', brief: gallery('planted-good').brief },
  { key: 'lowUpkeep', brief: gallery('lowMaintenance-good').brief },
];

interface Reading {
  brief: DesignBrief;
  score: DesignScore;
}

/** The three slot briefs a garden brief produces, and what this garden scores against each. */
function read(garden: GalleryGarden, against: GardenBrief = garden.brief): Reading[] {
  const constraints = resolveConstraints(against, ARCHETYPES[0]!, ANALYSIS.scale.designedArea);
  const requirements = interpretRequirements(against, ANALYSIS, constraints);

  return buildBriefs(against, requirements, ANALYSIS).map((brief) => ({
    brief,
    score: evaluateDesign({
      elements: garden.elements,
      analysis: ANALYSIS,
      brief,
      featureOf: garden.featureOf,
      tier: 'realised',
    }),
  }));
}

function main(): void {
  site();
  table();
  faults();
  pairs();
  cross();
  weights();
}

function site(): void {
  const { scale, roomDepth, roomWidth, shape, zones, scope } = ANALYSIS;
  console.log('\nThe gallery plot');
  console.log('─'.repeat(120));
  console.log(
    [
      `room ${roomWidth?.toFixed(1) ?? '—'} × ${roomDepth?.toFixed(1) ?? '—'} m`,
      `shape ${shape}`,
      `zones ${zones.map((zone) => zone.id).join(', ')}`,
      `in scope ${scope.zones.join(', ') || 'all'}`,
      `designed ${scale.designedArea.toFixed(0)} m²`,
      `edges ${ANALYSIS.edges.map((edge) => `${edge.vertexId}:${edge.exposure}/${edge.height}`).join(' ')}`,
    ].join('   '),
  );
}

function table(): void {
  console.log(`\nEvery garden against its own brief, one row per concept slot`);
  console.log(`${scoreHeading('garden / slot')}\n${'─'.repeat(150)}`);

  for (const garden of GALLERY) {
    for (const reading of read(garden)) {
      console.log(
        describeScore(`${garden.key} ${reading.brief.id} ${reading.brief.emphasis}`, reading.score),
      );
    }
  }
}

function faults(): void {
  console.log('\nWhat it found, on slot A');
  console.log('─'.repeat(120));

  for (const garden of GALLERY) {
    const [slotA] = read(garden);
    if (!slotA) continue;
    console.log(`\n${garden.key}  —  ${garden.description}`);
    if (slotA.score.issues.length === 0) {
      console.log('      (nothing)');
      continue;
    }
    for (const issue of slotA.score.issues) {
      const mark = issue.severity === 'critical' ? '✗' : issue.severity === 'major' ? '·' : ' ';
      console.log(
        [
          `    ${mark} ${issue.code.padEnd(24)}`,
          (issue.repair ?? '—').padEnd(17),
          `${issue.subjects.length > 0 ? `[${issue.subjects.join(' ')}]` : '[]'}`.padEnd(20),
          describeGuidance(issue.guidance),
        ].join(' '),
      );
    }
  }
}

/**
 * What a valid correction would have to achieve, in one line.
 *
 * Printed because guidance is the half of an issue nobody can see from the message: "move the store"
 * and "move the store out of the view, into the utility area, near the gate" read the same in prose
 * and are completely different instructions to a planner.
 */
function describeGuidance(guidance: DesignIssue['guidance']): string {
  if (!guidance) return '';
  const parts = Object.entries(guidance).map(([key, value]) =>
    Array.isArray(value)
      ? `${key}=${value.join('|')}`
      : typeof value === 'number'
        ? `${key}=${value.toFixed(2)}`
        : `${key}=${value}`,
  );
  return parts.join(' ');
}

/** Does it rank? The claim every other number rests on. */
function pairs(): void {
  console.log('\nDoes it rank? Each pair holds its contents constant');
  console.log('─'.repeat(120));

  for (const { better, worse } of GALLERY_PAIRS) {
    const good = read(gallery(better))[0]!.score.total;
    const bad = read(gallery(worse))[0]!.score.total;
    const verdict = good > bad ? 'ok  ' : 'FAIL';
    console.log(
      `  ${verdict}  ${better.padEnd(22)} ${good.toFixed(3)}   ${worse.padEnd(22)} ${bad.toFixed(3)}   Δ ${(good - bad).toFixed(3)}`,
    );
  }

  const floor = read(gallery('scattered'))[0]!.score.total;
  const worst = Math.min(...GALLERY_PAIRS.map(({ worse }) => read(gallery(worse))[0]!.score.total));
  console.log(
    `  ${floor < worst ? 'ok  ' : 'FAIL'}  scattered              ${floor.toFixed(3)}   under the worst of the pairs (${worst.toFixed(3)})`,
  );
}

/**
 * Does it read the brief?
 *
 * Every garden against every brief in the gallery, reported as the **uncapped** weighted mean rather
 * than the total. The total is capped at 0.5 whenever the brief calls for something the garden does
 * not contain, so a cross-brief table of totals is mostly a picture of that gate firing — which is
 * correct behaviour and not the question. What is being asked here is whether the *principles* judge
 * a planted garden differently when the brief is a planted one. A flat row means they do not.
 */
function cross(): void {
  console.log('\nDoes it read the brief? Slot A weighted mean before the essentials gate');
  console.log('─'.repeat(120));
  console.log(
    `  ${'garden'.padEnd(22)}${BRIEFS.map(({ key }) => key.padStart(16)).join('')}   spread`,
  );

  for (const garden of GALLERY) {
    const bases = BRIEFS.map(({ brief: against }) => base(read(garden, against)[0]!.score));
    const spread = Math.max(...bases) - Math.min(...bases);
    console.log(
      `  ${garden.key.padEnd(22)}${bases.map((value) => value.toFixed(3).padStart(16)).join('')}   ${spread.toFixed(3)}`,
    );
  }
}

/**
 * The weighted mean the total is made of, before the gate.
 *
 * Recomputed here rather than read off the score, because `DesignScore` carries the capped total and
 * the categories and nothing in between. It uses the score's own weights where it has them, so this
 * goes on being the same arithmetic once the weights vary by brief.
 */
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

/** Which weights were applied, when the score carries them. Silent until it does. */
function weights(): void {
  const sample = read(gallery('entertaining-good'));
  const carried = sample.map((reading) => (reading.score as { weights?: unknown }).weights);
  if (carried.every((entry) => entry === undefined)) {
    console.log('\nThe score carries no weights: every garden is judged by one fixed table.\n');
    return;
  }
  console.log('\nWeights applied, per slot');
  console.log('─'.repeat(120));
  for (const [index, reading] of sample.entries()) {
    console.log(`  ${reading.brief.id} ${reading.brief.emphasis.padEnd(12)}`, carried[index]);
  }
  console.log('');
}

main();
