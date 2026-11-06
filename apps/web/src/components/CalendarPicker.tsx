'use client';

import {
  Calendar as CalendarIcon,
  Check,
  Clock,
  Moon,
  Sun,
  Sunrise,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AvailableSlotDto,
  build28DayCalendar,
  formatTimeShort,
} from '@/lib/time';

export interface CalendarPickerProps {
  slots: readonly AvailableSlotDto[];
  viewerTimezone: string;
  professionalTimezone: string;
  selectedSlot: AvailableSlotDto | null;
  onSelectSlot: (slot: AvailableSlotDto) => void;
  isLoading?: boolean;
}

export function CalendarPicker({
  slots,
  viewerTimezone,
  professionalTimezone,
  selectedSlot,
  onSelectSlot,
  isLoading = false,
}: CalendarPickerProps) {
  const days = useMemo(
    () => build28DayCalendar(slots, viewerTimezone),
    [slots, viewerTimezone],
  );

  const [selectedDateKey, setSelectedDateKey] = useState<string>('');
  const slotsPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (days.length === 0) {
      return;
    }
    const currentStillHasSlots = days.some(
      (d) => d.dateKey === selectedDateKey && d.slots.length > 0,
    );
    if (currentStillHasSlots) {
      return;
    }
    const firstAvailableDay = days.find((d) => d.slots.length > 0) ?? days[0];
    if (firstAvailableDay) {
      setSelectedDateKey(firstAvailableDay.dateKey);
    }
  }, [days, selectedDateKey]);

  const activeDay =
    days.find((d) => d.dateKey === selectedDateKey) ?? days[0] ?? null;

  const totalSlotsCount = slots.length;

  function handleDateSelect(dateKey: string) {
    setSelectedDateKey(dateKey);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setTimeout(() => {
        slotsPanelRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }, 60);
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="h-96 animate-pulse rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-5" />
        <div className="h-96 animate-pulse rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-7" />
      </div>
    );
  }

  const periodGroups = activeDay
    ? [
        {
          id: 'morning',
          label: 'Morning',
          sublabel: 'Before 12:00',
          Icon: Sunrise,
          items: activeDay.morning,
        },
        {
          id: 'afternoon',
          label: 'Afternoon',
          sublabel: '12:00 – 16:50',
          Icon: Sun,
          items: activeDay.afternoon,
        },
        {
          id: 'evening',
          label: 'Evening',
          sublabel: '17:00 onwards',
          Icon: Moon,
          items: activeDay.evening,
        },
      ]
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left Column: 4-Week (28-Day) Date Picker */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs lg:col-span-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-emerald-800" />
            <h3 className="font-semibold text-sm text-stone-900">
              1. Select a Date (Next 4 Weeks)
            </h3>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-medium text-emerald-800 text-xs">
            {totalSlotsCount} openings
          </span>
        </div>

        <p className="mb-3 text-stone-600 text-xs">
          Dates shown in your timezone (<strong>{viewerTimezone}</strong>).
        </p>

        <div
          role="listbox"
          aria-label="28-day availability calendar"
          className="grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-4"
        >
          {days.map((day) => {
            const count = day.slots.length;
            const isSelected = day.dateKey === activeDay?.dateKey;
            const isDisabled = count === 0;

            return (
              <button
                key={day.dateKey}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isDisabled}
                onClick={() => handleDateSelect(day.dateKey)}
                className={`flex min-h-[68px] flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-1 ${
                  isSelected
                    ? 'border-emerald-800 bg-emerald-800 text-white shadow-xs'
                    : isDisabled
                      ? 'cursor-not-allowed border-stone-100 bg-stone-50 text-stone-400 opacity-60'
                      : 'border-stone-200 bg-white text-stone-900 hover:border-emerald-700 hover:bg-emerald-50/40'
                }`}
              >
                <span
                  className={`font-medium text-[10px] uppercase tracking-wider ${
                    isSelected ? 'text-emerald-100' : 'text-stone-500'
                  }`}
                >
                  {day.weekdayShort}
                </span>
                <span className="mt-0.5 font-bold text-sm leading-tight">
                  {day.monthShort} {day.dayNumber}
                </span>
                <span
                  className={`mt-1 inline-block rounded-full px-1.5 py-0.2 font-medium text-[10px] ${
                    isSelected
                      ? 'bg-emerald-900/70 text-emerald-50'
                      : count > 0
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'text-stone-400'
                  }`}
                >
                  {count > 0 ? `${count} slots` : 'Full'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Column: Morning / Afternoon / Evening 10-Minute Slot Pills */}
      <div
        ref={slotsPanelRef}
        className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs lg:col-span-7"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-stone-200 border-b pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-800" />
              <h3 className="font-semibold text-sm text-stone-900">
                2. Choose a 50-Minute Start Time
              </h3>
            </div>
            {activeDay && (
              <p className="mt-0.5 font-medium text-emerald-900 text-xs">
                {activeDay.fullLabel} ({viewerTimezone})
              </p>
            )}
          </div>
          {professionalTimezone !== viewerTimezone && (
            <span className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] text-stone-600">
              Pro timezone: <strong>{professionalTimezone}</strong>
            </span>
          )}
        </div>

        {!activeDay || activeDay.slots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Clock className="mb-2 h-8 w-8 text-stone-400" />
            <p className="font-semibold text-sm text-stone-800">
              No available slots on this date
            </p>
            <p className="mt-1 max-w-sm text-stone-600 text-xs">
              Select another highlighted date from the 4-week calendar. Slots
              require at least 2 hours advance notice.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {periodGroups.map(({ id, label, sublabel, Icon, items }) => {
              if (items.length === 0) {
                return null;
              }
              return (
                <div key={id}>
                  <div className="mb-2.5 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-emerald-800" />
                    <h4 className="font-semibold text-stone-900 text-xs uppercase tracking-wider">
                      {label}
                    </h4>
                    <span className="text-[11px] text-stone-500">
                      ({sublabel} · {items.length} available)
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {items.map((slot) => {
                      const isSelected =
                        selectedSlot?.startAt === slot.startAt;
                      const localStart = formatTimeShort(
                        slot.startAt,
                        viewerTimezone,
                      );

                      return (
                        <button
                          key={slot.startAt}
                          type="button"
                          onClick={() => onSelectSlot(slot)}
                          aria-pressed={isSelected}
                          className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 font-semibold text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-1 ${
                            isSelected
                              ? 'border-emerald-800 bg-emerald-800 text-white shadow-xs'
                              : 'border-stone-200 bg-stone-50/70 text-stone-900 hover:border-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {isSelected && <Check className="h-3.5 w-3.5" />}
                          <span>{localStart}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
