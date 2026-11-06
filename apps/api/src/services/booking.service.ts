import {
  type AllowedBufferMinutes,
  CALENDAR_DAYS,
  canMemberModifySession,
  DEFAULT_BUFFER_MINUTES,
  generateAvailableSlots,
  meetsMinimumNotice,
  SESSION_MINUTES,
} from '@booking-bro/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import {
  availabilityWindows,
  type BookingSessionRow,
  bookingSessions,
  notifications,
  professionalProfiles,
  users,
} from '../db/schema.js';
import type { AuthenticatedUser } from '../plugins/auth.js';
import { AppError } from '../plugins/error.js';
import {
  cancelSessionReminders,
  formatLocalSessionTime,
  scheduleSessionReminders,
} from './reminder.service.js';

interface ProfessionalScheduleContext {
  id: string;
  name: string;
  timezone: string;
  specialty: string;
  bufferMinutes: AllowedBufferMinutes;
  windows: Array<{ weekday: number; startTime: string; endTime: string }>;
}

async function loadProfessionalScheduleContext(
  app: FastifyInstance,
  professionalId: string,
): Promise<ProfessionalScheduleContext> {
  const proRows = await app.db
    .select({
      id: users.id,
      name: users.name,
      timezone: users.timezone,
      specialty: professionalProfiles.specialty,
      bufferMinutes: professionalProfiles.bufferMinutes,
    })
    .from(users)
    .leftJoin(professionalProfiles, eq(users.id, professionalProfiles.userId))
    .where(and(eq(users.id, professionalId), eq(users.role, 'professional')))
    .limit(1);

  const pro = proRows[0];
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

  return {
    id: pro.id,
    name: pro.name,
    timezone: pro.timezone,
    specialty: pro.specialty ?? 'Counsellor & Wellbeing Coach',
    bufferMinutes: (pro.bufferMinutes ??
      DEFAULT_BUFFER_MINUTES) as AllowedBufferMinutes,
    windows,
  };
}

function assertSlotMatchesWorkingSchedule(
  pro: ProfessionalScheduleContext,
  requestedStartUtc: DateTime,
  nowUtc: DateTime,
): void {
  const requestedIso = requestedStartUtc.toUTC().toISO();
  const nowIso = nowUtc.toUTC().toISO();
  if (!requestedIso || !nowIso) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid timestamp.');
  }

  if (!meetsMinimumNotice(requestedIso, nowIso)) {
    throw new AppError(
      422,
      'INSUFFICIENT_NOTICE',
      'Sessions must be booked at least 2 hours in advance.',
    );
  }

  const maxHorizon = nowUtc.plus({ days: CALENDAR_DAYS });
  if (requestedStartUtc.toMillis() > maxHorizon.toMillis()) {
    throw new AppError(
      422,
      'OUTSIDE_BOOKING_HORIZON',
      'Sessions can only be booked up to 4 weeks in advance.',
    );
  }

  // Generate candidate slots in a narrow window around the requested start time
  // without existing bookings to verify 10-minute alignment, working hours, and DST validity.
  const searchFrom = requestedStartUtc.minus({ hours: 12 }).toUTC().toISO()!;
  const searchTo = requestedStartUtc.plus({ hours: 12 }).toUTC().toISO()!;

  const validWindowSlots = generateAvailableSlots({
    professionalTimezone: pro.timezone,
    bufferMinutes: pro.bufferMinutes,
    windows: pro.windows,
    professionalBookings: [],
    memberBookings: [],
    fromUtcIso: searchFrom,
    toUtcIso: searchTo,
    nowUtcIso: nowIso,
  });

  const targetMs = requestedStartUtc.toMillis();
  const isInsideWorkingWindow = validWindowSlots.some(
    (s) => DateTime.fromISO(s.startAt, { zone: 'utc' }).toMillis() === targetMs,
  );

  if (!isInsideWorkingWindow) {
    throw new AppError(
      422,
      'INVALID_SLOT',
      'Selected start time is outside the professional’s available working hours or not aligned to the 10-minute schedule grid.',
    );
  }
}

export function serializeSessionRow(row: BookingSessionRow) {
  return {
    id: row.id,
    memberId: row.memberId,
    professionalId: row.professionalId,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    blockedUntil: row.blockedUntil.toISOString(),
    bufferMinutes: row.bufferMinutes,
    status: row.status,
    rescheduledFromId: row.rescheduledFromId ?? null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledBy: row.cancelledBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createBookingSession(
  app: FastifyInstance,
  member: AuthenticatedUser,
  input: { professionalId: string; startAt: string },
) {
  if (member.id === input.professionalId) {
    throw new AppError(
      422,
      'SELF_BOOKING_FORBIDDEN',
      'You cannot book a session with yourself.',
    );
  }

  const nowUtc = app.getNow().toUTC();
  const requestedStartUtc = DateTime.fromISO(input.startAt, { zone: 'utc' });
  if (!requestedStartUtc.isValid) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid startAt timestamp.');
  }

  const pro = await loadProfessionalScheduleContext(app, input.professionalId);
  assertSlotMatchesWorkingSchedule(pro, requestedStartUtc, nowUtc);

  const endUtc = requestedStartUtc.plus({ minutes: SESSION_MINUTES });
  const blockedUntilUtc = endUtc.plus({ minutes: pro.bufferMinutes });
  const nowDate = nowUtc.toJSDate();
  const nowUtcIso = nowUtc.toISO()!;

  const created = await app.db.transaction(async (tx) => {
    const insertedRows = await tx
      .insert(bookingSessions)
      .values({
        memberId: member.id,
        professionalId: pro.id,
        startAt: requestedStartUtc.toJSDate(),
        endAt: endUtc.toJSDate(),
        blockedUntil: blockedUntilUtc.toJSDate(),
        bufferMinutes: pro.bufferMinutes,
        status: 'booked',
        createdAt: nowDate,
        updatedAt: nowDate,
      })
      .returning();

    const newSession = insertedRows[0];
    if (!newSession) {
      throw new AppError(
        500,
        'SESSION_CREATE_FAILED',
        'Failed to create booking session.',
      );
    }

    await scheduleSessionReminders(
      tx,
      app.boss,
      app.pool,
      {
        id: newSession.id,
        memberId: newSession.memberId,
        professionalId: newSession.professionalId,
        startAt: newSession.startAt,
      },
      nowUtcIso,
    );

    return newSession;
  });

  return serializeSessionRow(created);
}

export async function cancelBookingSession(
  app: FastifyInstance,
  actor: AuthenticatedUser,
  sessionId: string,
) {
  const existingRows = await app.db
    .select()
    .from(bookingSessions)
    .where(eq(bookingSessions.id, sessionId))
    .limit(1);

  const session = existingRows[0];
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Booking session not found.');
  }

  const isMemberOwner = actor.id === session.memberId;
  const isProOwner = actor.id === session.professionalId;

  if (!isMemberOwner && !isProOwner) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'You do not have permission to cancel this session.',
    );
  }

  if (session.status !== 'booked') {
    throw new AppError(
      409,
      'INVALID_SESSION_STATE',
      `Cannot cancel a session that is already '${session.status}'.`,
    );
  }

  const nowUtc = app.getNow().toUTC();
  const nowIso = nowUtc.toISO()!;

  if (actor.role === 'member') {
    const modCheck = canMemberModifySession(
      session.startAt.toISOString(),
      nowIso,
    );
    if (!modCheck.allowed) {
      throw new AppError(
        422,
        'WITHIN_24_HOURS',
        'Members cannot cancel or reschedule a session within 24 hours of its start time.',
      );
    }
  } else {
    if (session.startAt.getTime() <= nowUtc.toMillis()) {
      throw new AppError(
        422,
        'SESSION_ALREADY_STARTED',
        'Cannot cancel a session that has already started or passed.',
      );
    }
  }

  const [memberRows, proRows] = await Promise.all([
    app.db
      .select({ id: users.id, name: users.name, timezone: users.timezone })
      .from(users)
      .where(eq(users.id, session.memberId))
      .limit(1),
    app.db
      .select({ id: users.id, name: users.name, timezone: users.timezone })
      .from(users)
      .where(eq(users.id, session.professionalId))
      .limit(1),
  ]);

  const memberUser = memberRows[0];
  const proUser = proRows[0];
  const nowDate = nowUtc.toJSDate();

  const updated = await app.db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(bookingSessions)
      .set({
        status: 'cancelled',
        cancelledAt: nowDate,
        cancelledBy: actor.id,
        updatedAt: nowDate,
      })
      .where(
        and(
          eq(bookingSessions.id, session.id),
          eq(bookingSessions.status, 'booked'),
        ),
      )
      .returning();

    const cancelledSession = updatedRows[0];
    if (!cancelledSession) {
      throw new AppError(
        409,
        'INVALID_SESSION_STATE',
        'Session state changed concurrently.',
      );
    }

    await cancelSessionReminders(tx, app.boss, app.pool, session.id);

    const cancelledByLabel =
      actor.id === session.memberId
        ? (memberUser?.name ?? 'the member')
        : (proUser?.name ?? 'the professional');

    // Notify only the counterparty (the actor sees immediate UI toast feedback)
    const notificationRows = [];
    if (actor.id !== session.memberId && memberUser) {
      const memberLocalTime = formatLocalSessionTime(
        session.startAt,
        memberUser.timezone,
      );
      notificationRows.push({
        sessionId: session.id,
        userId: memberUser.id,
        kind: 'session_cancelled' as const,
        title: 'Session Cancelled',
        body: `Your session with ${proUser?.name ?? 'your professional'} on ${memberLocalTime} was cancelled by ${cancelledByLabel}.`,
        createdAt: nowDate,
      });
    }

    if (actor.id !== session.professionalId && proUser) {
      const proLocalTime = formatLocalSessionTime(
        session.startAt,
        proUser.timezone,
      );
      notificationRows.push({
        sessionId: session.id,
        userId: proUser.id,
        kind: 'session_cancelled' as const,
        title: 'Session Cancelled',
        body: `Your session with ${memberUser?.name ?? 'your member'} on ${proLocalTime} was cancelled by ${cancelledByLabel}.`,
        createdAt: nowDate,
      });
    }

    if (notificationRows.length > 0) {
      await tx
        .insert(notifications)
        .values(notificationRows)
        .onConflictDoNothing({
          target: [
            notifications.sessionId,
            notifications.userId,
            notifications.kind,
          ],
        });
    }

    return cancelledSession;
  });

  return serializeSessionRow(updated);
}

export async function rescheduleBookingSession(
  app: FastifyInstance,
  member: AuthenticatedUser,
  sessionId: string,
  newStartAtIso: string,
) {
  const existingRows = await app.db
    .select()
    .from(bookingSessions)
    .where(eq(bookingSessions.id, sessionId))
    .limit(1);

  const oldSession = existingRows[0];
  if (!oldSession) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Booking session not found.');
  }

  if (oldSession.memberId !== member.id) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'You can only reschedule your own sessions.',
    );
  }

  if (oldSession.status !== 'booked') {
    throw new AppError(
      409,
      'INVALID_SESSION_STATE',
      `Cannot reschedule a session that is already '${oldSession.status}'.`,
    );
  }

  const nowUtc = app.getNow().toUTC();
  const nowIso = nowUtc.toISO()!;

  const modCheck = canMemberModifySession(
    oldSession.startAt.toISOString(),
    nowIso,
  );
  if (!modCheck.allowed) {
    throw new AppError(
      422,
      'WITHIN_24_HOURS',
      'Members cannot cancel or reschedule a session within 24 hours of its start time.',
    );
  }

  const requestedStartUtc = DateTime.fromISO(newStartAtIso, { zone: 'utc' });
  if (!requestedStartUtc.isValid) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Invalid newStartAt timestamp.',
    );
  }

  if (requestedStartUtc.toMillis() === oldSession.startAt.getTime()) {
    throw new AppError(
      422,
      'SAME_SLOT_RESCHEDULE',
      'Please choose a different start time when rescheduling.',
    );
  }

  const pro = await loadProfessionalScheduleContext(
    app,
    oldSession.professionalId,
  );
  assertSlotMatchesWorkingSchedule(pro, requestedStartUtc, nowUtc);

  const newEndUtc = requestedStartUtc.plus({ minutes: SESSION_MINUTES });
  const newBlockedUntilUtc = newEndUtc.plus({ minutes: pro.bufferMinutes });
  const nowDate = nowUtc.toJSDate();

  const [memberRows, proUserRows] = await Promise.all([
    app.db
      .select({ id: users.id, name: users.name, timezone: users.timezone })
      .from(users)
      .where(eq(users.id, oldSession.memberId))
      .limit(1),
    app.db
      .select({ id: users.id, name: users.name, timezone: users.timezone })
      .from(users)
      .where(eq(users.id, oldSession.professionalId))
      .limit(1),
  ]);

  const memberUser = memberRows[0];
  const proUser = proUserRows[0];

  const newSession = await app.db.transaction(async (tx) => {
    // 1. Mark existing session as 'rescheduled' (releases its partial GiST exclusion range)
    const markedOld = await tx
      .update(bookingSessions)
      .set({
        status: 'rescheduled',
        updatedAt: nowDate,
      })
      .where(
        and(
          eq(bookingSessions.id, oldSession.id),
          eq(bookingSessions.status, 'booked'),
        ),
      )
      .returning({ id: bookingSessions.id });

    if (markedOld.length === 0) {
      throw new AppError(
        409,
        'INVALID_SESSION_STATE',
        'Session state changed concurrently.',
      );
    }

    // 2. Insert new 'booked' session row (enforces no_professional_overlap & no_member_overlap via GiST)
    const insertedRows = await tx
      .insert(bookingSessions)
      .values({
        memberId: oldSession.memberId,
        professionalId: oldSession.professionalId,
        startAt: requestedStartUtc.toJSDate(),
        endAt: newEndUtc.toJSDate(),
        blockedUntil: newBlockedUntilUtc.toJSDate(),
        bufferMinutes: pro.bufferMinutes,
        status: 'booked',
        rescheduledFromId: oldSession.id,
        createdAt: nowDate,
        updatedAt: nowDate,
      })
      .returning();

    const createdNew = insertedRows[0];
    if (!createdNew) {
      throw new AppError(
        500,
        'RESCHEDULE_FAILED',
        'Failed to create rescheduled session.',
      );
    }

    // 3. Cancel old pending reminders and schedule new non-past reminders on the same transaction
    await cancelSessionReminders(tx, app.boss, app.pool, oldSession.id);
    await scheduleSessionReminders(
      tx,
      app.boss,
      app.pool,
      {
        id: createdNew.id,
        memberId: createdNew.memberId,
        professionalId: createdNew.professionalId,
        startAt: createdNew.startAt,
      },
      nowIso,
    );

    // 4. Notify the counterparty (professional) of the reschedule; member (actor) sees immediate UI toast
    const notificationRows = [];
    if (proUser) {
      const oldTimeStr = formatLocalSessionTime(
        oldSession.startAt,
        proUser.timezone,
      );
      const newTimeStr = formatLocalSessionTime(
        createdNew.startAt,
        proUser.timezone,
      );
      notificationRows.push({
        sessionId: createdNew.id,
        userId: proUser.id,
        kind: 'session_rescheduled' as const,
        title: 'Session Rescheduled',
        body: `${memberUser?.name ?? 'Your member'} rescheduled their session from ${oldTimeStr} to ${newTimeStr}.`,
        createdAt: nowDate,
      });
    }

    if (notificationRows.length > 0) {
      await tx
        .insert(notifications)
        .values(notificationRows)
        .onConflictDoNothing({
          target: [
            notifications.sessionId,
            notifications.userId,
            notifications.kind,
          ],
        });
    }

    return createdNew;
  });

  return {
    previousSessionId: oldSession.id,
    session: serializeSessionRow(newSession),
  };
}
