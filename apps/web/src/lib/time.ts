import { CALENDAR_DAYS, isValidIanaTimezone } from '@booking-bro/shared';
import { DateTime } from 'luxon';

export interface TimezoneOption {
  value: string;
  label: string;
}

export const COMMON_TIMEZONES: readonly TimezoneOption[] = [
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT, UTC+8)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Asia/Kuala_Lumpur (MYT, UTC+8)' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (HKT, UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST, UTC+9)' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok (ICT, UTC+7)' },
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB, UTC+7)' },
  { value: 'Asia/Manila', label: 'Asia/Manila (PHT, UTC+8)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST, UTC+5:30)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST, UTC+4)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST)' },
  { value: 'America/New_York', label: 'America/New_York (ET)' },
  { value: 'America/Chicago', label: 'America/Chicago (CT)' },
  { value: 'America/Denver', label: 'America/Denver (MT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
] as const;

export function detectBrowserTimezone(): string {
  if (typeof window === 'undefined') {
    return 'Asia/Singapore';
  }
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && isValidIanaTimezone(detected)) {
      return detected;
    }
  } catch {
    // Fallback to Asia/Singapore
  }
  return 'Asia/Singapore';
}

export function getTimezoneOptions(currentZone?: string): TimezoneOption[] {
  const options = [...COMMON_TIMEZONES];
  if (
    currentZone &&
    isValidIanaTimezone(currentZone) &&
    !options.some((opt) => opt.value === currentZone)
  ) {
    options.unshift({
      value: currentZone,
      label: `${currentZone} (Local)`,
    });
  }
  return options;
}

export function formatTimezonePillLabel(zone: string): {
  city: string;
  offset: string;
  shortLabel: string;
} {
  try {
    const dt = DateTime.now().setZone(zone);
    if (!dt.isValid) throw new Error('Invalid timezone');
    const offsetStr =
      dt.offset % 60 === 0 ? dt.toFormat('Z') : dt.toFormat('ZZ');
    const offset = dt.offset === 0 ? 'UTC' : `UTC${offsetStr}`;
    const rawCity = zone.includes('/') ? zone.split('/').pop()! : zone;
    const city = rawCity.replace(/_/g, ' ');
    return {
      city,
      offset,
      shortLabel: zone === 'UTC' ? 'UTC' : `${city} · ${offset}`,
    };
  } catch {
    return {
      city: zone,
      offset: '',
      shortLabel: zone,
    };
  }
}

export function formatDateHeader(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc, { zone: 'utc' })
    .setZone(zone)
    .toFormat('ccc, LLL d, yyyy');
}

export function formatLocalDateKey(
  localDateKey: string,
  zone: string,
): {
  weekdayShort: string;
  monthShort: string;
  dayNumber: string;
  fullLabel: string;
} {
  const dt = DateTime.fromISO(localDateKey, { zone });
  return {
    weekdayShort: dt.toFormat('ccc'),
    monthShort: dt.toFormat('LLL'),
    dayNumber: dt.toFormat('d'),
    fullLabel: dt.toFormat('cccc, LLLL d, yyyy'),
  };
}

export function formatTimeShort(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc, { zone: 'utc' })
    .setZone(zone)
    .toFormat('HH:mm');
}

export function formatTimeRange(
  startIsoUtc: string,
  endIsoUtc: string,
  zone: string,
): string {
  const start = DateTime.fromISO(startIsoUtc, { zone: 'utc' }).setZone(zone);
  const end = DateTime.fromISO(endIsoUtc, { zone: 'utc' }).setZone(zone);
  return `${start.toFormat('HH:mm')} – ${end.toFormat('HH:mm')} (${start.toFormat('ZZZZ')})`;
}

export function formatDateTimeFull(isoUtc: string, zone: string): string {
  const dt = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(zone);
  return `${dt.toFormat('ccc, LLL d, yyyy')} · ${dt.toFormat('HH:mm')} (${dt.toFormat('ZZZZ')})`;
}

export function formatNotificationTimestamp(
  isoUtc: string,
  zone: string,
): string {
  const dt = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(zone);
  return `${dt.toFormat('LLL d, HH:mm')} (${dt.toFormat('ZZZZ')})`;
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export function classifyPeriodOfDay(isoUtc: string, zone: string): DayPeriod {
  const hour = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(zone).hour;
  if (hour < 12) {
    return 'morning';
  }
  if (hour < 17) {
    return 'afternoon';
  }
  return 'evening';
}

export interface AvailableSlotDto {
  startAt: string;
  endAt: string;
}

export interface CalendarDayGroup {
  dateKey: string; // YYYY-MM-DD in viewer's timezone
  weekdayShort: string;
  monthShort: string;
  dayNumber: string;
  fullLabel: string;
  isToday: boolean;
  slots: AvailableSlotDto[];
  morning: AvailableSlotDto[];
  afternoon: AvailableSlotDto[];
  evening: AvailableSlotDto[];
}

export function build28DayCalendar(
  slots: readonly AvailableSlotDto[],
  viewerZone: string,
  referenceNowIso?: string,
): CalendarDayGroup[] {
  const nowInViewer = referenceNowIso
    ? DateTime.fromISO(referenceNowIso, { zone: 'utc' }).setZone(viewerZone)
    : DateTime.now().setZone(viewerZone);

  const startDay = nowInViewer.startOf('day');
  const todayKey = startDay.toFormat('yyyy-MM-dd');

  const slotMap = new Map<string, AvailableSlotDto[]>();
  for (const slot of slots) {
    const dt = DateTime.fromISO(slot.startAt, { zone: 'utc' }).setZone(
      viewerZone,
    );
    const key = dt.toFormat('yyyy-MM-dd');
    const existing = slotMap.get(key);
    if (existing) {
      existing.push(slot);
    } else {
      slotMap.set(key, [slot]);
    }
  }

  const days: CalendarDayGroup[] = [];
  for (let i = 0; i < CALENDAR_DAYS; i++) {
    const dayDt = startDay.plus({ days: i });
    const dateKey = dayDt.toFormat('yyyy-MM-dd');
    const daySlots = slotMap.get(dateKey) ?? [];

    const morning: AvailableSlotDto[] = [];
    const afternoon: AvailableSlotDto[] = [];
    const evening: AvailableSlotDto[] = [];

    for (const s of daySlots) {
      const period = classifyPeriodOfDay(s.startAt, viewerZone);
      if (period === 'morning') {
        morning.push(s);
      } else if (period === 'afternoon') {
        afternoon.push(s);
      } else {
        evening.push(s);
      }
    }

    days.push({
      dateKey,
      weekdayShort: dayDt.toFormat('ccc'),
      monthShort: dayDt.toFormat('LLL'),
      dayNumber: dayDt.toFormat('d'),
      fullLabel: dayDt.toFormat('cccc, LLLL d, yyyy'),
      isToday: dateKey === todayKey,
      slots: daySlots,
      morning,
      afternoon,
      evening,
    });
  }

  return days;
}

export const TEN_MINUTE_TIME_OPTIONS: readonly string[] = Array.from(
  { length: 24 * 6 },
  (_, index) => {
    const hours = Math.floor(index / 6);
    const minutes = (index % 6) * 10;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  },
);

export const WEEKDAY_LABELS: ReadonlyArray<{
  weekday: number;
  name: string;
  short: string;
}> = [
  { weekday: 1, name: 'Monday', short: 'Mon' },
  { weekday: 2, name: 'Tuesday', short: 'Tue' },
  { weekday: 3, name: 'Wednesday', short: 'Wed' },
  { weekday: 4, name: 'Thursday', short: 'Thu' },
  { weekday: 5, name: 'Friday', short: 'Fri' },
  { weekday: 6, name: 'Saturday', short: 'Sat' },
  { weekday: 7, name: 'Sunday', short: 'Sun' },
] as const;
