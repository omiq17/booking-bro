import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookingSessions } from '../src/db/schema.js';
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

describe('Real-PostgreSQL Concurrency & Exclusion Constraints (concurrency.test.ts)', () => {
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

  it('prevents double-booking when two members book the exact same professional and slot concurrently (one 201, one 409)', async () => {
    const pro = await signupUser(harness, {
      name: 'Dr. Concurrent',
      email: 'pro.concurrent@example.com',
      role: 'professional',
      timezone: 'UTC',
    });
    const memberA = await signupUser(harness, {
      name: 'Member Alpha',
      email: 'alpha@example.com',
      role: 'member',
    });
    const memberB = await signupUser(harness, {
      name: 'Member Beta',
      email: 'beta@example.com',
      role: 'member',
    });

    // Tuesday 2026-06-02 09:00 UTC is inside default Mon-Fri 09:00-12:00 window
    const targetStartAt = '2026-06-02T09:00:00.000Z';

    const results = await Promise.allSettled([
      harness.app.inject({
        method: 'POST',
        url: '/api/sessions',
        cookies: { sid: memberA.sid },
        payload: {
          professionalId: pro.user.id,
          startAt: targetStartAt,
        },
      }),
      harness.app.inject({
        method: 'POST',
        url: '/api/sessions',
        cookies: { sid: memberB.sid },
        payload: {
          professionalId: pro.user.id,
          startAt: targetStartAt,
        },
      }),
    ]);

    const responses = results.map((r) => {
      expect(r.status).toBe('fulfilled');
      return (r as PromiseFulfilledResult<Awaited<ReturnType<typeof harness.app.inject>>>).value;
    });

    const statuses = responses.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 409]);

    const conflictResponse = responses.find((r) => r.statusCode === 409)!;
    expect(conflictResponse.json().code).toBe('SLOT_CONFLICT');

    const bookedInDb = await harness.db
      .select()
      .from(bookingSessions)
      .where(eq(bookingSessions.status, 'booked'));
    expect(bookedInDb.length).toBe(1);
  });

  it('enforces professional post-session buffer in no_professional_overlap (10:00 + 10m buffer blocks 10:50 with 409, allows 11:00 with 201)', async () => {
    const pro = await signupUser(harness, {
      name: 'Dr. Buffer10',
      email: 'buffer10@example.com',
      role: 'professional',
      timezone: 'UTC',
    });
    const memberA = await signupUser(harness, {
      name: 'Member A',
      email: 'ma@example.com',
      role: 'member',
    });
    const memberB = await signupUser(harness, {
      name: 'Member B',
      email: 'mb@example.com',
      role: 'member',
    });

    // Book 10:00-10:50 (blocked_until = 11:00)
    const firstRes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: memberA.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-02T10:00:00.000Z',
      },
    });
    expect(firstRes.statusCode).toBe(201);
    expect(firstRes.json().session.blockedUntil).toBe(
      '2026-06-02T11:00:00.000Z',
    );

    // Member B attempts to book 10:50 (inside the 10:50-11:00 buffer window) -> 409 SLOT_CONFLICT
    const overlapBufferRes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: memberB.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-02T10:50:00.000Z',
      },
    });
    expect(overlapBufferRes.statusCode).toBe(409);
    expect(overlapBufferRes.json().code).toBe('SLOT_CONFLICT');

    // Member B books 11:00 (exact end of blocked_until) -> 201 Created
    const afterBufferRes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: memberB.sid },
      payload: {
        professionalId: pro.user.id,
        startAt: '2026-06-02T11:00:00.000Z',
      },
    });
    expect(afterBufferRes.statusCode).toBe(201);
  });

  it('prevents the same member from booking overlapping sessions across two different professionals (no_member_overlap 409)', async () => {
    const proA = await signupUser(harness, {
      name: 'Dr. Pro A',
      email: 'pro.a@example.com',
      role: 'professional',
      timezone: 'UTC',
    });
    const proB = await signupUser(harness, {
      name: 'Dr. Pro B',
      email: 'pro.b@example.com',
      role: 'professional',
      timezone: 'UTC',
    });
    const member = await signupUser(harness, {
      name: 'Busy Member',
      email: 'busy@example.com',
      role: 'member',
    });

    // Book 10:00-10:50 with Pro A
    const resA = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: proA.user.id,
        startAt: '2026-06-02T10:00:00.000Z',
      },
    });
    expect(resA.statusCode).toBe(201);

    // Attempt to book overlapping 10:20-11:10 with Pro B -> 409 SLOT_CONFLICT
    const resB = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member.sid },
      payload: {
        professionalId: proB.user.id,
        startAt: '2026-06-02T10:20:00.000Z',
      },
    });
    expect(resB.statusCode).toBe(409);
    expect(resB.json().code).toBe('SLOT_CONFLICT');
  });

  it('enforces member vs. professional buffer asymmetry: member booked 10:00-10:50 with Pro A (30m buffer -> 11:20) can book 10:50-11:40 back-to-back with Pro B', async () => {
    const proA = await signupUser(harness, {
      name: 'Dr. Pro A (30m buffer)',
      email: 'pro.a30@example.com',
      role: 'professional',
      timezone: 'UTC',
    });
    const proB = await signupUser(harness, {
      name: 'Dr. Pro B (10m buffer)',
      email: 'pro.b10@example.com',
      role: 'professional',
      timezone: 'UTC',
    });

    // Configure Pro A with 30m buffer and 09:00-13:00 window
    const updateAvailRes = await harness.app.inject({
      method: 'PUT',
      url: '/api/availability',
      cookies: { sid: proA.sid },
      payload: {
        bufferMinutes: 30,
        windows: [{ weekday: 2, startTime: '09:00', endTime: '13:00' }],
      },
    });
    expect(updateAvailRes.statusCode).toBe(200);

    // Configure Pro B with 09:00-13:00 window
    await harness.app.inject({
      method: 'PUT',
      url: '/api/availability',
      cookies: { sid: proB.sid },
      payload: {
        bufferMinutes: 10,
        windows: [{ weekday: 2, startTime: '09:00', endTime: '13:00' }],
      },
    });

    const member1 = await signupUser(harness, {
      name: 'Member One',
      email: 'm1@example.com',
      role: 'member',
    });
    const member2 = await signupUser(harness, {
      name: 'Member Two',
      email: 'm2@example.com',
      role: 'member',
    });

    // Member 1 books 10:00-10:50 with Pro A (Pro A blocked_until = 11:20)
    const bookProARes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member1.sid },
      payload: {
        professionalId: proA.user.id,
        startAt: '2026-06-02T10:00:00.000Z',
      },
    });
    expect(bookProARes.statusCode).toBe(201);
    expect(bookProARes.json().session.endAt).toBe('2026-06-02T10:50:00.000Z');
    expect(bookProARes.json().session.blockedUntil).toBe(
      '2026-06-02T11:20:00.000Z',
    );

    // Member 1 books 10:50-11:40 back-to-back with Pro B -> Succeeds (201) because member range is [start_at, end_at) = [10:00, 10:50)
    const bookProBRes = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member1.sid },
      payload: {
        professionalId: proB.user.id,
        startAt: '2026-06-02T10:50:00.000Z',
      },
    });
    expect(bookProBRes.statusCode).toBe(201);

    // Meanwhile, Pro A is still blocked until 11:20: Member 2 trying 11:10 with Pro A gets 409
    const member2EarlyProA = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member2.sid },
      payload: {
        professionalId: proA.user.id,
        startAt: '2026-06-02T11:10:00.000Z',
      },
    });
    expect(member2EarlyProA.statusCode).toBe(409);

    // Member 2 booking 11:20 with Pro A succeeds (201)
    const member2ValidProA = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      cookies: { sid: member2.sid },
      payload: {
        professionalId: proA.user.id,
        startAt: '2026-06-02T11:20:00.000Z',
      },
    });
    expect(member2ValidProA.statusCode).toBe(201);
  });
});
