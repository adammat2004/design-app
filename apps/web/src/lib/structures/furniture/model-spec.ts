/**
 * The furniture models the 3D view draws, and what each is composed from.
 *
 * The twin of `pbr/pbr-spec.ts` for geometry: the specification beside the code that reads it,
 * `tools/assets fetch:models` downloads, composes and packs, and `furniture-models.json` records what
 * was written. The sources are **Poly Haven's CC0 models**, each pinned by the md5 Poly Haven
 * publishes for its `.gltf`.
 *
 * ## Re-skinned, on purpose
 *
 * Every piece is drawn in the user's chosen furniture material — teak, rattan or powder-coated steel —
 * from the 3D material library, not in the photograph it was published with. A painted farmhouse chair
 * is a good chair *shape*; what it is made of is the user's choice, and the Inside tab offers it. So
 * the tool keeps only the geometry, lays texture coordinates on it in metres with the grain along
 * each member, and ships it untextured: the material library dresses it at run time, which is what
 * makes a teak table from a model and a teak table from the boxes the same teak.
 *
 * ## Only where a real one exists
 *
 * A key with no entry here draws as the boxes `furnitureParts` has always drawn. No CC0 library has a
 * photographed sun lounger, barbecue or parasol, and its pots are a quarter the size of a planter, so
 * those four stay boxes rather than become something else stretched to fit.
 */

export interface ModelSource {
  /** Poly Haven asset id. */
  asset: string;
  /** Poly Haven's published md5 of the 1k `.gltf`. */
  md5: string;
  author: string;
}

export const SOURCES = {
  diningChair: {
    asset: 'painted_wooden_chair_01',
    md5: '28e739db9799cdadf820ead2b486d463',
    author: 'Kuutti Siitonen',
  },
  squareTable: {
    asset: 'wooden_table_02',
    md5: '957c5d94784eed976cb4c6f0256a85e7',
    author: 'Serhii Khromov',
  },
  longTable: {
    asset: 'painted_wooden_table',
    md5: '081543cfe302f198aaf2e49f80ab6e31',
    author: 'Kirill Sannikov',
  },
  sofa: {
    asset: 'painted_wooden_sofa',
    md5: '2648c458e6639629c5dcb67fcbf07e6c',
    author: 'Kirill Sannikov',
  },
  lowTable: {
    asset: 'small_wooden_table_01',
    md5: '716b66952dc473d09a3ac5f48ef50a68',
    author: 'Ulan Cabanilla',
  },
  bench: {
    asset: 'painted_wooden_bench',
    md5: '784a49250144aa5299a93c1f3b6968d7',
    author: 'Kirill Sannikov',
  },
} as const satisfies Record<string, ModelSource>;

/**
 * How a key is put together.
 *
 * - `dining`: a table fitted into `diningLayout`'s table rectangle (its plan proportions kept, its
 *   top brought to `TABLE`), and a chair at every place the layout names, turned to face the table.
 * - `lounge`: a sofa fitted to `loungeLayout`'s sofa rectangle against the back, and a low table in
 *   its table rectangle.
 * - `single`: one model, as it is.
 */
export type Composition =
  | { kind: 'dining'; table: ModelSource; chair: ModelSource }
  | { kind: 'lounge'; sofa: ModelSource; table: ModelSource }
  | { kind: 'single'; piece: ModelSource };

export type FurnitureModelKey = 'dining-set-4' | 'dining-set-6' | 'sofa-set' | 'bench';

export const FURNITURE_MODELS: Record<FurnitureModelKey, Composition> = {
  'dining-set-4': { kind: 'dining', table: SOURCES.squareTable, chair: SOURCES.diningChair },
  'dining-set-6': { kind: 'dining', table: SOURCES.longTable, chair: SOURCES.diningChair },
  'sofa-set': { kind: 'lounge', sofa: SOURCES.sofa, table: SOURCES.lowTable },
  bench: { kind: 'single', piece: SOURCES.bench },
};

/** The AR budget for a piece of furniture. */
export const FURNITURE_TRIANGLE_BUDGET = 5000;

/** Where a model lands, relative to `public/`. */
export function furnitureModelFile(key: FurnitureModelKey): string {
  return `models/furniture/${key}.glb`;
}
