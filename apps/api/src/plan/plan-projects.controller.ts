import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreatePlanProjectSchema,
  GenerateConceptsSchema,
  PatchBriefSchema,
  PatchConceptSelectionSchema,
  PatchFeaturesSchema,
  PatchLayoutSchema,
  PatchSiteSchema,
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
  type RenameProject,
  type SectionPatchResult,
  type ValidateDocument,
  type ValidationResult,
} from '@garden-studio/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
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

@Controller('plan-projects')
export class PlanProjectsController {
  constructor(private readonly projects: PlanProjectsService) {}

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
}
