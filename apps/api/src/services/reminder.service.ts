import {
  computeReminderSchedule,
  type NotificationKind,
} from '@booking-bro/shared';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type pg from 'pg';
import type PgBoss from 'pg-boss';
import type { AppDatabase, DbOrTx } from '../db/client.js';
import { bookingSessions, notifications, users } from '../db/schema.js';

export const REMINDER_QUEUE_NAME = 'session-reminder';

export interface ReminderJobPayload {
  sessionId: string;
  userId: string;
  kind: 'reminder_24h' | 'reminder_1h';
}

export function createPgBossTxAdapter(
  tx: DbOrTx,
  fallbackPool: pg.Pool,
): PgBoss.Db {
  const internalClient =
    (tx as unknown as { session?: { client?: pg.PoolClient | pg.Pool } })
      .session?.client ?? fallbackPool;

  return {
    executeSql: async (text: string, values: unknown[]) => {
      const result = await internalClient.query(text, values);
      return { rows: result.rows };
    },
  };
}

export interface SchedulableSession {
  id: string;
  memberId: string;
  professionalId: string;
  startAt: Date;
}

export async function scheduleSessionReminders(
  tx: DbOrTx,
  boss: PgBoss | undefined,
  fallbackPool: pg.Pool,
  session: SchedulableSession,
  nowUtcIso: string,
): Promise<string[]> {
  if (!boss) {
    return [];
  }

  const reminders = computeReminderSchedule(
    session.startAt.toISOString(),
    nowUtcIso,
  );
  if (reminders.length === 0) {
    return [];
  }

  const txAdapter = createPgBossTxAdapter(tx, fallbackPool);
  const participantIds = [session.memberId, session.professionalId];
  const jobIds: string[] = [];

  for (const reminder of reminders) {
    for (const userId of participantIds) {
      const payload: ReminderJobPayload = {
        sessionId: session.id,
        userId,
        kind: reminder.kind,
      };
      const singletonKey = `${session.id}:${userId}:${reminder.kind}`;
      const jobId = await boss.send(REMINDER_QUEUE_NAME, payload, {
        startAfter: new Date(reminder.sendAtIso),
        singletonKey,
        db: txAdapter,
      });
      if (jobId) {
        jobIds.push(jobId);
      }
    }
  }

  return jobIds;
}

export async function cancelSessionReminders(
  tx: DbOrTx,
  boss: PgBoss | undefined,
  fallbackPool: pg.Pool,
  sessionId: string,
): Promise<number> {
  if (!boss) {
    return 0;
  }

  const txAdapter = createPgBossTxAdapter(tx, fallbackPool);
  const { rows } = await txAdapter.executeSql(
    `SELECT id FROM pgboss.job
     WHERE name = $1
       AND state IN ('created', 'retry')
       AND data->>'sessionId' = $2`,
    [REMINDER_QUEUE_NAME, sessionId],
  );

  const ids = (rows as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) {
    return 0;
  }

  await boss.cancel(REMINDER_QUEUE_NAME, ids, { db: txAdapter });
  return ids.length;
}

export function formatLocalSessionTime(
  utcDate: Date,
  ianaTimezone: string,
): string {
  return DateTime.fromJSDate(utcDate, { zone: 'utc' })
    .setZone(ianaTimezone)
    .toFormat("ccc, LLL d, yyyy 'at' HH:mm ZZZZ");
}

export async function processReminderJob(
  db: AppDatabase,
  jobData: ReminderJobPayload,
  nowDate?: Date,
): Promise<{ delivered: boolean; reason?: string }> {
  const sessionRows = await db
    .select()
    .from(bookingSessions)
    .where(eq(bookingSessions.id, jobData.sessionId))
    .limit(1);

  const session = sessionRows[0];
  if (!session || session.status !== 'booked') {
    return { delivered: false, reason: 'session_not_booked' };
  }

  const participantRows = await db
    .select({
      id: users.id,
      name: users.name,
      timezone: users.timezone,
    })
    .from(users)
    .where(
      eq(
        users.id,
        jobData.userId === session.memberId
          ? session.memberId
          : session.professionalId,
      ),
    )
    .limit(1);

  const recipient = participantRows[0];
  if (!recipient) {
    return { delivered: false, reason: 'recipient_not_found' };
  }

  const counterpartyId =
    jobData.userId === session.memberId
      ? session.professionalId
      : session.memberId;

  const counterpartyRows = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, counterpartyId))
    .limit(1);

  const counterpartyName = counterpartyRows[0]?.name ?? 'your participant';
  const localTimeStr = formatLocalSessionTime(
    session.startAt,
    recipient.timezone,
  );

  const is24h = jobData.kind === 'reminder_24h';
  const title = is24h
    ? 'Upcoming Session in 24 Hours'
    : 'Upcoming Session in 1 Hour';
  const body = is24h
    ? `Reminder: Your 50-minute session with ${counterpartyName} starts in 24 hours (${localTimeStr}).`
    : `Reminder: Your 50-minute session with ${counterpartyName} starts in 1 hour (${localTimeStr}).`;

  const inserted = await db
    .insert(notifications)
    .values({
      sessionId: session.id,
      userId: jobData.userId,
      kind: jobData.kind as NotificationKind,
      title,
      body,
      createdAt: nowDate ?? new Date(),
    })
    .onConflictDoNothing({
      target: [
        notifications.sessionId,
        notifications.userId,
        notifications.kind,
      ],
    })
    .returning({ id: notifications.id });

  if (inserted.length === 0) {
    return { delivered: false, reason: 'duplicate_skipped' };
  }

  return { delivered: true };
}
