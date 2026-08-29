import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { Database } from '../db/db.module.js';

describe('HealthController', () => {
  it('reports ok status with the PostGIS version from the DB', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ postgis_full_version: 'POSTGIS="3.4.0"' }]),
    } as unknown as Database;

    const controller = new HealthController(db);
    const result = await controller.check();

    expect(result).toEqual({
      status: 'ok',
      db: true,
      postgis: 'POSTGIS="3.4.0"',
    });
  });
});
