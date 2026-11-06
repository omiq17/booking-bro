import {
  type AllowedBufferMinutes,
  DEFAULT_BUFFER_MINUTES,
  updateAvailabilitySchema,
  validateAvailabilityWindows,
} from '@booking-bro/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { availabilityWindows, professionalProfiles } from '../db/schema.js';
import { requireRole } from '../plugins/auth.js';
import { AppError } from '../plugins/error.js';

export async function registerAvailabilityRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/availability/me',
    { preHandler: [app.requireAuth, requireRole('professional')] },
    async (request, reply) => {
      const currentUser = request.user!;

      const [profileRows, windows] = await Promise.all([
        app.db
          .select({
            specialty: professionalProfiles.specialty,
            bio: professionalProfiles.bio,
            bufferMinutes: professionalProfiles.bufferMinutes,
          })
          .from(professionalProfiles)
          .where(eq(professionalProfiles.userId, currentUser.id))
          .limit(1),
        app.db
          .select({
            id: availabilityWindows.id,
            weekday: availabilityWindows.weekday,
            startTime: availabilityWindows.startTime,
            endTime: availabilityWindows.endTime,
          })
          .from(availabilityWindows)
          .where(eq(availabilityWindows.professionalId, currentUser.id))
          .orderBy(
            asc(availabilityWindows.weekday),
            asc(availabilityWindows.startTime),
          ),
      ]);

      const profile = profileRows[0];
      return reply.status(200).send({
        timezone: currentUser.timezone,
        specialty: profile?.specialty ?? 'Counsellor & Wellbeing Coach',
        bio: profile?.bio ?? '',
        bufferMinutes: (profile?.bufferMinutes ??
          DEFAULT_BUFFER_MINUTES) as AllowedBufferMinutes,
        windows,
      });
    },
  );

  app.put(
    '/api/availability',
    { preHandler: [app.requireAuth, requireRole('professional')] },
    async (request, reply) => {
      const currentUser = request.user!;
      const input = updateAvailabilitySchema.parse(request.body);
      const nowUtc = app.getNow().toUTC();

      const validation = validateAvailabilityWindows(
        input.windows,
        currentUser.timezone,
        nowUtc.toISO()!,
      );

      if (!validation.valid) {
        throw new AppError(
          422,
          'INVALID_AVAILABILITY_WINDOWS',
          validation.errors[0] ?? 'Invalid availability windows.',
          { errors: validation.errors },
        );
      }

      const nowDate = nowUtc.toJSDate();
      const sortedWindows = [...input.windows].sort(
        (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
      );

      const savedWindows = await app.db.transaction(async (tx) => {
        await tx
          .insert(professionalProfiles)
          .values({
            userId: currentUser.id,
            bufferMinutes: input.bufferMinutes,
            updatedAt: nowDate,
          })
          .onConflictDoUpdate({
            target: professionalProfiles.userId,
            set: {
              bufferMinutes: input.bufferMinutes,
              updatedAt: nowDate,
            },
          });

        await tx
          .delete(availabilityWindows)
          .where(eq(availabilityWindows.professionalId, currentUser.id));

        const inserted = await tx
          .insert(availabilityWindows)
          .values(
            sortedWindows.map((win) => ({
              professionalId: currentUser.id,
              weekday: win.weekday,
              startTime: win.startTime,
              endTime: win.endTime,
              createdAt: nowDate,
            })),
          )
          .returning({
            id: availabilityWindows.id,
            weekday: availabilityWindows.weekday,
            startTime: availabilityWindows.startTime,
            endTime: availabilityWindows.endTime,
          });

        return inserted;
      });

      return reply.status(200).send({
        timezone: currentUser.timezone,
        bufferMinutes: input.bufferMinutes,
        windows: savedWindows,
      });
    },
  );
}
