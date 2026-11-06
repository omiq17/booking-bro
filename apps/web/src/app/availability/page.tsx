'use client';

import {
  ALLOWED_BUFFERS,
  type AllowedBufferMinutes,
  type AvailabilityWindowInput,
  MAX_WINDOWS_PER_DAY,
  validateAvailabilityWindows,
} from '@booking-bro/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronDown,
  Clock,
  Globe,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Toast } from '@/components/Toast';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { TEN_MINUTE_TIME_OPTIONS, WEEKDAY_LABELS } from '@/lib/time';

export default function AvailabilityEditorPage() {
  const queryClient = useQueryClient();

  const { data: user, isLoading: isAuthLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.auth.me(),
  });

  const { data: availabilityData, isLoading: isAvailLoading } = useQuery({
    queryKey: queryKeys.availability,
    queryFn: () => api.availability.getMe(),
    enabled: Boolean(user && user.role === 'professional'),
  });

  const [bufferMinutes, setBufferMinutes] =
    useState<AllowedBufferMinutes>(10);
  const [windows, setWindows] = useState<AvailabilityWindowInput[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (availabilityData && !initialized) {
      setBufferMinutes(availabilityData.bufferMinutes);
      setWindows(
        availabilityData.windows.map((w) => ({
          weekday: w.weekday,
          startTime: w.startTime,
          endTime: w.endTime,
        })),
      );
      setInitialized(true);
    }
  }, [availabilityData, initialized]);

  const liveValidation = useMemo(() => {
    if (!user) {
      return { valid: true, errors: [] as string[] };
    }
    if (windows.length === 0) {
      return {
        valid: false,
        errors: ['At least one availability window is required.'],
      };
    }
    return validateAvailabilityWindows(windows, user.timezone);
  }, [windows, user]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.availability.update({
        bufferMinutes,
        windows,
      }),
    onSuccess: (res) => {
      setServerError(null);
      setSaveSuccess(
        'Availability saved! Unbooked slots updated immediately.',
      );
      setWindows(
        res.windows.map((w) => ({
          weekday: w.weekday,
          startTime: w.startTime,
          endTime: w.endTime,
        })),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.availability });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.professionals });
    },
    onError: (err) => {
      setSaveSuccess(null);
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError('Failed to save availability settings.');
      }
    },
  });

  function handleAddWindow(weekday: number) {
    setSaveSuccess(null);
    setServerError(null);
    const dayWins = windows.filter((w) => w.weekday === weekday);
    if (dayWins.length >= MAX_WINDOWS_PER_DAY) {
      return;
    }

    const defaultPresets = [
      { startTime: '09:00', endTime: '12:00' },
      { startTime: '13:00', endTime: '17:00' },
      { startTime: '18:00', endTime: '20:00' },
    ] as const;

    const preset = defaultPresets[dayWins.length] ?? {
      startTime: '09:00',
      endTime: '10:00',
    };

    setWindows((prev) => [
      ...prev,
      {
        weekday,
        startTime: preset.startTime,
        endTime: preset.endTime,
      },
    ]);
  }

  function handleRemoveWindow(globalIndex: number) {
    setSaveSuccess(null);
    setServerError(null);
    setWindows((prev) => prev.filter((_, idx) => idx !== globalIndex));
  }

  function handleTimeChange(
    globalIndex: number,
    field: 'startTime' | 'endTime',
    value: string,
  ) {
    setSaveSuccess(null);
    setServerError(null);
    setWindows((prev) =>
      prev.map((item, idx) =>
        idx === globalIndex ? { ...item, [field]: value } : item,
      ),
    );
  }

  if (isAuthLoading || isAvailLoading) {
    return (
      <div className="space-y-4 py-6">
        <div className="h-12 w-72 animate-pulse rounded-xl bg-stone-200" />
        <div className="h-96 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <h1 className="font-bold text-xl text-stone-900">
          Professional Sign-In Required
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Please log in with a Professional account to configure your working
          hours and post-session buffer.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white hover:bg-emerald-900"
        >
          Go to Login
        </Link>
      </div>
    );
  }

  if (user.role !== 'professional') {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <h1 className="font-bold text-xl text-stone-900">
          Professional Role Required
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Only users with the <strong>Professional</strong> role can configure
          availability windows.
        </p>
        <Link
          href="/professionals"
          className="mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white hover:bg-emerald-900"
        >
          Browse Professionals
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-stone-200 border-b pb-5 sm:flex-row sm:items-end">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-0.5 font-semibold text-emerald-800 text-xs">
            <Clock className="h-3.5 w-3.5" />
            Schedule Configuration
          </span>
          <h1 className="mt-2 font-bold text-2xl text-stone-900 tracking-tight sm:text-3xl">
            Availability & Post-Session Buffer
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-600">
            <Globe className="h-4 w-4 text-emerald-800" />
            Working hours are interpreted in your active timezone:{' '}
            <strong>{user.timezone}</strong>
          </p>
        </div>

        <button
          type="button"
          disabled={!liveValidation.valid || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          <span>
            {saveMutation.isPending ? 'Saving Changes…' : 'Save Availability'}
          </span>
        </button>
      </div>

      <Toast
        message={saveSuccess}
        onClose={() => setSaveSuccess(null)}
        durationMs={3000}
      />

      {(serverError || !liveValidation.valid) && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm"
        >
          <div className="flex items-start gap-2.5 font-semibold">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <span>
              {serverError ??
                'Please resolve the following schedule validation issues:'}
            </span>
          </div>
          {!liveValidation.valid && (
            <ul className="mt-2 list-disc space-y-1 pl-6 text-xs">
              {liveValidation.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Buffer Selector Card */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
        <h2 className="font-bold text-base text-stone-900">
          Post-Session Rest Buffer
        </h2>
        <p className="mt-1 text-stone-600 text-xs leading-relaxed">
          Every session is strictly <strong>50 minutes</strong>. Your chosen
          buffer is automatically reserved after each booked session to give you
          adequate rest time and prevent back-to-back fatigue. Changing your
          buffer updates future unbooked slots immediately while keeping existing
          booked sessions unchanged.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3 sm:max-w-md">
          {ALLOWED_BUFFERS.map((buf) => {
            const selected = bufferMinutes === buf;
            return (
              <button
                key={buf}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setSaveSuccess(null);
                  setBufferMinutes(buf);
                }}
                className={`flex min-h-[48px] flex-col items-center justify-center rounded-xl border px-3 py-2 font-semibold text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                  selected
                    ? 'border-emerald-800 bg-emerald-800 text-white shadow-xs'
                    : 'border-stone-200 bg-stone-50 text-stone-800 hover:border-emerald-700 hover:bg-emerald-50/40'
                }`}
              >
                <span>{buf} mins</span>
                <span
                  className={`font-normal text-[10px] ${
                    selected ? 'text-emerald-100' : 'text-stone-500'
                  }`}
                >
                  {buf === 10 ? 'Default' : 'Extended'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Weekly Windows Editor */}
      <section className="space-y-4">
        <div>
          <h2 className="font-bold text-base text-stone-900">
            Weekly Availability Windows (Up to {MAX_WINDOWS_PER_DAY} per day)
          </h2>
          <p className="text-stone-600 text-xs">
            Each window must align to 10-minute increments, last at least 50
            minutes, and have a break between windows on the same day.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {WEEKDAY_LABELS.map((day) => {
            const dayWindowsWithIdx = windows
              .map((w, idx) => ({ ...w, globalIndex: idx }))
              .filter((w) => w.weekday === day.weekday);

            return (
              <div
                key={day.weekday}
                className="flex flex-col justify-between rounded-2xl border border-stone-200 bg-white p-5 shadow-xs"
              >
                <div>
                  <div className="mb-3 flex items-center justify-between border-stone-100 border-b pb-2.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-stone-900">
                        {day.name}
                      </h3>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-[11px] text-stone-600">
                        {dayWindowsWithIdx.length} / {MAX_WINDOWS_PER_DAY}{' '}
                        windows
                      </span>
                    </div>

                    {dayWindowsWithIdx.length < MAX_WINDOWS_PER_DAY && (
                      <button
                        type="button"
                        onClick={() => handleAddWindow(day.weekday)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 text-xs transition hover:bg-emerald-100"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Window
                      </button>
                    )}
                  </div>

                  {dayWindowsWithIdx.length === 0 ? (
                    <p className="py-4 text-center text-stone-400 text-xs italic">
                      Unavailable (No working windows configured)
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {dayWindowsWithIdx.map((win, winOrder) => (
                        <div
                          key={`${day.weekday}-${winOrder}`}
                          className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2.5"
                        >
                          <div className="flex flex-1 items-center gap-2">
                            <label
                              htmlFor={`start-${win.globalIndex}`}
                              className="sr-only"
                            >
                              {day.name} window {winOrder + 1} start time
                            </label>
                            <div className="relative flex-1">
                              <select
                                id={`start-${win.globalIndex}`}
                                value={win.startTime}
                                onChange={(e) =>
                                  handleTimeChange(
                                    win.globalIndex,
                                    'startTime',
                                    e.target.value,
                                  )
                                }
                                className="min-h-[38px] w-full cursor-pointer appearance-none rounded-lg border border-stone-300 bg-white py-1.5 pr-9 pl-3 font-medium text-stone-900 text-xs transition focus:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                              >
                                {TEN_MINUTE_TIME_OPTIONS.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown
                                className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-stone-500"
                                aria-hidden="true"
                              />
                            </div>

                            <span className="font-medium text-stone-500 text-xs">
                              to
                            </span>

                            <label
                              htmlFor={`end-${win.globalIndex}`}
                              className="sr-only"
                            >
                              {day.name} window {winOrder + 1} end time
                            </label>
                            <div className="relative flex-1">
                              <select
                                id={`end-${win.globalIndex}`}
                                value={win.endTime}
                                onChange={(e) =>
                                  handleTimeChange(
                                    win.globalIndex,
                                    'endTime',
                                    e.target.value,
                                  )
                                }
                                className="min-h-[38px] w-full cursor-pointer appearance-none rounded-lg border border-stone-300 bg-white py-1.5 pr-9 pl-3 font-medium text-stone-900 text-xs transition focus:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                              >
                                {TEN_MINUTE_TIME_OPTIONS.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown
                                className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-stone-500"
                                aria-hidden="true"
                              />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveWindow(win.globalIndex)}
                            aria-label={`Remove ${day.name} window ${winOrder + 1}`}
                            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
