import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ProposeGardenRequestSchema,
  ProposeRequestSchema,
  type AssistantProposal,
  type GardenProposal,
  type ProposeGardenRequest,
  type ProposeRequest,
} from '@garden-studio/schema';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PlanProjectsService } from '../plan-projects.service.js';
import { AssistantService } from './assistant.service.js';
import { GardenAssistantService } from './garden/garden-assistant.service.js';

const proposeBody = new ZodValidationPipe(ProposeRequestSchema);
const gardenBody = new ZodValidationPipe(ProposeGardenRequestSchema);

@Controller('plan-projects')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly garden: GardenAssistantService,
    private readonly projects: PlanProjectsService,
  ) {}

  /**
   * Turns a sentence into a reviewable diff. Reads the stored plan and writes nothing — applying a
   * change is the editor's job, and it arrives later as an ordinary layout patch.
   */
  @Post(':id/assistant/messages')
  async propose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(proposeBody) body: ProposeRequest,
  ): Promise<AssistantProposal> {
    const project = await this.projects.findOne(id);

    return this.assistant.propose(id, body.message, project.document);
  }

  /**
   * Step 2's garden assistant: a description of a garden in, validated feature changes out.
   *
   * Side-effect free like its sibling — the changes are applied by the features store, and reach
   * the server afterwards as an ordinary `PATCH /:id/features`. The request carries only the
   * sentence; everything else is read from the stored plan, so the assistant can never be asked to
   * reason about a garden that is not the one saved.
   */
  @Post(':id/assistant/garden')
  async proposeGarden(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(gardenBody) body: ProposeGardenRequest,
  ): Promise<GardenProposal> {
    const project = await this.projects.findOne(id);

    return this.garden.propose(id, body.message, project.document);
  }
}
