'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Globe,
  Lock,
  RefreshCw,
  Stethoscope,
  User,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RescheduleModal } from '@/components/RescheduleModal';
import { Toast } from '@/components/Toast';
import { ApiError, api, type EnrichedSessionDto } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { formatDateHeader, formatTimeRange } from '@/lib/time';

export default function SessionsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history'>(
    'upcoming',
  );
  const [rescheduleTarget, setRescheduleTarget] =
    useState<EnrichedSessionDto | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('booked') === '1') {
        setBannerMessage(
          'Session confirmed! 24-hour and 1-hour reminders scheduled.',
        );
        window.history.replaceState({}, '', '/sessions');
      }
    }
  }, []);

  const { data: user, isLoading: isAuthLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.auth.me(),
  });

  const { data: sessionsData, isLoading: isSessionsLoading } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => api.sessions.list(),
    enabled: Boolean(user),
  });

  const cancelMutation = useMutation({
    mutationFn: (sessionId: string) => api.sessions.cancel(sessionId),
    onSuccess: () => {
      setConfirmCancelId(null);
      setErrorMessage(null);
      setBannerMessage(
        'Session cancelled. Pending reminders have been removed.',
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
    onError: (err) => {
      setConfirmCancelId(null);
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to cancel session.');
      }
    },
  });

  if (isAuthLoading) {
    return (
      <div className="space-y-4 py-6">
        <div className="h-10 w-60 animate-pulse rounded-xl bg-stone-200" />
        <div className="h-48 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-xs">
        <Calendar className="mx-auto mb-3 h-10 w-10 text-emerald-800" />
        <h1 className="font-bold text-xl text-stone-900">
          Sign in to View Your Sessions
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Log in as a member or professional to manage your upcoming 50-minute
          sessions.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white hover:bg-emerald-900"
        >
          Log in
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  const upcoming = sessionsData?.upcoming ?? [];
  const pastOrInactive = sessionsData?.pastOrInactive ?? [];
  const isMember = user.role === 'member';

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-stone-200 border-b pb-5 sm:flex-row sm:items-end">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-0.5 font-semibold text-emerald-800 text-xs">
            <Calendar className="h-3.5 w-3.5" />
            {isMember ? 'Member Dashboard' : 'Professional Schedule'}
          </span>
          <h1 className="mt-2 font-bold text-2xl text-stone-900 tracking-tight sm:text-3xl">
            {isMember ? 'My Sessions' : 'My Upcoming Schedule'}
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            All session times are displayed in your active timezone (
            <strong>{user.timezone}</strong>).
          </p>
        </div>

        {isMember ? (
          <Link
            href="/professionals"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900"
          >
            <span>Book New Session</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <Link
            href="/availability"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 font-semibold text-sm text-stone-800 transition hover:bg-stone-100"
          >
            <Clock className="h-4 w-4 text-emerald-800" />
            <span>Edit Working Hours & Buffer</span>
          </Link>
        )}
      </div>

      <Toast
        message={bannerMessage}
        onClose={() => setBannerMessage(null)}
        durationMs={3000}
      />

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="font-semibold text-rose-800 text-xs hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div
        role="tablist"
        aria-label="Session categories"
        className="inline-flex rounded-xl border border-stone-200 bg-stone-100 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'upcoming'}
          onClick={() => setActiveTab('upcoming')}
          className={`min-h-[40px] rounded-lg px-4 py-2 font-semibold text-sm transition ${
            activeTab === 'upcoming'
              ? 'bg-white text-stone-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          Upcoming ({upcoming.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          onClick={() => setActiveTab('history')}
          className={`min-h-[40px] rounded-lg px-4 py-2 font-semibold text-sm transition ${
            activeTab === 'history'
              ? 'bg-white text-stone-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          Past, Cancelled & Rescheduled ({pastOrInactive.length})
        </button>
      </div>

      {isSessionsLoading ? (
        <div className="space-y-4">
          <div className="h-40 animate-pulse rounded-2xl border border-stone-200 bg-white p-6" />
          <div className="h-40 animate-pulse rounded-2xl border border-stone-200 bg-white p-6" />
        </div>
      ) : activeTab === 'upcoming' ? (
        upcoming.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center">
            <Calendar className="mx-auto mb-3 h-9 w-9 text-stone-400" />
            <h2 className="font-semibold text-base text-stone-900">
              No upcoming booked sessions
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              {isMember
                ? 'Browse professionals to schedule a 50-minute session.'
                : 'New member bookings will appear here automatically.'}
            </p>
            {isMember && (
              <Link
                href="/professionals"
                className="mt-4 inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2 font-semibold text-sm text-white hover:bg-emerald-900"
              >
                Find a Professional
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {upcoming.map((s) => {
              const counterPartyName = isMember
                ? s.professionalName
                : s.memberName;
              const counterPartyTz = isMember
                ? s.professionalTimezone
                : s.memberTimezone;
              const isLockedForMember = isMember && !s.canModify;
              const isConfirmingCancel = confirmCancelId === s.id;

              return (
                <article
                  key={s.id}
                  className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs sm:p-6"
                >
                  <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-800 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Confirmed · 50m
                        </span>

                        {isLockedForMember && (
                          <span
                            title="Members can cancel or reschedule up to 24 hours before start time"
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-800 text-xs"
                          >
                            <Lock className="h-3.5 w-3.5" />
                            Locked (&lt; 24h before start)
                          </span>
                        )}

                        {s.rescheduledFromId && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 font-medium text-sky-800 text-xs">
                            <RefreshCw className="h-3 w-3" />
                            Rescheduled Session
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        {isMember ? (
                          <Stethoscope className="h-4 w-4 text-emerald-800" />
                        ) : (
                          <User className="h-4 w-4 text-emerald-800" />
                        )}
                        <h2 className="font-bold text-lg text-stone-900">
                          {counterPartyName}
                        </h2>
                        {isMember && (
                          <span className="text-stone-500 text-xs">
                            · {s.professionalSpecialty}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-800">
                        <span className="font-semibold text-emerald-950">
                          {formatDateHeader(s.startAt, user.timezone)}
                        </span>
                        <span className="font-medium text-emerald-800">
                          {formatTimeRange(s.startAt, s.endAt, user.timezone)}
                        </span>
                      </div>

                      {counterPartyTz !== user.timezone && (
                        <p className="flex items-center gap-1.5 text-stone-500 text-xs">
                          <Globe className="h-3.5 w-3.5" />
                          {isMember ? 'Professional' : 'Member'} local time (
                          {counterPartyTz}):{' '}
                          <strong>
                            {formatTimeRange(
                              s.startAt,
                              s.endAt,
                              counterPartyTz,
                            )}
                          </strong>
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                      {isConfirmingCancel ? (
                        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2">
                          <span className="px-2 font-medium text-rose-900 text-xs">
                            Cancel this session?
                          </span>
                          <button
                            type="button"
                            disabled={cancelMutation.isPending}
                            onClick={() => cancelMutation.mutate(s.id)}
                            className="min-h-[38px] rounded-lg bg-rose-700 px-3 py-1.5 font-semibold text-white text-xs hover:bg-rose-800 disabled:opacity-50"
                          >
                            {cancelMutation.isPending
                              ? 'Cancelling…'
                              : 'Yes, Cancel'}
                          </button>
                          <button
                            type="button"
                            disabled={cancelMutation.isPending}
                            onClick={() => setConfirmCancelId(null)}
                            className="min-h-[38px] rounded-lg border border-stone-300 bg-white px-3 py-1.5 font-semibold text-stone-700 text-xs hover:bg-stone-100"
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                        <>
                          {isMember && (
                            <button
                              type="button"
                              disabled={!s.canModify}
                              onClick={() => {
                                setBannerMessage(null);
                                setErrorMessage(null);
                                setRescheduleTarget(s);
                              }}
                              title={
                                s.canModify
                                  ? 'Reschedule session'
                                  : 'Rescheduling is locked within 24 hours of session start'
                              }
                              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white px-4 py-2 font-semibold text-sm text-stone-800 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RefreshCw className="h-4 w-4 text-emerald-800" />
                              <span>Reschedule</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={!s.canModify}
                            onClick={() => {
                              setBannerMessage(null);
                              setErrorMessage(null);
                              setConfirmCancelId(s.id);
                            }}
                            title={
                              s.canModify
                                ? 'Cancel session'
                                : 'Cancellation is locked for members within 24 hours of session start'
                            }
                            className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-2 font-semibold text-rose-700 text-sm transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <XCircle className="h-4 w-4" />
                            <span>Cancel Session</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isLockedForMember && (
                    <p className="mt-3 border-stone-100 border-t pt-2.5 text-amber-900 text-xs">
                      This session starts in less than 24 hours. Per the 24-hour
                      member modification policy, cancellation and rescheduling
                      are locked.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )
      ) : pastOrInactive.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center">
          <p className="font-semibold text-base text-stone-800">
            No past, cancelled, or rescheduled sessions yet
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pastOrInactive.map((s) => {
            const counterPartyName = isMember
              ? s.professionalName
              : s.memberName;

            const statusBadge =
              s.status === 'cancelled'
                ? {
                    label: 'Cancelled',
                    className: 'bg-rose-50 text-rose-700 border-rose-200',
                    Icon: XCircle,
                  }
                : s.status === 'rescheduled'
                  ? {
                      label: 'Rescheduled (Replaced)',
                      className: 'bg-sky-50 text-sky-800 border-sky-200',
                      Icon: RefreshCw,
                    }
                  : {
                      label: 'Completed',
                      className: 'bg-stone-100 text-stone-700 border-stone-200',
                      Icon: CheckCircle2,
                    };

            const StatusIcon = statusBadge.Icon;

            return (
              <article
                key={s.id}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-stone-200 bg-white/80 p-5 sm:flex-row sm:items-center"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold text-xs ${statusBadge.className}`}
                    >
                      <StatusIcon className="h-3.5 w-3.5" />
                      {statusBadge.label}
                    </span>
                    <span className="font-semibold text-sm text-stone-900">
                      {counterPartyName}
                    </span>
                  </div>
                  <p className="text-stone-600 text-xs">
                    {formatDateHeader(s.startAt, user.timezone)} ·{' '}
                    {formatTimeRange(s.startAt, s.endAt, user.timezone)}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <RescheduleModal
        session={rescheduleTarget}
        viewerTimezone={user.timezone}
        onClose={() => setRescheduleTarget(null)}
        onSuccess={() => {
          setRescheduleTarget(null);
          setBannerMessage(
            'Session rescheduled! Time and reminders have been updated.',
          );
        }}
      />
    </div>
  );
}
