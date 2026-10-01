import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DbModule } from '../src/db/db.module';
import { ModelAssetsModule } from '../src/model-assets/model-assets.module';
import { ModelJobsService } from '../src/model-assets/model-jobs.service';

/**
 * Only what the sweep needs. The whole `AppModule` cannot be booted from `tsx`: esbuild does not emit
 * decorator metadata, and services elsewhere inject by type. Everything here injects by token.
 */
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, ModelAssetsModule] })
class SyncModule {}

/**
 * Move every live model job on by one step, from the terminal: what the API does once at boot.
 *
 *     pnpm --filter @garden-studio/api models:sync
 *
 * For a job left mid-generation with nobody watching the lab: Meshy keeps a finished result for only
 * three days, and a job advances only when something asks about it. It boots the API's own model
 * module (no HTTP server), so it runs under exactly the configuration and rules the API does —
 * including spending nothing unless `MODEL_GENERATION_ENABLED=true`.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SyncModule, { logger: ['error', 'warn'] });
  try {
    const jobs = app.get(ModelJobsService);
    const { looked } = await jobs.sweep();
    console.log(`\n  looked at ${looked} live job(s)`);
    for (const job of (await jobs.list()).slice(0, 10)) {
      console.log(
        `  ${job.id.slice(0, 8)}  ${job.status.padEnd(11)} ${job.progress}%  ${job.error ?? ''}`,
      );
    }
    console.log('');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
