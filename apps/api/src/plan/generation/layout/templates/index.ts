import type { GardenBrief } from '@garden-studio/schema';
import type { LayoutSketch, Room, SketchRequest, TemplateId } from '../sketch.js';
import { curved } from './curved.js';
import { formal } from './formal.js';
import { rectilinear } from './rectilinear.js';

/**
 * The three ways a garden gets laid out, and which of them a brief is recommended.
 *
 * Every set of concepts contains all three, in a fixed slot order, so the user chooses between
 * *shapes of plan* rather than between three rolls of the same one. The brief's style says which
 * slot is the recommendation; the other two are offered as the alternatives a designer would
 * bring along.
 */
export const TEMPLATES: Record<TemplateId, (request: SketchRequest, room: Room) => LayoutSketch> = {
  rectilinear,
  curved,
  formal,
};

export const TEMPLATE_ORDER: TemplateId[] = ['rectilinear', 'curved', 'formal'];

export const TEMPLATE_NAMES: Record<TemplateId, { name: string; summary: string; tone: string }> = {
  rectilinear: {
    name: 'Terrace and lawn',
    summary:
      'A terrace across the doors, one clean lawn set off-centre so the planting runs deeper down one side, and the gathering places in the far corner.',
    tone: 'Structured',
  },
  curved: {
    name: 'Sweeping lawn',
    summary:
      'A flowing lawn that bulges and narrows between deep planted bays, with a path that curves out of sight to a seat at the far end.',
    tone: 'Natural',
  },
  formal: {
    name: 'Formal axis',
    summary:
      'Everything mirrored about the view from the doors: a centred terrace, a paved line down the middle of the lawn, and a focal point at its end.',
    tone: 'Formal',
  },
};

export function templateFor(index: number): TemplateId {
  return TEMPLATE_ORDER[index % TEMPLATE_ORDER.length]!;
}

/** Which slot the brief's style is recommended: its own template. */
export function recommendedIndex(style: GardenBrief['style']): number {
  switch (style) {
    case 'cottage':
      return TEMPLATE_ORDER.indexOf('curved');
    case 'formal':
      return TEMPLATE_ORDER.indexOf('formal');
    default:
      return TEMPLATE_ORDER.indexOf('rectilinear');
  }
}
