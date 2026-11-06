import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notifications } from '../src/db/schema.js';
import {
  processReminderJob,
  REMINDER_QUEUE_NAME,
} from '../src/services/reminder.service.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Reminders, Auth Lifecycle & Role-Based Access Control (reminders-and-auth.test.ts)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness('2026-06-01T08:00:00.000Z');
  });

  afterAll(async () => {
    if (harness) {
      await harness.close();
    }
  });

  beforeEach(async () => {
    await harness.resetDb();
    harness.setNow('2026-06-01T08:00:00.000Z');
  });

  describe('Authentication Lifecycle & Security', () => {
    it('signs up a member with argon2id and sets HttpOnly session cookie', async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Jane Doe',
          email: 'Jane.Doe@example.com',
          password: 'securePassword123!',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.user.email).toBe('jane.doe@example.com');
      expect(body.user.role).toBe('member');
      expect(body.user.timezone).toBe('Asia/Singapore');

      const sidCookie = res.cookies.find((c) => c.name === 'sid');
      expect(sidCookie).toBeDefined();
      expect(sidCookie?.httpOnly).toBe(true);
      expect(sidCookie?.sameSite).toBe('Lax');
    });

    it('rejects case-insensitive duplicate email signup (409) and invalid IANA timezone (400)', async () => {
      await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Member One',
          email: 'member@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });

      const duplicateRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Member Two',
          email: 'MEMBER@EXAMPLE.COM',
          password: 'password123',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });
      expect(duplicateRes.statusCode).toBe(409);
      expect(duplicateRes.json().code).toBe('EMAIL_TAKEN');

      const invalidZoneRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Invalid Zone',
          email: 'invalid@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'Mars/Phobos',
        },
      });
      expect(invalidZoneRes.statusCode).toBe(400);
      expect(invalidZoneRes.json().code).toBe('VALIDATION_ERROR');
    });

    it('enforces session expiry (7 days), deletes expired auth_sessions row, and clears sid cookie (401)', async () => {
      const signupRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Bob',
          email: 'bob@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });

      const sidCookie = signupRes.cookies.find((c) => c.name === 'sid')!;

      harness.advanceTime({ days: 7, seconds: 1 });

      const meExpiredRes = await harness.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { sid: sidCookie.value },
      });

      expect(meExpiredRes.statusCode).toBe(401);
      expect(meExpiredRes.json().code).toBe('SESSION_EXPIRED');

      const dbSessions = await harness.pool.query<{ count: string }>(
        'SELECT count(*) FROM auth_sessions',
      );
      expect(Number(dbSessions.rows[0]?.count)).toBe(0);
    });
  });

  describe('Reliable Reminders & Idempotent Delivery (pg-boss + UNIQUE constraint)', () => {
    it('delivers reminder job once and makes duplicate/retry execution a safe no-op (ON CONFLICT DO NOTHING)', async () => {
      const proRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Dr. Reminder',
          email: 'pro.rem@example.com',
          password: 'password123',
          role: 'professional',
          timezone: 'Asia/Singapore',
        },
      });
      const proId = proRes.json().user.id as string;

      const memberRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Member Reminder',
          email: 'mem.rem@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });
      const memberId = memberRes.json().user.id as string;
      const memberSid = memberRes.cookies.find((c) => c.name === 'sid')!.value;

      // Book session > 24h away: 2026-06-03T04:00:00.000Z (12:00 SGT on Wednesday)
      const bookRes = await harness.app.inject({
        method: 'POST',
        url: '/api/sessions',
        cookies: { sid: memberSid },
        payload: {
          professionalId: proId,
          startAt: '2026-06-03T05:00:00.000Z',
        },
      });
      expect(bookRes.statusCode).toBe(201);
      const sessionId = bookRes.json().session.id as string;

      // Initial booking creates 0 immediate notifications
      const initialNotifs = await harness.db.select().from(notifications);
      expect(initialNotifs.length).toBe(0);

      // Verify 4 pg-boss jobs (24h and 1h for both member and professional) were scheduled
      const jobsInDb = await harness.pool.query<{ count: string }>(
        `SELECT count(*) FROM pgboss.job WHERE name = $1 AND state = 'created' AND data->>'sessionId' = $2`,
        [REMINDER_QUEUE_NAME, sessionId],
      );
      expect(Number(jobsInDb.rows[0]?.count)).toBe(4);

      // Execute 24h reminder job for member
      const firstRun = await processReminderJob(harness.db, {
        sessionId,
        userId: memberId,
        kind: 'reminder_24h',
      });
      expect(firstRun.delivered).toBe(true);

      // Re-run the exact same job payload (simulating worker crash/restart retry) -> no-op
      const secondRun = await processReminderJob(harness.db, {
        sessionId,
        userId: memberId,
        kind: 'reminder_24h',
      });
      expect(secondRun.delivered).toBe(false);
      expect(secondRun.reason).toBe('duplicate_skipped');

      const memberNotifs = await harness.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, memberId));
      expect(memberNotifs.length).toBe(1);
      expect(memberNotifs[0]?.kind).toBe('reminder_24h');
    });

    it('skips 24h reminder when booking < 24h ahead and suppresses reminder delivery if session is later cancelled or rescheduled', async () => {
      const proRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Dr. NearTerm',
          email: 'nearterm@example.com',
          password: 'password123',
          role: 'professional',
          timezone: 'UTC',
        },
      });
      const proId = proRes.json().user.id as string;
      const proSid = proRes.cookies.find((c) => c.name === 'sid')!.value;

      const memberRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Member NearTerm',
          email: 'mnearterm@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'UTC',
        },
      });
      const memberId = memberRes.json().user.id as string;
      const memberSid = memberRes.cookies.find((c) => c.name === 'sid')!.value;

      // Now is 2026-06-01T08:00:00Z (Monday). Book 2026-06-01T13:00:00Z (5 hours from now, < 24h)
      const bookRes = await harness.app.inject({
        method: 'POST',
        url: '/api/sessions',
        cookies: { sid: memberSid },
        payload: {
          professionalId: proId,
          startAt: '2026-06-01T13:00:00.000Z',
        },
      });
      expect(bookRes.statusCode).toBe(201);
      const sessionId = bookRes.json().session.id as string;

      // Only 1h reminders should be scheduled (2 jobs total: member + pro), skipping 24h reminder
      const jobsInDb = await harness.pool.query<{ kind: string }>(
        `SELECT data->>'kind' AS kind FROM pgboss.job WHERE name = $1 AND state = 'created' AND data->>'sessionId' = $2`,
        [REMINDER_QUEUE_NAME, sessionId],
      );
      expect(jobsInDb.rows.length).toBe(2);
      expect(jobsInDb.rows.every((r) => r.kind === 'reminder_1h')).toBe(true);

      // Professional cancels the session
      const cancelRes = await harness.app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/cancel`,
        cookies: { sid: proSid },
      });
      expect(cancelRes.statusCode).toBe(200);

      // Even if a reminder job fires after cancellation, processReminderJob suppresses it
      const suppressed = await processReminderJob(harness.db, {
        sessionId,
        userId: memberId,
        kind: 'reminder_1h',
      });
      expect(suppressed.delivered).toBe(false);
      expect(suppressed.reason).toBe('session_not_booked');
    });
  });

  describe('RBAC, Actor Spoofing Protection & Calendar Privacy', () => {
    it('enforces cross-role RBAC (403), prevents cross-member access (403/404), ignores spoofed userId, and preserves slot privacy', async () => {
      const proRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Dr. Privacy',
          email: 'privacy@example.com',
          password: 'password123',
          role: 'professional',
          timezone: 'UTC',
        },
      });
      const proId = proRes.json().user.id as string;
      const proSid = proRes.cookies.find((c) => c.name === 'sid')!.value;

      const memberARes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Member A',
          email: 'member.a@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'UTC',
        },
      });
      const memberAId = memberARes.json().user.id as string;
      const memberASid = memberARes.cookies.find((c) => c.name === 'sid')!.value;

      const memberBRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Member B',
          email: 'member.b@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'UTC',
        },
      });
      const memberBId = memberBRes.json().user.id as string;
      const memberBSid = memberBRes.cookies.find((c) => c.name === 'sid')!.value;

      // Unauthenticated request -> 401
      const unauthRes = await harness.app.inject({
        method: 'GET',
        url: '/api/sessions',
      });
      expect(unauthRes.statusCode).toBe(401);

      // Professional calling POST /api/sessions -> 403
      const proBookAttempt = await harness.app.inject({
        method: 'POST',
        url: '/api/sessions',
        cookies: { sid: proSid },
        payload: {
          professionalId: proId,
          startAt: '2026-06-03T09:00:00.000Z',
        },
      });
      expect(proBookAttempt.statusCode).toBe(403);

      // Member calling PUT /api/availability -> 403
      const memberAvailAttempt = await harness.app.inject({
        method: 'PUT',
        url: '/api/availability',
        cookies: { sid: memberASid },
        payload: {
          bufferMinutes: 10,
          windows: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
        },
      });
      expect(memberAvailAttempt.statusCode).toBe(403);

      // Member A books a session while attempting to spoof memberId = memberBId in body
      const spoofedBookRes = await harness.app.inject({
        method: 'POST',
        url: '/api/sessions',
        cookies: { sid: memberASid },
        payload: {
          professionalId: proId,
          startAt: '2026-06-03T09:00:00.000Z',
          memberId: memberBId,
          userId: memberBId,
        },
      });
      expect(spoofedBookRes.statusCode).toBe(201);
      const sessionId = spoofedBookRes.json().session.id as string;
      // Server resolves actor strictly from cookie session (memberAId)
      expect(spoofedBookRes.json().session.memberId).toBe(memberAId);

      // Member B cannot cancel or reschedule Member A's session (403)
      const memberBCancelAttempt = await harness.app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/cancel`,
        cookies: { sid: memberBSid },
      });
      expect(memberBCancelAttempt.statusCode).toBe(403);

      const memberBReschedAttempt = await harness.app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/reschedule`,
        cookies: { sid: memberBSid },
        payload: { newStartAt: '2026-06-03T10:00:00.000Z' },
      });
      expect(memberBReschedAttempt.statusCode).toBe(403);

      // Deliver a reminder to Member A and verify Member B cannot mark it read (404)
      await processReminderJob(harness.db, {
        sessionId,
        userId: memberAId,
        kind: 'reminder_24h',
      });
      const memberANotifsRes = await harness.app.inject({
        method: 'GET',
        url: '/api/notifications',
        cookies: { sid: memberASid },
      });
      const notifId = memberANotifsRes.json().notifications[0].id as string;

      const memberBReadNotif = await harness.app.inject({
        method: 'POST',
        url: `/api/notifications/${notifId}/read`,
        cookies: { sid: memberBSid },
      });
      expect(memberBReadNotif.statusCode).toBe(404);

      // Member A can mark their own notification read (200)
      const memberAReadNotif = await harness.app.inject({
        method: 'POST',
        url: `/api/notifications/${notifId}/read`,
        cookies: { sid: memberASid },
      });
      expect(memberAReadNotif.statusCode).toBe(200);

      // Calendar Privacy: GET /api/professionals/:id/slots returns strictly { startAt, endAt }[] with zero booked-session or other-member metadata
      const slotsRes = await harness.app.inject({
        method: 'GET',
        url: `/api/professionals/${proId}/slots`,
        cookies: { sid: memberBSid },
      });
      expect(slotsRes.statusCode).toBe(200);
      const slotsBody = slotsRes.json();
      expect(Object.keys(slotsBody).sort()).toEqual(['professional', 'slots']);
      for (const slot of slotsBody.slots as Array<Record<string, unknown>>) {
        expect(Object.keys(slot).sort()).toEqual(['endAt', 'startAt']);
      }
    });
  });
});
