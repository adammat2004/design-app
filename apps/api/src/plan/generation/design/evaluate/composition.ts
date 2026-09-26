import {
  distanceToSegment,
  pointInPolygon,
  polygonsIntersect,
  polylineLength,
  type ElementCategory,
  type Point,
} from '@garden-studio/schema';
import { FEATURE_LIBRARY } from '../../knowledge/feature-library.js';
import { RELATIONSHIP_RULES } from '../../knowledge/relationship-rules.js';
import { styleRules } from '../../knowledge/style-rules.js';
import {
  clamp01,
  meanOf,
  NOT_APPLICABLE,
  type MeasuredIssue,
  type PrincipleResult,
} from './result.js';
import { offAxis } from './style.js';
import type { DesignSubject, SubjectItem, SubjectRegion, SubjectRoute } from './subject.js';

/**
 * Does the plan read as one design, or as a set of individually correct things?
 *
 * Every other principle can be satisfied by a garden that is a collection of legal objects: the
 * shed is out of the view, the barbecue is by the table, the routes arrive, the shares are inside
 * the bands — and the fire pit is a gravel circle in the middle of the lawn with a diagonal line of
 * stepping stones cut across the grass to reach it. That was the generator's output on most of the
 * fixtures, and the measurement that nothing here noticed it is the reason this principle exists.
 * It landed *before* the generator started composing, so the improvement could be measured.
 *
 * Seven readings, each about the whole rather than about one rule:
 *
 * - **open space** — a built thing standing on the lawn or the open gravel, rather than in a bay
 *   beside it. The lawn is a designed shape; things go round it.
 * - **crossing** — a path cut across the lawn rather than run along its edge. Only the lawn: a paved
 *   line through a gravel court is a change of surface, not a cut in the ground. A route on the
 *   garden's own axis is exempt whatever the style, because a path down the middle to the thing at
 *   the end of it is a decision, not an accident.
 * - **islands** — hard landscaping touching nothing: not the house, not a fence, not a bed, not a
 *   panel, not a path, not another built thing.
 * - **purpose** — an element the composition never gave a reason. Conditional on the plan carrying
 *   purposes at all, so a plan drawn before the composition layer existed is not marked down for
 *   a vocabulary it never had.
 * - **balance** — the built masses all down one side of the room. Skipped where the style requires
 *   symmetry, because `style` already measures that and would count it twice.
 * - **panel shape** — an open space whose outline is the leftover of everything placed round it:
 *   many inside corners, or a perimeter far longer than a compact shape of its area needs.
 * - **geometry** — a curve in a straight plan or a rectangle in a curved one. Mixed geometry is
 *   allowed; a minority language that is a fifth of the ground is not a decision.
 *
 * Deliberately reads nothing off `emphasis` or `intent`. What a social or an open concept wants is
 * already said by the bands and the weight profile, and saying it a third time here is the mistake
 * `weight-profiles.ts` records three times over.
 */

/** The share of a built thing's sample points that must fall on a panel before it stands on it. */
const IN_OPEN_SPACE = 0.5;

/**
 * The features that belong *on* the open ground rather than in a bay beside it.
 *
 * Derived from the relationship rules rather than listed here, because it is already written down
 * with a reason: `play preferNear lawn`, "Play spills onto the grass, and a play area with no grass
 * beside it is a pen." A scorer that then reported a play area on the grass as a fault would be
 * contradicting its own knowledge — the class of defect this codebase keeps recording, where one
 * rule disagrees with a considered decision taken elsewhere in the system.
 *
 * One feature answers to it today and that is the right number: a fire pit, a pergola, a dining
 * terrace and a store all belong beside the open ground rather than marooned in the middle of it.
 */
const OPEN_GROUND_FEATURES = new Set(
  RELATIONSHIP_RULES.filter((rule) => rule.kind === 'preferNear' && rule.object === 'lawn').map(
    (rule) => rule.subject,
  ),
);

/** How far a route must run *inside* a panel before its shape is worth asking about, in metres. */
const CROSSING_LENGTH = 2;

/**
 * How much of a panel has to lie either side of a route's line before it is cut in two.
 *
 * The measurement that separates a path run down the edge of the lawn from one cut across it, and
 * the reason a plain "does it touch the grass" test is wrong: the generator's own service path hugs
 * the lawn's left-hand edge for five metres, which is exactly what a well-composed plan does. What
 * reads as a scar is a line with lawn on *both* sides of it.
 */
const BISECT_SHARE = 0.2;

/** How close a route has to stay to the primary axis, along its whole length, to be the axis. */
const AXIS_TOLERANCE = 0.8;

/** Under this a built thing is a detail rather than a mass, and cannot be an island. */
const ISLAND_AREA = 2;

/**
 * A built thing further than this from everything is an island.
 *
 * Three quarters of a metre rather than a hand's breadth, because the gallery's own convention is
 * that a route arrives a little over half a metre off the face of what it serves — a shed reached by
 * a path that stops 0.55 m short of it is not floating.
 */
const ISLAND_CLEARANCE = 0.75;

/** Under this a built thing does not count towards where the weight of the plan sits. */
const MASS_AREA = 4;

/** How far the built masses' centroid may sit from the room's centre line, as a share of half its width. */
const ONE_SIDED = 0.45;

/** A concave corner sharper than this is an inside corner; gentler is a curve. */
const SHARP_TURN = 25;

/** A turn under this is a straight line with a vertex in it. */
const COLLINEAR = 3;

/** Inside corners past which an open panel reads as the leftover rather than the shape. */
const REFLEX_MAJOR = 3;

/** Perimeter² over 4πA: 1 for a circle, 1.27 for a square, 1.5 for a rect notched twice. */
const IQ_MINOR = 2.2;
const IQ_MAJOR = 3;

/** Under this share of the ground the minority geometry is an accent rather than a mixture. */
const MIXED_SHARE = 0.15;

/** Degrees off the frame's bearing an edge may sit and still be straight. */
const ALIGNED = 3;

/** Edges shorter than this are a rounded corner's facets and say nothing about the language. */
const LANGUAGE_EDGE = 0.5;

/** A route the composition drew to be walked for pleasure, which may cross what it likes. */
const DECORATIVE = 'decorative-route';

/** The categories that are *built*: things a person placed, standing on the ground. */
const BUILT: ElementCategory[] = ['paved-area', 'gravel-mulch', 'structure', 'water-feature'];

export function scoreComposition(subject: DesignSubject): PrincipleResult {
  const issues: MeasuredIssue[] = [];
  const parts: number[] = [];

  const built = subject.items.filter(
    (item) => BUILT.includes(item.category) && item.symbol !== 'steps',
  );

  const onPanel = openSpace(subject, built, issues, parts);
  crossings(subject, issues, parts);
  islands(subject, built, onPanel, issues, parts);
  purposes(subject, issues, parts);
  balance(subject, built, issues, parts);
  panelShape(subject, issues, parts);
  languages(subject, built, issues, parts);

  return parts.length > 0 ? { score: meanOf(parts), issues } : NOT_APPLICABLE;
}

/* ---------------------------------------------------------------- open space */

function openSpace(
  subject: DesignSubject,
  built: SubjectItem[],
  issues: MeasuredIssue[],
  parts: number[],
): Set<string> {
  const flagged = new Set<string>();
  const candidates = built.filter(
    (item) => !(item.feature && OPEN_GROUND_FEATURES.has(item.feature)),
  );
  if (candidates.length === 0 || subject.panels.length === 0) return flagged;

  for (const item of candidates) {
    const samples = [item.centre, ...item.ring];
    let worst: SubjectRegion | null = null;
    let share = 0;
    for (const panel of subject.panels) {
      const inside = samples.filter((point) => pointInPolygon(point, panel.ring)).length;
      const fraction = inside / samples.length;
      if (fraction > share) {
        share = fraction;
        worst = panel;
      }
    }
    if (!worst || share < IN_OPEN_SPACE) continue;

    flagged.add(item.id);
    issues.push({
      code: 'feature-in-open-space',
      principle: 'composition',
      severity: 'major',
      message: `${label(item)} stands on the ${ground(worst)} rather than in a bay beside it.`,
      subjects: [item.id, worst.id],
      repair: 'move-to-zone',
      guidance: {
        awayFrom: [worst.id],
        ...(item.feature ? { preferZone: FEATURE_LIBRARY[item.feature].zone } : {}),
      },
    });
  }

  parts.push(1 - flagged.size / candidates.length);
  return flagged;
}

/* ---------------------------------------------------------------- crossings */

function crossings(subject: DesignSubject, issues: MeasuredIssue[], parts: number[]): void {
  const lawns = subject.panels.filter((panel) => panel.category === 'lawn');
  if (subject.routes.length === 0 || lawns.length === 0) return;

  const axis = subject.analysis.primaryAxis;
  let crossing = 0;

  for (const route of subject.routes) {
    if (route.purpose === DECORATIVE) continue;
    if (axis && isAxial(route, axis)) continue;

    for (const lawn of lawns) {
      const inside = lengthInside(route.centreline, lawn.ring);
      if (inside < CROSSING_LENGTH) continue;
      if (!bisects(route, lawn.ring)) continue;

      crossing += 1;
      issues.push({
        code: 'route-crosses-panel',
        principle: 'composition',
        severity: 'major',
        message: `${route.name} runs ${inside.toFixed(1)} m across the lawn rather than round its edge.`,
        subjects: [route.id, lawn.id],
        repair: 'reroute',
        guidance: { avoid: [lawn.id] },
      });
      break;
    }
  }

  parts.push(1 - crossing / subject.routes.length);
}

/** Every vertex within `AXIS_TOLERANCE` of the line from the doors down the garden. */
function isAxial(route: SubjectRoute, axis: { from: Point; to: Point }): boolean {
  return route.centreline.every(
    (point) => distanceToSegment(point, axis.from, axis.to) <= AXIS_TOLERANCE,
  );
}

/**
 * Does the route's line cut this panel in two, or run along the side of it?
 *
 * Measured on the chord between the route's ends rather than on its strip: a path that wanders has
 * the same effect on the ground it divides as a straight one between the same two points. The answer
 * is the *smaller* share of the lawn's **area** — a line with 4% of the lawn on one side of it is an
 * edge, one with 40% is a scar.
 *
 * Area, not perimeter. The first version counted densified outline points, and a path a metre and a
 * half in from the lawn's side has that whole short side's outline beside it: 29% of the perimeter
 * for 14% of the grass, so an edge path read as a cut.
 */
function bisects(route: SubjectRoute, ring: Point[]): boolean {
  const from = route.centreline[0]!;
  const to = route.centreline[route.centreline.length - 1]!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-6) return false;

  let left = 0;
  let right = 0;
  for (const point of gridInside(ring, 0.25)) {
    const side = (point.x - from.x) * dy - (point.y - from.y) * dx;
    if (side > 1e-9) left += 1;
    else if (side < -1e-9) right += 1;
  }

  const total = left + right;
  return total > 0 && Math.min(left, right) / total >= BISECT_SHARE;
}

/** Cell centres of a `step` grid over the ring's bounding box that fall inside it. */
function gridInside(ring: Point[], step: number): Point[] {
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  const points: Point[] = [];
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      if (pointInPolygon({ x, y }, ring)) points.push({ x, y });
    }
  }
  return points;
}

/** How many metres of a centreline lie inside a ring, sampled every quarter metre. */
function lengthInside(centreline: Point[], ring: Point[]): number {
  const STEP = 0.25;
  let inside = 0;
  for (let i = 1; i < centreline.length; i += 1) {
    const a = centreline[i - 1]!;
    const b = centreline[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const samples = Math.max(1, Math.ceil(length / STEP));
    for (let s = 0; s < samples; s += 1) {
      const t = (s + 0.5) / samples;
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (pointInPolygon(point, ring)) inside += length / samples;
    }
  }
  return inside;
}

/* ---------------------------------------------------------------- islands */

function islands(
  subject: DesignSubject,
  built: SubjectItem[],
  onPanel: Set<string>,
  issues: MeasuredIssue[],
  parts: number[],
): void {
  const candidates = built.filter((item) => item.area >= ISLAND_AREA && !onPanel.has(item.id));
  if (candidates.length === 0) return;

  const { analysis } = subject;
  /*
   * The fence is a *line* to stand beside, not an area to stand in. Every feature is inside the
   * plot, and `polygonsIntersect` counts containment as overlap, so measuring against the boundary
   * as a ring made every feature touch it and nothing could ever be an island. Its edges are
   * measured on their own, below.
   */
  const fence = (ring: Point[]) => edgeDistance(ring, analysis.boundary);
  const ground: Point[][] = [
    ...(analysis.house ? [analysis.house.ring] : []),
    ...subject.panels.map((panel) => panel.ring),
    ...subject.beds.map((bed) => bed.ring),
    ...subject.routes.map((route) => route.ring),
  ];

  let count = 0;
  for (const item of candidates) {
    const others = built.filter((other) => other.id !== item.id);
    const rings = [...ground, ...others.map((other) => other.ring)];
    const nearest = Math.min(
      fence(item.ring),
      ...rings.map((ring) => ringDistance(item.ring, ring)),
    );
    if (nearest <= ISLAND_CLEARANCE) continue;

    count += 1;
    const neighbour = others
      .map((other) => ({ other, distance: ringDistance(item.ring, other.ring) }))
      .sort((a, b) => a.distance - b.distance)[0];
    issues.push({
      code: 'hard-island',
      principle: 'composition',
      severity: 'major',
      message: `${label(item)} stands ${nearest.toFixed(1)} m from anything else: an island in the ground.`,
      subjects: [item.id],
      repair: 'move-to-zone',
      guidance: neighbour ? { near: [neighbour.other.id], nearM: 1 } : { nearAnchor: 'house' },
    });
  }

  parts.push(1 - count / candidates.length);
}

/** The gap between two rings; nought when they touch or overlap. */
function ringDistance(a: Point[], b: Point[]): number {
  if (polygonsIntersect(a, b)) return 0;
  return edgeDistance(a, b);
}

/** The nearest approach of two outlines, as lines, whatever lies inside which. */
function edgeDistance(a: Point[], b: Point[]): number {
  let best = Infinity;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const point of from) {
      for (let i = 0; i < to.length; i += 1) {
        best = Math.min(best, distanceToSegment(point, to[i]!, to[(i + 1) % to.length]!));
      }
    }
  }
  return best;
}

/* ---------------------------------------------------------------- purpose */

function purposes(subject: DesignSubject, issues: MeasuredIssue[], parts: number[]): void {
  /* Only on a plan that carries the vocabulary at all. */
  if (!subject.elements.some((element) => element.purpose)) return;

  const features: { id: string; name: string; purpose: string | null }[] = [
    ...subject.items.filter((item) => item.category !== 'existing-feature'),
    ...subject.routes,
  ];
  if (features.length === 0) return;

  const orphans = features.filter((feature) => !feature.purpose);
  parts.push(1 - orphans.length / features.length);
  if (orphans.length === 0) return;

  issues.push({
    code: 'orphan-feature',
    principle: 'composition',
    severity: 'minor',
    message: `${orphans.length === 1 ? 'One thing' : `${orphans.length} things`} on the plan ${orphans.length === 1 ? 'answers' : 'answer'} to no purpose in the composition: ${orphans
      .slice(0, 4)
      .map((orphan) => orphan.name || 'an unnamed feature')
      .join(', ')}.`,
    subjects: orphans.slice(0, 8).map((orphan) => orphan.id),
    repair: 'drop-optional',
  });
}

/* ---------------------------------------------------------------- balance */

function balance(
  subject: DesignSubject,
  built: SubjectItem[],
  issues: MeasuredIssue[],
  parts: number[],
): void {
  const { frame, box } = subject.analysis;
  if (!frame || !box) return;
  if (styleRules(subject.brief.style).symmetry === 'required') return;

  const masses = built.filter((item) => item.area >= MASS_AREA && item.category !== 'water-feature');
  if (masses.length < 2) return;

  const half = (box.vMax - box.vMin) / 2;
  if (half <= 0) return;
  const middle = (box.vMax + box.vMin) / 2;

  let moment = 0;
  let total = 0;
  const across = new Map<string, number>();
  for (const mass of masses) {
    const v = frame.toLocal(mass.centre).v - middle;
    across.set(mass.id, v);
    moment += mass.area * v;
    total += mass.area;
  }

  const offset = Math.abs(moment) / (total * half);
  parts.push(clamp01(1 - Math.max(0, offset - 0.2) / 0.4));
  if (offset <= ONE_SIDED) return;

  const sign = Math.sign(moment);
  const heavy = masses.filter((mass) => Math.sign(across.get(mass.id) ?? 0) === sign);
  issues.push({
    code: 'one-sided',
    principle: 'composition',
    severity: 'minor',
    message: `The built spaces sit ${pct(offset)} of the way to one side of the garden: ${heavy
      .slice(0, 4)
      .map(label)
      .join(', ')}.`,
    subjects: heavy.slice(0, 8).map((mass) => mass.id),
    repair: 'move-to-zone',
    guidance: { awayFrom: heavy.slice(0, 8).map((mass) => mass.id) },
  });
}

/* ---------------------------------------------------------------- panel shape */

function panelShape(subject: DesignSubject, issues: MeasuredIssue[], parts: number[]): void {
  for (const panel of subject.panels.filter((candidate) => candidate.area >= MASS_AREA)) {
    const ring = simplify(panel.ring);
    if (ring.length < 3) continue;

    const reflex = reflexCorners(ring);
    const perimeter = polylineLength([...ring, ring[0]!]);
    const quotient = (perimeter * perimeter) / (4 * Math.PI * panel.area);

    parts.push(
      Math.min(
        clamp01(1 - Math.max(0, reflex - 2) / 4),
        clamp01(1 - Math.max(0, quotient - IQ_MINOR) / (IQ_MAJOR - IQ_MINOR + 0.8)),
      ),
    );

    const major = reflex > REFLEX_MAJOR || quotient > IQ_MAJOR;
    const minor = reflex === REFLEX_MAJOR || quotient > IQ_MINOR;
    if (!major && !minor) continue;

    issues.push({
      code: 'panel-complexity',
      principle: 'composition',
      severity: major ? 'major' : 'minor',
      message: `The ${ground(panel)} has ${reflex} inside corner${reflex === 1 ? '' : 's'} and ${quotient.toFixed(1)}× the outline a compact shape of its area would have: it is the ground left over rather than a shape.`,
      subjects: [panel.id],
      repair: 'enlarge-lawn',
      /* The size is right; the shape is not. A factor of one says "the same ground, simpler". */
      guidance: { targetAreaFactor: 1 },
    });
  }
}

/** The ring with collinear vertices and zero-length edges removed. */
function simplify(ring: Point[]): Point[] {
  const distinct = ring.filter((point, i) => {
    const previous = ring[(i + ring.length - 1) % ring.length]!;
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-6;
  });
  if (distinct.length < 3) return distinct;

  return distinct.filter((point, i) => {
    const before = distinct[(i + distinct.length - 1) % distinct.length]!;
    const after = distinct[(i + 1) % distinct.length]!;
    return Math.abs(turnDegrees(before, point, after)) > COLLINEAR;
  });
}

/** How many corners turn inwards by more than `SHARP_TURN`. */
function reflexCorners(ring: Point[]): number {
  let signed = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    signed += a.x * b.y - b.x * a.y;
  }
  const orientation = Math.sign(signed) || 1;

  let reflex = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const before = ring[(i + ring.length - 1) % ring.length]!;
    const point = ring[i]!;
    const after = ring[(i + 1) % ring.length]!;
    const turn = turnDegrees(before, point, after);
    if (Math.sign(turn) === -orientation && Math.abs(turn) > SHARP_TURN) reflex += 1;
  }
  return reflex;
}

/** The signed change of heading at `point`, in degrees; positive is the ring's own winding. */
function turnDegrees(before: Point, point: Point, after: Point): number {
  const inX = point.x - before.x;
  const inY = point.y - before.y;
  const outX = after.x - point.x;
  const outY = after.y - point.y;
  const cross = inX * outY - inY * outX;
  const dot = inX * outX + inY * outY;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

/* ---------------------------------------------------------------- geometry language */

function languages(
  subject: DesignSubject,
  built: SubjectItem[],
  issues: MeasuredIssue[],
  parts: number[],
): void {
  const frame = subject.analysis.frame;
  if (!frame) return;

  const shapes: { id: string; name: string; area: number; straight: boolean }[] = [
    ...subject.panels.map((panel) => ({
      id: panel.id,
      name: ground(panel),
      area: panel.area,
      straight: isStraight(panel.ring, frame.wallBearing),
    })),
    ...subject.beds.map((bed) => ({
      id: bed.id,
      name: 'a planting bed',
      area: bed.area,
      straight: isStraight(bed.ring, frame.wallBearing),
    })),
    ...built
      .filter((item) => item.area >= MASS_AREA)
      .map((item) => ({
        id: item.id,
        name: label(item),
        area: item.area,
        straight: isStraight(item.ring, frame.wallBearing),
      })),
  ];
  if (shapes.length < 2) return;

  const total = shapes.reduce((sum, shape) => sum + shape.area, 0);
  if (total <= 0) return;
  const straight = shapes.filter((shape) => shape.straight).reduce((sum, s) => sum + s.area, 0);
  const curved = total - straight;
  const minority = Math.min(straight, curved) / total;

  parts.push(clamp01(1 - minority / 0.5));
  if (minority <= MIXED_SHARE) return;

  const straightIsMinority = straight < curved;
  const offenders = shapes.filter((shape) => shape.straight === straightIsMinority);
  issues.push({
    code: 'geometry-mixed',
    principle: 'composition',
    severity: 'minor',
    message: `${pct(minority)} of the designed ground is ${straightIsMinority ? 'straight-edged' : 'curved or angled'} in a plan that is otherwise ${straightIsMinority ? 'curved' : 'straight'}: ${offenders
      .slice(0, 3)
      .map((shape) => shape.name)
      .join(', ')}.`,
    subjects: offenders.slice(0, 8).map((shape) => shape.id),
  });
}

/** Every edge worth reading runs along the house or square to it. */
function isStraight(ring: Point[], bearing: number): boolean {
  const simplified = simplify(ring);
  for (let i = 0; i < simplified.length; i += 1) {
    const a = simplified[i]!;
    const b = simplified[(i + 1) % simplified.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.hypot(dx, dy) < LANGUAGE_EDGE) continue;
    const heading = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (offAxis(heading, bearing) > ALIGNED) return false;
  }
  return true;
}

/* ---------------------------------------------------------------- words */

function label(item: SubjectItem): string {
  return item.name || item.feature || 'A feature';
}

function ground(panel: SubjectRegion): string {
  return panel.category === 'lawn' ? 'lawn' : 'open gravel';
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
