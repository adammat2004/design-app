import type { StructurePartGroup } from '@garden-studio/schema';

/** The inspector's tabs, in the order it shows them. */
export type StructureTab = 'style' | 'roof' | 'sides' | 'finish' | 'lighting' | 'inside' | 'size';

/**
 * Which tab edits the part somebody clicked in the 3D view.
 *
 * Read off what the part *is*, never where it is: the rafters are the roof of an open pergola, so
 * they open Roof; a post and a beam are the frame, which is its finish. A tab the structure does not
 * have falls back to Style, which every configurable structure has, and then to the first tab — a
 * click that opens nothing is a control that does nothing.
 */
const TAB_FOR_GROUP: Record<StructurePartGroup, StructureTab> = {
  post: 'finish',
  beam: 'finish',
  rafter: 'roof',
  roof: 'roof',
  'side-left': 'sides',
  'side-right': 'sides',
  'side-rear': 'sides',
  light: 'lighting',
};

export function tabForPart(
  group: StructurePartGroup,
  available: readonly StructureTab[],
): StructureTab | null {
  const wanted = TAB_FOR_GROUP[group];
  if (available.includes(wanted)) return wanted;
  if (available.includes('style')) return 'style';
  return available[0] ?? null;
}
