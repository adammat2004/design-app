import type { AssetId } from '../materials/assets/asset-spec';
import {
  buildArScene,
  type Appearance,
  type AppearanceRole,
  type ArBuild,
  type PlantProfile,
} from '@garden-studio/ar-builder';
import type { ModelLibrary } from '@garden-studio/ar-contract';
import {
  bedPlanting,
  type BoundaryKind,
  type DesignElement,
  type EdgeRuleContext,
  type RoofMaterial,
  type SiteSection,
} from '@garden-studio/schema';
import { fileStem } from '../materials/export-plan';
import { catalogueVariants } from '../materials/assets/catalogue';
import { materialAssets } from '../materials/assets/material-assets';
import { resolvePattern } from '../materials/palette';
import { FACE_TINT, MASS_TEXTURE_TINT } from '../materials/render-surface-pattern';
import { BOUNDARY_PALETTE } from '../materials/symbols/boundary';
import { ROOF_TONES } from '../render/roof';

/**
 * The web's side of the scene builder: the plan as the editor holds it right now, and what each
 * material looks like.
 *
 * The builder decides every position and triangle; it is handed colour, because colour is the
 * web's and a second copy in the builder would be a second answer to "what colour is the lawn".
 *
 * A material's colour in a scene is **the colour the plan actually shows it as**. Where the plan
 * draws a photograph — turf, gravel, a slab face — that is the photograph's recorded mean colour
 * (`catalogue.json`) multiplied by the palette tone at the painter's own strength (`MASS_TEXTURE_TINT`
 * for a mass, `FACE_TINT` for a face), which is what `tintTexture` does to the pixels. The mean of
 * the palette tones alone was the first answer and it was visibly wrong: a palette is the tint laid
 * over a photograph, not the photograph, and a lawn drawn in it came out pale mint beside the plan's
 * deep green. The plants in a bed are asked for separately (`foliage`), in the palette's own tones,
 * because a bed's ground is its soil and its palette is its plants. Textures stay off for now: a phone draws flat colour first (AR phase 4 adds textures),
 * and the preview draws what the phone will.
 */
export function materialAppearance(materialId: string, as: AppearanceRole = 'surface'): Appearance | null {
  if (as === 'boundary') return boundaryAppearance(materialId);
  if (as === 'roof') {
    const tones = ROOF_TONES[materialId as RoofMaterial];
    return tones ? { label: `${materialId} roof`, baseColor: tones.base, roughness: 0.85, metalness: 0, texture: null } : null;
  }
  const entry = resolvePattern(materialId);
  if (!entry || entry.palette.length === 0) return null;
  const tone = meanColour(entry.palette);
  // The plants in a bed are drawn in the planting's own tones: a bed's palette is its plants.
  if (as === 'foliage') {
    // A bed's plants in its palette's own tones — one each, by the tone the sampler drew for it.
    return { label: entry.displayName, baseColor: tone, roughness: 0.95, metalness: 0, texture: null, tones: entry.palette };
  }
  const assets = materialAssets(entry.id);
  const soil = bedSoil(entry.id, assets?.texture);
  const photo = soil ?? assets?.texture ?? assets?.face;
  const mean = photo ? catalogueVariants(photo)[0]?.meanColour : undefined;
  // A bed's ground is tinted to its joint colour, as `resolveLayers` lays it; anything else to its palette.
  const tint = soil ? entry.jointColour : tone;
  return {
    label: entry.displayName,
    baseColor: mean ? multiplyTowards(mean, tint, soil || assets?.texture ? MASS_TEXTURE_TINT : FACE_TINT) : tone,
    // Still water is the one ground that shines; everything else in a garden is matt.
    roughness: entry.category === 'water-feature' ? 0.15 : 0.9,
    metalness: 0,
    texture: null,
  };
}

/**
 * A boundary's colours are the plan's own (`BOUNDARY_PALETTE`): its body, and its posts or piers
 * (`detail`) and coping or rail (`cap`) where the kind has them. Asked for as `fence`,
 * `fence:detail`, `wall:cap`.
 */
function boundaryAppearance(id: string): Appearance | null {
  const [kind, part] = id.split(':') as [BoundaryKind, 'detail' | 'cap' | undefined];
  const palette = BOUNDARY_PALETTE[kind];
  if (!palette) return null;
  const colour = part === 'detail' ? palette.detail : part === 'cap' ? palette.cap : palette.body;
  if (!colour) return null;
  // A hedge is foliage and a railing is painted metal; everything else is timber or masonry.
  const roughness = kind === 'hedge' ? 0.95 : kind === 'railing' ? 0.55 : 0.85;
  return { label: part ? `${kind} ${part}` : kind, baseColor: colour, roughness, metalness: kind === 'railing' ? 0.3 : 0, texture: null };
}

/**
 * The photograph a planting bed's ground is laid in, as `resolveLayers` lays it: a scheme bed on its
 * scheme's base (bark, gravel, soil), a mix on its own texture or plain soil. Its own material's
 * photograph was the first answer, and a border came out as black holes under its plants.
 */
function bedSoil(materialId: string, own: AssetId | undefined): AssetId | undefined {
  const planting = bedPlanting(materialId);
  if (!planting) return undefined;
  if (planting.source === 'mix') return own ?? 'tex-soil';
  return planting.base ? materialAssets(planting.base)?.texture : undefined;
}

/** `base` multiplied by `tone` pre-blended from white by `strength`: a low-alpha multiply. */
export function multiplyTowards(base: string, tone: string, strength: number): string {
  const channels = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const a = channels(base);
  const b = channels(tone);
  return `#${a
    .map((channel, index) => {
      const tint = 255 + (b[index]! - 255) * strength;
      return Math.round((channel * tint) / 255).toString(16).padStart(2, '0');
    })
    .join('')}`;
}

/** The mean of some sRGB hexes, channel by channel. */
export function meanColour(hexes: string[]): string {
  const sum = [0, 0, 0];
  for (const hex of hexes) {
    const value = Number.parseInt(hex.slice(1), 16);
    sum[0]! += (value >> 16) & 255;
    sum[1]! += (value >> 8) & 255;
    sum[2]! += value & 255;
  }
  return `#${sum.map((channel) => Math.round(channel / hexes.length).toString(16).padStart(2, '0')).join('')}`;
}

export interface PlanForScene {
  site: SiteSection;
  elements: DesignElement[];
  /** The brief's style, budget and upkeep: what automatic edging lays, as the plan resolves it. */
  edgeRules?: EdgeRuleContext;
  projectName: string;
  projectId: string | null;
  revision: number | null;
  documentVersion: number | null;
}

/**
 * A scene of this plan, for a phone or for the desktop preview. `library` is the model library once
 * it has loaded (`useModelLibrary`); without it no structure carries an `AssetRef`, and the scene is
 * exactly what it was before the library existed.
 */
export function sceneOfPlan(
  plan: PlanForScene,
  plants: PlantProfile,
  library: ModelLibrary | null = null,
): ArBuild {
  return buildArScene(
    {
      site: plan.site,
      elements: plan.elements,
      ...(plan.edgeRules ? { edgeRules: plan.edgeRules } : {}),
      source: {
        projectId: plan.projectId,
        projectName: plan.projectName,
        revision: plan.revision,
        documentVersion: plan.documentVersion,
      },
    },
    { plants, appearance: materialAppearance, library },
  );
}

/** The file name a scene is downloaded as: the plan's own, ending `.ar.json`. */
export function sceneFileName(projectName: string): string {
  return `${fileStem(projectName) || 'garden'}.ar.json`;
}
