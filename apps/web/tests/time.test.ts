import { describe, expect, it } from 'vitest';
import {
  build28DayCalendar,
  classifyPeriodOfDay,
  detectBrowserTimezone,
  formatDateHeader,
  formatDateTimeFull,
  formatNotificationTimestamp,
  formatTimeRange,
  formatTimeShort,
  getTimezoneOptions,
} from '../src/lib/time.js';

describe('Web Time and Timezone Helpers', () => {
  it('detects a fallback timezone in non-browser environments', () => {
    const tz = detectBrowserTimezone();
    expect(tz).toBeDefined();
    expect(typeof tz).toBe('string');
  });

  it('prepends unique user timezone if not in common timezones list', () => {
    const options = getTimezoneOptions('Atlantic/Reykjavik');
    expect(options[0]?.value).toBe('Atlantic/Reykjavik');
    expect(options[0]?.label).toContain('Atlantic/Reykjavik');
  });

  it('formats dates and time ranges correctly across zones', () => {
    const startUtc = '2026-06-01T01:00:00.000Z';
    const endUtc = '2026-06-01T01:50:00.000Z';

    // In Asia/Singapore (UTC+8): 09:00 - 09:50
    const sgHeader = formatDateHeader(startUtc, 'Asia/Singapore');
    expect(sgHeader).toBe('Mon, Jun 1, 2026');

    const sgTime = formatTimeShort(startUtc, 'Asia/Singapore');
    expect(sgTime).toBe('09:00');

    const sgRange = formatTimeRange(startUtc, endUtc, 'Asia/Singapore');
    expect(sgRange).toContain('09:00 – 09:50');

    const fullStr = formatDateTimeFull(startUtc, 'Asia/Singapore');
    expect(fullStr).toContain('Mon, Jun 1, 2026');
    expect(fullStr).toContain('09:00');

    const notifStr = formatNotificationTimestamp(startUtc, 'Asia/Singapore');
    expect(notifStr).toContain('Jun 1, 09:00');
  });

  it('classifies periods of day correctly in the viewer timezone', () => {
    // 01:00 UTC = 09:00 SGT -> morning
    expect(
      classifyPeriodOfDay('2026-06-01T01:00:00.000Z', 'Asia/Singapore'),
    ).toBe('morning');

    // 06:00 UTC = 14:00 SGT -> afternoon
    expect(
      classifyPeriodOfDay('2026-06-01T06:00:00.000Z', 'Asia/Singapore'),
    ).toBe('afternoon');

    // 10:00 UTC = 18:00 SGT -> evening
    expect(
      classifyPeriodOfDay('2026-06-01T10:00:00.000Z', 'Asia/Singapore'),
    ).toBe('evening');
  });

  it('builds a complete 28-day calendar grouped into Morning, Afternoon, Evening', () => {
    const referenceNowIso = '2026-06-01T00:00:00.000Z';
    const sampleSlots = [
      {
        startAt: '2026-06-01T01:00:00.000Z', // 09:00 SGT (morning)
        endAt: '2026-06-01T01:50:00.000Z',
      },
      {
        startAt: '2026-06-01T06:00:00.000Z', // 14:00 SGT (afternoon)
        endAt: '2026-06-01T06:50:00.000Z',
      },
      {
        startAt: '2026-06-01T11:00:00.000Z', // 19:00 SGT (evening)
        endAt: '2026-06-01T11:50:00.000Z',
      },
      {
        startAt: '2026-06-02T02:00:00.000Z', // 10:00 SGT on next day
        endAt: '2026-06-02T02:50:00.000Z',
      },
    ];

    const calendar = build28DayCalendar(
      sampleSlots,
      'Asia/Singapore',
      referenceNowIso,
    );

    expect(calendar).toHaveLength(28);

    const firstDay = calendar[0]!;
    expect(firstDay.dateKey).toBe('2026-06-01');
    expect(firstDay.slots).toHaveLength(3);
    expect(firstDay.morning).toHaveLength(1);
    expect(firstDay.afternoon).toHaveLength(1);
    expect(firstDay.evening).toHaveLength(1);

    const secondDay = calendar[1]!;
    expect(secondDay.dateKey).toBe('2026-06-02');
    expect(secondDay.slots).toHaveLength(1);
    expect(secondDay.morning).toHaveLength(1);

    const thirdDay = calendar[2]!;
    expect(thirdDay.slots).toHaveLength(0);
  });
});
