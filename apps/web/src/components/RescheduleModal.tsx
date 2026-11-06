'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { CalendarPicker } from '@/components/CalendarPicker';
import {
  ApiError,
  api,
  type EnrichedSessionDto,
  type SlotDto,
} from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { formatDateHeader, formatTimeRange } from '@/lib/time';

export interface RescheduleModalProps {
  session: EnrichedSessionDto | null;
  viewerTimezone: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function RescheduleModal({
  session,
  viewerTimezone,
  onClose,
  onSuccess,
}: RescheduleModalProps) {
  const queryClient = useQueryClient();
  const [selectedSlot, setSelectedSlot] = useState<SlotDto | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSlot(null);
    setErrorMessage(null);
  }, [session?.id]);

  const {
    data: slotsData,
    isLoading: isSlotsLoading,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: session
      ? queryKeys.slots(session.professionalId, session.id)
      : ['slots', 'none'],
    queryFn: () =>
      api.professionals.slots(session!.professionalId, {
        excludeSessionId: session!.id,
      }),
    enabled: Boolean(session),
  });

  const rescheduleMutation = useMutation({
    mutationFn: (newStartAt: string) =>
      api.sessions.reschedule(session!.id, newStartAt),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      onSuccess();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        if (err.statusCode === 409) {
          void refetchSlots();
        }
      } else {
        setErrorMessage('Failed to reschedule session. Please try again.');
      }
    },
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !rescheduleMutation.isPending) {
        onClose();
      }
    }
    if (session) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [session, rescheduleMutation.isPending, onClose]);

  if (!session) {
    return null;
  }

  const currentSlots = (slotsData?.slots ?? []).filter(
    (s) => s.startAt !== session.startAt,
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/50 p-0 backdrop-blur-xs sm:items-center sm:p-4"
    >
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl border border-stone-200 bg-stone-50 p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3 border-stone-200 border-b pb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-800 text-xs">
              <RefreshCw className="h-3.5 w-3.5" />
              Reschedule Session
            </span>
            <h2
              id="reschedule-modal-title"
              className="mt-1 font-bold text-xl text-stone-900"
            >
              Reschedule Session with {session.professionalName}
            </h2>
            <p className="text-stone-600 text-xs">
              Select a new date and time from the calendar below. You can choose
              any open slot, including earlier or later on the same day.
            </p>
          </div>
          <button
            type="button"
            disabled={rescheduleMutation.isPending}
            onClick={onClose}
            aria-label="Close reschedule modal"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-100 hover:text-stone-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-rose-800 text-sm"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-4 text-sm">
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-stone-500" />
            <div>
              <p className="text-stone-500 text-xs">Current Session Time</p>
              <p className="font-semibold text-stone-900">
                {formatDateHeader(session.startAt, viewerTimezone)} ·{' '}
                {formatTimeRange(
                  session.startAt,
                  session.endAt,
                  viewerTimezone,
                )}
              </p>
            </div>
          </div>

          {selectedSlot && (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2">
              <ArrowRight className="h-4 w-4 text-emerald-800" />
              <div>
                <p className="font-medium text-emerald-800 text-xs">
                  New Selected Time
                </p>
                <p className="font-bold text-emerald-950 text-sm">
                  {formatDateHeader(selectedSlot.startAt, viewerTimezone)} ·{' '}
                  {formatTimeRange(
                    selectedSlot.startAt,
                    selectedSlot.endAt,
                    viewerTimezone,
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        <CalendarPicker
          slots={currentSlots}
          viewerTimezone={viewerTimezone}
          professionalTimezone={session.professionalTimezone}
          selectedSlot={selectedSlot}
          onSelectSlot={(slot) => {
            setErrorMessage(null);
            setSelectedSlot(slot);
          }}
          isLoading={isSlotsLoading}
        />

        <div className="mt-6 flex flex-col-reverse items-center justify-between gap-3 border-stone-200 border-t pt-4 sm:flex-row">
          <p className="text-stone-600 text-xs">
            Confirming updates your session to the new time and resets your 24h
            and 1h reminders automatically.
          </p>
          <div className="flex w-full gap-2.5 sm:w-auto">
            <button
              type="button"
              disabled={rescheduleMutation.isPending}
              onClick={onClose}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2 font-semibold text-sm text-stone-700 hover:bg-stone-100 sm:flex-none"
            >
              Keep Current Time
            </button>
            <button
              type="button"
              disabled={!selectedSlot || rescheduleMutation.isPending}
              onClick={() => {
                if (selectedSlot) {
                  rescheduleMutation.mutate(selectedSlot.startAt);
                }
              }}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 py-2 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 disabled:opacity-50 sm:flex-none"
            >
              <RefreshCw className="h-4 w-4" />
              <span>
                {rescheduleMutation.isPending
                  ? 'Rescheduling…'
                  : 'Confirm Reschedule'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
