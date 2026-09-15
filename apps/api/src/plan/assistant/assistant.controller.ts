import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ProposeGardenRequestSchema,
  ProposeRequestSchema,
  RedesignRequestSchema,
  type AssistantAvailability,
  type AssistantProposal,
  type GardenProposal,
  type ProposeGardenRequest,
  type ProposeRequest,
  type RedesignRequest,
  type RedesignResult,
} from '@garden-studio/schema';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PlanProjectsService } from '../plan-projects.service.js';
import { AssistantService } from './assistant.service.js';
import { GardenAssistantService } from './garden/garden-assistant.service.js';

const proposeBody = new ZodValidationPipe(ProposeRequestSchema);
const gardenBody = new ZodValidationPipe(ProposeGardenRequestSchema);
const redesignBody = new ZodValidationPipe(RedesignRequestSchema);

@Controller('plan-projects')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly garden: GardenAssistantService,
    private readonly projects: PlanProjectsService,
  ) {}

  /**
   * Whether this server can interpret a sentence at all.
   *
   * **Above the `:id` routes on purpose.** Nest matches in declaration order, so declared after
   * them `assistant/availability` would be swallowed by `:id/...` with "availability" taken as a
   * project id — which `ParseUUIDPipe` then rejects as a 400. It reads no project and needs none:
   * whether a key is configured is a fact about the server.
   */
  @Get('assistant/availability')
  availability(): AssistantAvailability {
    return { model: this.assistant.available };
  }

  /**
   * Turns a sentence into a diff the editor performs. Reads the stored plan and writes nothing —
   * changing the garden is the editor's job, and it arrives later as an ordinary layout patch.
   */
  @Post(':id/assistant/messages')
  async propose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(proposeBody) body: ProposeRequest,
  ): Promise<AssistantProposal> {
    const project = await this.projects.findOne(id);

    return this.assistant.propose(id, body.message, project.document, body.history);
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

  /**
   * The same planner, asked directly in intents rather than through a sentence.
   *
   * This is what the design reviewer uses: it has already decided what is wrong and which element
   * it is about, so there is nothing to interpret. Writes nothing, like the route above — what
   * comes back is a diff the editor may animate, apply, or throw away.
   */
  @Post(':id/assistant/redesign')
  async redesign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(redesignBody) body: RedesignRequest,
  ): Promise<RedesignResult> {
    const project = await this.projects.findOne(id);
    return this.assistant.redesign(project.document, body.intents, body.elements);
  }
}
