import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

export type AppDatabase = NodePgDatabase<typeof schema>;

export type AppTransaction = Parameters<
  Parameters<AppDatabase['transaction']>[0]
>[0];

export type DbOrTx = AppDatabase | AppTransaction;

export const DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/booking_bro';

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/booking_bro_test';

export interface DatabaseContext {
  pool: pg.Pool;
  db: AppDatabase;
  connectionString: string;
  close: () => Promise<void>;
}

export function createDatabase(connectionString?: string): DatabaseContext {
  const resolvedUrl =
    connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const pool = new Pool({
    connectionString: resolvedUrl,
    max: 20,
  });
  const db = drizzle(pool, { schema });

  return {
    pool,
    db,
    connectionString: resolvedUrl,
    close: async () => {
      await pool.end();
    },
  };
}
