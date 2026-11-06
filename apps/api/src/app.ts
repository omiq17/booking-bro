import fastifyCookie from '@fastify/cookie';
import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { DateTime } from 'luxon';
import type pg from 'pg';
import type PgBoss from 'pg-boss';
import {
  type AppDatabase,
  createDatabase,
  type DatabaseContext,
} from './db/client.js';
import { createRequireAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAvailabilityRoutes } from './routes/availability.js';
import { registerNotificationsRoutes } from './routes/notifications.js';
import { registerProfessionalsRoutes } from './routes/professionals.js';
import { registerSessionsRoutes } from './routes/sessions.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDatabase;
    pool: pg.Pool;
    boss?: PgBoss;
    getNow: () => DateTime;
    setNow: (clock: () => DateTime) => void;
    requireAuth: preHandlerHookHandler;
  }
}

export interface BuildAppOptions {
  databaseUrl?: string;
  dbContext?: DatabaseContext;
  boss?: PgBoss;
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
  app.decorate('boss', options.boss);
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
  await registerSessionsRoutes(app);
  await registerNotificationsRoutes(app);

  if (ownsDbContext) {
    app.addHook('onClose', async () => {
      if (options.boss) {
        await options.boss.stop({ graceful: false });
      }
      await dbContext.close();
    });
  }

  return app;
}
