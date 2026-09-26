import { polygonIsSimple } from '@garden-studio/schema';
import {
  rectCentre,
  rectSize,
  terraceSlot,
  type LayoutSketch,
  type Room,
  type Slot,
  type SketchPath,
  type TemplateId,
} from '../../layout/sketch.js';
import type { GardenComposition, GeometryLanguage } from './types.js';

/**
 * A composition, said in the vocabulary the rest of the pipeline already speaks.
 *
 * The contract below `LayoutSketch` — `fitInSlot`, the preview, the realisation, the adapters, the
 * scorer — does not change, which is what lets a composed archetype and a hand-drawn one be enumerated
 * side by side in one candidate field. What a composed sketch adds is `composed`: the facts the
 * realisation has to honour for the composition to survive being built — that the lawn was reserved
 * first, why each tree is where it is, what each bed is for.
 *
 * A bay becomes a slot of the same id, sized to the bay, with the bay's purpose. The corridors do not
 * appear at all: they are the gaps the beds were drawn round, and the routes are laid in them.
 */

const TEMPLATE: Record<GeometryLanguage, TemplateId> = {
  rectilinear: 'rectilinear',
  soft_organic: 'curved',
  formal_symmetric: 'formal',
};

export function composeSketch(composition: GardenComposition, room: Room): LayoutSketch {
  const slots: Slot[] = [
    { ...terraceSlot(composition.terrace, room), zoneId: 'terrace', purpose: 'terrace' },
    ...composition.bays.map(
      (bay): Slot => ({
        id: bay.id,
        kind: bay.kind,
        zoneId: bay.zoneId,
        anchor: rectCentre(bay.rect),
        maxSize: rectSize(bay.rect),
        purpose: bay.purpose,
        ...(bay.turn ? { turn: true } : {}),
        ...(bay.minSize ? { minSize: bay.minSize } : {}),
      }),
    ),
  ];

  const paths: SketchPath[] = composition.circulation.map((edge) => ({
    from: edge.from,
    to: edge.to,
    via: edge.via,
    name: edge.name,
    tier: edge.tier,
    purpose: edge.purpose,
    ...(edge.branch ? { branch: edge.branch } : {}),
  }));

  const beds = composition.masses.filter(
    (mass) =>
      mass.shape.kind !== 'polygon' ||
      polygonIsSimple(mass.shape.points.map(({ u, v }) => ({ x: u, y: v }))),
  );

  return {
    template: TEMPLATE[composition.language],
    beds: beds.map((mass) => ({ name: mass.name, shape: mass.shape })),
    terrace: composition.terrace,
    lawn: composition.openSpace?.shape ?? null,
    lawnCategory: composition.openSpace?.category ?? 'lawn',
    slots,
    paths,
    trees: composition.trees.map((tree) => tree.at),
    axisPath: composition.axis,
    axisStops: composition.axisStops,
    /* No open ground reserved is what a courtyard is, and the fill pass reads it so. */
    courtyard: composition.openSpace === null,
    composed: {
      language: composition.language,
      treeRoles: composition.trees.map((tree) => ({ role: tree.role, purpose: tree.purpose })),
      bedPurposes: beds.map((mass) => mass.purpose),
      decisions: composition.decisions,
    },
  };
}
