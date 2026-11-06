import { DateTime } from 'luxon';
import {
  type AllowedBufferMinutes,
  CALENDAR_DAYS,
  MAX_WINDOWS_PER_DAY,
  MIN_NOTICE_HOURS,
  SESSION_MINUTES,
  SLOT_STEP_MINUTES,
} from './constants.js';
import {
  isTenMinuteAlignedTime,
  isValidIanaTimezone,
  parseTimeMinutes,
} from './rules.js';

export interface AvailabilityWindow {
  weekday: number; // 1 = Monday .. 7 = Sunday (ISO weekday)
  startTime: string; // 'HH:mm'
  endTime: string; // 'HH:mm'
}

export interface ExistingBooking {
  id: string;
  startAtIso: string; // UTC ISO
  endAtIso: string; // UTC ISO
  blockedUntilIso: string; // UTC ISO (endAt + snapshotted buffer)
}

export interface MemberBooking {
  id: string;
  startAtIso: string; // UTC ISO
  endAtIso: string; // UTC ISO
}

export interface GenerateSlotsInput {
  professionalTimezone: string;
  bufferMinutes: AllowedBufferMinutes;
  windows: AvailabilityWindow[];
  professionalBookings: ExistingBooking[];
  memberBookings?: MemberBooking[];
  excludeSessionId?: string;
  fromUtcIso: string;
  toUtcIso: string;
  nowUtcIso: string;
}

export interface GeneratedSlot {
  startAt: string; // UTC ISO
  endAt: string; // UTC ISO
}

export interface WindowValidationResult {
  valid: boolean;
  errors: string[];
}

const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

/**
 * Validates a professional's availability windows across all weekdays:
 * - Up to 3 windows per weekday
 * - Aligned to 10-minute increments (:00, :10, ..., :50)
 * - Each window spans >= 50 minutes on the wall clock AND >= 50 real elapsed UTC minutes
 *   across the upcoming 4 weeks (if professionalTimezone is provided)
 * - Strictly non-overlapping with a gap on the same weekday (prev.endTime < next.startTime)
 */
export function validateAvailabilityWindows(
  windows: AvailabilityWindow[],
  professionalTimezone?: string,
  referenceDateIso?: string,
): WindowValidationResult {
  const errors: string[] = [];

  if (windows.length === 0) {
    errors.push('At least one availability window is required.');
    return { valid: false, errors };
  }

  const byWeekday = new Map<number, AvailabilityWindow[]>();

  for (const w of windows) {
    if (!Number.isInteger(w.weekday) || w.weekday < 1 || w.weekday > 7) {
      errors.push(`Invalid weekday "${String(w.weekday)}" (must be 1..7).`);
      continue;
    }

    const dayLabel = WEEKDAY_NAMES[w.weekday] ?? `Day ${String(w.weekday)}`;

    if (
      !isTenMinuteAlignedTime(w.startTime) ||
      !isTenMinuteAlignedTime(w.endTime)
    ) {
      errors.push(
        `${dayLabel} window ${w.startTime}–${w.endTime} must be in HH:mm format aligned to 10-minute increments.`,
      );
      continue;
    }

    const startMins = parseTimeMinutes(w.startTime)!;
    const endMins = parseTimeMinutes(w.endTime)!;

    if (endMins <= startMins) {
      errors.push(
        `${dayLabel} window ${w.startTime}–${w.endTime} end time must be after start time.`,
      );
      continue;
    }

    if (endMins - startMins < SESSION_MINUTES) {
      errors.push(
        `${dayLabel} window ${w.startTime}–${w.endTime} must be at least ${String(SESSION_MINUTES)} minutes long.`,
      );
      continue;
    }

    const list = byWeekday.get(w.weekday) ?? [];
    list.push(w);
    byWeekday.set(w.weekday, list);
  }

  for (const [weekday, dayWindows] of byWeekday.entries()) {
    const dayLabel = WEEKDAY_NAMES[weekday] ?? `Day ${String(weekday)}`;

    if (dayWindows.length > MAX_WINDOWS_PER_DAY) {
      errors.push(
        `${dayLabel} can have at most ${String(MAX_WINDOWS_PER_DAY)} availability windows (received ${String(dayWindows.length)}).`,
      );
    }

    const sorted = [...dayWindows].sort(
      (a, b) => parseTimeMinutes(a.startTime)! - parseTimeMinutes(b.startTime)!,
    );

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]!;
      const next = sorted[i + 1]!;
      const currentEnd = parseTimeMinutes(current.endTime)!;
      const nextStart = parseTimeMinutes(next.startTime)!;

      if (currentEnd >= nextStart) {
        errors.push(
          `${dayLabel} windows ${current.startTime}–${current.endTime} and ${next.startTime}–${next.endTime} cannot overlap or touch without a break.`,
        );
      }
    }
  }

  // Real elapsed UTC duration check across the 4-week window when professionalTimezone is provided
  if (
    errors.length === 0 &&
    professionalTimezone &&
    isValidIanaTimezone(professionalTimezone)
  ) {
    const baseUtc = referenceDateIso
      ? DateTime.fromISO(referenceDateIso, { zone: 'utc' })
      : DateTime.utc();

    if (baseUtc.isValid) {
      const startLocalDay = baseUtc
        .setZone(professionalTimezone)
        .startOf('day');

      for (let dayOffset = 0; dayOffset < CALENDAR_DAYS; dayOffset++) {
        const localDate = startLocalDay.plus({ days: dayOffset });
        const dayWindows = byWeekday.get(localDate.weekday) ?? [];

        for (const w of dayWindows) {
          const startMins = parseTimeMinutes(w.startTime)!;
          const endMins = parseTimeMinutes(w.endTime)!;

          const winStart = localDate.set({
            hour: Math.floor(startMins / 60),
            minute: startMins % 60,
            second: 0,
            millisecond: 0,
          });
          const winEnd = localDate.set({
            hour: Math.floor(endMins / 60),
            minute: endMins % 60,
            second: 0,
            millisecond: 0,
          });

          const realElapsedMinutes = winEnd
            .toUTC()
            .diff(winStart.toUTC(), 'minutes').minutes;

          if (realElapsedMinutes < SESSION_MINUTES) {
            const dayLabel =
              WEEKDAY_NAMES[localDate.weekday] ??
              `Day ${String(localDate.weekday)}`;
            errors.push(
              `${dayLabel} window ${w.startTime}–${w.endTime} spans only ${String(realElapsedMinutes)} real UTC minutes on ${localDate.toFormat('yyyy-MM-dd')} due to a DST transition (must be at least ${String(SESSION_MINUTES)} minutes).`,
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

interface ParsedRange {
  id: string;
  startMs: number;
  endMs: number;
}

/**
 * Generates available 50-minute slots on the fly across `[fromUtcIso, toUtcIso]` in 10-minute increments:
 * 1. Pads local date iteration by ±1 day in the professional's timezone so cross-midnight shifts never clip slots
 * 2. Skips non-existent DST spring-forward local times and deduplicates fall-back UTC instants
 * 3. Enforces `start + 50m <= windowEnd` in real elapsed UTC time
 * 4. Enforces 2-hour minimum booking notice (`start >= now + 2h`)
 * 5. Filters out slots where `[start, end + bufferMinutes)` overlaps any existing booking's `[start_at, blocked_until)`
 * 6. Filters out slots where `[start, end)` overlaps any of the requesting member's own bookings
 * 7. Excludes `excludeSessionId` when computing slots for rescheduling an existing session
 */
export function generateAvailableSlots(
  input: GenerateSlotsInput,
): GeneratedSlot[] {
  const {
    professionalTimezone,
    bufferMinutes,
    windows,
    professionalBookings,
    memberBookings = [],
    excludeSessionId,
    fromUtcIso,
    toUtcIso,
    nowUtcIso,
  } = input;

  if (!isValidIanaTimezone(professionalTimezone)) {
    return [];
  }

  const fromUtc = DateTime.fromISO(fromUtcIso, { zone: 'utc' });
  const toUtc = DateTime.fromISO(toUtcIso, { zone: 'utc' });
  const nowUtc = DateTime.fromISO(nowUtcIso, { zone: 'utc' });

  if (!fromUtc.isValid || !toUtc.isValid || !nowUtc.isValid) {
    return [];
  }

  const fromMs = fromUtc.toMillis();
  const toMs = toUtc.toMillis();
  if (toMs < fromMs) {
    return [];
  }

  const earliestNoticeMs = nowUtc.plus({ hours: MIN_NOTICE_HOURS }).toMillis();

  // Pre-parse professional bookings [startAt, blockedUntil) excluding excludeSessionId
  const proBlockedRanges: ParsedRange[] = [];
  for (const b of professionalBookings) {
    if (excludeSessionId && b.id === excludeSessionId) {
      continue;
    }
    const s = DateTime.fromISO(b.startAtIso, { zone: 'utc' });
    const e = DateTime.fromISO(b.blockedUntilIso, { zone: 'utc' });
    if (s.isValid && e.isValid) {
      proBlockedRanges.push({
        id: b.id,
        startMs: s.toMillis(),
        endMs: e.toMillis(),
      });
    }
  }

  // Pre-parse member bookings [startAt, endAt) excluding excludeSessionId
  const memberBusyRanges: ParsedRange[] = [];
  for (const m of memberBookings) {
    if (excludeSessionId && m.id === excludeSessionId) {
      continue;
    }
    const s = DateTime.fromISO(m.startAtIso, { zone: 'utc' });
    const e = DateTime.fromISO(m.endAtIso, { zone: 'utc' });
    if (s.isValid && e.isValid) {
      memberBusyRanges.push({
        id: m.id,
        startMs: s.toMillis(),
        endMs: e.toMillis(),
      });
    }
  }

  // Group windows by weekday
  const windowsByWeekday = new Map<number, AvailabilityWindow[]>();
  for (const w of windows) {
    if (
      !isTenMinuteAlignedTime(w.startTime) ||
      !isTenMinuteAlignedTime(w.endTime)
    ) {
      continue;
    }
    const list = windowsByWeekday.get(w.weekday) ?? [];
    list.push(w);
    windowsByWeekday.set(w.weekday, list);
  }

  // Iterate over professional local dates from (fromUtc - 1 day) to (toUtc + 1 day)
  const firstLocalDay = fromUtc
    .setZone(professionalTimezone)
    .startOf('day')
    .minus({ days: 1 });
  const lastLocalDay = toUtc
    .setZone(professionalTimezone)
    .startOf('day')
    .plus({ days: 1 });

  const totalDays = Math.ceil(
    lastLocalDay.diff(firstLocalDay, 'days').days + 1,
  );

  const slotMap = new Map<string, GeneratedSlot>();

  for (let d = 0; d <= totalDays; d++) {
    const localDate = firstLocalDay.plus({ days: d });
    const dayWindows = windowsByWeekday.get(localDate.weekday);
    if (!dayWindows || dayWindows.length === 0) {
      continue;
    }

    const sortedWindows = [...dayWindows].sort(
      (a, b) => parseTimeMinutes(a.startTime)! - parseTimeMinutes(b.startTime)!,
    );

    for (const w of sortedWindows) {
      const startMins = parseTimeMinutes(w.startTime)!;
      const endMins = parseTimeMinutes(w.endTime)!;
      if (endMins - startMins < SESSION_MINUTES) {
        continue;
      }

      const endHour = Math.floor(endMins / 60);
      const endMinute = endMins % 60;
      const windowEndLocal = localDate.set({
        hour: endHour,
        minute: endMinute,
        second: 0,
        millisecond: 0,
      });
      const windowEndMs = windowEndLocal.toUTC().toMillis();

      for (
        let candMins = startMins;
        candMins <= endMins - SESSION_MINUTES;
        candMins += SLOT_STEP_MINUTES
      ) {
        const candHour = Math.floor(candMins / 60);
        const candMinute = candMins % 60;

        const candidateStartLocal = localDate.set({
          hour: candHour,
          minute: candMinute,
          second: 0,
          millisecond: 0,
        });

        // If Luxon shifted the wall-clock hour/minute, this time fell into a DST spring-forward gap
        if (
          candidateStartLocal.hour !== candHour ||
          candidateStartLocal.minute !== candMinute
        ) {
          continue;
        }

        const startUtc = candidateStartLocal.toUTC();
        const startMs = startUtc.toMillis();

        // Clip to requested [fromUtc, toUtc] query range and 2-hour minimum notice
        if (startMs < fromMs || startMs > toMs || startMs < earliestNoticeMs) {
          continue;
        }

        const endUtc = startUtc.plus({ minutes: SESSION_MINUTES });
        const endMs = endUtc.toMillis();

        // Session must finish within the availability window in real elapsed UTC time
        if (endMs > windowEndMs) {
          continue;
        }

        const blockedUntilMs = endUtc
          .plus({ minutes: bufferMinutes })
          .toMillis();

        // Check professional overlap: [startMs, blockedUntilMs) vs [b.startMs, b.endMs)
        const hasProConflict = proBlockedRanges.some(
          (b) => startMs < b.endMs && b.startMs < blockedUntilMs,
        );
        if (hasProConflict) {
          continue;
        }

        // Check member overlap: [startMs, endMs) vs [m.startMs, m.endMs)
        const hasMemberConflict = memberBusyRanges.some(
          (m) => startMs < m.endMs && m.startMs < endMs,
        );
        if (hasMemberConflict) {
          continue;
        }

        const startAtIso = startUtc.toISO()!;
        const endAtIso = endUtc.toISO()!;
        slotMap.set(startAtIso, {
          startAt: startAtIso,
          endAt: endAtIso,
        });
      }
    }
  }

  return [...slotMap.values()].sort((a, b) =>
    a.startAt.localeCompare(b.startAt),
  );
}
