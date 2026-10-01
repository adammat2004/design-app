import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UseGuards,
  type CanActivate,
} from '@nestjs/common';
import {
  ModelGenerationRequestSchema,
  ModelPublishRequestSchema,
  type ModelGenerationRequest,
  type ModelJob,
  type ModelLabStatus,
  type ModelPublishRequest,
  type ModelReference,
  type ModelRequestResult,
} from '@garden-studio/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ModelJobsService } from './model-jobs.service.js';
import { ModelStorage } from './model-storage.js';

/** Every route here answers 404 in production: generation is a development tool that spends money. */
class DevelopmentOnly implements CanActivate {
  canActivate(): boolean {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    return true;
  }
}

const requestBody = new ZodValidationPipe(ModelGenerationRequestSchema);
const publishBody = new ZodValidationPipe(ModelPublishRequestSchema);

/**
 * The model lab's API (`/model-lab` in the web app). Development only, loopback only (see
 * `main.ts`), and 503 for anything that would spend while generation is not switched on.
 */
@Controller('model-assets')
@UseGuards(DevelopmentOnly)
export class ModelAssetsController {
  constructor(private readonly jobs: ModelJobsService) {}

  @Get('status')
  status(): Promise<ModelLabStatus> {
    return this.jobs.status();
  }

  @Get('references')
  references(): ModelReference[] {
    return this.jobs.references();
  }

  @Get('references/:name/image')
  referenceImage(@Param('name') name: string): StreamableFile {
    return new StreamableFile(this.jobs.referenceImage(name), { type: 'image/png' });
  }

  @Get('jobs')
  list(): Promise<ModelJob[]> {
    return this.jobs.list();
  }

  /** Ask for a model. Reuse first; a new job only within the ceiling and the in-flight limit. */
  @Post('requests')
  request(@Body(requestBody) body: ModelGenerationRequest): Promise<ModelRequestResult> {
    return this.jobs.request(body);
  }

  /** A job, advanced a step first — polling this is what moves a job along. */
  @Get('jobs/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ModelJob> {
    return this.jobs.get(id);
  }

  @Get('jobs/:id/files/:name')
  file(@Param('id', ParseUUIDPipe) id: string, @Param('name') name: string): StreamableFile {
    if (!ModelStorage.allowed(name)) throw new NotFoundException();
    const { bytes, contentType } = this.jobs.file(id, name);
    return new StreamableFile(bytes, { type: contentType });
  }

  @Post('jobs/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<ModelJob> {
    return this.jobs.cancel(id);
  }

  @Post('jobs/:id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string): Promise<ModelJob> {
    return this.jobs.reject(id);
  }

  @Post('jobs/:id/publish')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(publishBody) body: ModelPublishRequest,
  ): Promise<ModelJob> {
    return this.jobs.publish(id, body);
  }
}
