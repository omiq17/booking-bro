import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notifications } from '../db/schema.js';
import { AppError } from '../plugins/error.js';

const notificationParamsSchema = z.object({
  id: z.string().uuid('Invalid notification ID'),
});

export async function registerNotificationsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/notifications',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const currentUser = request.user!;

      const rows = await app.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, currentUser.id))
        .orderBy(desc(notifications.createdAt));

      let unreadCount = 0;
      const items = rows.map((row) => {
        if (!row.readAt) {
          unreadCount++;
        }
        return {
          id: row.id,
          sessionId: row.sessionId,
          kind: row.kind,
          title: row.title,
          body: row.body,
          readAt: row.readAt ? row.readAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
        };
      });

      return reply.status(200).send({
        unreadCount,
        notifications: items,
      });
    },
  );

  app.post(
    '/api/notifications/:id/read',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const { id } = notificationParamsSchema.parse(request.params);
      const currentUser = request.user!;
      const nowDate = app.getNow().toJSDate();

      const updatedRows = await app.db
        .update(notifications)
        .set({ readAt: nowDate })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.userId, currentUser.id),
          ),
        )
        .returning({
          id: notifications.id,
          readAt: notifications.readAt,
        });

      const updated = updatedRows[0];
      if (!updated) {
        throw new AppError(
          404,
          'NOTIFICATION_NOT_FOUND',
          'Notification not found.',
        );
      }

      return reply.status(200).send({
        notification: {
          id: updated.id,
          readAt: updated.readAt ? updated.readAt.toISOString() : null,
        },
      });
    },
  );

  app.post(
    '/api/notifications/read-all',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const currentUser = request.user!;
      const nowDate = app.getNow().toJSDate();

      const updatedRows = await app.db
        .update(notifications)
        .set({ readAt: nowDate })
        .where(
          and(
            eq(notifications.userId, currentUser.id),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id });

      return reply.status(200).send({
        ok: true,
        updatedCount: updatedRows.length,
      });
    },
  );
}
