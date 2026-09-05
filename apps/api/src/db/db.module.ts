import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export const DRIZZLE = Symbol('DRIZZLE');
export type Database = PostgresJsDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const connectionString = config.getOrThrow<string>('DATABASE_URL');
        /*
         * JIT off, and it is not optional. The generator's fill queries inline every room as a
         * literal polygon, the planner folds them into large constant expressions, and Postgres
         * then JIT-compiles those: 1.4 s of compilation for 110 ms of work, on every query. The
         * setting is per session, so it goes in the startup parameters where every connection
         * in the pool gets it.
         */
        const client = postgres(connectionString, { connection: { jit: 'off' } });
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
