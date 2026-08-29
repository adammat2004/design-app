import { emptyPlanDocument, type PlacedFeature, type SiteSection } from '@garden-studio/schema';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConceptsService } from './generation/concepts.service.js';
import { FillService } from './generation/fill.service.js';
import { PlacementService } from './generation/placement.service.js';
import { GeometryValidationService } from './geometry-validation.service.js';
import { PlanProjectsService } from './plan-projects.service.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE, type TestDatabase } from '../test/db.js';

const connection = await connectTestDatabase();

const closedSite: SiteSection = {
  vertices: [
    { id: 'v1', x: 0, y: 0 },
    { id: 'v2', x: 10, y: 0 },
    { id: 'v3', x: 10, y: 8 },
    { id: 'v4', x: 0, y: 8 },
  ],
  closed: true,
  house: null,
  selectedZoneIds: [],
};

/** Generation needs a house, because the zones are derived from where it sits. */
const housedSite: SiteSection = {
  ...closedSite,
  vertices: [
    { id: 'v1', x: 0, y: 0 },
    { id: 'v2', x: 20, y: 0 },
    { id: 'v3', x: 20, y: 16 },
    { id: 'v4', x: 0, y: 16 },
  ],
  house: {
    outline: [
      { id: 'h0', x: -4, y: -3 },
      { id: 'h1', x: 4, y: -3 },
      { id: 'h2', x: 4, y: 3 },
      { id: 'h3', x: -4, y: 3 },
    ],
    centre: { x: 10, y: 4 },
    rotation: 0,
  },
  selectedZoneIds: ['front', 'back'],
};

function shed(id: string, x: number, y: number): PlacedFeature {
  return {
    id,
    kind: 'shed',
    name: id,
    geometry: { kind: 'rect', centre: { x, y }, width: 2, depth: 2, rotation: 0 },
    status: 'keep',
    replaceWith: null,
  };
}

describe.skipIf(connection === null)('PlanProjectsService', () => {
  let service: PlanProjectsService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    service = new PlanProjectsService(
      db.db,
      new GeometryValidationService(db.db),
      new ConceptsService(new PlacementService(db.db), new FillService(db.db)),
    );
  });

  afterEach(async () => {
    await db.truncate();
  });

  afterAll(async () => {
    await db?.close();
  });

  it('creates a project holding an empty plan at revision 1', async () => {
    const project = await service.create({ name: 'Test garden' });

    expect(project.name).toBe('Test garden');
    expect(project.revision).toBe(1);
    expect(project.document).toEqual(emptyPlanDocument());
  });

  it('reads a project back', async () => {
    const created = await service.create({ name: 'Readable' });
    const found = await service.findOne(created.id);

    expect(found).toEqual(created);
  });

  it('404s on an id that does not exist', async () => {
    await expect(service.findOne('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('persists a section and bumps the revision', async () => {
    const created = await service.create({ name: 'Mapped' });

    const { project } = await service.patchSection(
      created.id,
      'site',
      created.revision,
      closedSite,
    );

    expect(project.revision).toBe(2);
    expect(project.document.site.closed).toBe(true);
    expect(project.document.site.vertices).toHaveLength(4);

    // And it is genuinely on disk, not just in the response.
    expect((await service.findOne(created.id)).document.site.vertices).toHaveLength(4);
  });

  it('leaves the other sections alone when one is written', async () => {
    const created = await service.create({ name: 'Partial' });
    const afterSite = await service.patchSection(created.id, 'site', created.revision, closedSite);

    const { project } = await service.patchSection(
      created.id,
      'brief',
      afterSite.project.revision,
      { ...emptyPlanDocument().brief, budget: 'medium' },
    );

    expect(project.document.brief.budget).toBe('medium');
    expect(project.document.site.vertices).toHaveLength(4);
  });

  it('reports violations alongside a clean save', async () => {
    const created = await service.create({ name: 'Valid' });
    const site = await service.patchSection(created.id, 'site', created.revision, closedSite);

    const result = await service.patchSection(created.id, 'features', site.project.revision, {
      features: [shed('shed-1', 2, 2), shed('shed-2', 6, 6)],
      skipped: false,
    });

    expect(result.violations).toEqual([]);
  });

  /*
   * The decision this pins: an autosaving wizard cannot reject invalid geometry, because the
   * user can reach an illegal state through the UI and would then silently lose every
   * subsequent edit. The draft is stored and the problem is reported.
   */
  it('stores an invalid draft and reports what is wrong with it', async () => {
    const created = await service.create({ name: 'Invalid' });
    const site = await service.patchSection(created.id, 'site', created.revision, closedSite);

    const result = await service.patchSection(created.id, 'features', site.project.revision, {
      features: [shed('shed-1', 2, 2), shed('shed-2', 3, 3)],
      skipped: false,
    });

    expect(result.violations.map((v) => v.code)).toContain('features_overlap');
    // Stored regardless.
    expect((await service.findOne(created.id)).document.features.features).toHaveLength(2);
  });

  it('409s on a stale revision and hands back the current project', async () => {
    const created = await service.create({ name: 'Contended' });
    await service.patchSection(created.id, 'site', created.revision, closedSite);

    // Second tab still thinks it is on revision 1.
    const stale = service.patchSection(created.id, 'site', created.revision, closedSite);

    await expect(stale).rejects.toBeInstanceOf(ConflictException);

    const error = await stale.catch((caught: ConflictException) => caught);
    const body = (error as ConflictException).getResponse() as {
      current: { revision: number };
    };

    expect(body.current.revision).toBe(2);
  });

  it('renames without touching the document', async () => {
    const created = await service.create({ name: 'Before' });
    const site = await service.patchSection(created.id, 'site', created.revision, closedSite);

    const renamed = await service.rename(created.id, site.project.revision, 'After');

    expect(renamed.name).toBe('After');
    expect(renamed.document.site.vertices).toHaveLength(4);
  });

  it('writes only the selection when step 4 chooses a concept', async () => {
    const created = await service.create({ name: 'Chosen' });

    const { project } = await service.patchConceptSelection(created.id, {
      revision: created.revision,
      selectedId: 'c1-0',
      chosenConceptId: 'c1-0',
    });

    expect(project.document.concepts.chosenConceptId).toBe('c1-0');
    // The generator owns the array; a selection write must not have invented one.
    expect(project.document.concepts.concepts).toEqual([]);
  });

  /* ---------------------------------------------------------------- generation */

  it('generates concepts into the plan and advances the seed', async () => {
    const created = await service.create({ name: 'Generated' });
    const site = await service.patchSection(created.id, 'site', created.revision, housedSite);
    const brief = await service.patchSection(created.id, 'brief', site.project.revision, {
      ...emptyPlanDocument().brief,
      desiredFeatures: ['seating'],
      budget: 'medium',
      maintenance: 'medium',
      style: 'modern',
    });

    const { project, concepts } = await service.generateConcepts(created.id, {
      revision: brief.project.revision,
      mode: 'all',
    });

    expect(concepts).toHaveLength(3);
    expect(project.document.concepts.seed).toBe(2);
    expect(project.document.concepts.concepts).toHaveLength(3);
    // The recommendation is pre-selected, so the screen has something to show.
    expect(project.document.concepts.selectedId).toBe(concepts[0]!.id);

    // And they are genuinely stored, not just returned.
    expect((await service.findOne(created.id)).document.concepts.concepts).toHaveLength(3);
  });

  it('rerolls a single slot, leaving the others alone', async () => {
    const created = await service.create({ name: 'Rerolled' });
    const site = await service.patchSection(created.id, 'site', created.revision, housedSite);
    const first = await service.generateConcepts(created.id, {
      revision: site.project.revision,
      mode: 'all',
    });

    const { project } = await service.generateConcepts(created.id, {
      revision: first.project.revision,
      mode: 'one',
      index: 1,
    });

    const before = first.project.document.concepts.concepts;
    const after = project.document.concepts.concepts;

    expect(after).toHaveLength(3);
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
    expect(after[1]!.id).not.toBe(before[1]!.id);
  });

  /*
   * The one write path that still refuses. Everywhere else an invalid draft is stored and
   * reported, because refusing an autosave loses work — but the generator has to be able to trust
   * its input.
   */
  it('refuses to generate against an invalid plan', async () => {
    const created = await service.create({ name: 'Broken' });
    const site = await service.patchSection(created.id, 'site', created.revision, housedSite);
    const features = await service.patchSection(created.id, 'features', site.project.revision, {
      features: [shed('shed-1', 2, 2), shed('shed-2', 3, 3)],
      skipped: false,
    });

    const generate = service.generateConcepts(created.id, {
      revision: features.project.revision,
      mode: 'all',
    });

    await expect(generate).rejects.toBeInstanceOf(UnprocessableEntityException);

    const error = await generate.catch((caught: UnprocessableEntityException) => caught);
    const body = (error as UnprocessableEntityException).getResponse() as {
      violations: { code: string }[];
    };

    expect(body.violations.map((violation) => violation.code)).toContain('features_overlap');
  });

  it('409s on a stale revision when generating', async () => {
    const created = await service.create({ name: 'Contended generate' });
    const site = await service.patchSection(created.id, 'site', created.revision, housedSite);
    await service.generateConcepts(created.id, {
      revision: site.project.revision,
      mode: 'all',
    });

    const stale = service.generateConcepts(created.id, {
      revision: site.project.revision,
      mode: 'all',
    });

    await expect(stale).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists projects newest-first without their documents', async () => {
    await service.create({ name: 'Older' });
    const newer = await service.create({ name: 'Newer' });
    await service.patchSection(newer.id, 'site', newer.revision, closedSite);

    const list = await service.list();

    expect(list.map((project) => project.name)).toEqual(['Newer', 'Older']);
    expect(list[0]).not.toHaveProperty('document');
  });
});

if (connection === null) {
  describe('PlanProjectsService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}
