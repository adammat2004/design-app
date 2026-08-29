import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PLAN_DOCUMENT_VERSION,
  emptyPlanDocument,
  readPlanDocument,
  type CreatePlanProject,
  type GenerateConcepts,
  type GenerateConceptsResult,
  type PatchConceptSelection,
  type PlanDocument,
  type PlanProject,
  type PlanProjectSummary,
  type SectionPatchResult,
  type ValidationResult,
} from '@garden-studio/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { planProjects, type PlanProjectRow } from '../db/schema.js';
import { ConceptsService } from './generation/concepts.service.js';
import { GeometryValidationService } from './geometry-validation.service.js';

/** The sections a client may write. `concepts` is generator-owned, so it is not one of them. */
type WritableSection = 'site' | 'features' | 'brief' | 'layout';

@Injectable()
export class PlanProjectsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly validation: GeometryValidationService,
    private readonly concepts: ConceptsService,
  ) {}

  async create(input: CreatePlanProject): Promise<PlanProject> {
    const [row] = await this.db
      .insert(planProjects)
      .values({ name: input.name, document: emptyPlanDocument() })
      .returning();

    return toResource(row!);
  }

  async list(): Promise<PlanProjectSummary[]> {
    const rows = await this.db
      .select({
        id: planProjects.id,
        name: planProjects.name,
        revision: planProjects.revision,
        createdAt: planProjects.createdAt,
        updatedAt: planProjects.updatedAt,
      })
      .from(planProjects)
      .orderBy(desc(planProjects.updatedAt));

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async findOne(id: string): Promise<PlanProject> {
    const [row] = await this.db.select().from(planProjects).where(eq(planProjects.id, id));

    if (!row) throw new NotFoundException(`No plan project with id ${id}.`);

    return toResource(row);
  }

  async rename(id: string, revision: number, name: string): Promise<PlanProject> {
    const current = await this.findOne(id);

    return this.write(id, revision, current.document, { name });
  }

  /**
   * Writes one section over the stored document, then reports what is now wrong with the whole
   * thing.
   *
   * The draft is persisted **even when it is invalid**. A user can reach an illegal state
   * through the UI — drag a boundary vertex inward past a shed — and refusing the write would
   * silently lose every edit that followed until they noticed. Continue is gated on
   * `violations` being empty instead, which is a thing the user can see and fix.
   *
   * Validation runs on the merge rather than on the section alone, which is why the service
   * keeps a whole-document signature. It costs no extra query: the stored row had to be read
   * for the revision check anyway.
   */
  async patchSection<S extends WritableSection>(
    id: string,
    section: S,
    revision: number,
    value: PlanDocument[S],
  ): Promise<SectionPatchResult> {
    const current = await this.findOne(id);
    const merged: PlanDocument = { ...current.document, [section]: value };

    const project = await this.write(id, revision, merged);
    const { violations } = await this.validate(merged);

    return { project, violations };
  }

  /** Step 4 writes only the selection; the concepts array itself is generator-owned. */
  async patchConceptSelection(
    id: string,
    input: PatchConceptSelection,
  ): Promise<SectionPatchResult> {
    const current = await this.findOne(id);
    const merged: PlanDocument = {
      ...current.document,
      concepts: {
        ...current.document.concepts,
        selectedId: input.selectedId,
        chosenConceptId: input.chosenConceptId,
      },
    };

    return { project: await this.write(id, input.revision, merged), violations: [] };
  }

  validate(document: PlanDocument): Promise<ValidationResult> {
    return this.validation.validate(document);
  }

  /**
   * Generates concepts and writes them into the plan.
   *
   * The one place a 422 still lives. Everywhere else an invalid draft is stored and reported,
   * because refusing an autosave loses work — but the generator has to be able to trust its
   * input, and this is the point at which the user is asking for real work rather than typing.
   *
   * The seed is advanced here, server-side, and written back. That is what makes "Regenerate"
   * mean "roll again" instead of handing back the same three gardens, and it is why the client
   * never sends one.
   */
  async generateConcepts(id: string, input: GenerateConcepts): Promise<GenerateConceptsResult> {
    const current = await this.findOne(id);

    const { valid, violations } = await this.validate(current.document);
    if (!valid) {
      throw new UnprocessableEntityException({
        message: 'Fix the problems on the plan before generating concepts.',
        violations,
      });
    }

    const seed = current.document.concepts.seed + 1;
    const existing = current.document.concepts.concepts;

    const concepts =
      input.mode === 'all'
        ? await this.concepts.generate(current.document, seed)
        : replaceAt(
            existing,
            input.index,
            await this.concepts.regenerate(current.document, seed, input.index),
          );

    /*
     * A regenerated slot invalidates a choice that pointed at it, and `chosenConcept` derives
     * liveness from the array anyway — but `selectedId` has to be repointed, or the screen would
     * show nothing after a reroll.
     */
    const selectedId =
      input.mode === 'all'
        ? ((concepts.find((concept) => concept.recommended) ?? concepts[0])?.id ?? null)
        : (concepts[input.index]?.id ?? current.document.concepts.selectedId);

    const merged: PlanDocument = {
      ...current.document,
      concepts: { ...current.document.concepts, concepts, selectedId, seed },
    };

    return { project: await this.write(id, input.revision, merged), concepts };
  }

  /**
   * Compare-and-swap on `revision`, in one statement — no transaction needed. A row that fails
   * to come back either does not exist or was written by someone else in the meantime, and the
   * 409 carries the server's current state so the client can adopt it rather than guess.
   */
  private async write(
    id: string,
    revision: number,
    document: PlanDocument,
    extra: { name?: string } = {},
  ): Promise<PlanProject> {
    const [row] = await this.db
      .update(planProjects)
      .set({
        ...extra,
        document: { ...document, version: PLAN_DOCUMENT_VERSION },
        revision: sql`${planProjects.revision} + 1`,
        /*
         * `now()` rather than `new Date()`: inserts stamp `created_at`/`updated_at` from
         * Postgres at microsecond precision, and a JavaScript Date only carries milliseconds.
         * Mixing the two lets a row written *after* another sort *before* it, which shows up as
         * a project list in the wrong order.
         */
        updatedAt: sql`now()`,
      })
      .where(and(eq(planProjects.id, id), eq(planProjects.revision, revision)))
      .returning();

    if (row) return toResource(row);

    // findOne throws 404 if it is genuinely gone, which is the more useful answer.
    const current = await this.findOne(id);

    throw new ConflictException({
      message: 'This plan changed somewhere else — reload to pick up the newer version.',
      current,
    });
  }
}

/** Replaces one slot, extending the list if the set was short. */
function replaceAt<T>(list: T[], index: number, value: T): T[] {
  const next = [...list];
  next[index] = value;

  return next.filter((entry): entry is T => entry !== undefined);
}

function toResource(row: PlanProjectRow): PlanProject {
  return {
    id: row.id,
    name: row.name,
    document: readPlanDocument(row.document),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
