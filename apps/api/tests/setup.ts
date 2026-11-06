import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import {
  type AppDatabase,
  createDatabase,
  DEFAULT_TEST_DATABASE_URL,
} from '../src/db/client.js';
import { runMigrationsOnPool } from '../src/db/migrate.js';

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

export async function resetTestDatabase(pool: pg.Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      notifications,
      booking_sessions,
      availability_windows,
      professional_profiles,
      auth_sessions,
      users
    RESTART IDENTITY CASCADE;
  `);

  const pgbossTableCheck = await pool.query<{ reg: string | null }>(
    `SELECT to_regclass('pgboss.job') AS reg;`,
  );
  if (pgbossTableCheck.rows[0]?.reg) {
    await pool.query(`TRUNCATE TABLE pgboss.job CASCADE;`);
  }
}

export interface TestHarness {
  app: FastifyInstance;
  db: AppDatabase;
  pool: pg.Pool;
  getNow: () => DateTime;
  setNow: (isoOrDt: string | DateTime) => void;
  advanceTime: (duration: {
    hours?: number;
    minutes?: number;
    seconds?: number;
    days?: number;
  }) => DateTime;
  resetDb: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestHarness(
  initialNowIso = '2026-06-01T08:00:00.000Z',
): Promise<TestHarness> {
  let currentNow = DateTime.fromISO(initialNowIso, { zone: 'utc' });
  const dbContext = createDatabase(TEST_DB_URL);

  await runMigrationsOnPool(dbContext.pool);
  await resetTestDatabase(dbContext.pool);

  const app = await buildApp({
    dbContext,
    getNow: () => currentNow,
    logger: false,
  });

  await app.ready();

  return {
    app,
    db: dbContext.db,
    pool: dbContext.pool,
    getNow: () => currentNow,
    setNow: (isoOrDt: string | DateTime) => {
      currentNow =
        typeof isoOrDt === 'string'
          ? DateTime.fromISO(isoOrDt, { zone: 'utc' })
          : isoOrDt.toUTC();
      app.setNow(() => currentNow);
    },
    advanceTime: (duration) => {
      currentNow = currentNow.plus(duration);
      app.setNow(() => currentNow);
      return currentNow;
    },
    resetDb: async () => {
      await resetTestDatabase(dbContext.pool);
    },
    close: async () => {
      await app.close();
      await dbContext.close();
    },
  };
}
