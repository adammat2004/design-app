import { z } from 'zod';
import { ConceptsSectionSchema, LayoutSectionSchema } from './concepts.js';
import { FeaturesSectionSchema } from './features.js';
import { GardenBriefSchema } from './brief.js';
import { SiteSectionSchema } from './site.js';
import { UnitSchema } from './units.js';

/**
 * The whole wizard as one document — exactly what is stored in the `document` jsonb column.
 *
 * Sections mirror the steps, and each is written by the one screen that owns it, which is what
 * makes per-section autosave safe: only the map screen writes `site`, only the brief screen
 * writes `brief`, and the wizard shows one screen at a time.
 *
 * Two things are deliberately absent. The project's name is a column, so a project list needs
 * no jsonb parsing, and the last-saved time is `updated_at`. Zones are absent too — they are
 * derived from the boundary and the house by `computeZones`, so storing them would only create
 * something that could go stale.
 *
 * `unit` sits at the top rather than inside `site` because it is not a property of the plot:
 * it affects snapping on steps 1, 2 and 5, and the server needs it to write the assistant's
 * before/after strings in the user's own units.
 */

export const PLAN_DOCUMENT_VERSION = 4;

export const PlanDocumentSchema = z.object({
  version: z.number().int().positive().default(PLAN_DOCUMENT_VERSION),
  unit: UnitSchema.default('m'),
  site: SiteSectionSchema.default({}),
  features: FeaturesSectionSchema.default({}),
  brief: GardenBriefSchema.default({}),
  concepts: ConceptsSectionSchema.default({}),
  layout: LayoutSectionSchema.default({}),
});
export type PlanDocument = z.infer<typeof PlanDocumentSchema>;

export function emptyPlanDocument(): PlanDocument {
  return PlanDocumentSchema.parse({ version: PLAN_DOCUMENT_VERSION });
}

/**
 * Upgrades stored under their version number, applied in order on read.
 *
 * Note the defensive habit that makes most entries unnecessary: every section defaults to `{}` and
 * every array to `[]`, so *adding* a field never invalidates an old row. Migrations are only needed
 * when a field changes meaning or shape — which is exactly what `1` does.
 */
const MIGRATIONS: Record<number, (document: unknown) => unknown> = {
  0: (document) => document,

  /**
   * 1 → 2: the house outline gains vertex ids, and the house gains a wall list.
   *
   * The first real migration, and the reason this mechanism was built rather than invented under
   * pressure. `outline` changes element type from `Point` to `HouseVertex`, so unlike every change
   * before it a stored row genuinely does not parse without help.
   *
   * Ids are assigned positionally because that is all the information a v1 document carries — the
   * point is not that these particular ids are meaningful, it is that from now on they are stable.
   * `site.orientation` needs nothing here: it is an addition with a default, so Zod fills it.
   */
  /**
   * 2 → 3: `elevation` starts being drawn.
   *
   * A no-op, and deliberately one. Nothing about the document's *shape* changes — `elevation` has
   * been on `DesignElement` since long before this — but its **meaning** does: it was documented as
   * "carried for costing later; nothing renders differently because of it", and from here a raised
   * element draws a retaining face and casts its shadow from the top of it. A stored v2 plan with
   * `elevation: 0.45` on a terrace meant the same thing it means now, so there is nothing to
   * rewrite; the version is bumped so the change has a date rather than because a row needs help.
   */
  2: (document) => document,

  /**
   * 3 → 4: `edging` stops meaning "there is a border round this".
   *
   * A no-op on the same grounds as `2`. Nothing about the shape changes — `edges` is an addition
   * Zod fills, and `edgingSides` never shipped — but `edging`'s **meaning** does: it was the
   * product for a whole outline, derived wherever a course was legal, and it is now the product
   * `mode: 'auto'` lays only where the rules say to lay one. A stored v3 plan therefore *draws*
   * differently: a patio that met a path in the same stone keeps its course under the old reading
   * and correctly loses it under this one. There is nothing to rewrite, because the field still
   * holds the product it always held; the bump is what dates the change.
   */
  3: (document) => document,

  1: (document) => {
    const root = document as { site?: { house?: { outline?: unknown[] } | null } } | null;
    const house = root?.site?.house;

    if (!house || !Array.isArray(house.outline)) return document;

    const outline = house.outline.map((point, index) => ({
      ...(point as object),
      id: `h${index}`,
    }));

    return {
      ...(root as object),
      site: {
        ...root!.site,
        house: { ...house, outline, walls: outline.map((_, i) => ({ id: `w${i}` })) },
      },
    };
  },
};

/**
 * Parses a stored document, upgrading it first. Called on read only — every write path already
 * holds a parsed document, and the server stamps the current version on the way out.
 */
export function readPlanDocument(raw: unknown): PlanDocument {
  const stored = (raw as { version?: unknown } | null)?.version;
  let document = raw;

  for (
    let version = typeof stored === 'number' ? stored : 0;
    version < PLAN_DOCUMENT_VERSION;
    version += 1
  ) {
    const migrate = MIGRATIONS[version];
    if (migrate) document = migrate(document);
  }

  return PlanDocumentSchema.parse({ ...(document as object), version: PLAN_DOCUMENT_VERSION });
}
