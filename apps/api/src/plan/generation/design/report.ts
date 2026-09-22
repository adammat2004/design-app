import type { DesignScore, PrincipleId } from '@garden-studio/schema';
import { PRINCIPLES, WEAK } from '../knowledge/principles.js';

/**
 * A score as a line of text.
 *
 * Shared by the fixture report and the evaluation harness so the two print the same thing. Written
 * to line up in a terminal, because the whole value of a benchmark you can read is that a
 * regression shows up as a column moving rather than as a number in a log.
 */

const SHORT: Record<PrincipleId, string> = {
  circulation: 'circ',
  grouping: 'group',
  proportion: 'prop',
  relationships: 'relat',
  privacy: 'priv',
  hierarchy: 'hier',
  style: 'style',
  buildability: 'build',
  featureFit: 'fit',
  sun: 'sun',
  maintenanceFit: 'upkp',
  canopy: 'tree',
};

export function describeScore(name: string, score: DesignScore): string {
  const cells = [...PRINCIPLES.map((principle) => principle.id), 'featureFit' as PrincipleId].map(
    (id) => {
      const value = score.categories[id];
      /*
       * A dash rather than a nought for a principle that did not apply. They are different answers
       * and the table has to show that a plan with no location was not marked down for it.
       */
      return `${SHORT[id]} ${(value === undefined ? '—' : value.toFixed(2)).padStart(4)}`;
    },
  );

  const critical = score.issues.filter((issue) => issue.severity === 'critical').length;
  const major = score.issues.filter((issue) => issue.severity === 'major').length;

  return [
    name.padEnd(26),
    `total ${score.total.toFixed(2)}${score.total < WEAK ? '!' : ' '}`,
    ...cells,
    `issues ${String(critical).padStart(2)}c ${String(major).padStart(2)}M ${String(score.issues.length).padStart(2)}`,
  ].join('  ');
}

/** The heading the columns line up under. */
export function scoreHeading(label = ''): string {
  const cells = [...PRINCIPLES.map((principle) => principle.id), 'featureFit' as PrincipleId].map(
    (id) => SHORT[id].padEnd(8),
  );
  return [label.padEnd(26), 'total    ', ...cells, 'issues'].join('  ');
}

/** The worst few faults, one per line, for a report that has room for them. */
export function describeIssues(score: DesignScore, limit = 3): string[] {
  return score.issues
    .filter((issue) => issue.severity !== 'minor')
    .slice(0, limit)
    .map((issue) => `      ${issue.severity === 'critical' ? '✗' : '·'} ${issue.message}`);
}
