import {
  boxMesh,
  planToGround,
  rotateAboutY,
  yawFromPlanDegrees,
  type Mesh,
  type SolidNode,
  type Vec2,
  type Vec3,
} from '@garden-studio/ar-contract';
import {
  BOUNDARY_BAYS,
  boundaryPolygon,
  effectiveBoundaryRuns,
  elementOutline,
  heightFor,
  houseHeight,
  housePolygon,
  kerbLines,
  levelBands,
  openingSpans,
  pointInPolygon,
  polylineStrip,
  resolveEdges,
  retainingThickness,
  roofFor,
  roofSolid,
  stepFlight,
  type BoundaryRun,
  type DesignElement,
  type EdgeRuleContext,
  type HouseFootprint,
  type Point,
  type RoofPoint,
  type SiteSection,
} from '@garden-studio/schema';
import type { MaterialTable } from './materials.js';
import { emptyMesh, flatMesh, mergeInto, prismMesh } from './mesh.js';

/**
 * The garden's depth: everything that stands up out of the plan and is not a structure or a plant.
 * The house with its roof, the boundaries as they are built, the faces that hold a raised terrace
 * up, the courses along a bed's edge, and a flight of steps. Every one of them is a 2D answer the
 * schema already gives — `roofFor`, `effectiveBoundaryRuns`, `levelBands`, `resolveEdges`,
 * `stepFlight` — stood up, never a second opinion about where anything is.
 */

type Ground = (point: Point) => Vec2;

/** How far a retaining wall's top stands proud of the ground it holds: a coping, and no flicker. */
const RETAINING_LIP = 0.015;

/* ------------------------------------------------------------------ the house */

/**
 * The house as a building: walls to the eaves and the roof the plan draws, stood up by `roofSolid`.
 * A gable's end walls are wall. Its doors and windows ride along as `openings` (contract 0.0.2) for
 * the renderer to draw on the wall; nothing is cut into the mesh.
 */
export function houseNode(
  house: HouseFootprint,
  ground: Ground,
  materials: MaterialTable,
): SolidNode {
  const ring = housePolygon(house);
  const eaves = houseHeight(house);
  const walls = prismMesh(ring.map(ground), 0, eaves);
  const roofMaterial = house.roofMaterial ?? 'slate';
  const roof = roofFor(ring, { x: -1, y: -1 }, { material: roofMaterial });
  const parts: SolidNode['parts'] = [];

  if (roof) {
    const solid = roofSolid(roof, eaves);
    const slopes = emptyMesh();
    for (const plane of solid.planes) mergeInto(slopes, planeMesh(plane, ground));
    const ridge = roof.ridge[0];
    if (ridge) {
      const middle = { x: (ridge[0].x + ridge[1].x) / 2, y: (ridge[0].y + ridge[1].y) / 2 };
      for (const gable of solid.gables) mergeInto(walls, triangleFacing(gable, ground, middle));
    }
    parts.push({
      material: materials.use(`roof:${roofMaterial}`, 'house', '#5a6169'),
      mesh: slopes,
    });
  }
  parts.unshift({ material: materials.use('house:walls', 'house'), mesh: walls });

  // Its doors and windows, where they resolve: drawn on the wall, and how the garden door is found.
  const openings = openingSpans(house).map((span) => ({
    kind: span.opening.type,
    a: ground(span.a),
    b: ground(span.b),
    // A direction, not a place: turned into the scene's axes, never moved by the origin.
    outward: [span.outward.x, span.outward.y] as Vec2,
    bottom: span.bottom,
    top: span.top,
  }));

  return {
    kind: 'solid',
    id: 'house',
    sourceId: 'house',
    category: 'house',
    name: 'House',
    existing: true,
    visibleByDefault: true,
    parts,
    ...(openings.length > 0 ? { openings } : {}),
  };
}

/** A roof plane lifted into the scene, triangulated in plan and every triangle turned to face up. */
function planeMesh(plane: RoofPoint[], ground: Ground): Mesh {
  const mesh = emptyMesh();
  if (plane.length < 3) return mesh;
  // A quad or a triangle is a fan; a ridge cap on an irregular house is triangulated flat first.
  const flat = flatMesh([[plane.map((point) => ground(point))]], 0);
  const heights = new Map(plane.map((point) => [key(ground(point)), point.height]));
  for (let i = 0; i < flat.indices.length; i += 3) {
    const corners = [flat.indices[i]!, flat.indices[i + 1]!, flat.indices[i + 2]!].map(
      (index): Vec3 => {
        const x = flat.positions[index * 3]!;
        const z = flat.positions[index * 3 + 2]!;
        return [x, heights.get(key([x, z])) ?? 0, z];
      },
    );
    pushTriangle(mesh, corners as [Vec3, Vec3, Vec3], [0, 1, 0]);
  }
  return mesh;
}

/** A gable end: one triangle, facing away from the roof's middle. */
function triangleFacing(points: RoofPoint[], ground: Ground, middle: Point): Mesh {
  const mesh = emptyMesh();
  const corners = points.map((point): Vec3 => {
    const [x, z] = ground(point);
    return [x, point.height, z];
  }) as [Vec3, Vec3, Vec3];
  const [mx, mz] = ground(middle);
  const top = corners[2];
  pushTriangle(mesh, corners, [top[0] - mx, 0, top[2] - mz]);
  return mesh;
}

/** Appends a triangle wound so its normal points along `towards`, with that normal on each corner. */
function pushTriangle(mesh: Mesh, [a, b, c]: [Vec3, Vec3, Vec3], towards: Vec3): void {
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const flip = n[0] * towards[0] + n[1] * towards[1] + n[2] * towards[2] < 0;
  if (flip) n = [-n[0], -n[1], -n[2]];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  const start = mesh.positions.length / 3;
  for (const p of flip ? [a, c, b] : [a, b, c]) {
    mesh.positions.push(...p);
    mesh.normals.push(n[0] / length, n[1] / length, n[2] / length);
    mesh.uvs.push(p[0], p[2]);
  }
  mesh.indices.push(start, start + 1, start + 2);
}

function key([x, z]: Vec2): string {
  return `${x.toFixed(6)},${z.toFixed(6)}`;
}

/* ------------------------------------------------------------------ boundaries */

/**
 * The property's sides and the enclosures the design proposes, each built as its kind is: panels
 * between posts, a wall with piers and a coping, a clipped hedge, balusters under a rail, a slatted
 * screen with a rail along the top. An open side builds nothing, which is what it says.
 *
 * `effectiveBoundaryRuns` decides which stretch of the survey a proposal replaces; this stands up
 * whatever it returns. The survey's own runs are what is there (`existing`); a proposal is the
 * element that proposes it.
 */
export function boundaryNodes(
  site: SiteSection,
  elements: DesignElement[],
  ground: Ground,
  materials: MaterialTable,
): { nodes: SolidNode[]; drawn: Set<string> } {
  const { survey, proposed } = effectiveBoundaryRuns(site, elements);
  const plot = boundaryPolygon(site);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const drawn = new Set<string>();
  const nodes: SolidNode[] = [];

  for (const run of [...survey, ...proposed]) {
    if (run.kind === 'open' || run.height <= 0 || run.length <= 0) continue;
    const parts = boundaryParts(run, run.inward ?? inwardOf(run, plot), ground, materials);
    if (parts.length === 0) continue;
    const element = run.sourceId ? byId.get(run.sourceId) : undefined;
    if (element) drawn.add(element.id);
    const inward = run.inward ?? inwardOf(run, plot);
    nodes.push({
      kind: 'solid',
      id: `boundary:${run.id ?? run.edgeVertexId}${run.sourceId ? `:${run.sourceId}` : ''}`,
      sourceId: run.sourceId ?? `boundary:${run.edgeVertexId}`,
      category: 'boundary',
      ...(element?.name ? { name: element.name } : {}),
      existing: element ? element.status === 'keep' : true,
      visibleByDefault: true,
      parts,
      // A hedge says so, with its band, for a renderer that draws clipped foliage rather than a block.
      ...(run.kind === 'hedge'
        ? { hedge: { outline: bandOf(run, inward).map(ground), base: 0, height: run.height } }
        : {}),
    });
  }
  return { nodes, drawn };
}

/**
 * Which way is into the plot from a survey side: probed a centimetre each way off its middle, as
 * `openingNormal` probes rather than trusting a winding. A proposed run carries its own.
 */
function inwardOf(run: BoundaryRun, plot: Point[]): Point {
  const dx = run.end.x - run.start.x;
  const dy = run.end.y - run.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const left = { x: -dy / length, y: dx / length };
  const mid = { x: (run.start.x + run.end.x) / 2, y: (run.start.y + run.end.y) / 2 };
  const probe = { x: mid.x + left.x * 0.01, y: mid.y + left.y * 0.01 };
  return pointInPolygon(probe, plot) ? left : { x: -left.x, y: -left.y };
}

/** The band a run occupies, from its line inward: where the plan draws it, and what a hedge takes. */
function bandOf(run: BoundaryRun, inward: Point): Point[] {
  const { thickness } = run;
  return [
    run.start,
    run.end,
    { x: run.end.x + inward.x * thickness, y: run.end.y + inward.y * thickness },
    { x: run.start.x + inward.x * thickness, y: run.start.y + inward.y * thickness },
  ];
}

function boundaryParts(
  run: BoundaryRun,
  inward: Point,
  ground: Ground,
  materials: MaterialTable,
): SolidNode['parts'] {
  const { kind, height, thickness } = run;
  const along = { x: run.end.x - run.start.x, y: run.end.y - run.start.y };
  const length = Math.hypot(along.x, along.y);
  const unit = { x: along.x / length, y: along.y / length };
  const band = bandOf(run, inward).map(ground);
  const centre = (t: number): Point => ({
    x: run.start.x + along.x * t + inward.x * (thickness / 2),
    y: run.start.y + along.y * t + inward.y * (thickness / 2),
  });
  const [ux, uz] = [unit.x, unit.y];
  const yaw = Math.atan2(-uz, ux);
  const body = materials.use(`boundary:${kind}`, 'boundary');
  const detail = () => materials.use(`boundary:${kind}:detail`, 'boundary');
  const cap = () => materials.use(`boundary:${kind}:cap`, 'boundary');

  const uprights = (size: Vec3): Mesh => {
    const spacing = BOUNDARY_BAYS[kind];
    const mesh = emptyMesh();
    if (!spacing) return mesh;
    const bays = Math.max(1, Math.ceil(length / spacing));
    for (let i = 0; i <= bays; i++) {
      const [x, z] = ground(centre(i / bays));
      mergeInto(mesh, boxMesh([x, 0, z], size, yaw));
    }
    return mesh;
  };
  const rail = (y: number, size: [number, number]): Mesh => {
    const [x, z] = ground(centre(0.5));
    return boxMesh([x, y, z], [length, size[0], size[1]], yaw);
  };

  switch (kind) {
    case 'fence':
      return [
        { material: body, mesh: prismMesh(band, 0, height) },
        { material: detail(), mesh: uprights([0.1, height + 0.05, Math.max(thickness, 0.1)]) },
      ];
    case 'screen':
      return [
        { material: body, mesh: prismMesh(band, 0, height) },
        { material: detail(), mesh: uprights([0.09, height, Math.max(thickness, 0.09)]) },
        { material: cap(), mesh: rail(height, [0.045, thickness + 0.03]) },
      ];
    case 'wall':
      return [
        { material: body, mesh: prismMesh(band, 0, height) },
        { material: detail(), mesh: uprights([0.35, height + 0.08, thickness + 0.1]) },
        { material: cap(), mesh: rail(height, [0.06, thickness + 0.06]) },
      ];
    case 'hedge':
      return [{ material: body, mesh: prismMesh(band, 0, height) }];
    case 'railing':
      return [
        { material: detail(), mesh: uprights([0.025, height, 0.025]) },
        {
          material: body,
          mesh: mergeInto(rail(height - 0.05, [0.05, 0.05]), rail(0.08, [0.04, 0.04])),
        },
      ];
    case 'open':
      return [];
  }
  // A kind a later catalogue added and this builder does not know yet: nothing, rather than a throw.
  return [];
}

/* ------------------------------------------------------------------ levels */

/**
 * The faces that hold a raised terrace up, or a sunken one back: a wall along every level band, as
 * thick as the plan draws it (`retainingThickness`), from the lower ground to a coping just proud
 * of the higher. In the walling the user chose, or the host's own paving where they chose none —
 * which is most raised terraces, and what `levelBands.walling === null` means.
 */
export function retainingNodes(
  elements: DesignElement[],
  house: HouseFootprint | null,
  ground: Ground,
  materials: MaterialTable,
): SolidNode[] {
  const bands = levelBands(elements, { house: house ? housePolygon(house) : undefined });
  const byHost = new Map<string, { material: string; mesh: Mesh }>();
  for (const band of bands) {
    const strip = polylineStrip(band.points, retainingThickness(band.rise));
    if (strip.length < 3) continue;
    const bottom = band.sunken ? -band.rise : 0;
    const material = materials.use(
      `material:${band.walling ?? band.material ?? 'paved-area'}`,
      'retaining',
    );
    const entry = byHost.get(band.hostId) ?? { material, mesh: emptyMesh() };
    mergeInto(entry.mesh, prismMesh(strip.map(ground), bottom, band.rise + RETAINING_LIP));
    byHost.set(band.hostId, entry);
  }
  return [...byHost].map(([hostId, { material, mesh }]) => ({
    kind: 'solid',
    id: `${hostId}:retaining`,
    sourceId: hostId,
    category: 'retaining',
    existing: false,
    visibleByDefault: true,
    parts: [{ material, mesh }],
  }));
}

/* ------------------------------------------------------------------ edging */

/**
 * The courses along a surface's edge, as `resolveEdges` resolves them — the same runs the plan draws
 * and the schedule counts — each a strip centred on its line at its own width, standing its own
 * height proud of the surface it edges. A flush join stands no height and builds nothing. A kerb the
 * design proposes as a line is a course on the ground, as the plan lays it.
 */
export function edgingNodes(
  elements: DesignElement[],
  site: SiteSection,
  rules: EdgeRuleContext | undefined,
  ground: Ground,
  materials: MaterialTable,
): { nodes: SolidNode[]; drawn: Set<string> } {
  const house = site.house ? housePolygon(site.house) : undefined;
  const { runs } = resolveEdges(elements, { boundary: boundaryPolygon(site), house }, rules);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const byHost = new Map<string, Map<string, Mesh>>();
  const add = (hostId: string, material: string, mesh: Mesh) => {
    const host = byHost.get(hostId) ?? new Map<string, Mesh>();
    host.set(material, mergeInto(host.get(material) ?? emptyMesh(), mesh));
    byHost.set(hostId, host);
  };

  for (const run of runs) {
    if (run.heightM <= 0 || run.widthM <= 0) continue;
    const strip = polylineStrip(run.points, run.widthM);
    if (strip.length < 3) continue;
    const base = byId.get(run.hostId)?.elevation ?? 0;
    add(
      run.hostId,
      materials.use(`material:${run.materialId ?? 'edging'}`, 'edging'),
      prismMesh(strip.map(ground), base, run.heightM),
    );
  }
  const drawn = new Set<string>();
  for (const kerb of kerbLines(elements)) {
    const strip = polylineStrip(kerb.points, kerb.width);
    if (strip.length < 3) continue;
    add(
      kerb.id,
      materials.use('material:concrete-kerb', 'edging'),
      prismMesh(strip.map(ground), 0, KERB_HEIGHT),
    );
    drawn.add(kerb.id);
  }

  const nodes = [...byHost].map(([hostId, meshes]): SolidNode => ({
    kind: 'solid',
    id: `${hostId}:edging`,
    sourceId: hostId,
    category: 'edging',
    existing: byId.get(hostId)?.status === 'keep',
    visibleByDefault: true,
    parts: [...meshes].map(([material, mesh]) => ({ material, mesh })),
  }));
  return { nodes, drawn };
}

/** How far a proposed kerb stands proud: the plan draws its course at this height too. */
const KERB_HEIGHT = 0.1;

/* ------------------------------------------------------------------ steps */

/**
 * A flight of steps as the risers it has: `stepFlight` divides the rise into whole steps near
 * 170 mm, and each is a solid block running from its nosing to the top of the flight, so the stack
 * is a staircase with no gaps under it.
 *
 * **Which end is the top is derived, never stored**: the plan records a rectangle and a rise, not a
 * direction. It is the end that meets the higher ground — probed a hand's width past each end
 * against every surface the plan has, the topmost one there deciding the level — which is the
 * terrace a flight was laid to serve, or the lawn round a sunken area a flight goes down into. Where
 * the two ends meet the same level the flight climbs towards its rectangle's far side.
 */
export function flightParts(
  element: DesignElement,
  surfaces: DesignElement[],
  origin: Point,
  material: string,
): SolidNode['parts'] | null {
  if (element.shape.kind !== 'rect') return null;
  const rise = element.elevation ?? 0;
  const flight = stepFlight(rise);
  if (!flight) return null;
  const { centre, width, depth } = element.shape;
  const yaw = yawFromPlanDegrees(element.shape.rotation ?? 0);
  const bottom = Math.min(0, rise);

  // The level at a point: the topmost surface there, in the plan's own stacking order, else grade.
  const levelAt = (probe: Point): number => {
    let level = 0;
    for (const surface of surfaces) {
      if (surface.id !== element.id && pointInPolygon(probe, elementOutline(surface)))
        level = surface.elevation ?? 0;
    }
    return level;
  };
  // In the rect's own frame the ends are at ±depth/2; the one meeting the higher ground is the top.
  const beyond = (sign: 1 | -1): number => {
    const [dx, dz] = rotateAboutY([0, sign * (depth / 2 + 0.2)], yaw);
    return levelAt({ x: centre.x + dx, y: centre.y + dz });
  };
  const climbs: 1 | -1 = beyond(-1) > beyond(1) ? -1 : 1;

  const going = depth / flight.risers;
  const mesh = emptyMesh();
  const [cx, cz] = planToGround(centre, origin);
  for (let i = 0; i < flight.risers; i++) {
    // From step i's nosing to the top end of the flight.
    const length = depth - i * going;
    const along = climbs * (depth / 2 - length / 2);
    const [ox, oz] = rotateAboutY([0, along], yaw);
    mergeInto(
      mesh,
      boxMesh(
        [cx + ox, bottom + i * flight.riserHeight, cz + oz],
        [width, flight.riserHeight, length],
        yaw,
      ),
    );
  }
  return [{ material, mesh }];
}

/* ------------------------------------------------------------------ hedging beds */

/**
 * A bed planted as hedging is a hedge, not a bed of plants: `bedPlanting` gives it no layers, so the
 * scene would otherwise lay it as bare ground. It stands as a clipped block to its own height, with
 * the `hedge` hint for a renderer that draws foliage — the same answer a hedge boundary gets.
 */
export function hedgingBedNodes(
  elements: DesignElement[],
  ground: Ground,
  materials: MaterialTable,
): SolidNode[] {
  return elements.flatMap((element): SolidNode[] => {
    if (
      element.category !== 'planting-bed' ||
      element.shape.kind === 'point' ||
      element.material !== HEDGING
    )
      return [];
    const ring = elementOutline(element).map(ground);
    const height = heightFor(element);
    const base = element.elevation ?? 0;
    if (ring.length < 3 || height <= 0) return [];
    return [
      {
        kind: 'solid',
        id: `${element.id}:hedge`,
        sourceId: element.id,
        category: 'shrub',
        ...(element.name ? { name: element.name } : {}),
        existing: element.status === 'keep',
        visibleByDefault: true,
        parts: [
          {
            material: materials.use(`foliage:${HEDGING}`, 'shrub'),
            mesh: prismMesh(ring, base, height),
          },
        ],
        hedge: { outline: ring, base, height },
      },
    ];
  });
}

/** The planting material that is a hedge rather than a bed of plants, as `plantingExclusions` knows it. */
const HEDGING = 'hedging';
