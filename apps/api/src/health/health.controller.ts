import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get()
  async check() {
    const [row] = await this.db.execute<{ postgis_full_version: string }>(
      sql`select postgis_full_version()`,
    );

    return {
      status: 'ok',
      db: true,
      postgis: row?.postgis_full_version ?? null,
    };
  }
}
