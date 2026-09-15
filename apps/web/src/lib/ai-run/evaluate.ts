import {
  boundingBox,
  geometryAnchor,
  geometryOutline,
  polygonCentroid,
  type AgentRole,
  type DesignElement,
  type Point,
  type RunPhase,
} from '@garden-studio/schema';
import { CURSOR_TRAVEL, clamp01, easeInOutCubic, easeOutBack, easeOutCubic, lerpPoint, progress, windowFade } from './easing';
import { alignRings, matchVertexCount, polylineLength, prefixAlongLength, transformGeometry } from './interpolate';
import type { CompiledLeaf, PreparedRun } from './prepare';

/**
 * Everything on screen at one instant of a run, as a pure function of the clock.
 *
 * This is the whole design in one signature. Nothing here reads the store, sets a timer or touches
 * a canvas, so a nineteen-second redesign can be asserted frame by frame in a Node test — and
 * Replay, Compare and scrubbing are not features to build but the same function called with a
 * different `t`.
 *
 * What it returns is strictly presentation. `motion` carries valid `DesignElement`s because that
 * costs nothing and keeps the "geometry is always real" rule true even of the throwaway frames, but
 * none of it is ever written to the plan: the executor commits only the pre-resolved result of an
 * operation, at its boundary.
 */

export interface MotionEntry {
  /** Distinct from the element id: a reroute draws the old route and the new one at once. */
  key: string;
  element: DesignElement;
  opacity: number;
  /** Applied to the Konva node, never to the geometry — see `easeOutBack`. */
  scale: number;
  /**
   * Whether this stands in for an element the plan already has.
   *
   * The ones that do are handed to the real renderer in place of the settled element, so a terrace
   * being enlarged goes on being drawn in its own paving rather than turning into a flat shape for
   * the second it is moving. The ones that do not — something being added, something fading out,
   * the old route while a new one is drawn along — cannot be expressed that way (they are not on
   * the plan, or they need an opacity the scene has nowhere to put), so they are drawn over the top
   * instead.
   */
  replacesSettled: boolean;
}

export type RunOverlay =
  | { kind: 'selection'; key: string; outline: Point[]; box: Box; handles: boolean; alpha: number }
  | { kind: 'ghost'; key: string; outline: Point[]; from: Point; to: Point; travel: number; alpha: number }
  | { kind: 'vertices'; key: string; points: Point[]; alpha: number }
  | { kind: 'route'; key: string; points: Point[]; reveal: number; alpha: number }
  | { kind: 'frame'; key: string; box: Box; alpha: number }
  | { kind: 'scan'; key: string; y: number; passed: Point[][]; alpha: number };

export interface Box {
  minX: number;
  minY: number;
  width: number;
  length: number;
}

export interface RunFrame {
  t: number;
  /** How many top-level operations have finished; the executor commits `stateAfter` of the last. */
  settledIndex: number;
  motion: MotionEntry[];
  /** Element ids the settled scene must not draw, because `motion` is drawing them instead. */
  suppress: string[];
  overlays: RunOverlay[];
  cursor: Point | null;
  chip: string | null;
  phase: RunPhase | null;
  agent: AgentRole | null;
  /** What the panel says this agent is doing. */
  status: string | null;
  done: boolean;
}

const VERTEX_LEAD = 300;

function boxOf(points: Point[]): Box {
  const box = boundingBox(points);
  return { minX: box.minX, minY: box.minY, width: box.width, length: box.length };
}

/** Where the cursor should be looking while an operation runs. */
function focusOf(leaf: CompiledLeaf, fallback: Point): Point {
  const { operation, outcome } = leaf;
  if (outcome.ok && 'after' in outcome) return geometryAnchor(outcome.after.shape);
  if (outcome.ok && 'before' in outcome) return geometryAnchor(outcome.before.shape);
  if (leaf.before) return geometryAnchor(leaf.before.shape);
  if (operation.kind === 'inspect') return fallback;
  return fallback;
}

/**
 * The crosshair's path.
 *
 * Built from where the operations are rather than from anything the script says, so an author
 * cannot leave the cursor pointing at the wrong thing — and an agent writing operations does not
 * have to know the cursor exists. It sets off `CURSOR_TRAVEL` before the operation it is about to
 * work on, which is what makes the movement read as attention rather than as a teleport.
 */
function cursorAt(prepared: PreparedRun, t: number, centre: Point): Point | null {
  const keys: { t: number; at: Point; travel: number }[] = [];

  for (const operation of prepared.operations) {
    const leaf = operation.leaves.find((candidate) => candidate.outcome.ok) ?? operation.leaves[0];
    if (!leaf) continue;

    const at = focusOf(leaf, centre);
    keys.push({ t: operation.start, at, travel: CURSOR_TRAVEL });

    /* A move leads the eye: the cursor travels with the thing rather than waiting at its old home. */
    if (leaf.operation.kind === 'move' && leaf.outcome.ok && 'before' in leaf.outcome)
      keys.push({ t: leaf.end, at, travel: Math.max(1, leaf.end - leaf.start) });
  }

  const first = keys[0];
  if (!first) return null;

  let position = first.at;
  for (const key of keys.slice(1)) {
    const eased = easeInOutCubic(progress(t, key.t - key.travel, key.travel));
    if (eased <= 0) break;
    position = lerpPoint(position, key.at, eased);
  }
  return position;
}

/** One label at a time, held until the next one is due. */
function chipAt(prepared: PreparedRun, t: number): { label: string; agent: AgentRole; phase: RunPhase; status: string | null } | null {
  let current: PreparedRun['operations'][number] | null = null;
  for (const operation of prepared.operations)
    if (t >= operation.start - 100 && operation.end > 0) current = operation;

  if (!current) return null;
  return {
    label: current.operation.label,
    agent: current.operation.agent,
    phase: current.operation.phase,
    status: current.operation.reason ?? null,
  };
}

/** Where an operation's named elements are, as the plan stands at this instant. */
export type Lookup = (ref: string) => DesignElement | null;

function overlaysFor(
  leaf: CompiledLeaf,
  t: number,
  plot: Point[],
  look: Lookup,
  /** This instant's geometry for the thing being worked on, where something is moving. */
  live: DesignElement | null,
): RunOverlay[] {
  const { operation, outcome, start, end } = leaf;
  if (!outcome.ok) return [];

  const out: RunOverlay[] = [];
  const alpha = windowFade(t, start, end);
  const subject = outcome.effect === 'replace' || outcome.effect === 'delete' ? outcome.before : null;

  switch (operation.kind) {
    case 'analyse': {
      const p = progress(t, start, end - start);
      if (p <= 0 || p >= 1) break;
      const box = boxOf(plot);
      const y = box.minY - 0.5 + (box.length + 1) * p;
      out.push({ kind: 'scan', key: operation.id, y, passed: [], alpha: Math.min(1, p * 6, (1 - p) * 6) });
      break;
    }
    case 'select': {
      if (!subject) break;
      const outline = geometryOutline(subject.shape);
      out.push({ kind: 'selection', key: operation.id, outline, box: boxOf(outline),
        handles: subject.shape.kind === 'rect', alpha });
      break;
    }
    case 'inspect': {
      const p = progress(t, start, end - start);
      if (p <= 0 || p >= 1) break;

      /*
       * One frame gliding between the things being looked at, rather than a frame round each.
       * Three boxes at once is a diagram of a checklist; one box moving is somebody looking.
       */
      const boxes = operation.elementIds
        .map((ref) => look(ref))
        .filter((element): element is DesignElement => element !== null)
        .map((element) => boxOf(geometryOutline(element.shape)));
      if (boxes.length === 0) break;

      const leg = Math.min(Math.floor(p * boxes.length), boxes.length - 1);
      const q = easeInOutCubic(clamp01(p * boxes.length - leg));
      const a = boxes[leg]!;
      const b = boxes[Math.min(leg + 1, boxes.length - 1)]!;

      out.push({ kind: 'frame', key: operation.id, alpha: Math.min(1, p * 8, (1 - p) * 8), box: {
        minX: a.minX + (b.minX - a.minX) * q,
        minY: a.minY + (b.minY - a.minY) * q,
        width: a.width + (b.width - a.width) * q,
        length: a.length + (b.length - a.length) * q,
      } });
      break;
    }
    case 'move': {
      if (!subject || outcome.effect !== 'replace') break;
      if (!operation.ghost) break;
      const target = geometryOutline(outcome.after.shape);
      out.push({ kind: 'ghost', key: operation.id, outline: target,
        from: geometryAnchor(subject.shape), to: geometryAnchor(outcome.after.shape),
        travel: easeInOutCubic(progress(t, start, end - start)),
        alpha: windowFade(t, start - VERTEX_LEAD, end) });
      break;
    }
    case 'reshape': {
      if (outcome.effect !== 'replace') break;
      const to = outcome.after.shape;
      const from = outcome.before.shape;
      if (to.kind !== 'polygon' || from.kind !== 'polygon') break;

      /*
       * The vertices appear a moment before the outline starts moving and stay a moment after it
       * stops, which is what makes a reshape read as an edit rather than as the bed melting: you
       * see the handles being taken hold of, then the corners going where they were put.
       *
       * **Only the ones that actually move.** A sweeping lawn is a twenty-eight point ellipse, and
       * marking every corner of it to show that four of them moved covers the garden in dots and
       * says nothing. The corners a designer would have taken hold of are the ones going somewhere.
       */
      const span = progress(t, start, end - start);
      const moving = transformGeometry(from, to, span);
      if (moving.kind !== 'polygon') break;

      const count = moving.points.length;
      const origin = matchVertexCount(from.points, count);
      const target = alignRings(origin, matchVertexCount(to.points, count));
      const handles = moving.points.filter((_point, index) => {
        const a = origin[index];
        const b = target[index];
        return a && b && Math.hypot(b.x - a.x, b.y - a.y) > 0.05;
      });

      if (handles.length > 0)
        out.push({ kind: 'vertices', key: operation.id, points: handles,
          alpha: windowFade(t, start - VERTEX_LEAD, end + VERTEX_LEAD) });
      break;
    }
    case 'reroute': {
      if (outcome.effect !== 'replace') break;
      const shape = outcome.after.shape;
      if (shape.kind !== 'polyline') break;
      const p = progress(t, start, end - start);
      const reveal = clamp01(p / 0.28);
      const guide = 1 - clamp01((p - 0.85) / 0.15);
      if (guide > 0 && reveal > 0)
        out.push({ kind: 'route', key: operation.id, points: shape.points, reveal, alpha: guide * alpha });
      break;
    }
    default:
      break;
  }

  /*
   * Every geometry operation shows what it is working on, not only `select`. A resize with no
   * outline round it reads as the plan changing by itself, which is the opposite of the point.
   */
  const alreadyOutlined = out.some((overlay) => overlay.kind === 'selection');
  if (subject && operation.kind !== 'select' && operation.kind !== 'analyse' && !alreadyOutlined) {
    /*
     * The outline follows the shape as it changes, rather than jumping to where it is going.
     * Drawn at the target instead, it reads as a second selection sitting around the first — and
     * it quietly claims the terrace is already the size it is only on its way to being.
     */
    const shown = live ?? (outcome.effect === 'replace' ? outcome.after : subject);
    const outline = geometryOutline(shown.shape);
    out.push({ kind: 'selection', key: `${operation.id}:sel`, outline, box: boxOf(outline),
      handles: shown.shape.kind === 'rect', alpha: alpha * 0.9 });
  }

  return out;
}

/** What one operation is drawing at `t`, if it is drawing anything. */
function motionFor(leaf: CompiledLeaf, t: number): MotionEntry[] {
  const { operation, outcome, start, end } = leaf;
  if (!outcome.ok || t < start || t > end) return [];

  const span = end - start;
  const p = progress(t, start, span);

  switch (operation.kind) {
    case 'move':
    case 'resize':
    case 'rotate':
    case 'reshape': {
      if (outcome.effect !== 'replace') return [];
      const from = outcome.before.shape;
      return [{
        key: operation.id,
        element: { ...outcome.after, shape: transformGeometry(from, outcome.after.shape, p) },
        opacity: 1,
        scale: 1,
        replacesSettled: true,
      }];
    }

    case 'reroute': {
      if (outcome.effect !== 'replace') return [];
      const next = outcome.after.shape;
      const previous = outcome.before.shape;
      if (next.kind !== 'polyline' || previous.kind !== 'polyline') return [];

      /*
       * A route is redrawn rather than morphed, which is how a path is actually designed: the line
       * is set out first, then built along. Morphing one route into another slides the whole thing
       * sideways through ground it never crosses.
       */
      const drawn = easeInOutCubic(clamp01((p - 0.28) / 0.57));
      const entries: MotionEntry[] = [
        { key: `${operation.id}:old`, element: outcome.before, opacity: 1 - drawn, scale: 1,
          replacesSettled: false },
      ];
      if (drawn > 0) {
        const points = prefixAlongLength(next.points, polylineLength(next.points) * drawn);
        entries.push({
          key: `${operation.id}:new`,
          element: { ...outcome.after, shape: { ...next, points } },
          opacity: 1,
          scale: 1,
          replacesSettled: false,
        });
      }
      return entries;
    }

    case 'add': {
      if (outcome.effect !== 'append') return [];
      return [{
        key: operation.id,
        element: outcome.after,
        opacity: Math.min(1, p * 3),
        scale: easeOutBack(p),
        replacesSettled: false,
      }];
    }

    case 'remove': {
      if (outcome.effect !== 'delete') return [];
      return [{ key: operation.id, element: outcome.before, opacity: 1 - easeOutCubic(p), scale: 1,
        replacesSettled: false }];
    }

    default:
      return [];
  }
}

export function evaluateRun(prepared: PreparedRun, t: number, plot: Point[] = []): RunFrame {
  const settledIndex = prepared.operations.filter((operation) => t >= operation.end).length;
  const centre = plot.length >= 3 ? polygonCentroid(plot) : { x: 0, y: 0 };

  /* What the plan looks like right now, for anything that has to find an element by name. */
  const settled = prepared.operations[settledIndex - 1]?.stateAfter ?? prepared.initial;
  const look: Lookup = (ref) => {
    const id = ref.startsWith('$') ? prepared.bindings[ref] : ref;
    return id ? (settled.find((element) => element.id === id) ?? null) : null;
  };

  const motion: MotionEntry[] = [];
  const overlays: RunOverlay[] = [];
  const suppress = new Set<string>();

  for (const operation of prepared.operations) {
    if (t < operation.start - VERTEX_LEAD || t > operation.end + VERTEX_LEAD) continue;

    for (const leaf of operation.leaves) {
      const entries = motionFor(leaf, t);
      /* One reading of "where is it now", shared by the motion and the outline drawn round it. */
      const live = entries.find((entry) => entry.replacesSettled)?.element ?? null;

      for (const entry of entries) {
        motion.push(entry);
        /*
         * An element being animated must not also be drawn by the settled scene, or the garden
         * shows two of it — the old one standing where the store still has it, and the moving one
         * on top. An `add` suppresses nothing: it is not on the plan yet.
         */
        if (!entry.replacesSettled && leaf.operation.kind !== 'add') suppress.add(entry.element.id);
      }
      overlays.push(...overlaysFor(leaf, t, plot.length >= 3 ? plot : [], look, live));
    }
  }

  const chip = chipAt(prepared, t);

  return {
    t,
    settledIndex,
    motion,
    suppress: [...suppress],
    overlays,
    cursor: cursorAt(prepared, t, centre),
    chip: chip?.label ?? null,
    phase: chip?.phase ?? null,
    agent: chip?.agent ?? null,
    status: chip?.status ?? null,
    done: t >= prepared.total,
  };
}
