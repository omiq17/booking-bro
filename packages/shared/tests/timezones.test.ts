import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  generateAvailableSlots,
  validateAvailabilityWindows,
} from '../src/slots.js';

describe('Timezones & Daylight Saving Time (timezones.test.ts)', () => {
  it('converts Europe/London professional hours across the October BST -> GMT transition for an Asia/Singapore member', () => {
    // UK DST ends Sunday 2026-10-25:
    // - Friday 2026-10-23 (weekday=5): London is BST (UTC+1). 09:00 London = 08:00 UTC = 16:00 SGT (UTC+8).
    // - Friday 2026-10-30 (weekday=5): London is GMT (UTC+0). 09:00 London = 09:00 UTC = 17:00 SGT (UTC+8).
    const slots = generateAvailableSlots({
      professionalTimezone: 'Europe/London',
      bufferMinutes: 10,
      windows: [{ weekday: 5, startTime: '09:00', endTime: '09:50' }],
      professionalBookings: [],
      fromUtcIso: '2026-10-22T00:00:00.000Z',
      toUtcIso: '2026-10-31T23:59:59.000Z',
      nowUtcIso: '2026-10-01T00:00:00.000Z',
    });

    expect(slots).toHaveLength(2);
    expect(slots[0]?.startAt).toBe('2026-10-23T08:00:00.000Z');
    expect(slots[1]?.startAt).toBe('2026-10-30T09:00:00.000Z');

    const sgtBeforeDstEnd = DateTime.fromISO(slots[0]!.startAt, {
      zone: 'Asia/Singapore',
    });
    const sgtAfterDstEnd = DateTime.fromISO(slots[1]!.startAt, {
      zone: 'Asia/Singapore',
    });
    expect(sgtBeforeDstEnd.toFormat('HH:mm')).toBe('16:00');
    expect(sgtAfterDstEnd.toFormat('HH:mm')).toBe('17:00');
  });

  it('handles cross-midnight date and ISO weekday shift between America/Los_Angeles (Sunday night) and Asia/Singapore (Monday morning)', () => {
    // Professional in America/Los_Angeles (UTC-8 in Nov) works Sunday (weekday=7) 18:00-19:00 PST.
    // Sunday 2026-11-08 18:00 PST = Monday 2026-11-09 02:00 UTC = Monday 2026-11-09 10:00 SGT (weekday=1).
    // Even if member queries from Monday 2026-11-09T00:00:00.000Z, ±1 day padding in pro timezone finds Sunday's window!
    const slots = generateAvailableSlots({
      professionalTimezone: 'America/Los_Angeles',
      bufferMinutes: 10,
      windows: [{ weekday: 7, startTime: '18:00', endTime: '19:00' }],
      professionalBookings: [],
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-10T00:00:00.000Z',
      nowUtcIso: '2026-11-01T00:00:00.000Z',
    });

    expect(slots.map((s) => s.startAt)).toEqual([
      '2026-11-09T02:00:00.000Z',
      '2026-11-09T02:10:00.000Z',
    ]);

    const sgtTime = DateTime.fromISO(slots[0]!.startAt, {
      zone: 'Asia/Singapore',
    });
    expect(sgtTime.weekday).toBe(1); // Monday in Singapore
    expect(sgtTime.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-09 10:00');
  });

  it('supports non-whole-hour offset timezones (Asia/Kolkata UTC+5:30 and Asia/Kathmandu UTC+5:45)', () => {
    // Monday 2026-11-09 09:00 in Asia/Kolkata (+05:30) = 03:30 UTC
    // Monday 2026-11-09 09:00 in Asia/Kathmandu (+05:45) = 03:15 UTC
    const kolkataSlots = generateAvailableSlots({
      professionalTimezone: 'Asia/Kolkata',
      bufferMinutes: 10,
      windows: [{ weekday: 1, startTime: '09:00', endTime: '09:50' }],
      professionalBookings: [],
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-09T23:59:59.000Z',
      nowUtcIso: '2026-11-01T00:00:00.000Z',
    });
    expect(kolkataSlots[0]?.startAt).toBe('2026-11-09T03:30:00.000Z');
    expect(kolkataSlots[0]?.endAt).toBe('2026-11-09T04:20:00.000Z');

    const kathmanduSlots = generateAvailableSlots({
      professionalTimezone: 'Asia/Kathmandu',
      bufferMinutes: 10,
      windows: [{ weekday: 1, startTime: '09:00', endTime: '09:50' }],
      professionalBookings: [],
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-09T23:59:59.000Z',
      nowUtcIso: '2026-11-01T00:00:00.000Z',
    });
    expect(kathmanduSlots[0]?.startAt).toBe('2026-11-09T03:15:00.000Z');
    expect(kathmanduSlots[0]?.endAt).toBe('2026-11-09T04:05:00.000Z');
  });

  it('handles DST Spring-Forward gap (America/New_York 2026-03-08 missing 02:00-02:59) and rejects windows < 50 real UTC minutes', () => {
    // In America/New_York on Sunday 2026-03-08, 02:00 EST jumps to 03:00 EDT.
    // A window of 01:30-03:00 looks like 90 wall-clock minutes, but is only 30 real UTC minutes (06:30 UTC to 07:00 UTC)!
    const validation = validateAvailabilityWindows(
      [{ weekday: 7, startTime: '01:30', endTime: '03:00' }],
      'America/New_York',
      '2026-03-01T00:00:00.000Z',
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes('50'))).toBe(true);

    // A wider window 01:00-04:00 on 2026-03-08 (06:00 UTC to 08:00 UTC = 120 real UTC minutes):
    // - 01:00 EST (06:00 UTC -> ends 06:50 UTC) is valid
    // - 01:50 EST (06:50 UTC -> ends 07:40 UTC = 03:40 EDT <= 04:00 EDT) is valid
    // - 02:00..02:50 local times do not exist and are skipped
    // - 03:00 EDT (07:00 UTC -> ends 07:50 UTC) and 03:10 EDT (07:10 UTC -> ends 08:00 UTC) are valid
    const slots = generateAvailableSlots({
      professionalTimezone: 'America/New_York',
      bufferMinutes: 10,
      windows: [{ weekday: 7, startTime: '01:00', endTime: '04:00' }],
      professionalBookings: [],
      fromUtcIso: '2026-03-08T00:00:00.000Z',
      toUtcIso: '2026-03-08T23:59:59.000Z',
      nowUtcIso: '2026-03-01T00:00:00.000Z',
    });

    // Every generated slot must be 50 real UTC minutes long and have unique startAt
    for (const slot of slots) {
      const start = DateTime.fromISO(slot.startAt, { zone: 'utc' });
      const end = DateTime.fromISO(slot.endAt, { zone: 'utc' });
      expect(end.diff(start, 'minutes').minutes).toBe(50);

      const nyLocal = start.setZone('America/New_York');
      expect(nyLocal.hour).not.toBe(2); // 02:xx never exists on spring-forward day
    }
    expect(slots.map((s) => s.startAt)).toContain('2026-03-08T06:00:00.000Z'); // 01:00 EST
    expect(slots.map((s) => s.startAt)).toContain('2026-03-08T07:00:00.000Z'); // 03:00 EDT
  });

  it('handles DST Fall-Back repeated hour (America/New_York 2026-11-01) deterministically without duplicate UTC instants', () => {
    const slots = generateAvailableSlots({
      professionalTimezone: 'America/New_York',
      bufferMinutes: 10,
      windows: [{ weekday: 7, startTime: '01:00', endTime: '03:00' }],
      professionalBookings: [],
      fromUtcIso: '2026-11-01T00:00:00.000Z',
      toUtcIso: '2026-11-01T23:59:59.000Z',
      nowUtcIso: '2026-10-20T00:00:00.000Z',
    });

    const uniqueStarts = new Set(slots.map((s) => s.startAt));
    expect(uniqueStarts.size).toBe(slots.length);
    expect(slots.length).toBeGreaterThan(0);
  });
});
