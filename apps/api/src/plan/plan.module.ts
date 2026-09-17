import { Module } from '@nestjs/common';
import { AnthropicModule } from './assistant/anthropic.module.js';
import { AssistantController } from './assistant/assistant.controller.js';
import { AssistantService } from './assistant/assistant.service.js';
import { DesignBriefService } from './assistant/design-brief/design-brief.service.js';
import { AssistantRateLimit } from './assistant/rate-limit.js';
import { GardenAssistantService } from './assistant/garden/garden-assistant.service.js';
import { GardenIntentService } from './assistant/garden/garden-intent.service.js';
import { GardenPlannerService } from './assistant/garden/garden-planner.service.js';
import { IntentService } from './assistant/intent.service.js';
import { PlannerService } from './assistant/planner.service.js';
import { DesignEventsService } from './design-events.service.js';
import { DesignRepairService } from './design-repair.service.js';
import { DesignReviewService } from './design-review.service.js';
import { ConceptsService } from './generation/concepts.service.js';
import { FillService } from './generation/fill.service.js';
import { PlacementService } from './generation/placement.service.js';
import { GeometryValidationService } from './geometry-validation.service.js';
import { PlanProjectsController } from './plan-projects.controller.js';
import { PlanProjectsService } from './plan-projects.service.js';

/**
 * The plan wizard's backend. `DbModule` is `@Global()`, so nothing needs importing for the
 * database; `AnthropicModule` is not global, because only the assistant talks to a model.
 *
 * `DesignBriefService` is the one assistant on the *generation* path rather than behind an endpoint
 * of its own, which is why `ConceptsService` takes it as an `@Optional()` dependency: the concept
 * suite, the reference fixtures and the eval harness all construct that service by hand, and none
 * of them wants a model in the loop.
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
    AssistantRateLimit,
    GardenIntentService,
    GardenPlannerService,
    GardenAssistantService,
    DesignBriefService,
    DesignEventsService,
    DesignReviewService,
    DesignRepairService,
  ],
  exports: [GeometryValidationService, ConceptsService, PlanProjectsService, AssistantService],
})
export class PlanModule {}
