'use client';

import { SESSION_MINUTES } from '@booking-bro/shared';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Globe,
  ShieldAlert,
  User,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import type { ProfessionalSummaryDto, SlotDto } from '@/lib/api';
import { formatDateHeader, formatTimeRange } from '@/lib/time';

export interface ConfirmModalProps {
  open: boolean;
  professional: ProfessionalSummaryDto;
  slot: SlotDto | null;
  viewerTimezone: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  open,
  professional,
  slot,
  viewerTimezone,
  isSubmitting,
  errorMessage,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, isSubmitting, onClose]);

  if (!open || !slot) {
    return null;
  }

  const viewerDate = formatDateHeader(slot.startAt, viewerTimezone);
  const viewerTimeRange = formatTimeRange(
    slot.startAt,
    slot.endAt,
    viewerTimezone,
  );
  const proTimeRange = formatTimeRange(
    slot.startAt,
    slot.endAt,
    professional.timezone,
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-booking-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/50 p-0 backdrop-blur-xs sm:items-center sm:p-4"
    >
      <div className="w-full max-w-lg rounded-t-2xl border border-stone-200 bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-stone-200 border-b pb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-800 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Confirm 50-Minute Session
            </span>
            <h2
              id="confirm-booking-title"
              className="mt-1.5 font-bold text-lg text-stone-900"
            >
              Review Your Booking Details
            </h2>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close confirmation modal"
            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-rose-800 text-sm"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="mt-4 space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm">
          <div className="flex items-start gap-3">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800" />
            <div>
              <p className="text-stone-500 text-xs">Professional</p>
              <p className="font-semibold text-stone-900">
                {professional.name}
              </p>
              <p className="text-stone-600 text-xs">{professional.specialty}</p>
            </div>
          </div>

          <div className="flex items-start gap-3 border-stone-200 border-t pt-3">
            <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800" />
            <div>
              <p className="text-stone-500 text-xs">
                Date & Time ({viewerTimezone})
              </p>
              <p className="font-semibold text-stone-900">{viewerDate}</p>
              <p className="font-medium text-emerald-900">{viewerTimeRange}</p>
            </div>
          </div>

          {professional.timezone !== viewerTimezone && (
            <div className="flex items-start gap-3 border-stone-200 border-t pt-3">
              <Globe className="mt-0.5 h-4 w-4 shrink-0 text-stone-600" />
              <div>
                <p className="text-stone-500 text-xs">
                  Professional&apos;s Local Time ({professional.timezone})
                </p>
                <p className="font-medium text-stone-800 text-xs">
                  {proTimeRange}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3 border-stone-200 border-t pt-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800" />
            <div>
              <p className="text-stone-500 text-xs">Duration & Reminders</p>
              <p className="font-medium text-stone-800 text-xs">
                {SESSION_MINUTES} minutes · Automated 24h & 1h in-app reminders
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-amber-900 text-xs">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
          <p className="leading-relaxed">
            <strong>24-Hour Modification Policy:</strong> You can cancel or
            reschedule this session up to <strong>24 hours</strong> before it
            starts. Changes are locked within 24 hours of start time.
          </p>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2.5 font-semibold text-sm text-stone-700 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          >
            Back to Calendar
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onConfirm}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {isSubmitting ? 'Booking Session…' : 'Confirm & Book Session'}
          </button>
        </div>
      </div>
    </div>
  );
}
