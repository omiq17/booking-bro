import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { runMigrationsOnPool } from './db/migrate.js';
import { createAndStartBoss } from './worker/boss.js';

async function startServer(): Promise<void> {
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
  const host = process.env.API_HOST ?? '0.0.0.0';

  const dbContext = createDatabase();
  await runMigrationsOnPool(dbContext.pool);

  const boss = await createAndStartBoss(dbContext.pool, dbContext.db, {
    startWorker: true,
    pollingIntervalSeconds: 2,
  });

  const app = await buildApp({
    dbContext,
    boss,
    logger: true,
  });

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await boss.stop({ graceful: true, timeout: 5000 });
      await app.close();
      await dbContext.close();
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port, host });
  console.log(`BookingBro API & Reminder Worker listening on http://${host}:${String(port)}`);
}

startServer().catch((err: unknown) => {
  console.error('Failed to start BookingBro API server:', err);
  process.exit(1);
});
