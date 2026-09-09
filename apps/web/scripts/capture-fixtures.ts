import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeZones,
  GenerateConceptsResultSchema,
  lShapePlotOutline,
  PlanProjectSchema,
  rectangleHouse,
  rectanglePlotOutline,
  SectionPatchResultSchema,
  suggestedAccess,
  type BoundaryKind,
  type GardenBrief,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';

/**
 * Captures real generated plans as JSON fixtures for `render:plan`.
 *
 * The preview script must not need PostGIS — it is a thing you run while tuning a hex, and
 * waiting on a database for that is the wrong trade. So the documents it draws are captured once,
 * here, from the real generator, and checked in under `scripts/fixtures/`. Re-run this whenever the
 * generator changes in a way the sheets should show:
 *
 *     pnpm --filter @garden-studio/web capture:fixtures
 *
 * Needs the API (and therefore the database) running. Each capture creates a project, fills in the
 * site and brief, generates concepts, seeds the layout from the recommended one and writes the
 * resulting document. The projects are left behind and can be deleted from `/projects`; the API
 * test suite truncates the table anyway.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface Case {
  name: string;
  plot: Point[];
  house: { centre: Point; width: number; depth: number; rotation?: number };
  brief: GardenBrief;
  /** Manchester by default, so the sheets can show real shadows. */
  location?: { latitude: number; longitude: number } | null;
}

const MANCHESTER = { latitude: 53.4, longitude: -2.98 };

const CASES: Case[] = [
  {
    name: 'suburban',
    plot: rectanglePlotOutline({ width: 18, depth: 26 }),
    house: { centre: { x: 9, y: 6.5 }, width: 9, depth: 7, rotation: 180 },
    brief: {
      purpose: 'A family garden with somewhere to eat outside and space for the kids.',
      desiredFeatures: ['seating', 'pergola', 'play', 'firePit', 'storage'],
      featuresOther: '',
      budget: 'medium',
      maintenance: 'medium',
      style: 'modern',
      styleOther: '',
    },
    location: MANCHESTER,
  },
  {
    name: 'l-shape',
    plot: lShapePlotOutline({ width: 22, depth: 20, returnWidth: 9, returnDepth: 8 }),
    house: { centre: { x: 7, y: 6 }, width: 10, depth: 7, rotation: 180 },
    brief: {
      purpose: 'Somewhere to entertain, with a veg patch tucked out of the way.',
      desiredFeatures: ['seating', 'outdoorKitchen', 'vegPatch', 'water'],
      featuresOther: '',
      budget: 'high',
      maintenance: 'medium',
      style: 'cottage',
      styleOther: '',
    },
    location: MANCHESTER,
  },
  {
    name: 'courtyard',
    plot: rectanglePlotOutline({ width: 9, depth: 12 }),
    house: { centre: { x: 4.5, y: 2.5 }, width: 8, depth: 4, rotation: 180 },
    brief: {
      purpose: 'A calm, low-effort courtyard.',
      desiredFeatures: ['seating', 'water'],
      featuresOther: '',
      budget: 'low',
      maintenance: 'low',
      style: 'lowMaintenance',
      styleOther: '',
    },
    location: null,
  },
];

async function api<T>(path: string, init: RequestInit, parse: (json: unknown) => T): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} → ${response.status}: ${await response.text()}`,
    );
  }

  return parse(await response.json());
}

/** One of each, cycled round the plot, so every boundary renderer appears on a judging sheet. */
const BOUNDARY_CYCLE: BoundaryKind[] = ['wall', 'fence', 'hedge', 'railing'];

async function capture(item: Case): Promise<void> {
  const created = await api(
    '/plan-projects',
    { method: 'POST', body: JSON.stringify({ name: `Fixture · ${item.name}` }) },
    (json) => PlanProjectSchema.parse(json),
  );

  const house = {
    ...rectangleHouse(item.house.centre, item.house.width, item.house.depth),
    rotation: item.house.rotation ?? 0,
  };

  // Doors, a side gate and the street edge, inferred the way the access panel offers them: the
  // generator designs from these, so a fixture without them would judge the wrong thing.
  const site: SiteSection = suggestedAccess({
    vertices: item.plot.map((point, index) => ({ ...point, id: `v${index}` })),
    closed: true,
    house,
    selectedZoneIds: computeZones(item.plot, house).map((zone) => zone.id),
    orientation: 0,
    location: item.location ?? null,
    // Drawn from measurements, so no origin on Earth — the fixtures are not traced plans.
    georeference: null,
    sun: { dayOfYear: 172, minutes: 900 },
    gates: [],
    streetEdgeVertexId: null,
    /*
     * A different kind on each side, so the judging sheets actually exercise the boundary
     * renderers rather than showing four fences and telling us nothing. Nothing infers these —
     * `suggestedAccess` offers doors and a gate, but what a side is made of is a fact only the
     * user knows, so a fixture states it the same way a user would.
     */
    boundaryStyles: item.plot.map((_, index) => ({
      edgeVertexId: `v${index}`,
      kind: BOUNDARY_CYCLE[index % BOUNDARY_CYCLE.length]!,
    })),
  });

  let revision = created.revision;

  const afterSite = await api(
    `/plan-projects/${created.id}/site`,
    { method: 'PATCH', body: JSON.stringify({ revision, section: site }) },
    (json) => SectionPatchResultSchema.parse(json),
  );
  if (afterSite.violations.length > 0) {
    throw new Error(`${item.name}: site has violations ${JSON.stringify(afterSite.violations)}`);
  }
  revision = afterSite.project.revision;

  const afterBrief = await api(
    `/plan-projects/${created.id}/brief`,
    { method: 'PATCH', body: JSON.stringify({ revision, section: item.brief }) },
    (json) => SectionPatchResultSchema.parse(json),
  );
  revision = afterBrief.project.revision;

  const generated = await api(
    `/plan-projects/${created.id}/concepts/generate`,
    { method: 'POST', body: JSON.stringify({ revision, mode: 'all' }) },
    (json) => GenerateConceptsResultSchema.parse(json),
  );
  revision = generated.project.revision;

  const chosen = generated.concepts.find((concept) => concept.recommended) ?? generated.concepts[0];
  if (!chosen) throw new Error(`${item.name}: the generator returned no concepts`);

  // Chosen as well as seeded, so the editor opens on the project rather than sending you back.
  const afterChoice = await api(
    `/plan-projects/${created.id}/concept-selection`,
    {
      method: 'PATCH',
      body: JSON.stringify({ revision, selectedId: chosen.id, chosenConceptId: chosen.id }),
    },
    (json) => SectionPatchResultSchema.parse(json),
  );
  revision = afterChoice.project.revision;

  const afterLayout = await api(
    `/plan-projects/${created.id}/layout`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        revision,
        section: { elements: chosen.elements, seededFrom: chosen.id, pristine: chosen.elements },
      }),
    },
    (json) => SectionPatchResultSchema.parse(json),
  );

  const file = join(OUT_DIR, `${item.name}.plan.json`);
  writeFileSync(file, `${JSON.stringify(afterLayout.project.document, null, 2)}\n`);
  console.log(`  ${item.name}: ${chosen.name} (${chosen.elements.length} elements) → ${file}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Capturing ${CASES.length} fixtures from ${API_URL}`);
  for (const item of CASES) await capture(item);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
