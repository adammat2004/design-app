import { hexToRgb } from '../light';
import { MATERIAL_TONES } from './tones';
import {
  findMaterial,
  materialPattern,
  MATERIALS,
  type ElementCategory,
  type MaterialId,
  type MaterialPattern,
} from '@garden-studio/schema';

export * from './tones';
export * from './edges';

export interface MaterialManifestEntry {
  id: MaterialId;
  category: ElementCategory;
  displayName: string;
  pattern: MaterialPattern;
  palette: string[];
  jointColour: string;
}

/**
 * A material's full pattern manifest, or `null` when it has no pattern — which is the flat-fill
 * path and the honest answer for still water and powder-coated steel.
 *
 * Null also when a material has geometry but no tones, or the reverse. That is a half-finished
 * catalogue entry, and drawing it would mean inventing one of the two halves. `palette.test.ts`
 * fails loudly when that happens rather than letting the material quietly go flat.
 */
export function resolvePattern(materialId: string | undefined): MaterialManifestEntry | null {
  const material = findMaterial(materialId);
  if (!material) return null;

  const pattern = materialPattern(material.id);
  const tones = MATERIAL_TONES[material.id];
  if (!pattern || !tones) return null;

  return {
    id: material.id,
    category: categoryOf(material.id),
    displayName: material.label,
    pattern,
    palette: tones.palette.map((tone, index) => checkTone(tone, material.id, `palette[${index}]`)),
    jointColour: checkTone(tones.jointColour, material.id, 'jointColour'),
  };
}

/**
 * A safe tone for a palette entry that is not a colour. Mid-grey: obviously wrong to look at,
 * never invisible, and it cannot be mistaken for a deliberate choice.
 */
const FALLBACK_TONE = '#8a8a8a';

/**
 * Checked once per surface, here, rather than on every one of the forty thousand units a scatter
 * can draw. The palettes are a static hand-written manifest — a bad entry is a typo, not a runtime
 * condition, so validating it in the inner loop is pure waste.
 *
 * **Loud in development, soft in production**, and the split is deliberate. While tuning a palette
 * a bad hex should stop you at once and say which material and which key: that is a bug and you
 * are the person who can fix it in the next keystroke. In front of an audience the right answer is
 * a slightly wrong grey rather than a blank canvas — `hexToRgb` throws, the throw escapes through
 * Konva's render, and with no error boundary above it the whole plan disappears.
 *
 * Safe *because it is only a colour*. The codebase's rule elsewhere is to return null rather than
 * guess, and that exists for geometry, where a guess misleads about where things are. A fallback
 * grey misleads nobody about the shape of the garden.
 */
function checkTone(tone: string, materialId: MaterialId, key: string): string {
  try {
    hexToRgb(tone);
    return tone;
  } catch {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`${materialId}.${key} is not a hex colour: ${JSON.stringify(tone)}`);
    }

    return FALLBACK_TONE;
  }
}

/**
 * Which category a material belongs to.
 *
 * `findMaterial` deliberately searches across every category and does not report which one it
 * matched in, so the index is derived from `MATERIALS` itself rather than written out again — a
 * second hand-maintained table is exactly how a material ends up filed under two categories.
 */
const CATEGORY_BY_MATERIAL: Record<string, ElementCategory> = Object.fromEntries(
  Object.entries(MATERIALS).flatMap(([category, materials]) =>
    materials.map((material) => [material.id, category as ElementCategory]),
  ),
);

function categoryOf(id: MaterialId): ElementCategory {
  return CATEGORY_BY_MATERIAL[id]!;
}
