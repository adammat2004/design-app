import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { PlanModule } from './plan/plan.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DbModule,
    PlanModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
