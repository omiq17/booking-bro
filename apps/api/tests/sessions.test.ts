import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookingSessions, notifications } from '../src/db/schema.js';
import { REMINDER_QUEUE_NAME } from '../src/services/reminder.service.js';
import { createTestHarness, type TestHarness } from './setup.js';

async function signupUser(
  harness: TestHarness,
  payload: {
    name: string;
    email: string;
    role: 'member' | 'professional';
    timezone?: string;
  },
) {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      name: payload.name,
      email: payload.email,
      password: 'password123!',
      role: payload.role,
      timezone: payload.timezone ?? 'UTC',
    },
  });
  expect(res.statusCode).toBe(201);
  const sid = res.cookies.find((c) => c.name === 'sid')!.value;
  return {
    user: res.json().user as {
      id: string;
      email: string;
      name: string;
      role: 'member' | 'professional';
      timezone: string;
    },
    sid,
  };
}

describe('Session Lifecycle: Cancel, Atomic Reschedule, Schedule Edits & State Transitions (sessions.test.ts)', () => {
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

  it('enforces 24h member lock (422 within 24h) while allowing professional to cancel future sessions anytime (200) and rejecting past sessions (422)', async () => {
    const pro = await signupUser(harness, {
      name: 'Dr. Smith',
      email: 'smith@example.com',
      role: 'professional',
    });
    const member = await signupUser(harness, {
      name: 'Member Alice',
      email: 'alice@example.com',
      role: 'member',
    });

    // Book a session 26 hours in the future: 2026-06-02T10:00:00.000Z
    const bookRes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-02T10:00:00.000Z',
      },
    });
    expect(bookRes.statusCode).toBe(201);
    const sessionId = bookRes.json().session.id as string;

    // Advance time to 2026-06-01T10:00:01.000Z (23h 59m 59s before start)
    harness.setNow('2026-06-01T10:00:01.000Z');

    // Member attempt to cancel within 24h -> 422 WITHIN_24_HOURS
    const memberCancelRes = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/cancel`,
      cookies: { sid: member.sid },
    });
    expect(memberCancelRes.statusCode).toBe(422);
    expect(memberCancelRes.json().code).toBe('WITHIN_24_HOURS');

    // Member attempt to reschedule within 24h -> 422 WITHIN_24_HOURS
    const memberReschedRes = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/reschedule`,
      cookies: { sid: member.sid },
      payload: { newStartAt: '2026-06-03T10:00:00.000Z' },
    });
    expect(memberReschedRes.statusCode).toBe(422);
    expect(memberReschedRes.json().code).toBe('WITHIN_24_HOURS');

    // Professional can cancel even 1 hour before start (setNow to 2026-06-02T09:00:00.000Z)
    harness.setNow('2026-06-02T09:00:00.000Z');
    const proCancelRes = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/cancel`,
      cookies: { sid: pro.sid },
    });
    expect(proCancelRes.statusCode).toBe(200);
    expect(proCancelRes.json().session.status).toBe('cancelled');
    expect(proCancelRes.json().session.cancelledBy).toBe(pro.user.id);

    // Book a second session on 2026-06-03T10:00:00.000Z and advance past its start time
    harness.setNow('2026-06-02T09:00:00.000Z');
    const book2Res = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-03T10:00:00.000Z',
      },
    });
    const session2Id = book2Res.json().session.id as string;

    // Move clock to exact start time: 2026-06-03T10:00:00.000Z -> Professional cannot cancel past/started session (422)
    harness.setNow('2026-06-03T10:00:00.000Z');
    const proPastCancelRes = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${session2Id}/cancel`,
      cookies: { sid: pro.sid },
    });
    expect(proPastCancelRes.statusCode).toBe(422);
    expect(proPastCancelRes.json().code).toBe('SESSION_ALREADY_STARTED');
  });

  it('supports adjacent same-day reschedule (+10m) via excludeSessionId self-exclusion', async () => {
    const pro = await signupUser(harness, {
      name: 'Dr. Adjacent',
      email: 'adjacent@example.com',
      role: 'professional',
    });
    const member = await signupUser(harness, {
      name: 'Member Shift',
      email: 'shift@example.com',
      role: 'member',
    });

    // Book 2026-06-03T10:00:00.000Z (> 24h away)
    const bookRes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-03T10:00:00.000Z',
      },
    });
    expect(bookRes.statusCode).toBe(201);
    const oldSessionId = bookRes.json().session.id as string;

    // Without excludeSessionId, 10:10 is blocked by the 10:00 booking
    const slotsWithoutExclude = await harness.app.inject({
      method: 'GET',
      url: `/api/professionals/${pro.user.id}/slots`,
      cookies: { sid: member.sid },
    });
    const has1010WithoutExclude = slotsWithoutExclude
      .json()
      .slots.some(
        (s: { startAt: string }) => s.startAt === '2026-06-03T10:10:00.000Z',
      );
    expect(has1010WithoutExclude).toBe(false);

    // With ?excludeSessionId=oldSessionId, 10:10 is available!
    const slotsWithExclude = await harness.app.inject({
      method: 'GET',
      url: `/api/professionals/${pro.user.id}/slots?excludeSessionId=${oldSessionId}`,
      cookies: { sid: member.sid },
    });
    expect(slotsWithExclude.statusCode).toBe(200);
    const has1010WithExclude = slotsWithExclude
      .json()
      .slots.some(
        (s: { startAt: string }) => s.startAt === '2026-06-03T10:10:00.000Z',
      );
    expect(has1010WithExclude).toBe(true);

    // Reschedule by +10m to 2026-06-03T10:10:00.000Z -> 200 OK
    const reschedRes = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${oldSessionId}/reschedule`,
      cookies: { sid: member.sid },
      payload: { newStartAt: '2026-06-03T10:10:00.000Z' },
    });
    expect(reschedRes.statusCode).toBe(200);
    expect(reschedRes.json().previousSessionId).toBe(oldSessionId);
    expect(reschedRes.json().session.startAt).toBe('2026-06-03T10:10:00.000Z');
    expect(reschedRes.json().session.rescheduledFromId).toBe(oldSessionId);
  });

  it('supports chained reschedules (A -> B -> C) and cancelling C without notifications unique constraint collision', async () => {
    const pro = await signupUser(harness, {
      name: 'Dr. Chain',
      email: 'chain@example.com',
      role: 'professional',
    });
    const member = await signupUser(harness, {
      name: 'Member Chain',
      email: 'mchain@example.com',
      role: 'member',
    });

    // Create Session A at 2026-06-03T09:00:00.000Z
    const resA = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-03T09:00:00.000Z',
      },
    });
    expect(resA.statusCode).toBe(201);
    const sessionAId = resA.json().session.id as string;

    // Reschedule A -> B (2026-06-03T10:00:00.000Z)
    const resB = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionAId}/reschedule`,
      cookies: { sid: member.sid },
      payload: { newStartAt: '2026-06-03T10:00:00.000Z' },
    });
    expect(resB.statusCode).toBe(200);
    const sessionBId = resB.json().session.id as string;

    // Reschedule B -> C (2026-06-03T11:00:00.000Z)
    const resC = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionBId}/reschedule`,
      cookies: { sid: member.sid },
      payload: { newStartAt: '2026-06-03T11:00:00.000Z' },
    });
    expect(resC.statusCode).toBe(200);
    const sessionCId = resC.json().session.id as string;

    // Cancel C
    const cancelC = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionCId}/cancel`,
      cookies: { sid: member.sid },
    });
    expect(cancelC.statusCode).toBe(200);
    expect(cancelC.json().session.status).toBe('cancelled');

    // Verify member notifications contain 2 'session_rescheduled' (attached to B and C) and 1 'session_cancelled' (attached to C)
    const memberNotifs = await harness.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, member.user.id));
    expect(memberNotifs.length).toBe(3);
  });

  it('rolls back atomic reschedule completely (including pg-boss jobs) when the target slot is already taken (409)', async () => {
    const pro = await signupUser(harness, {
      name: 'Dr. Rollback',
      email: 'rollback@example.com',
      role: 'professional',
    });
    const member1 = await signupUser(harness, {
      name: 'Member 1',
      email: 'm1.rb@example.com',
      role: 'member',
    });
    const member2 = await signupUser(harness, {
      name: 'Member 2',
      email: 'm2.rb@example.com',
      role: 'member',
    });

    // Member 1 books 2026-06-03T09:00:00.000Z
    const book1 = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member1.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-03T09:00:00.000Z',
      },
    });
    const session1Id = book1.json().session.id as string;

    // Member 2 books 2026-06-03T11:00:00.000Z
    const book2 = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member2.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-03T11:00:00.000Z',
      },
    });
    expect(book2.statusCode).toBe(201);

    // Member 1 attempts to reschedule session1 into Member 2's taken slot (2026-06-03T11:00:00.000Z) -> 409 SLOT_CONFLICT
    const conflictResched = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${session1Id}/reschedule`,
      cookies: { sid: member1.sid },
      payload: { newStartAt: '2026-06-03T11:00:00.000Z' },
    });
    expect(conflictResched.statusCode).toBe(409);
    expect(conflictResched.json().code).toBe('SLOT_CONFLICT');

    // Verify session1 is STILL 'booked' at 09:00
    const [session1Row] = await harness.db
      .select()
      .from(bookingSessions)
      .where(eq(bookingSessions.id, session1Id));
    expect(session1Row?.status).toBe('booked');
    expect(session1Row?.startAt.toISOString()).toBe('2026-06-03T09:00:00.000Z');

    // Verify session1's 4 pg-boss reminder jobs are STILL in 'created' state (not cancelled!)
    const jobsRes = await harness.pool.query<{ count: string }>(
      `SELECT count(*) FROM pgboss.job WHERE name = $1 AND state = 'created' AND data->>'sessionId' = $2`,
      [REMINDER_QUEUE_NAME, session1Id],
    );
    expect(Number(jobsRes.rows[0]?.count)).toBe(4);
  });

  it('preserves existing booked sessions and their snapshotted blocked_until when professional updates working hours or buffer_minutes', async () => {
    const pro = await signupUser(harness, {
      name: 'Dr. Evolving Schedule',
      email: 'evolving@example.com',
      role: 'professional',
      timezone: 'UTC',
    });
    const member = await signupUser(harness, {
      name: 'Member Steady',
      email: 'steady@example.com',
      role: 'member',
    });

    // Pro starts with 30m buffer on Tuesday (weekday 2) 09:00-13:00
    await harness.app.inject({
      method: 'PUT',
      url: '/api/availability',
      cookies: { sid: pro.sid },
      payload: {
        bufferMinutes: 30,
        windows: [{ weekday: 2, startTime: '09:00', endTime: '13:00' }],
      },
    });

    // Member books 10:00-10:50 (snapshotted buffer = 30m -> blocked_until = 11:20)
    const bookRes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-02T10:00:00.000Z',
      },
    });
    expect(bookRes.statusCode).toBe(201);
    const bookedSessionId = bookRes.json().session.id as string;

    // Pro now updates buffer down to 10m
    const updateRes = await harness.app.inject({
      method: 'PUT',
      url: '/api/availability',
      cookies: { sid: pro.sid },
      payload: {
        bufferMinutes: 10,
        windows: [{ weekday: 2, startTime: '09:00', endTime: '13:00' }],
      },
    });
    expect(updateRes.statusCode).toBe(200);

    // Existing booking row retains buffer_minutes = 30 and blocked_until = 11:20
    const [existingRow] = await harness.db
      .select()
      .from(bookingSessions)
      .where(eq(bookingSessions.id, bookedSessionId));
    expect(existingRow?.status).toBe('booked');
    expect(existingRow?.bufferMinutes).toBe(30);
    expect(existingRow?.blockedUntil.toISOString()).toBe(
      '2026-06-02T11:20:00.000Z',
    );

    // Meanwhile, a new candidate slot BEFORE 10:00 uses the new 10m buffer: 09:00 (09:00-09:50 + 10m = 10:00) is now free!
    const otherMember = await signupUser(harness, {
      name: 'Member Other',
      email: 'other@example.com',
      role: 'member',
    });
    const slotsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/professionals/${pro.user.id}/slots`,
      cookies: { sid: otherMember.sid },
    });
    const slotStarts = slotsRes
      .json()
      .slots.map((s: { startAt: string }) => s.startAt);
    expect(slotStarts).toContain('2026-06-02T09:00:00.000Z');
    // And 11:10 is still blocked by the existing booking's snapshotted 11:20 blocked_until
    expect(slotStarts).not.toContain('2026-06-02T11:10:00.000Z');
    expect(slotStarts).toContain('2026-06-02T11:20:00.000Z');
  });

  it('rejects invalid state transitions (409) and < 2h notice or off-grid booking times (422)', async () => {
    const pro = await signupUser(harness, {
      name: 'Dr. Rules',
      email: 'rules@example.com',
      role: 'professional',
    });
    const member = await signupUser(harness, {
      name: 'Member Rules',
      email: 'mrules@example.com',
      role: 'member',
    });

    // Reject booking < 2 hours from now (now = 2026-06-01T08:00:00Z, try 09:30Z)
    const tooSoonRes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-01T09:30:00.000Z',
      },
    });
    expect(tooSoonRes.statusCode).toBe(422);
    expect(tooSoonRes.json().code).toBe('INSUFFICIENT_NOTICE');

    // Reject off-grid start time (09:05)
    const offGridRes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-02T09:05:00.000Z',
      },
    });
    expect(offGridRes.statusCode).toBe(422);
    expect(offGridRes.json().code).toBe('INVALID_SLOT');

    // Book valid slot and cancel it
    const validBook = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-03T09:00:00.000Z',
      },
    });
    const sessionId = validBook.json().session.id as string;

    const firstCancel = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/cancel`,
      cookies: { sid: member.sid },
    });
    expect(firstCancel.statusCode).toBe(200);

    // Cancelling an already cancelled session -> 409
    const secondCancel = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/cancel`,
      cookies: { sid: member.sid },
    });
    expect(secondCancel.statusCode).toBe(409);

    // Rescheduling an already cancelled session -> 409
    const reschedCancelled = await harness.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/reschedule`,
      cookies: { sid: member.sid },
      payload: { newStartAt: '2026-06-03T10:00:00.000Z' },
    });
    expect(reschedCancelled.statusCode).toBe(409);
  });
});
