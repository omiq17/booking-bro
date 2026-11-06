import { DateTime, IANAZone } from 'luxon';
import {
  CANCEL_LOCK_HOURS,
  MIN_NOTICE_HOURS,
  SLOT_STEP_MINUTES,
} from './constants.js';

const HH_MM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validates that a string is a valid IANA timezone identifier (e.g., "Asia/Singapore", "Europe/London").
 */
export function isValidIanaTimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== 'string' || !timezone.trim()) {
    return false;
  }
  return IANAZone.isValidZone(timezone);
}

/**
 * Validates that a wall-clock time string is in HH:mm 24-hour format and aligned to a 10-minute boundary (:00, :10, ..., :50).
 */
export function isTenMinuteAlignedTime(timeStr: string): boolean {
  const match = HH_MM_REGEX.exec(timeStr);
  if (!match) {
    return false;
  }
  const minutes = Number(match[2]);
  return minutes % SLOT_STEP_MINUTES === 0;
}

/**
 * Parses an HH:mm time string into minutes since midnight (0..1439).
 * Returns null if the format is invalid.
 */
export function parseTimeMinutes(timeStr: string): number | null {
  const match = HH_MM_REGEX.exec(timeStr);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

/**
 * Checks whether a candidate session start time satisfies the 2-hour minimum booking notice:
 * start_at >= now + 2 hours.
 */
export function meetsMinimumNotice(startAtIso: string, nowIso: string): boolean {
  const start = DateTime.fromISO(startAtIso, { zone: 'utc' });
  const now = DateTime.fromISO(nowIso, { zone: 'utc' });
  if (!start.isValid || !now.isValid) {
    return false;
  }
  const earliestAllowed = now.plus({ hours: MIN_NOTICE_HOURS });
  return start.toMillis() >= earliestAllowed.toMillis();
}

/**
 * Evaluates the 24-hour member modification rule:
 * Members can cancel or reschedule a session only when start_at - now >= 24 hours.
 */
export function canMemberModifySession(
  startAtIso: string,
  nowIso: string,
): {
  allowed: boolean;
  reason?: string;
} {
  const start = DateTime.fromISO(startAtIso, { zone: 'utc' });
  const now = DateTime.fromISO(nowIso, { zone: 'utc' });

  if (!start.isValid || !now.isValid) {
    return {
      allowed: false,
      reason: 'Invalid session timestamp.',
    };
  }

  const lockThreshold = now.plus({ hours: CANCEL_LOCK_HOURS });
  if (start.toMillis() < lockThreshold.toMillis()) {
    return {
      allowed: false,
      reason:
        'Members cannot cancel or reschedule a session within 24 hours of its start time.',
    };
  }

  return { allowed: true };
}

/**
 * Computes the UTC reminder delivery timestamps (24h before and 1h before start_at),
 * skipping any reminder whose scheduled send time is already at or before `nowIso`.
 */
export function computeReminderSchedule(
  startAtIso: string,
  nowIso: string,
): Array<{
  kind: 'reminder_24h' | 'reminder_1h';
  sendAtIso: string;
}> {
  const start = DateTime.fromISO(startAtIso, { zone: 'utc' });
  const now = DateTime.fromISO(nowIso, { zone: 'utc' });

  if (!start.isValid || !now.isValid) {
    return [];
  }

  const candidates: Array<{
    kind: 'reminder_24h' | 'reminder_1h';
    sendAt: DateTime;
  }> = [
    { kind: 'reminder_24h', sendAt: start.minus({ hours: 24 }) },
    { kind: 'reminder_1h', sendAt: start.minus({ hours: 1 }) },
  ];

  return candidates
    .filter((candidate) => candidate.sendAt.toMillis() > now.toMillis())
    .map((candidate) => ({
      kind: candidate.kind,
      sendAtIso: candidate.sendAt.toUTC().toISO()!,
    }));
}
