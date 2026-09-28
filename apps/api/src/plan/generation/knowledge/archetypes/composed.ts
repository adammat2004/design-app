import type {
  FunctionalZoneType,
  GeometryLanguage,
  LayoutArchetypeId,
  StyleDirection,
} from '@garden-studio/schema';
import { composeSketch } from '../../design/composition/compose-sketch.js';
import { composeBeside } from '../../design/composition/beside.js';
import { composeCourt } from '../../design/composition/court.js';
import { composeGarden, type ComposeInput } from '../../design/composition/compose.js';
import type { GardenComposition } from '../../design/composition/types.js';
import type { CandidateParams, FunctionalZone } from '../../design/types.js';
import type { Room, SketchRequest } from '../../layout/sketch.js';
import { styleRules } from '../style-rules.js';
import type { LayoutArchetype } from './types.js';

/**
 * The shape languages a composition that has none of its own can be drawn in: the style's first. A
 * destination garden or a sequence of rooms is a plan, not a shape, and drawn straight-edged for a
 * brief whose style wants curves it contradicted the brief it was chosen for — which is how a
 * cottage garden came to be recommended a rectilinear destination garden once that plan was
 * composed. The other language stays on offer, so the candidate loop can find out whether it is
 * the better drawing of this plot.
 */
export function styleLanguages(style: StyleDirection | null): GeometryLanguage[] {
  return styleRules(style).curvature === 'strong'
    ? ['soft_organic', 'rectilinear']
    : ['rectilinear', 'soft_organic'];
}

/**
 * The language a composition is drawn in: the candidate's own, where the archetype speaks it, and
 * otherwise the archetype's first. Resolved in one place so the preview and the realisation cannot
 * read a candidate's parameters differently.
 */
export function languageOf(
  languages: GeometryLanguage[],
  params: Pick<CandidateParams, 'language'>,
): GeometryLanguage {
  return params.language && languages.includes(params.language) ? params.language : languages[0]!;
}

/**
 * An archetype drawn by the composition layer.
 *
 * Each archetype says only what is particular to it — which shape languages it can be drawn in,
 * first the one it is drawn in by default, and for the destination garden that the far end is the
 * point — and `design/composition/` does the rest.
 *
 * **Where the composition declines, the courtyard draws, and says it was the last resort.** Each
 * archetype used to fall back to a hand-drawn template of its own, and those templates were the last
 * place in the generator a feature could stand on a lawn or be handed to the sampler. A plot where
 * a composition cannot hold what the brief most wants round a lawn is a plot that is, for this
 * brief, a courtyard: the paving is the floor, the rooms are carved off it, and anything that will
 * not fit is reported rather than stood somewhere. `ComposedFacts.lastResort` marks it, so the
 * candidate loop still treats the archetype as having declined and never offers it under that name
 * while anything else composed.
 *
 * The composition is pure and cheap, so `zonePattern` and `sketch` both compose rather than one
 * caching for the other: the same inputs give the same garden to the last bit, which is what the
 * preview and the realisation both rely on.
 */
export function composed(
  id: LayoutArchetypeId,
  languages: GeometryLanguage[] | ((style: StyleDirection | null) => GeometryLanguage[]),
  options: { primary?: FunctionalZoneType[] } = {},
): Pick<LayoutArchetype, 'sketch' | 'zonePattern' | 'languages'> {
  /*
   * Which composer draws it: the front-to-back one for every plan whose rooms lie behind the
   * terrace, and the side-by-side one for the plan whose rooms lie beside it. Both produce the same
   * `GardenComposition`, so everything downstream — the sketch, the zones, realisation — is shared.
   */
  const composer: (input: ComposeInput) => GardenComposition | null =
    id === 'side_by_side' ? composeBeside : id === 'courtyard' ? composeCourt : composeGarden;
  const spoken = (style: StyleDirection | null) =>
    typeof languages === 'function' ? languages(style) : languages;
  const compose = (request: SketchRequest, room: Room, params: CandidateParams) =>
    composer({
      archetype: id,
      language: languageOf(spoken(request.style), params),
      request,
      room,
      params,
    });

  return {
    languages: spoken,
    sketch(request, room, _plan, params) {
      const composition = compose(request, room, params);
      if (composition) return composeSketch(composition, room);
      const sketch = composeSketch(lastResort(request, room, params), room);
      return { ...sketch, composed: { ...sketch.composed!, lastResort: true } };
    },
    zonePattern(zones, room, params, request) {
      const composition = compose(request, room, params) ?? lastResort(request, room, params);
      return zonesFromComposition(zones, composition, options.primary ?? []);
    },
  };
}

/**
 * The courtyard, drawn so that it cannot decline: every room it can carve off the floor, and the
 * rest reported. What every composition falls back to, and what the candidate loop offers where
 * nothing else composed.
 */
export function lastResort(
  request: SketchRequest,
  room: Room,
  params: CandidateParams,
): GardenComposition {
  const composition = composeCourt({
    archetype: 'courtyard',
    language: 'rectilinear',
    request,
    room,
    params: { ...params, lastResort: true },
  });
  /* `composeCourt` declines only for an essential it could not seat, which `lastResort` forbids. */
  if (!composition) throw new Error('The last-resort courtyard declined.');
  return composition;
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
