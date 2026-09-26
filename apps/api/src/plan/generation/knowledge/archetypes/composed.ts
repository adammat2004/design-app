import type { FunctionalZoneType, LayoutArchetypeId } from '@garden-studio/schema';
import { composeSketch } from '../../design/composition/compose-sketch.js';
import { composeBeside } from '../../design/composition/beside.js';
import { composeCourt } from '../../design/composition/court.js';
import { composeGarden, type ComposeInput } from '../../design/composition/compose.js';
import type { GardenComposition, GeometryLanguage } from '../../design/composition/types.js';
import type { CandidateParams, FunctionalZone } from '../../design/types.js';
import type { Room, SketchRequest } from '../../layout/sketch.js';
import { styleRules } from '../style-rules.js';
import type { LayoutArchetype } from './types.js';

/**
 * The shape language a composition that has none of its own speaks: the style's. A destination
 * garden or a sequence of rooms is a plan, not a shape, and drawn straight-edged for a brief whose
 * style wants curves it contradicted the brief it was chosen for — which is how a cottage garden
 * came to be recommended a rectilinear destination garden once that plan was composed.
 */
export function styleLanguage(request: SketchRequest): GeometryLanguage {
  return styleRules(request.style).curvature === 'strong' ? 'soft_organic' : 'rectilinear';
}

/**
 * An archetype drawn by the composition layer, with its hand-drawn sketch as the fallback.
 *
 * Each archetype says only what is particular to it — which shape language it speaks, and for the
 * destination garden that the far end is the point — and `design/composition/` does the rest. Where
 * the composition declines (a courtyard, or a plot that cannot hold what the brief most wants
 * without giving up the lawn), the archetype's own hand-drawn sketch and zone pattern draw instead.
 *
 * The composition is pure and cheap, so `zonePattern` and `sketch` both compose rather than one
 * caching for the other: the same inputs give the same garden to the last bit, which is what the
 * preview and the realisation both rely on.
 */
export function composed(
  id: LayoutArchetypeId,
  language: GeometryLanguage | ((request: SketchRequest) => GeometryLanguage),
  fallback: Pick<LayoutArchetype, 'sketch' | 'zonePattern'>,
  options: { primary?: FunctionalZoneType[] } = {},
): Pick<LayoutArchetype, 'sketch' | 'zonePattern'> {
  /*
   * Which composer draws it: the front-to-back one for every plan whose rooms lie behind the
   * terrace, and the side-by-side one for the plan whose rooms lie beside it. Both produce the same
   * `GardenComposition`, so everything downstream — the sketch, the zones, realisation — is shared.
   */
  const composer: (input: ComposeInput) => GardenComposition | null =
    id === 'side_by_side' ? composeBeside : id === 'courtyard' ? composeCourt : composeGarden;
  const compose = (request: SketchRequest, room: Room, params: CandidateParams) =>
    composer({
      archetype: id,
      language: typeof language === 'function' ? language(request) : language,
      request,
      room,
      params,
    });

  return {
    sketch(request, room, plan, params) {
      const composition = compose(request, room, params);
      return composition
        ? composeSketch(composition, room)
        : fallback.sketch(request, room, plan, params);
    },
    zonePattern(zones, room, params, request) {
      const composition = compose(request, room, params);
      return composition
        ? zonesFromComposition(zones, composition, options.primary ?? [])
        : fallback.zonePattern(zones, room, params, request);
    },
  };
}

/**
 * The zone plan read off the composition, so the rooms the plan describes are the rooms it drew.
 *
 * The terrace and the lawn are the composition's own; every other room is the bay that was reserved
 * for one of its features. A room that got no bay keeps `rect: null`, which is the honest report.
 * `primary` names the zone types this archetype is organised around, where that is not the
 * brief's own answer — the destination garden's room at the far end is the reason for the plan.
 */
function zonesFromComposition(
  zones: FunctionalZone[],
  composition: GardenComposition,
  primary: FunctionalZoneType[],
): FunctionalZone[] {
  return zones.map((zone) => {
    if (zone.type === 'terrace') return { ...zone, rect: composition.terrace };
    if (zone.type === 'lawn') return { ...zone, rect: composition.openSpace?.rect ?? null };
    const bay = composition.bays.find(
      (candidate) =>
        candidate.zoneId === zone.type ||
        (candidate.feature !== null && zone.features.includes(candidate.feature)),
    );
    const rect = bay?.rect ?? null;
    return primary.includes(zone.type) && rect
      ? { ...zone, rect, importance: 'primary' as const }
      : { ...zone, rect };
  });
}
