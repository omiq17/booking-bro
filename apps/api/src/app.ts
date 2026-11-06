import fastifyCookie from '@fastify/cookie';
import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { DateTime } from 'luxon';
import type pg from 'pg';
import {
  type AppDatabase,
  createDatabase,
  type DatabaseContext,
} from './db/client.js';
import { createRequireAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAvailabilityRoutes } from './routes/availability.js';
import { registerProfessionalsRoutes } from './routes/professionals.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDatabase;
    pool: pg.Pool;
    getNow: () => DateTime;
    setNow: (clock: () => DateTime) => void;
    requireAuth: preHandlerHookHandler;
  }
}

export interface BuildAppOptions {
  databaseUrl?: string;
  dbContext?: DatabaseContext;
  getNow?: () => DateTime;
  logger?: boolean;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  const ownsDbContext = !options.dbContext;
  const dbContext =
    options.dbContext ?? createDatabase(options.databaseUrl);

  let currentClock: () => DateTime =
    options.getNow ?? (() => DateTime.utc());

  app.decorate('db', dbContext.db);
  app.decorate('pool', dbContext.pool);
  app.decorate('getNow', () => currentClock());
  app.decorate('setNow', (clock: () => DateTime) => {
    currentClock = clock;
  });

  await app.register(fastifyCookie);

  const requireAuth = createRequireAuth(app);
  app.decorate('requireAuth', requireAuth);

  registerErrorHandler(app);

  app.get('/api/health', async () => ({
    status: 'ok',
    now: app.getNow().toUTC().toISO(),
  }));

  await registerAuthRoutes(app);
  await registerProfessionalsRoutes(app);
  await registerAvailabilityRoutes(app);

  if (ownsDbContext) {
    app.addHook('onClose', async () => {
      await dbContext.close();
    });
  }

  return app;
}
