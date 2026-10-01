import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readModelAssetsConfig, type ModelAssetsConfig } from './model-assets.config.js';
import { ModelAssetsController } from './model-assets.controller.js';
import { MESHY, MODEL_ASSETS_CONFIG, ModelJobsService } from './model-jobs.service.js';
import { MeshyClient, type MeshyApi } from './meshy.client.js';

/**
 * The model library's generation side: Meshy, the job ledger and the lab's API.
 *
 * Meshy resolves to `null` unless generation is switched on (`MODEL_GENERATION_ENABLED=true`, a
 * `MESHY_API_KEY`, not production), exactly as the Anthropic client resolves to `null` without its
 * key: `pnpm dev` and the whole test suite work for somebody with no key, and the lab says
 * "unavailable" rather than the server failing to start.
 */
@Module({
  controllers: [ModelAssetsController],
  providers: [
    {
      provide: MODEL_ASSETS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ModelAssetsConfig => readModelAssetsConfig(config),
    },
    {
      provide: MESHY,
      inject: [ConfigService, MODEL_ASSETS_CONFIG],
      useFactory: (config: ConfigService, assets: ModelAssetsConfig): MeshyApi | null => {
        const key = config.get<string>('MESHY_API_KEY');
        return assets.enabled && key ? new MeshyClient(key) : null;
      },
    },
    ModelJobsService,
  ],
  exports: [ModelJobsService],
})
export class ModelAssetsModule {}
