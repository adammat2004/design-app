import type { ARScene, ModelLibrary } from '@garden-studio/ar-contract';
import type { DesignElement, EdgeRuleContext, SiteSection } from '@garden-studio/schema';

export type SceneFrame = ARScene['frame'];

/** What a scene is built from: the plan as it stands, saved or not. */
export interface ArSceneInput {
  site: SiteSection;
  elements: DesignElement[];
  /** The brief's style, budget and upkeep: what automatic edging lays. Absent, no style is assumed. */
  edgeRules?: EdgeRuleContext;
  source: {
    projectId: string | null;
    projectName: string;
    revision: number | null;
    documentVersion: number | null;
  };
}

/**
 * How many plants a scene may carry, by what will draw it. A phone draws each plant as its own node
 * (Viro has no instancing), so it gets a few hundred; the desktop instances them and gets the bed.
 * The same ranking decides both, so the phone's plants are a subset of the desktop's.
 */
export type PlantProfile = 'phone' | 'desktop';

export const PLANT_BUDGET: Record<PlantProfile, number> = { phone: 300, desktop: 4000 };

/**
 * What a material looks like. Colour is presentation and lives with the caller — the web's palette
 * is the source of every ground colour — so the builder is handed it rather than holding a second
 * copy that could disagree. `null` means "use the builder's neutral colour for this kind of thing".
 */
export interface Appearance {
  label?: string;
  baseColor: string;
  roughness: number;
  metalness: number;
  texture: { key: string; tileSizeM: number } | null;
  /** A few related colours, for things drawn many times in this material (a bed's plants). */
  tones?: string[];
}

/**
 * Which look of a material is asked for. A bed is two things: the ground it is laid on (`surface`,
 * soil or mulch) and the plants that grow in it (`foliage`). One colour for both drew every clump in
 * the colour of the soil under it. A `boundary` is asked for by kind and part (`fence`,
 * `fence:detail`, `wall:cap`); a `roof` by its covering (`slate`).
 */
export type AppearanceRole = 'surface' | 'foliage' | 'boundary' | 'roof';

export interface BuildOptions {
  plants?: PlantProfile;
  appearance?: (materialId: string, as: AppearanceRole) => Appearance | null;
  /** Stamped on the scene. Passed in by tests so a build is a pure function of its inputs. */
  generatedAt?: string;
  /**
   * The model library (`library.json`), for the structures a library model can draw. Injected like
   * `appearance`, never fetched: the builder is pure. Absent or empty, no node carries an `asset` and
   * the scene is exactly what it was before the library existed.
   */
  library?: ModelLibrary | null;
}

/** An element the scene does not draw, and why. Every visible element is drawn or named here. */
export interface SkippedElement {
  elementId: string;
  reason: string;
}

export interface ArBuild {
  scene: ARScene;
  skipped: SkippedElement[];
  /** Things that went wrong and were recovered from, e.g. a cut that fell back to the uncut ring. */
  warnings: string[];
}
