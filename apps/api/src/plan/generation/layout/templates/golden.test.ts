import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LayoutSketch, Room, SketchRequest } from '../sketch.js';
import { TEMPLATE_ORDER, TEMPLATES } from './index.js';

/**
 * The three templates, pinned exactly, so the archetype refactor can be proved to change nothing.
 *
 * **Temporary, and it says so here rather than in a commit message.** Phase 2 turns the three
 * layout templates into archetypes that read a zone plan and take parameters; every one of those
 * changes is supposed to be a pure restructuring at the default parameters, and the only way to be
 * sure is to compare against what they drew before anybody touched them. It is deleted when the
 * candidate loop lands in Phase 3 and the sketches start varying on purpose.
 *
 * **Structure exactly, numbers to 1e-9.** Not `toEqual`: anchors are computed directly today
 * (`{ u: farRoom.u, v: farV(b + 2.1 * s) }`) and will be read back out of a stored rectangle
 * afterwards, so `(u0 + u1) / 2` differs from the original in the last bit for reasons that are
 * arithmetic rather than design. Ids, order, names, kinds and counts have to match to the letter;
 * the numbers have to match to a nanometre. A refactor that moves a slot by a centimetre fails.
 *
 * Regenerate with `CAPTURE_TEMPLATE_GOLDEN=1`, and only ever with a reason.
 */

const GOLDEN = resolve(__dirname, 'golden.sketches.json');

function request(over: Partial<SketchRequest> = {}): SketchRequest {
  return {
    features: ['seating', 'storage', 'firePit'],
    scale: 1,
    style: 'modern',
    lawnAllowed: true,
    gateSide: 'right',
    houseWallLength: 8,
    doorWidth: 2.4,
    ...over,
  };
}

function room(over: Partial<Room> = {}): Room {
  return { uMin: 0, uMax: 14, vMin: -7, vMax: 7, ...over };
}

/**
 * The inputs, chosen so every branch in every template is exercised at least once.
 *
 * A template is a pile of conditionals on scale, gate side, room shape and what was asked for, and
 * a golden file that only covers the suburban rectangle pins the one case nobody was going to break.
 */
const CASES: { name: string; request: SketchRequest; room: Room }[] = [
  { name: 'suburban', request: request(), room: room() },
  { name: 'gate-left', request: request({ gateSide: 'left' }), room: room() },
  { name: 'no-gate', request: request({ gateSide: null }), room: room() },
  { name: 'small', request: request({ scale: 0.7 }), room: room({ uMax: 8, vMin: -4, vMax: 4 }) },
  {
    name: 'large',
    request: request({ scale: 2.1 }),
    room: room({ uMax: 26, vMin: -13, vMax: 13 }),
  },
  {
    name: 'courtyard',
    request: request({ scale: 0.6 }),
    room: room({ uMax: 4.5, vMin: -3.5, vMax: 3.5 }),
  },
  {
    name: 'wide-shallow',
    request: request({ houseWallLength: 11 }),
    room: room({ uMax: 6, vMin: -11, vMax: 11 }),
  },
  { name: 'long-narrow', request: request(), room: room({ uMax: 24, vMin: -3, vMax: 3 }) },
  {
    name: 'no-lawn',
    request: request({ lawnAllowed: false, style: 'lowMaintenance' }),
    room: room(),
  },
  {
    name: 'off-centre-door',
    request: request({ doorWidth: 0.9 }),
    room: room({ vMin: -2.5, vMax: 11.5 }),
  },
  {
    name: 'every-feature',
    request: request({
      features: ['seating', 'dining', 'pergola', 'outdoorKitchen', 'storage', 'vegPatch', 'water'],
    }),
    room: room({ uMax: 18, vMin: -9, vMax: 9 }),
  },
  {
    name: 'l-shaped-room',
    request: request(),
    room: room({
      uMax: 18,
      vMin: -7,
      vMax: 7,
      /* The deep limb on the right: what `roomBehind` exists to find. */
      polygon: [
        { u: 0, v: -7 },
        { u: 9, v: -7 },
        { u: 9, v: 0 },
        { u: 18, v: 0 },
        { u: 18, v: 7 },
        { u: 0, v: 7 },
      ],
    }),
  },
  { name: 'cottage', request: request({ style: 'cottage' }), room: room() },
  { name: 'formal-style', request: request({ style: 'formal' }), room: room() },
];

function capture(): Record<string, LayoutSketch> {
  const sketches: Record<string, LayoutSketch> = {};
  for (const item of CASES) {
    for (const template of TEMPLATE_ORDER) {
      sketches[`${item.name}/${template}`] = TEMPLATES[template](item.request, item.room);
    }
  }
  return sketches;
}

/** Everything but the numbers: ids, order, names, kinds, counts, flags. */
function structureOf(value: unknown): unknown {
  if (typeof value === 'number') return '#';
  if (Array.isArray(value)) return value.map(structureOf);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, structureOf(inner)]),
    );
  }
  return value;
}

/** Every number in the tree, in a stable order, so two sketches can be compared numerically. */
function numbersOf(value: unknown, into: number[] = []): number[] {
  if (typeof value === 'number') into.push(value);
  else if (Array.isArray(value)) for (const inner of value) numbersOf(inner, into);
  else if (value && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      numbersOf((value as Record<string, unknown>)[key], into);
    }
  }
  return into;
}

describe('the layout templates are unchanged by the archetype refactor', () => {
  const current = capture();

  if (process.env.CAPTURE_TEMPLATE_GOLDEN === '1') {
    it('captures the golden sketches', () => {
      writeFileSync(GOLDEN, `${JSON.stringify(current, null, 2)}\n`);
      expect(Object.keys(current).length).toBe(CASES.length * TEMPLATE_ORDER.length);
    });
    return;
  }

  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, LayoutSketch>;

  it('draws the same set of sketches', () => {
    expect(Object.keys(current).sort()).toEqual(Object.keys(golden).sort());
  });

  for (const key of Object.keys(golden)) {
    it(`${key} keeps its structure exactly`, () => {
      expect(structureOf(current[key])).toEqual(structureOf(golden[key]));
    });

    it(`${key} keeps every number to a nanometre`, () => {
      const before = numbersOf(golden[key]);
      const after = numbersOf(current[key]);
      expect(after.length).toBe(before.length);
      for (let i = 0; i < before.length; i += 1) {
        expect(Math.abs(after[i]! - before[i]!), `number ${i}`).toBeLessThan(1e-9);
      }
    });
  }
});
