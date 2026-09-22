import type { DesignElement, ElementCategory, MaterialId } from '@garden-studio/schema';
import { elementLabel } from './concept-colours';

/**
 * Things you might want to do to the selected subject.
 *
 * A suggestion is a typed **action on the subject**, not a sentence the designer said. Its `action`
 * is a union of a direct edit, a request to the designer and a review, and the inspector renders all
 * three identically — art, title, detail — so a material swap and a natural-language request are
 * the same kind of thing on screen. That is the whole argument of the section: manual control,
 * recommended action and free text are three ways of changing one object, not three features.
 *
 * Everything here is pure and deterministic. It reads the plan (is there lighting already? is this
 * patio already porcelain?) and never the model, so the list is the same on a machine with no key;
 * the component drops the request-kind entries there rather than showing a card that does nothing.
 */

export type Subject = { kind: 'garden' } | { kind: 'element'; element: DesignElement };

export type SuggestionAction =
  /** A sentence for the designer, resolved against the selection the way any typed one is. */
  | { kind: 'request'; text: string }
  /** A direct property edit through the editor store. No model, no key, no run. */
  | { kind: 'material'; material: MaterialId }
  /** The reviewer: a scorer and a planner, no model anywhere in it. */
  | { kind: 'review' };

export type SuggestionArt =
  /** One of the step-3 vignettes, by its `BriefArt.id` (`space-lighting`, `style-modern`). */
  | { kind: 'brief'; id: string }
  /** A material, drawn by the same thumbnail the catalogue uses. */
  | { kind: 'material'; material: MaterialId; category: ElementCategory }
  | { kind: 'icon'; icon: 'sparkles' | 'leaf' | 'sun' | 'check' };

export interface SmartSuggestion {
  id: string;
  title: string;
  detail: string;
  art: SuggestionArt;
  action: SuggestionAction;
}

/** A short prewritten sentence for the composer's chip row. Always a request. */
export interface QuickCommand {
  id: string;
  label: string;
  text: string;
}

export interface SuggestionContext {
  elements: DesignElement[];
}

const hasLighting = (elements: DesignElement[]) =>
  elements.some((element) => element.category === 'lighting');

const hasPergola = (elements: DesignElement[]) =>
  elements.some((element) => element.symbol === 'pergola');

const hasPavedFeature = (elements: DesignElement[]) =>
  elements.some((element) => element.category === 'paved-area' && element.role === 'feature');

const isPlant = (element: DesignElement) =>
  element.category === 'planting-bed' && element.shape.kind === 'point';

const brief = (id: string): SuggestionArt => ({ kind: 'brief', id });

function material(id: MaterialId, category: ElementCategory): SuggestionArt {
  return { kind: 'material', material: id, category };
}

function request(id: string, title: string, detail: string, art: SuggestionArt, text: string) {
  return { id, title, detail, art, action: { kind: 'request', text } } as SmartSuggestion;
}

function swap(
  id: string,
  title: string,
  detail: string,
  to: MaterialId,
  category: ElementCategory,
): SmartSuggestion {
  return { id, title, detail, art: material(to, category), action: { kind: 'material', material: to } };
}

export function suggestionsFor(subject: Subject, context: SuggestionContext): SmartSuggestion[] {
  const { elements } = context;
  if (subject.kind === 'garden') return gardenSuggestions(elements);

  const { element } = subject;
  const name = elementLabel(element);
  const out: SmartSuggestion[] = [];

  switch (element.category) {
    case 'paved-area': {
      if (element.material !== 'porcelain') {
        out.push(
          swap('porcelain', 'Use porcelain paving', 'Modern look · low maintenance', 'porcelain', 'paved-area'),
        );
      } else {
        out.push(
          swap('stone', 'Use natural stone', 'Warmer and more traditional', 'stone-pavers', 'paved-area'),
        );
      }
      if (!hasLighting(elements)) {
        out.push(
          request('lighting', 'Add outdoor lighting', 'Works well around patios', brief('space-lighting'), `Add lighting around ${name}`),
        );
      }
      if (!hasPergola(elements)) {
        out.push(
          request('pergola', 'Add a pergola', 'Create a shaded seating area', brief('space-pergola'), `Add a pergola over ${name}`),
        );
      } else {
        out.push(
          request('planting', 'Plant beside it', 'Softens the edge of the paving', brief('space-plantingBeds'), `Add a planting bed beside ${name}`),
        );
      }
      break;
    }
    case 'lawn': {
      if (element.material === 'standard-turf') {
        out.push(
          swap('hardwearing', 'Hard-wearing turf', 'Stands up to children and dogs', 'hardwearing-turf', 'lawn'),
        );
      }
      out.push(
        request('margin', 'Add a wildflower margin', 'Colour and pollinators along the edge', brief('space-lawn'), `Add a wildflower margin along the edge of ${name}`),
        request('border', 'Border it with planting', 'Frames the lawn and hides the fence', brief('space-plantingBeds'), `Add a planting border around ${name}`),
      );
      break;
    }
    case 'planting-bed': {
      if (isPlant(element)) {
        out.push(
          request('group', 'Plant a group of three', 'Odd numbers read as one drift', brief('space-plantingBeds'), `Add two more of ${name} nearby`),
        );
        if (!hasLighting(elements)) {
          out.push(
            request('uplight', 'Uplight it at night', 'A spike light at the foot of the stem', brief('space-lighting'), `Add an uplight at the foot of ${name}`),
          );
        }
      } else {
        out.push(
          request('deepen', 'Deepen the border', 'Room for three layers of planting', brief('space-plantingBeds'), `Make ${name} deeper`),
          request('specimen', 'Add a specimen tree', 'Height and a focal point in the bed', brief('space-plantingBeds'), `Add a specimen tree in ${name}`),
        );
        if (!element.edging) {
          out.push(
            request('edging', 'Edge it in steel', 'A crisp line against the lawn', brief('style-modern'), `Edge ${name} with steel`),
          );
        }
      }
      break;
    }
    case 'gravel-mulch': {
      if (element.material !== 'slate-chippings') {
        out.push(
          swap('slate', 'Use slate chippings', 'Darker and sharper underfoot', 'slate-chippings', 'gravel-mulch'),
        );
      }
      out.push(
        request('through', 'Plant through it', 'Grasses and perennials in the gravel', brief('space-plantingBeds'), `Add planting through ${name}`),
      );
      break;
    }
    case 'structure': {
      out.push(
        request('screen', 'Screen it with planting', 'Softens a building seen from the house', brief('space-plantingBeds'), `Add planting to screen ${name}`),
        request('square', 'Square it to the house', 'Lines it up with the walls', brief('style-modern'), `Turn ${name} square to the house`),
      );
      if (!hasLighting(elements)) {
        out.push(
          request('lighting', 'Light it at night', 'Bollards along the way to it', brief('space-lighting'), `Add lighting on the way to ${name}`),
        );
      }
      break;
    }
    case 'water-feature': {
      out.push(
        request('planting', 'Plant around it', 'Marginals soften the edge', brief('space-water'), `Add planting around ${name}`),
      );
      if (!hasLighting(elements)) {
        out.push(
          request('lighting', 'Light it at night', 'Water is the thing to light', brief('space-lighting'), `Add a light beside ${name}`),
        );
      }
      break;
    }
    case 'furniture': {
      if (!hasPergola(elements)) {
        out.push(
          request('pergola', 'Add a pergola over it', 'Shade for the seating', brief('space-pergola'), `Add a pergola over ${name}`),
        );
      }
      if (!hasLighting(elements)) {
        out.push(
          request('lighting', 'Add lighting nearby', 'So it can be used after dark', brief('space-lighting'), `Add lighting near ${name}`),
        );
      }
      break;
    }
    case 'lighting': {
      out.push(
        request('more', 'Add more along the paths', 'Bollards every few metres', brief('space-lighting'), `Add more lights like ${name} along the paths`),
      );
      break;
    }
    case 'existing-feature': {
      out.push(
        request('around', 'Plant around it', 'Ties it into the new design', brief('space-plantingBeds'), `Add planting around ${name}`),
      );
      break;
    }
    default:
      break;
  }

  return out;
}

function gardenSuggestions(elements: DesignElement[]): SmartSuggestion[] {
  const out: SmartSuggestion[] = [];

  if (!hasPavedFeature(elements)) {
    out.push(
      request('seating', 'Create a cosy seating area', 'Popular for gardens like yours', brief('space-seating'), 'Create a seating area'),
    );
  } else if (!hasLighting(elements)) {
    out.push(
      request('lighting', 'Add outdoor lighting', 'Uplit trees and bollards along the paths', brief('space-lighting'), 'Add outdoor lighting'),
    );
  }

  out.push(
    request('border', 'Add border planting', 'Adds colour and structure', brief('space-plantingBeds'), 'Add more border planting along the fences'),
    request('natural', 'Use natural materials', 'Timeless and low maintenance', brief('style-cottage'), 'Use natural materials throughout'),
  );

  if (elements.length > 0) {
    out.push({
      id: 'review',
      title: 'Review my design',
      detail: 'Checked against landscape-design principles',
      art: { kind: 'icon', icon: 'check' },
      action: { kind: 'review' },
    });
  }

  return out;
}

/** "It" in these resolves to the selection, which is the point of having a selection. */
export function quickCommandsFor(subject: Subject): QuickCommand[] {
  if (subject.kind === 'garden') return [];
  const { element } = subject;

  const commands = (entries: [string, string][]): QuickCommand[] =>
    entries.map(([label, text]) => ({ id: label.toLowerCase().replace(/[^a-z]+/g, '-'), label, text }));

  switch (element.category) {
    case 'paved-area':
      return commands([
        ['Make it bigger', 'Make it bigger'],
        ['Darker material', 'Use a darker material for it'],
        ['Add lighting', 'Add lighting around it'],
        ['Add a pergola', 'Add a pergola over it'],
      ]);
    case 'lawn':
      return commands([
        ['Make it bigger', 'Make it bigger'],
        ['Rounder shape', 'Round off the corners'],
        ['Wildflower edge', 'Add a wildflower margin along the edge'],
        ['Border it', 'Add a planting border around it'],
      ]);
    case 'planting-bed':
      return isPlant(element)
        ? commands([
            ['Bigger canopy', 'Make the canopy bigger'],
            ['Nearer the fence', 'Move it nearer the fence'],
            ['Add two more', 'Add two more of these nearby'],
          ])
        : commands([
            ['Deeper border', 'Make it deeper'],
            ['More colour', 'Use a more colourful mix of planting'],
            ['Add a specimen tree', 'Add a specimen tree in it'],
            ['Edge it in steel', 'Edge it with steel'],
          ]);
    case 'gravel-mulch':
      return commands([
        ['Make it bigger', 'Make it bigger'],
        ['Darker chippings', 'Use darker chippings'],
        ['Plant through it', 'Add planting through it'],
      ]);
    case 'structure':
      return commands([
        ['Make it smaller', 'Make it smaller'],
        ['Nearer the house', 'Move it nearer the house'],
        ['Square to the house', 'Turn it square to the house'],
        ['Screen it', 'Add planting to screen it'],
      ]);
    case 'water-feature':
      return commands([
        ['Make it bigger', 'Make it bigger'],
        ['Formal pool', 'Make it a formal pool'],
        ['Plant round it', 'Add planting around it'],
      ]);
    case 'furniture':
      return commands([
        ['Onto the patio', 'Move it onto the patio'],
        ['Face the garden', 'Turn it to face the garden'],
        ['Add lighting', 'Add lighting near it'],
      ]);
    case 'lighting':
      return commands([
        ['More like this', 'Add more lights like this along the paths'],
        ['Beside the path', 'Move it beside the nearest path'],
      ]);
    case 'existing-feature':
      return commands([
        ['Plant around it', 'Add planting around it'],
        ['Path to it', 'Add a path to it'],
      ]);
    default:
      return [];
  }
}
