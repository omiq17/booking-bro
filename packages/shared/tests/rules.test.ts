import { describe, expect, it } from 'vitest';
import {
  canMemberModifySession,
  computeReminderSchedule,
  isTenMinuteAlignedTime,
  isValidIanaTimezone,
  meetsMinimumNotice,
} from '../src/rules.js';
import {
  signupSchema,
  updateAvailabilitySchema,
  createSessionSchema,
  rescheduleSessionSchema,
  updateTimezoneSchema,
} from '../src/schemas.js';

describe('24-Hour Cancellation & Reschedule Rule (canMemberModifySession)', () => {
  it('allows member to cancel or reschedule when exactly 24h 00m 00s before start_at', () => {
    const nowIso = '2026-11-10T10:00:00.000Z';
    const startAtIso = '2026-11-11T10:00:00.000Z';

    const result = canMemberModifySession(startAtIso, nowIso);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('allows member to cancel or reschedule when more than 24 hours before start_at', () => {
    const nowIso = '2026-11-10T10:00:00.000Z';
    const startAtIso = '2026-11-13T14:30:00.000Z';

    const result = canMemberModifySession(startAtIso, nowIso);

    expect(result.allowed).toBe(true);
  });

  it('blocks member from cancelling or rescheduling at 23h 59m 59s before start_at', () => {
    const nowIso = '2026-11-10T10:00:01.000Z';
    const startAtIso = '2026-11-11T10:00:00.000Z';

    const result = canMemberModifySession(startAtIso, nowIso);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('24 hours');
  });

  it('blocks member when start_at is in the past or invalid ISO string', () => {
    const nowIso = '2026-11-10T10:00:00.000Z';
    expect(canMemberModifySession('2026-11-09T10:00:00.000Z', nowIso).allowed).toBe(false);
    expect(canMemberModifySession('not-a-date', nowIso).allowed).toBe(false);
  });
});

describe('2-Hour Minimum Booking Notice (meetsMinimumNotice)', () => {
  it('allows booking when start_at is exactly 2 hours from now', () => {
    const nowIso = '2026-11-10T10:00:00.000Z';
    const startAtIso = '2026-11-10T12:00:00.000Z';

    expect(meetsMinimumNotice(startAtIso, nowIso)).toBe(true);
  });

  it('rejects booking when start_at is 1h 59m 59s from now', () => {
    const nowIso = '2026-11-10T10:00:01.000Z';
    const startAtIso = '2026-11-10T12:00:00.000Z';

    expect(meetsMinimumNotice(startAtIso, nowIso)).toBe(false);
  });
});

describe('Reminder Schedule Calculator (computeReminderSchedule)', () => {
  it('schedules both 24h and 1h reminders when session is > 24 hours away', () => {
    const nowIso = '2026-11-10T08:00:00.000Z';
    const startAtIso = '2026-11-12T10:00:00.000Z';

    const schedule = computeReminderSchedule(startAtIso, nowIso);

    expect(schedule).toEqual([
      { kind: 'reminder_24h', sendAtIso: '2026-11-11T10:00:00.000Z' },
      { kind: 'reminder_1h', sendAtIso: '2026-11-12T09:00:00.000Z' },
    ]);
  });

  it('skips 24h reminder and schedules only 1h reminder when booked/rescheduled 2h-24h ahead', () => {
    const nowIso = '2026-11-10T12:00:00.000Z';
    const startAtIso = '2026-11-11T10:00:00.000Z'; // 22 hours away

    const schedule = computeReminderSchedule(startAtIso, nowIso);

    expect(schedule).toEqual([
      { kind: 'reminder_1h', sendAtIso: '2026-11-11T09:00:00.000Z' },
    ]);
  });

  it('skips 24h reminder when start_at is exactly 24h away (remindAt == now)', () => {
    const nowIso = '2026-11-10T10:00:00.000Z';
    const startAtIso = '2026-11-11T10:00:00.000Z';

    const schedule = computeReminderSchedule(startAtIso, nowIso);

    expect(schedule).toEqual([
      { kind: 'reminder_1h', sendAtIso: '2026-11-11T09:00:00.000Z' },
    ]);
  });

  it('returns empty array when session is <= 1 hour away', () => {
    const nowIso = '2026-11-10T09:00:00.000Z';
    const startAtIso = '2026-11-10T10:00:00.000Z';

    expect(computeReminderSchedule(startAtIso, nowIso)).toEqual([]);
  });
});

describe('Timezone & Grid Helpers and Shared Zod Schemas', () => {
  it('validates real IANA timezones and rejects fictional zones', () => {
    expect(isValidIanaTimezone('Asia/Singapore')).toBe(true);
    expect(isValidIanaTimezone('Europe/London')).toBe(true);
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('Mars/Phobos')).toBe(false);
    expect(isValidIanaTimezone('')).toBe(false);
  });

  it('validates 10-minute grid HH:mm strings', () => {
    expect(isTenMinuteAlignedTime('09:00')).toBe(true);
    expect(isTenMinuteAlignedTime('17:50')).toBe(true);
    expect(isTenMinuteAlignedTime('09:05')).toBe(false);
    expect(isTenMinuteAlignedTime('24:00')).toBe(false);
    expect(isTenMinuteAlignedTime('9:00')).toBe(false);
  });

  it('validates signupSchema and rejects invalid timezone or short password', () => {
    const valid = signupSchema.safeParse({
      name: 'Maya Lin',
      email: 'Maya@Example.com',
      password: 'Password123!',
      role: 'member',
      timezone: 'Asia/Singapore',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.email).toBe('maya@example.com');
    }

    const badZone = signupSchema.safeParse({
      name: 'Maya Lin',
      email: 'maya@example.com',
      password: 'Password123!',
      role: 'member',
      timezone: 'Mars/Phobos',
    });
    expect(badZone.success).toBe(false);
  });

  it('validates updateAvailabilitySchema bufferMinutes (10 | 20 | 30) and windows', () => {
    const valid = updateAvailabilitySchema.safeParse({
      bufferMinutes: 20,
      windows: [
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '13:00', endTime: '17:00' },
      ],
    });
    expect(valid.success).toBe(true);

    const badBuffer = updateAvailabilitySchema.safeParse({
      bufferMinutes: 15,
      windows: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
    });
    expect(badBuffer.success).toBe(false);
  });

  it('validates createSessionSchema, rescheduleSessionSchema, and updateTimezoneSchema', () => {
    expect(
      createSessionSchema.safeParse({
        professionalId: '550e8400-e29b-41d4-a716-446655440000',
        startAt: '2026-11-12T10:00:00.000Z',
      }).success,
    ).toBe(true);

    expect(
      rescheduleSessionSchema.safeParse({
        newStartAt: '2026-11-12T10:10:00.000Z',
      }).success,
    ).toBe(true);

    expect(updateTimezoneSchema.safeParse({ timezone: 'Europe/London' }).success).toBe(true);
    expect(updateTimezoneSchema.safeParse({ timezone: 'Invalid/Zone' }).success).toBe(false);
  });
});
