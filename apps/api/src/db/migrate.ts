import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DEFAULT_DATABASE_URL, DEFAULT_TEST_DATABASE_URL } from './client.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrationsOnPool(pool: pg.Pool): Promise<void> {
  const migrationPath = path.resolve(__dirname, '../../drizzle/0000_init.sql');
  const sqlText = await readFile(migrationPath, 'utf8');
  await pool.query(sqlText);
}

export async function runMigrationsForUrl(
  connectionString: string,
): Promise<void> {
  const pool = new Pool({ connectionString, max: 2 });
  try {
    await runMigrationsOnPool(pool);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const primaryUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  await runMigrationsForUrl(primaryUrl);
  console.log('Migrations applied successfully to primary database.');

  if (process.env.NODE_ENV !== 'production') {
    const testUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
    if (testUrl !== primaryUrl) {
      try {
        await runMigrationsForUrl(testUrl);
        console.log('Migrations applied successfully to test database.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`Skipped test database migration (${message}).`);
      }
    }
  }
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  main().catch((err: unknown) => {
    console.error('Database migration failed:', err);
    process.exit(1);
  });
}
