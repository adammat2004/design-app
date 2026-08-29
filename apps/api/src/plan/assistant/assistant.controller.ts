import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ProposeRequestSchema,
  type AssistantProposal,
  type ProposeRequest,
} from '@garden-studio/schema';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PlanProjectsService } from '../plan-projects.service.js';
import { AssistantService } from './assistant.service.js';

const proposeBody = new ZodValidationPipe(ProposeRequestSchema);

@Controller('plan-projects')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
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
}
