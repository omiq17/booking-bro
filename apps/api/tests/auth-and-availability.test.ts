import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Auth & Availability API (Phase 2)', () => {
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
      expect(body.user.email).toBe('jane.doe@example.com'); // normalized to lowercase
      expect(body.user.role).toBe('member');
      expect(body.user.timezone).toBe('Asia/Singapore');

      const cookies = res.cookies;
      const sidCookie = cookies.find((c) => c.name === 'sid');
      expect(sidCookie).toBeDefined();
      expect(sidCookie?.httpOnly).toBe(true);
      expect(sidCookie?.sameSite).toBe('Lax');
    });

    it('rejects case-insensitive duplicate email signup', async () => {
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
    });

    it('rejects invalid IANA timezone', async () => {
      const res = await harness.app.inject({
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

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('seeds default profile and Mon-Fri availability for professional signup', async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Dr. John Watson',
          email: 'john.watson@example.com',
          password: 'password123',
          role: 'professional',
          timezone: 'Europe/London',
          specialty: 'Clinical Psychologist',
          bio: 'Specializing in CBT.',
        },
      });

      expect(res.statusCode).toBe(201);
      const proId = res.json().user.id;
      const sidCookie = res.cookies.find((c) => c.name === 'sid')!;

      // Inspect availability via GET /api/availability/me
      const availRes = await harness.app.inject({
        method: 'GET',
        url: '/api/availability/me',
        cookies: { sid: sidCookie.value },
      });

      expect(availRes.statusCode).toBe(200);
      const availBody = availRes.json();
      expect(availBody.bufferMinutes).toBe(10);
      expect(availBody.specialty).toBe('Clinical Psychologist');
      expect(availBody.windows.length).toBe(10); // 5 weekdays * 2 windows
      expect(availBody.windows[0]).toMatchObject({
        weekday: 1,
        startTime: '09:00',
        endTime: '12:00',
      });
      expect(availBody.windows[1]).toMatchObject({
        weekday: 1,
        startTime: '13:00',
        endTime: '17:00',
      });
    });

    it('authenticates with correct credentials and rejects invalid password without leaking user existence', async () => {
      await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Alice',
          email: 'alice@example.com',
          password: 'correctPassword123',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });

      const badPwRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'alice@example.com',
          password: 'wrongPassword',
        },
      });

      expect(badPwRes.statusCode).toBe(401);
      expect(badPwRes.json().code).toBe('INVALID_CREDENTIALS');

      const nonExistentRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'nobody@example.com',
          password: 'anyPassword',
        },
      });

      expect(nonExistentRes.statusCode).toBe(401);
      expect(nonExistentRes.json().code).toBe('INVALID_CREDENTIALS');

      const goodLoginRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'ALICE@example.com', // case-insensitive login
          password: 'correctPassword123',
        },
      });

      expect(goodLoginRes.statusCode).toBe(200);
      expect(goodLoginRes.json().user.email).toBe('alice@example.com');
      expect(goodLoginRes.cookies.find((c) => c.name === 'sid')).toBeDefined();
    });

    it('enforces session expiry (7 days) and cleans up expired session row on access', async () => {
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

      // Verify active session works
      const meActiveRes = await harness.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { sid: sidCookie.value },
      });
      expect(meActiveRes.statusCode).toBe(200);

      // Advance clock past 7 days (e.g. 7 days + 1 second)
      harness.advanceTime({ days: 7, seconds: 1 });

      const meExpiredRes = await harness.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { sid: sidCookie.value },
      });

      expect(meExpiredRes.statusCode).toBe(401);
      expect(meExpiredRes.json().code).toBe('SESSION_EXPIRED');

      // Verify expired row was deleted from auth_sessions
      const dbSessions = await harness.pool.query(
        'SELECT count(*) FROM auth_sessions',
      );
      expect(Number(dbSessions.rows[0].count)).toBe(0);
    });

    it('allows user to update their IANA timezone', async () => {
      const signupRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Traveler',
          email: 'traveler@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });

      const sidCookie = signupRes.cookies.find((c) => c.name === 'sid')!;

      const updateRes = await harness.app.inject({
        method: 'PATCH',
        url: '/api/users/me/timezone',
        cookies: { sid: sidCookie.value },
        payload: { timezone: 'Europe/Paris' },
      });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().user.timezone).toBe('Europe/Paris');

      // Verify GET /api/auth/me reflects the updated zone
      const meRes = await harness.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { sid: sidCookie.value },
      });
      expect(meRes.json().user.timezone).toBe('Europe/Paris');
    });
  });

  describe('Professional Directory & Availability Routes', () => {
    it('lists professionals and retrieves profile with windows', async () => {
      // Create professional
      const proRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Dr. Sarah Connor',
          email: 'sarah@example.com',
          password: 'password123',
          role: 'professional',
          timezone: 'America/New_York',
          specialty: 'Trauma & Resilience',
          bio: 'Expert in stress reduction.',
        },
      });
      const proId = proRes.json().user.id;

      // Create member
      const memberRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Member Jane',
          email: 'jane@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });
      const memberSid = memberRes.cookies.find((c) => c.name === 'sid')!.value;

      // List professionals
      const listRes = await harness.app.inject({
        method: 'GET',
        url: '/api/professionals',
        cookies: { sid: memberSid },
      });

      expect(listRes.statusCode).toBe(200);
      const listBody = listRes.json();
      expect(listBody.professionals.length).toBe(1);
      expect(listBody.professionals[0]).toMatchObject({
        id: proId,
        name: 'Dr. Sarah Connor',
        specialty: 'Trauma & Resilience',
        timezone: 'America/New_York',
        bufferMinutes: 10,
      });

      // Get single professional
      const getRes = await harness.app.inject({
        method: 'GET',
        url: `/api/professionals/${proId}`,
        cookies: { sid: memberSid },
      });

      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().professional.name).toBe('Dr. Sarah Connor');
      expect(getRes.json().professional.windows.length).toBeGreaterThan(0);
    });

    it('enforces RBAC on availability editor (professionals only)', async () => {
      const memberRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Regular Member',
          email: 'reg@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });
      const memberSid = memberRes.cookies.find((c) => c.name === 'sid')!.value;

      const forbiddenGet = await harness.app.inject({
        method: 'GET',
        url: '/api/availability/me',
        cookies: { sid: memberSid },
      });
      expect(forbiddenGet.statusCode).toBe(403);

      const forbiddenPut = await harness.app.inject({
        method: 'PUT',
        url: '/api/availability',
        cookies: { sid: memberSid },
        payload: {
          bufferMinutes: 20,
          windows: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
        },
      });
      expect(forbiddenPut.statusCode).toBe(403);
    });

    it('updates professional availability and validates rules (buffer & windows)', async () => {
      const proRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Dr. House',
          email: 'house@example.com',
          password: 'password123',
          role: 'professional',
          timezone: 'America/New_York',
        },
      });
      const proSid = proRes.cookies.find((c) => c.name === 'sid')!.value;

      // Reject window shorter than 50 minutes
      const shortWinRes = await harness.app.inject({
        method: 'PUT',
        url: '/api/availability',
        cookies: { sid: proSid },
        payload: {
          bufferMinutes: 20,
          windows: [{ weekday: 1, startTime: '09:00', endTime: '09:40' }],
        },
      });
      expect(shortWinRes.statusCode).toBe(422);

      // Reject overlapping windows on the same weekday
      const overlapRes = await harness.app.inject({
        method: 'PUT',
        url: '/api/availability',
        cookies: { sid: proSid },
        payload: {
          bufferMinutes: 20,
          windows: [
            { weekday: 1, startTime: '09:00', endTime: '12:00' },
            { weekday: 1, startTime: '11:00', endTime: '14:00' },
          ],
        },
      });
      expect(overlapRes.statusCode).toBe(422);

      // Successfully update with 3 valid windows and 30m buffer
      const validPutRes = await harness.app.inject({
        method: 'PUT',
        url: '/api/availability',
        cookies: { sid: proSid },
        payload: {
          bufferMinutes: 30,
          windows: [
            { weekday: 1, startTime: '08:00', endTime: '11:00' },
            { weekday: 1, startTime: '12:00', endTime: '15:00' },
            { weekday: 1, startTime: '16:00', endTime: '19:00' },
          ],
        },
      });

      expect(validPutRes.statusCode).toBe(200);
      const putBody = validPutRes.json();
      expect(putBody.bufferMinutes).toBe(30);
      expect(putBody.windows.length).toBe(3);
    });

    it('computes on-the-fly available slots and filters member self-overlap', async () => {
      // Setup professional in London (UTC+1 on 2026-06-01 BST)
      const proRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'London Pro',
          email: 'london.pro@example.com',
          password: 'password123',
          role: 'professional',
          timezone: 'Europe/London',
        },
      });
      const proId = proRes.json().user.id;
      const proSid = proRes.cookies.find((c) => c.name === 'sid')!.value;

      // Set Mon 09:00-12:00 window (in Europe/London BST = 08:00-11:00 UTC)
      await harness.app.inject({
        method: 'PUT',
        url: '/api/availability',
        cookies: { sid: proSid },
        payload: {
          bufferMinutes: 10,
          windows: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
        },
      });

      // Member signs up
      const memberRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Member SG',
          email: 'sg.member@example.com',
          password: 'password123',
          role: 'member',
          timezone: 'Asia/Singapore',
        },
      });
      const memberId = memberRes.json().user.id;
      const memberSid = memberRes.cookies.find((c) => c.name === 'sid')!.value;

      // Current time is 2026-06-01T08:00:00.000Z.
      // Minimum booking notice is 2 hours -> earliest allowed start is 10:00:00Z.
      // London Mon 09:00-12:00 local is 08:00-11:00 UTC.
      // 50m session finishing by 11:00 UTC can start at: 08:00, 08:10, ..., 10:10 UTC.
      // With 2h notice (>= 10:00 UTC), today only 10:00 and 10:10 UTC are valid for today.
      const slotsRes = await harness.app.inject({
        method: 'GET',
        url: `/api/professionals/${proId}/slots`,
        cookies: { sid: memberSid },
      });

      expect(slotsRes.statusCode).toBe(200);
      const slotsBody = slotsRes.json();
      expect(slotsBody.slots.length).toBeGreaterThan(0);

      // Verify today's first slot respects 2h notice
      const firstSlot = slotsBody.slots[0];
      expect(new Date(firstSlot.startAt).getTime()).toBeGreaterThanOrEqual(
        new Date('2026-06-01T10:00:00.000Z').getTime(),
      );

      // Insert a booking for member on another professional at 10:00-10:50 UTC to verify member self-overlap filtering
      const otherProRes = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          name: 'Other Pro',
          email: 'other.pro@example.com',
          password: 'password123',
          role: 'professional',
          timezone: 'UTC',
        },
      });
      const otherProId = otherProRes.json().user.id;

      await harness.pool.query(
        `INSERT INTO booking_sessions (
          id, member_id, professional_id, start_at, end_at, blocked_until, buffer_minutes, status
        ) VALUES (
          gen_random_uuid(), $1, $2, '2026-06-01T10:00:00.000Z', '2026-06-01T10:50:00.000Z', '2026-06-01T11:00:00.000Z', 10, 'booked'
        );`,
        [memberId, otherProId],
      );

      // Re-query slots: 10:00 UTC slot should now be filtered out for this member!
      const filteredSlotsRes = await harness.app.inject({
        method: 'GET',
        url: `/api/professionals/${proId}/slots`,
        cookies: { sid: memberSid },
      });

      const filteredSlots = filteredSlotsRes.json().slots;
      const has1000 = filteredSlots.some(
        (s: { startAt: string }) => s.startAt === '2026-06-01T10:00:00.000Z',
      );
      expect(has1000).toBe(false);
    });
  });
});
