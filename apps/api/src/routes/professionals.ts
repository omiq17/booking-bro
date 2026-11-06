import {
  type AllowedBufferMinutes,
  CALENDAR_DAYS,
  DEFAULT_BUFFER_MINUTES,
  generateAvailableSlots,
  getProfessionalSlotsQuerySchema,
} from '@booking-bro/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  availabilityWindows,
  bookingSessions,
  professionalProfiles,
  users,
} from '../db/schema.js';
import { AppError } from '../plugins/error.js';

const professionalParamsSchema = z.object({
  id: z.string().uuid('Invalid professional ID'),
});

export async function registerProfessionalsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/professionals',
    { preHandler: [app.requireAuth] },
    async (_request, reply) => {
      const rows = await app.db
        .select({
          id: users.id,
          name: users.name,
          timezone: users.timezone,
          specialty: professionalProfiles.specialty,
          bio: professionalProfiles.bio,
          bufferMinutes: professionalProfiles.bufferMinutes,
        })
        .from(users)
        .leftJoin(
          professionalProfiles,
          eq(users.id, professionalProfiles.userId),
        )
        .where(eq(users.role, 'professional'))
        .orderBy(asc(users.name));

      const professionals = rows.map((row) => ({
        id: row.id,
        name: row.name,
        timezone: row.timezone,
        specialty: row.specialty ?? 'Counsellor & Wellbeing Coach',
        bio: row.bio ?? '',
        bufferMinutes: (row.bufferMinutes ??
          DEFAULT_BUFFER_MINUTES) as AllowedBufferMinutes,
      }));

      return reply.status(200).send({ professionals });
    },
  );

  app.get(
    '/api/professionals/:id',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const { id } = professionalParamsSchema.parse(request.params);

      const rows = await app.db
        .select({
          id: users.id,
          name: users.name,
          timezone: users.timezone,
          specialty: professionalProfiles.specialty,
          bio: professionalProfiles.bio,
          bufferMinutes: professionalProfiles.bufferMinutes,
        })
        .from(users)
        .leftJoin(
          professionalProfiles,
          eq(users.id, professionalProfiles.userId),
        )
        .where(and(eq(users.id, id), eq(users.role, 'professional')))
        .limit(1);

      const pro = rows[0];
      if (!pro) {
        throw new AppError(
          404,
          'PROFESSIONAL_NOT_FOUND',
          'Professional not found.',
        );
      }

      const windows = await app.db
        .select({
          weekday: availabilityWindows.weekday,
          startTime: availabilityWindows.startTime,
          endTime: availabilityWindows.endTime,
        })
        .from(availabilityWindows)
        .where(eq(availabilityWindows.professionalId, pro.id))
        .orderBy(
          asc(availabilityWindows.weekday),
          asc(availabilityWindows.startTime),
        );

      return reply.status(200).send({
        professional: {
          id: pro.id,
          name: pro.name,
          timezone: pro.timezone,
          specialty: pro.specialty ?? 'Counsellor & Wellbeing Coach',
          bio: pro.bio ?? '',
          bufferMinutes: (pro.bufferMinutes ??
            DEFAULT_BUFFER_MINUTES) as AllowedBufferMinutes,
          windows,
        },
      });
    },
  );

  app.get(
    '/api/professionals/:id/slots',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const { id } = professionalParamsSchema.parse(request.params);
      const query = getProfessionalSlotsQuerySchema.parse(request.query);
      const currentUser = request.user!;

      const rows = await app.db
        .select({
          id: users.id,
          name: users.name,
          timezone: users.timezone,
          specialty: professionalProfiles.specialty,
          bio: professionalProfiles.bio,
          bufferMinutes: professionalProfiles.bufferMinutes,
        })
        .from(users)
        .leftJoin(
          professionalProfiles,
          eq(users.id, professionalProfiles.userId),
        )
        .where(and(eq(users.id, id), eq(users.role, 'professional')))
        .limit(1);

      const pro = rows[0];
      if (!pro) {
        throw new AppError(
          404,
          'PROFESSIONAL_NOT_FOUND',
          'Professional not found.',
        );
      }

      if (query.excludeSessionId) {
        const excludedRows = await app.db
          .select({
            id: bookingSessions.id,
            memberId: bookingSessions.memberId,
          })
          .from(bookingSessions)
          .where(eq(bookingSessions.id, query.excludeSessionId))
          .limit(1);

        const excluded = excludedRows[0];
        if (!excluded) {
          throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
        }
        if (excluded.memberId !== currentUser.id) {
          throw new AppError(
            403,
            'FORBIDDEN',
            'You can only exclude your own session when checking availability.',
          );
        }
      }

      const nowUtc = app.getNow().toUTC();
      const fromUtc = query.from
        ? DateTime.fromISO(query.from, { zone: 'utc' })
        : nowUtc;
      const toUtc = fromUtc.plus({ days: CALENDAR_DAYS });

      const queryRangeStart = fromUtc.minus({ days: 2 }).toJSDate();
      const queryRangeEnd = toUtc.plus({ days: 2 }).toJSDate();

      const [windows, proBookingsRows, memberBookingsRows] = await Promise.all([
        app.db
          .select({
            weekday: availabilityWindows.weekday,
            startTime: availabilityWindows.startTime,
            endTime: availabilityWindows.endTime,
          })
          .from(availabilityWindows)
          .where(eq(availabilityWindows.professionalId, pro.id))
          .orderBy(
            asc(availabilityWindows.weekday),
            asc(availabilityWindows.startTime),
          ),
        app.db
          .select({
            id: bookingSessions.id,
            startAt: bookingSessions.startAt,
            endAt: bookingSessions.endAt,
            blockedUntil: bookingSessions.blockedUntil,
          })
          .from(bookingSessions)
          .where(
            and(
              eq(bookingSessions.professionalId, pro.id),
              eq(bookingSessions.status, 'booked'),
              gte(bookingSessions.blockedUntil, queryRangeStart),
              lte(bookingSessions.startAt, queryRangeEnd),
            ),
          ),
        currentUser.role === 'member'
          ? app.db
              .select({
                id: bookingSessions.id,
                startAt: bookingSessions.startAt,
                endAt: bookingSessions.endAt,
              })
              .from(bookingSessions)
              .where(
                and(
                  eq(bookingSessions.memberId, currentUser.id),
                  eq(bookingSessions.status, 'booked'),
                  gte(bookingSessions.endAt, queryRangeStart),
                  lte(bookingSessions.startAt, queryRangeEnd),
                ),
              )
          : Promise.resolve([]),
      ]);

      const bufferMinutes = (pro.bufferMinutes ??
        DEFAULT_BUFFER_MINUTES) as AllowedBufferMinutes;

      const slots = generateAvailableSlots({
        professionalTimezone: pro.timezone,
        bufferMinutes,
        windows,
        professionalBookings: proBookingsRows.map((b) => ({
          id: b.id,
          startAtIso: b.startAt.toISOString(),
          endAtIso: b.endAt.toISOString(),
          blockedUntilIso: b.blockedUntil.toISOString(),
        })),
        memberBookings: memberBookingsRows.map((m) => ({
          id: m.id,
          startAtIso: m.startAt.toISOString(),
          endAtIso: m.endAt.toISOString(),
        })),
        excludeSessionId: query.excludeSessionId,
        fromUtcIso: fromUtc.toISO()!,
        toUtcIso: toUtc.toISO()!,
        nowUtcIso: nowUtc.toISO()!,
      });

      return reply.status(200).send({
        professional: {
          id: pro.id,
          name: pro.name,
          timezone: pro.timezone,
          specialty: pro.specialty ?? 'Counsellor & Wellbeing Coach',
          bio: pro.bio ?? '',
          bufferMinutes,
        },
        slots: slots.map((s) => ({
          startAt: s.startAt,
          endAt: s.endAt,
        })),
      });
    },
  );
}
