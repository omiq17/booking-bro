import {
  canMemberModifySession,
  createSessionSchema,
  rescheduleSessionSchema,
} from '@booking-bro/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  bookingSessions,
  professionalProfiles,
  users,
} from '../db/schema.js';
import { requireRole } from '../plugins/auth.js';
import {
  cancelBookingSession,
  createBookingSession,
  rescheduleBookingSession,
  serializeSessionRow,
} from '../services/booking.service.js';

const sessionParamsSchema = z.object({
  id: z.string().uuid('Invalid session ID'),
});

export async function registerSessionsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    '/api/sessions',
    { preHandler: [app.requireAuth, requireRole('member')] },
    async (request, reply) => {
      const input = createSessionSchema.parse(request.body);
      const session = await createBookingSession(app, request.user!, input);
      return reply.status(201).send({ session });
    },
  );

  app.get(
    '/api/sessions',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const currentUser = request.user!;
      const nowUtc = app.getNow().toUTC();
      const nowIso = nowUtc.toISO()!;
      const nowMillis = nowUtc.toMillis();

      const whereClause =
        currentUser.role === 'member'
          ? eq(bookingSessions.memberId, currentUser.id)
          : eq(bookingSessions.professionalId, currentUser.id);

      const rows = await app.db
        .select()
        .from(bookingSessions)
        .where(whereClause)
        .orderBy(asc(bookingSessions.startAt));

      const userIds = new Set<string>();
      for (const row of rows) {
        userIds.add(row.memberId);
        userIds.add(row.professionalId);
      }

      const participantMap = new Map<
        string,
        { id: string; name: string; timezone: string; specialty?: string }
      >();

      if (userIds.size > 0) {
        const userRows = await app.db
          .select({
            id: users.id,
            name: users.name,
            timezone: users.timezone,
            specialty: professionalProfiles.specialty,
          })
          .from(users)
          .leftJoin(
            professionalProfiles,
            eq(users.id, professionalProfiles.userId),
          )
          .where(inArray(users.id, [...userIds]));

        for (const u of userRows) {
          participantMap.set(u.id, {
            id: u.id,
            name: u.name,
            timezone: u.timezone,
            specialty: u.specialty ?? undefined,
          });
        }
      }

      const enriched = rows.map((row) => {
        const base = serializeSessionRow(row);
        const memberInfo = participantMap.get(row.memberId);
        const proInfo = participantMap.get(row.professionalId);

        const canModify =
          row.status === 'booked' &&
          (currentUser.role === 'professional'
            ? row.startAt.getTime() > nowMillis
            : canMemberModifySession(row.startAt.toISOString(), nowIso)
                .allowed);

        return {
          ...base,
          memberName: memberInfo?.name ?? 'Member',
          memberTimezone: memberInfo?.timezone ?? 'UTC',
          professionalName: proInfo?.name ?? 'Professional',
          professionalTimezone: proInfo?.timezone ?? 'UTC',
          professionalSpecialty:
            proInfo?.specialty ?? 'Counsellor & Wellbeing Coach',
          canModify,
        };
      });

      const upcoming = enriched.filter(
        (s) =>
          s.status === 'booked' && new Date(s.endAt).getTime() > nowMillis,
      );

      const pastOrInactive = enriched
        .filter(
          (s) =>
            s.status !== 'booked' || new Date(s.endAt).getTime() <= nowMillis,
        )
        .sort(
          (a, b) =>
            new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
        );

      return reply.status(200).send({
        upcoming,
        pastOrInactive,
      });
    },
  );

  app.post(
    '/api/sessions/:id/cancel',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const { id } = sessionParamsSchema.parse(request.params);
      const session = await cancelBookingSession(app, request.user!, id);
      return reply.status(200).send({ session });
    },
  );

  app.post(
    '/api/sessions/:id/reschedule',
    { preHandler: [app.requireAuth, requireRole('member')] },
    async (request, reply) => {
      const { id } = sessionParamsSchema.parse(request.params);
      const input = rescheduleSessionSchema.parse(request.body);
      const result = await rescheduleBookingSession(
        app,
        request.user!,
        id,
        input.newStartAt,
      );
      return reply.status(200).send(result);
    },
  );
}
