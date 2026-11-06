import { describe, expect, it } from 'vitest';
import {
  generateAvailableSlots,
  validateAvailabilityWindows,
} from '../src/slots.js';

describe('Availability Window Validation (validateAvailabilityWindows)', () => {
  it('accepts up to 3 valid non-overlapping windows >= 50m on the same weekday', () => {
    const result = validateAvailabilityWindows([
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
      { weekday: 1, startTime: '13:00', endTime: '16:00' },
      { weekday: 1, startTime: '17:00', endTime: '18:00' },
    ]);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects more than 3 windows on the same weekday', () => {
    const result = validateAvailabilityWindows([
      { weekday: 2, startTime: '08:00', endTime: '09:00' },
      { weekday: 2, startTime: '10:00', endTime: '11:00' },
      { weekday: 2, startTime: '12:00', endTime: '13:00' },
      { weekday: 2, startTime: '14:00', endTime: '15:00' },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at most 3'))).toBe(true);
  });

  it('rejects windows shorter than 50 minutes (e.g., 40 minutes)', () => {
    const result = validateAvailabilityWindows([
      { weekday: 1, startTime: '09:00', endTime: '09:40' },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('50 minutes'))).toBe(true);
  });

  it('rejects off-grid start or end times (e.g., 09:05 or 12:15)', () => {
    const result = validateAvailabilityWindows([
      { weekday: 1, startTime: '09:05', endTime: '12:15' },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('10-minute'))).toBe(true);
  });

  it('rejects overlapping windows and touching windows without a gap (09:00-12:00 + 12:00-15:00)', () => {
    const overlapping = validateAvailabilityWindows([
      { weekday: 3, startTime: '09:00', endTime: '12:30' },
      { weekday: 3, startTime: '12:00', endTime: '15:00' },
    ]);
    expect(overlapping.valid).toBe(false);

    const touching = validateAvailabilityWindows([
      { weekday: 3, startTime: '09:00', endTime: '12:00' },
      { weekday: 3, startTime: '12:00', endTime: '15:00' },
    ]);
    expect(touching.valid).toBe(false);
    expect(touching.errors.some((e) => e.includes('overlap or touch'))).toBe(
      true,
    );
  });
});

describe('On-the-Fly Slot Generation (generateAvailableSlots)', () => {
  it('generates 10-minute step slots inside a window where session (50m) fits within windowEnd', () => {
    // Window: Monday 2026-11-09 09:00 to 10:10 UTC (70 minutes)
    // Valid 50m starts: 09:00 (ends 09:50), 09:10 (ends 10:00), 09:20 (ends 10:10).
    // 09:30 would end at 10:20 (> 10:10), so excluded.
    const slots = generateAvailableSlots({
      professionalTimezone: 'UTC',
      bufferMinutes: 10,
      windows: [{ weekday: 1, startTime: '09:00', endTime: '10:10' }],
      professionalBookings: [],
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-09T23:59:59.000Z',
      nowUtcIso: '2026-11-08T00:00:00.000Z',
    });

    expect(slots.map((s) => s.startAt)).toEqual([
      '2026-11-09T09:00:00.000Z',
      '2026-11-09T09:10:00.000Z',
      '2026-11-09T09:20:00.000Z',
    ]);
    expect(slots[0]?.endAt).toBe('2026-11-09T09:50:00.000Z');
  });

  it('enforces configurable buffer (10, 20, 30m) in both directions around an existing booking', () => {
    // Window: Monday 2026-11-09 09:00 to 13:00 UTC
    // Existing booking: 10:00 to 10:50 with 10m buffer -> blockedUntil = 11:00
    // Candidate 09:00 -> ends 09:50, blockedUntil 10:00 -> [09:00, 10:00) does NOT overlap [10:00, 11:00) -> ALLOWED
    // Candidate 09:10 -> ends 10:00, blockedUntil 10:10 -> overlaps [10:00, 11:00) -> BLOCKED
    // ...
    // Candidate 10:50 -> overlaps [10:00, 11:00) -> BLOCKED
    // Candidate 11:00 -> [11:00, 12:00) does NOT overlap [10:00, 11:00) -> ALLOWED
    const slots = generateAvailableSlots({
      professionalTimezone: 'UTC',
      bufferMinutes: 10,
      windows: [{ weekday: 1, startTime: '09:00', endTime: '13:00' }],
      professionalBookings: [
        {
          id: 'booking-1',
          startAtIso: '2026-11-09T10:00:00.000Z',
          endAtIso: '2026-11-09T10:50:00.000Z',
          blockedUntilIso: '2026-11-09T11:00:00.000Z',
        },
      ],
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-09T23:59:59.000Z',
      nowUtcIso: '2026-11-08T00:00:00.000Z',
    });

    const startTimes = slots.map((s) => s.startAt);
    expect(startTimes).toContain('2026-11-09T09:00:00.000Z');
    expect(startTimes).not.toContain('2026-11-09T09:10:00.000Z');
    expect(startTimes).not.toContain('2026-11-09T10:00:00.000Z');
    expect(startTimes).not.toContain('2026-11-09T10:50:00.000Z');
    expect(startTimes).toContain('2026-11-09T11:00:00.000Z');
  });

  it('preserves existing booking snapshotted blocked_until while applying updated bufferMinutes to new slots (30m -> 10m and 10m -> 30m)', () => {
    // Scenario A: Booking was made when buffer was 30m: 10:00-10:50, blockedUntil = 11:20.
    // Later, professional updates bufferMinutes to 10m.
    // - After booking: 11:00 and 11:10 are STILL blocked because existing booking has blockedUntil = 11:20!
    // - Before booking: 09:00 (ends 09:50 + new 10m buffer = 10:00) is now ALLOWED (under 30m buffer it was blocked until 10:20).
    const slotsAfterDecrease = generateAvailableSlots({
      professionalTimezone: 'UTC',
      bufferMinutes: 10,
      windows: [{ weekday: 1, startTime: '08:30', endTime: '13:00' }],
      professionalBookings: [
        {
          id: 'b-30m-snapshot',
          startAtIso: '2026-11-09T10:00:00.000Z',
          endAtIso: '2026-11-09T10:50:00.000Z',
          blockedUntilIso: '2026-11-09T11:20:00.000Z',
        },
      ],
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-09T23:59:59.000Z',
      nowUtcIso: '2026-11-08T00:00:00.000Z',
    });

    const startsA = slotsAfterDecrease.map((s) => s.startAt);
    expect(startsA).toContain('2026-11-09T09:00:00.000Z');
    expect(startsA).not.toContain('2026-11-09T09:10:00.000Z');
    expect(startsA).not.toContain('2026-11-09T11:00:00.000Z');
    expect(startsA).not.toContain('2026-11-09T11:10:00.000Z');
    expect(startsA).toContain('2026-11-09T11:20:00.000Z');

    // Scenario B: Booking was made when buffer was 10m: 10:00-10:50, blockedUntil = 11:00.
    // Later, professional updates bufferMinutes to 30m.
    // - Before booking: 09:00 (ends 09:50 + new 30m buffer = 10:20) is now BLOCKED; latest before 10:00 is 08:40 (ends 09:30 + 30m = 10:00).
    // - After booking: 11:00 is still ALLOWED because existing booking's snapshotted blockedUntil is 11:00.
    const slotsAfterIncrease = generateAvailableSlots({
      professionalTimezone: 'UTC',
      bufferMinutes: 30,
      windows: [{ weekday: 1, startTime: '08:30', endTime: '13:00' }],
      professionalBookings: [
        {
          id: 'b-10m-snapshot',
          startAtIso: '2026-11-09T10:00:00.000Z',
          endAtIso: '2026-11-09T10:50:00.000Z',
          blockedUntilIso: '2026-11-09T11:00:00.000Z',
        },
      ],
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-09T23:59:59.000Z',
      nowUtcIso: '2026-11-08T00:00:00.000Z',
    });

    const startsB = slotsAfterIncrease.map((s) => s.startAt);
    expect(startsB).toContain('2026-11-09T08:40:00.000Z');
    expect(startsB).not.toContain('2026-11-09T08:50:00.000Z');
    expect(startsB).not.toContain('2026-11-09T09:00:00.000Z');
    expect(startsB).toContain('2026-11-09T11:00:00.000Z');
  });

  it('filters out slots overlapping any of the requesting member existing bookings (without buffer on member side)', () => {
    // Member has a booking with another professional from 10:00 to 10:50.
    // Member overlap uses [start_at, end_at) (no buffer), so:
    // - 09:10 (ends 10:00) is ALLOWED!
    // - 09:20 (ends 10:10) through 10:40 (starts 10:40) are BLOCKED.
    // - 10:50 (starts 10:50) is ALLOWED!
    const slots = generateAvailableSlots({
      professionalTimezone: 'UTC',
      bufferMinutes: 30,
      windows: [{ weekday: 1, startTime: '09:00', endTime: '13:00' }],
      professionalBookings: [],
      memberBookings: [
        {
          id: 'member-other-pro-session',
          startAtIso: '2026-11-09T10:00:00.000Z',
          endAtIso: '2026-11-09T10:50:00.000Z',
        },
      ],
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-09T23:59:59.000Z',
      nowUtcIso: '2026-11-08T00:00:00.000Z',
    });

    const startTimes = slots.map((s) => s.startAt);
    expect(startTimes).toContain('2026-11-09T09:10:00.000Z');
    expect(startTimes).not.toContain('2026-11-09T09:20:00.000Z');
    expect(startTimes).not.toContain('2026-11-09T10:00:00.000Z');
    expect(startTimes).not.toContain('2026-11-09T10:40:00.000Z');
    expect(startTimes).toContain('2026-11-09T10:50:00.000Z');
  });

  it('allows rescheduling into an adjacent +10m slot on the same day when excludeSessionId is provided', () => {
    const existingSessionId = 'session-to-reschedule';
    const slots = generateAvailableSlots({
      professionalTimezone: 'UTC',
      bufferMinutes: 10,
      windows: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
      professionalBookings: [
        {
          id: existingSessionId,
          startAtIso: '2026-11-09T10:00:00.000Z',
          endAtIso: '2026-11-09T10:50:00.000Z',
          blockedUntilIso: '2026-11-09T11:00:00.000Z',
        },
      ],
      memberBookings: [
        {
          id: existingSessionId,
          startAtIso: '2026-11-09T10:00:00.000Z',
          endAtIso: '2026-11-09T10:50:00.000Z',
        },
      ],
      excludeSessionId: existingSessionId,
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-09T23:59:59.000Z',
      nowUtcIso: '2026-11-08T00:00:00.000Z',
    });

    const startTimes = slots.map((s) => s.startAt);
    expect(startTimes).toContain('2026-11-09T10:10:00.000Z');
    expect(startTimes).toContain('2026-11-09T09:50:00.000Z');
  });

  it('enforces the 2-hour minimum booking notice (start_at >= now + 2 hours)', () => {
    // now = 08:05 UTC -> earliest allowed slot is 10:05 UTC -> 10:10 UTC on the 10-min grid
    const slots = generateAvailableSlots({
      professionalTimezone: 'UTC',
      bufferMinutes: 10,
      windows: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
      professionalBookings: [],
      fromUtcIso: '2026-11-09T00:00:00.000Z',
      toUtcIso: '2026-11-09T23:59:59.000Z',
      nowUtcIso: '2026-11-09T08:05:00.000Z',
    });

    expect(slots[0]?.startAt).toBe('2026-11-09T10:10:00.000Z');
  });
});
