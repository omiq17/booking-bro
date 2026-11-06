import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_MINUTES } from '@booking-bro/shared';
import argon2 from 'argon2';
import { eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { createDatabase, DEFAULT_DATABASE_URL } from './client.js';
import { runMigrationsOnPool } from './migrate.js';
import {
  availabilityWindows,
  bookingSessions,
  notifications,
  professionalProfiles,
  users,
} from './schema.js';
import {
  formatLocalSessionTime,
  REMINDER_QUEUE_NAME,
  type ReminderJobPayload,
  scheduleSessionReminders,
} from '../services/reminder.service.js';
import { createAndStartBoss } from '../worker/boss.js';

const __filename = fileURLToPath(import.meta.url);

export const DEMO_PASSWORD = 'Password123!';

interface SeedUserSpec {
  email: string;
  name: string;
  role: 'member' | 'professional';
  timezone: string;
  specialty?: string;
  bio?: string;
  bufferMinutes?: 10 | 20 | 30;
  windows?: Array<{ weekday: number; startTime: string; endTime: string }>;
}

const DEMO_USERS: readonly SeedUserSpec[] = [
  {
    email: 'mei.tan@example.com',
    name: 'Mei Lin Tan',
    role: 'member',
    timezone: 'Asia/Singapore',
  },
  {
    email: 'alex.rivera@example.com',
    name: 'Alex Rivera',
    role: 'member',
    timezone: 'America/New_York',
  },
  {
    email: 'dr.aisha.lim@example.com',
    name: 'Dr. Aisha Lim',
    role: 'professional',
    timezone: 'Asia/Singapore',
    specialty: 'Clinical Psychologist · Burnout & Anxiety',
    bio: 'Specializing in evidence-based cognitive behavioral strategies, workplace burnout recovery, and mindful stress regulation.',
    bufferMinutes: 10,
    windows: [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, startTime: '09:00', endTime: '12:00' },
      { weekday, startTime: '14:00', endTime: '18:00' },
    ]),
  },
  {
    email: 'dr.oliver.grant@example.com',
    name: 'Dr. Oliver Grant',
    role: 'professional',
    timezone: 'Europe/London',
    specialty: 'CBT Therapist & Executive Wellbeing Coach',
    bio: 'Helping remote leaders and cross-functional professionals build sustainable routines, emotional resilience, and clear boundaries.',
    bufferMinutes: 20,
    windows: [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, startTime: '09:00', endTime: '13:00' },
      { weekday, startTime: '14:30', endTime: '18:00' },
    ]),
  },
];

function computeNextAlignedUtc(now: DateTime, hoursAhead: number): DateTime {
  const target = now.plus({ hours: hoursAhead }).startOf('minute');
  const remainder = target.minute % 10;
  return remainder === 0 ? target : target.plus({ minutes: 10 - remainder });
}

export async function runSeed(connectionString?: string): Promise<void> {
  const dbUrl =
    connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const { pool, db } = createDatabase(dbUrl);

  try {
    await runMigrationsOnPool(pool);

    const passwordHash = await argon2.hash(DEMO_PASSWORD, {
      type: argon2.argon2id,
    });

    const userIdByEmail = new Map<string, string>();

    for (const spec of DEMO_USERS) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, spec.email))
        .limit(1);

      let userId: string;
      if (existing[0]) {
        userId = existing[0].id;
        await db
          .update(users)
          .set({
            name: spec.name,
            role: spec.role,
            timezone: spec.timezone,
            passwordHash,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      } else {
        const [inserted] = await db
          .insert(users)
          .values({
            email: spec.email,
            name: spec.name,
            role: spec.role,
            timezone: spec.timezone,
            passwordHash,
          })
          .returning({ id: users.id });
        userId = inserted!.id;
      }

      userIdByEmail.set(spec.email, userId);

      if (spec.role === 'professional') {
        await db
          .insert(professionalProfiles)
          .values({
            userId,
            specialty: spec.specialty ?? 'Counsellor & Wellbeing Coach',
            bio: spec.bio ?? '',
            bufferMinutes: spec.bufferMinutes ?? 10,
          })
          .onConflictDoUpdate({
            target: professionalProfiles.userId,
            set: {
              specialty: spec.specialty ?? 'Counsellor & Wellbeing Coach',
              bio: spec.bio ?? '',
              bufferMinutes: spec.bufferMinutes ?? 10,
              updatedAt: new Date(),
            },
          });

        await db
          .delete(availabilityWindows)
          .where(eq(availabilityWindows.professionalId, userId));

        if (spec.windows && spec.windows.length > 0) {
          await db.insert(availabilityWindows).values(
            spec.windows.map((w) => ({
              professionalId: userId,
              weekday: w.weekday,
              startTime: w.startTime,
              endTime: w.endTime,
            })),
          );
        }
      }
    }

    const meiId = userIdByEmail.get('mei.tan@example.com')!;
    const alexId = userIdByEmail.get('alex.rivera@example.com')!;
    const aishaId = userIdByEmail.get('dr.aisha.lim@example.com')!;
    const oliverId = userIdByEmail.get('dr.oliver.grant@example.com')!;

    // Remove previous seeded sessions for these demo members so seed is 100% idempotent
    await db
      .delete(bookingSessions)
      .where(inArray(bookingSessions.memberId, [meiId, alexId]));

    const nowUtc = DateTime.utc();

    // 1. Upcoming session > 24h away (2 days from now at 10:00 Asia/Singapore)
    const futureGt24hStart = nowUtc
      .setZone('Asia/Singapore')
      .plus({ days: 2 })
      .set({ hour: 10, minute: 0, second: 0, millisecond: 0 })
      .toUTC();
    const futureGt24hEnd = futureGt24hStart.plus({
      minutes: SESSION_MINUTES,
    });
    const futureGt24hBlocked = futureGt24hEnd.plus({ minutes: 10 });

    // 2. Upcoming session < 24h away (~6 hours from now, aligned to 10-minute grid -> locked for member cancel/reschedule)
    const futureLt24hStart = computeNextAlignedUtc(nowUtc, 6);
    const futureLt24hEnd = futureLt24hStart.plus({
      minutes: SESSION_MINUTES,
    });
    const futureLt24hBlocked = futureLt24hEnd.plus({ minutes: 10 });

    // 3. Past completed session (3 days ago at 15:00 Asia/Singapore)
    const pastStart = nowUtc
      .setZone('Asia/Singapore')
      .minus({ days: 3 })
      .set({ hour: 15, minute: 0, second: 0, millisecond: 0 })
      .toUTC();
    const pastEnd = pastStart.plus({ minutes: SESSION_MINUTES });
    const pastBlocked = pastEnd.plus({ minutes: 10 });

    // 4. Cross-timezone upcoming session > 24h away (3 days from now at 15:00 Europe/London)
    const crossTzStart = nowUtc
      .setZone('Europe/London')
      .plus({ days: 3 })
      .set({ hour: 15, minute: 0, second: 0, millisecond: 0 })
      .toUTC();
    const crossTzEnd = crossTzStart.plus({
      minutes: SESSION_MINUTES,
    });
    const crossTzBlocked = crossTzEnd.plus({ minutes: 20 });

    const insertedSessions = await db
      .insert(bookingSessions)
      .values([
        {
          memberId: meiId,
          professionalId: aishaId,
          startAt: futureGt24hStart.toJSDate(),
          endAt: futureGt24hEnd.toJSDate(),
          blockedUntil: futureGt24hBlocked.toJSDate(),
          bufferMinutes: 10,
          status: 'booked',
        },
        {
          memberId: meiId,
          professionalId: aishaId,
          startAt: futureLt24hStart.toJSDate(),
          endAt: futureLt24hEnd.toJSDate(),
          blockedUntil: futureLt24hBlocked.toJSDate(),
          bufferMinutes: 10,
          status: 'booked',
        },
        {
          memberId: meiId,
          professionalId: aishaId,
          startAt: pastStart.toJSDate(),
          endAt: pastEnd.toJSDate(),
          blockedUntil: pastBlocked.toJSDate(),
          bufferMinutes: 10,
          status: 'booked',
        },
        {
          memberId: alexId,
          professionalId: oliverId,
          startAt: crossTzStart.toJSDate(),
          endAt: crossTzEnd.toJSDate(),
          blockedUntil: crossTzBlocked.toJSDate(),
          bufferMinutes: 20,
          status: 'booked',
        },
      ])
      .returning();

    const sessionGt24h = insertedSessions[0]!;
    const sessionLt24h = insertedSessions[1]!;
    const sessionCrossTz = insertedSessions[3]!;

    // Seed an immediate unread 24h reminder notification for the <24h session so the notification badge is visible right away
    const meiLocalStr = formatLocalSessionTime(
      sessionLt24h.startAt,
      'Asia/Singapore',
    );
    await db
      .insert(notifications)
      .values([
        {
          sessionId: sessionLt24h.id,
          userId: meiId,
          kind: 'reminder_24h',
          title: 'Upcoming Session in 24 Hours',
          body: `Reminder: Your 50-minute session with Dr. Aisha Lim starts soon (${meiLocalStr}).`,
        },
        {
          sessionId: sessionLt24h.id,
          userId: aishaId,
          kind: 'reminder_24h',
          title: 'Upcoming Session in 24 Hours',
          body: `Reminder: Your 50-minute session with Mei Lin Tan starts soon (${meiLocalStr}).`,
        },
      ])
      .onConflictDoNothing();

    // Start pg-boss without worker polling to enqueue standard + near-due (~8s) live reminder jobs
    const boss = await createAndStartBoss(pool, db, { startWorker: false });
    try {
      const nowIso = nowUtc.toISO()!;
      await scheduleSessionReminders(
        db,
        boss,
        pool,
        sessionGt24h,
        nowIso,
      );
      await scheduleSessionReminders(
        db,
        boss,
        pool,
        sessionCrossTz,
        nowIso,
      );

      // Enqueue a near-due 1h reminder job firing ~8 seconds from now so reviewers see live pg-boss delivery
      const nearDueAt = new Date(Date.now() + 8_000);
      for (const participantId of [meiId, aishaId]) {
        const payload: ReminderJobPayload = {
          sessionId: sessionLt24h.id,
          userId: participantId,
          kind: 'reminder_1h',
        };
        await boss.send(REMINDER_QUEUE_NAME, payload, {
          startAfter: nearDueAt,
          singletonKey: `${sessionLt24h.id}:${participantId}:reminder_1h`,
        });
      }
    } finally {
      await boss.stop({ graceful: true });
    }

    console.log(
      'Seed complete: 4 synthetic demo accounts, weekly availability windows, 4 sessions (>24h, <24h locked, past, cross-timezone), and live pg-boss reminder jobs.',
    );
  } finally {
    await pool.end();
  }
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  runSeed().catch((err: unknown) => {
    console.error('Database seed failed:', err);
    process.exit(1);
  });
}
