import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreatePlanProjectSchema,
  GenerateConceptsSchema,
  PatchBriefSchema,
  PatchConceptSelectionSchema,
  PatchFeaturesSchema,
  PatchLayoutSchema,
  PatchSiteSchema,
  RecordDesignEventsSchema,
  RenameProjectSchema,
  ValidateDocumentSchema,
  type CreatePlanProject,
  type GenerateConcepts,
  type GenerateConceptsResult,
  type PatchBrief,
  type PatchConceptSelection,
  type PatchFeatures,
  type PatchLayout,
  type PatchSite,
  type PlanProject,
  type PlanProjectSummary,
  type RecordDesignEvents,
  type RecordDesignEventsResult,
  type RenameProject,
  type SectionPatchResult,
  type ValidateDocument,
  type ValidationResult,
  ReviewDesignSchema,
  type ReviewDesign,
  type ReviewDesignResult,
} from '@garden-studio/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DesignEventsService } from './design-events.service.js';
import { DesignReviewService } from './design-review.service.js';
import { PlanProjectsService } from './plan-projects.service.js';

const createBody = new ZodValidationPipe(CreatePlanProjectSchema);
const renameBody = new ZodValidationPipe(RenameProjectSchema);
const siteBody = new ZodValidationPipe(PatchSiteSchema);
const featuresBody = new ZodValidationPipe(PatchFeaturesSchema);
const briefBody = new ZodValidationPipe(PatchBriefSchema);
const layoutBody = new ZodValidationPipe(PatchLayoutSchema);
const selectionBody = new ZodValidationPipe(PatchConceptSelectionSchema);
const validateBody = new ZodValidationPipe(ValidateDocumentSchema);
const generateBody = new ZodValidationPipe(GenerateConceptsSchema);
const eventsBody = new ZodValidationPipe(RecordDesignEventsSchema);
const reviewBody = new ZodValidationPipe(ReviewDesignSchema);

@Controller('plan-projects')
export class PlanProjectsController {
  constructor(
    private readonly projects: PlanProjectsService,
    private readonly events: DesignEventsService,
    private readonly reviewer: DesignReviewService,
  ) {}

  @Post()
  create(@Body(createBody) body: CreatePlanProject): Promise<PlanProject> {
    return this.projects.create(body);
  }

  @Get()
  list(): Promise<PlanProjectSummary[]> {
    return this.projects.list();
  }

  /**
   * Side-effect free, so the wizard can ask "would this be legal?" without writing anything —
   * the same property the validator's inline geometry gives it.
   *
   * Declared before `:id` would matter for a GET; as a POST on a distinct path it cannot
   * collide, but keeping the static route first is the habit that stops the next one biting.
   */
  @Post('validate')
  validate(@Body(validateBody) body: ValidateDocument): Promise<ValidationResult> {
    return this.projects.validate(body.document);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PlanProject> {
    return this.projects.findOne(id);
  }

  @Patch(':id')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(renameBody) body: RenameProject,
  ): Promise<PlanProject> {
    return this.projects.rename(id, body.revision, body.name);
  }

  @Patch(':id/site')
  patchSite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(siteBody) body: PatchSite,
  ): Promise<SectionPatchResult> {
    return this.projects.patchSection(id, 'site', body.revision, body.section);
  }

  @Patch(':id/features')
  patchFeatures(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(featuresBody) body: PatchFeatures,
  ): Promise<SectionPatchResult> {
    return this.projects.patchSection(id, 'features', body.revision, body.section);
  }

  @Patch(':id/brief')
  patchBrief(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(briefBody) body: PatchBrief,
  ): Promise<SectionPatchResult> {
    return this.projects.patchSection(id, 'brief', body.revision, body.section);
  }

  @Patch(':id/layout')
  patchLayout(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(layoutBody) body: PatchLayout,
  ): Promise<SectionPatchResult> {
    return this.projects.patchSection(id, 'layout', body.revision, body.section);
  }

  @Patch(':id/concept-selection')
  patchConceptSelection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(selectionBody) body: PatchConceptSelection,
  ): Promise<SectionPatchResult> {
    return this.projects.patchConceptSelection(id, body);
  }

  /**
   * Generates concepts into the plan. 422 when the stored geometry is invalid — the one write
   * path that still refuses, because the generator has to be able to trust its input.
   */
  @Post(':id/concepts/generate')
  generateConcepts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(generateBody) body: GenerateConcepts,
  ): Promise<GenerateConceptsResult> {
    return this.projects.generateConcepts(id, body);
  }

  /**
   * What the person did with the design they were offered.
   *
   * A batch, because the editor produces these in bursts and a request per gesture would put the
   * measurement in the way of the thing being measured. The client never waits on the answer and
   * never acts on it — a failed insert is logged and reported as zero rather than raised, because
   * telemetry that can break an editor is worth less than none.
   */
  @Post(':id/events')
  recordEvents(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(eventsBody) body: RecordDesignEvents,
  ): Promise<RecordDesignEventsResult> {
    return this.events.record(id, body.events);
  }

  /**
   * A designer's reading of a layout, written nowhere.
   *
   * The elements come in the body rather than being read from the stored plan, because the question
   * is asked *during* a redesign — about a garden that has not been saved and should not be until
   * somebody decides to keep it. Side-effect free for the same reason `POST /validate` is: the
   * editor has to be able to ask "is this any good" without committing to the answer.
   */
  @Post(':id/design/review')
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(reviewBody) body: ReviewDesign,
  ): Promise<ReviewDesignResult> {
    const project = await this.projects.findOne(id);
    return { score: this.reviewer.review(project.document, body.elements) };
  }
}
