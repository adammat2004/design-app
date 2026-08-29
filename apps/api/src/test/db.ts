import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../db/schema.js';
import type { Database } from '../db/db.module.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgres://garden:garden@localhost:5432/garden_studio';

export interface TestDatabase {
  db: Database;
  /**
   * Empties the plan table. The geometry tests never needed this — validation builds its
   * geometry inline and writes nothing — but the persistence tests insert rows, and a suite
   * that leaves them behind makes the next run's "list projects" assertions depend on history.
   */
  truncate: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Opens a real connection to the PostGIS instance.
 *
 * These tests deliberately do not mock the database: GeometryValidationService is almost
 * entirely SQL, so a mocked client would assert on hardcoded fake rows and prove nothing
 * about whether the geometry predicates are correct.
 *
 * Returns null when the database is unreachable so suites can skip with a clear message
 * instead of failing with a connection error.
 */
export async function connectTestDatabase(): Promise<TestDatabase | null> {
  const client = postgres(CONNECTION_STRING, { max: 1, onnotice: () => {} });

  try {
    await client`select postgis_version()`;
  } catch {
    await client.end({ timeout: 1 }).catch(() => {});
    return null;
  }

  const db = drizzle(client, { schema });
  return {
    db,
    truncate: async () => {
      await client`truncate table plan_projects`;
    },
    close: () => client.end({ timeout: 5 }),
  };
}

export const DB_UNAVAILABLE_MESSAGE =
  'PostGIS is not reachable — start it with `docker compose up -d` before running the API tests.';

export { sql };
