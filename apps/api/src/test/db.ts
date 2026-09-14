import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../db/schema.js';
import type { Database } from '../db/db.module.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgres://garden:garden@localhost:5432/garden_studio';

export interface TestDatabase {
  db: Database;
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
 *
 * **There is deliberately no `truncate` here, and there was.** Two suites now write rows, vitest
 * runs files concurrently, and a helper that empties a shared table deletes whatever the suite
 * beside it is using — as well as every plan the developer has open in the browser, a trap CLAUDE.md
 * recorded twice before this. Each suite removes the rows it created instead, which is what a test
 * sharing a database should do anyway and what the cascading foreign key on `design_events` makes
 * a one-liner.
 */
export async function connectTestDatabase(): Promise<TestDatabase | null> {
  // `jit: 'off'` for the reason `db.module.ts` gives: the fill queries are compiled otherwise.
  const client = postgres(CONNECTION_STRING, {
    max: 1,
    onnotice: () => {},
    connection: { jit: 'off' },
  });

  try {
    await client`select postgis_version()`;
  } catch {
    await client.end({ timeout: 1 }).catch(() => {});
    return null;
  }

  const db = drizzle(client, { schema });
  return {
    db,
    close: () => client.end({ timeout: 5 }),
  };
}

export const DB_UNAVAILABLE_MESSAGE =
  'PostGIS is not reachable — start it with `docker compose up -d` before running the API tests.';

export { sql };
