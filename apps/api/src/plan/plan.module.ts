import { Module } from '@nestjs/common';
import { AnthropicModule } from './assistant/anthropic.module.js';
import { AssistantController } from './assistant/assistant.controller.js';
import { AssistantService } from './assistant/assistant.service.js';
import { IntentService } from './assistant/intent.service.js';
import { PlannerService } from './assistant/planner.service.js';
import { ConceptsService } from './generation/concepts.service.js';
import { FillService } from './generation/fill.service.js';
import { PlacementService } from './generation/placement.service.js';
import { GeometryValidationService } from './geometry-validation.service.js';
import { PlanProjectsController } from './plan-projects.controller.js';
import { PlanProjectsService } from './plan-projects.service.js';

/**
 * The plan wizard's backend. `DbModule` is `@Global()`, so nothing needs importing for the
 * database; `AnthropicModule` is not global, because only the assistant talks to a model.
 */
@Module({
  imports: [AnthropicModule],
  controllers: [PlanProjectsController, AssistantController],
  providers: [
    GeometryValidationService,
    PlacementService,
    FillService,
    ConceptsService,
    PlanProjectsService,
    IntentService,
    PlannerService,
    AssistantService,
  ],
  exports: [GeometryValidationService, ConceptsService, PlanProjectsService, AssistantService],
})
export class PlanModule {}
