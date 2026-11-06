'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BellRing,
  CalendarCheck,
  Clock,
  Globe2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export default function HomePage() {
  const { data: user, isLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.auth.me(),
  });

  return (
    <div className="space-y-12 py-4">
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-xs sm:p-10 lg:p-12">
        <div className="max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1 font-medium text-emerald-900 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-emerald-800" />
            <span>50-Minute Structured Sessions · Zero Double-Booking</span>
          </div>

          <h1 className="font-bold text-3xl text-stone-900 tracking-tight sm:text-4xl lg:text-5xl">
            Calm, reliable session booking built around your timezone.
          </h1>

          <p className="text-base text-stone-700 leading-relaxed sm:text-lg">
            Connect with professionals across a 4-week calendar rendered in your
            local IANA timezone. Every 50-minute session includes automated
            24-hour and 1-hour in-app reminders and database-enforced conflict
            protection.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            {isLoading ? (
              <div className="h-11 w-48 animate-pulse rounded-xl bg-stone-100" />
            ) : user ? (
              user.role === 'member' ? (
                <>
                  <Link
                    href="/professionals"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                  >
                    Browse Professionals
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/sessions"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 bg-white px-5 py-2.5 font-semibold text-sm text-stone-800 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                  >
                    View My Sessions
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/sessions"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                  >
                    View My Upcoming Schedule
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/availability"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 bg-white px-5 py-2.5 font-semibold text-sm text-stone-800 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                  >
                    Configure Availability & Buffer
                  </Link>
                </>
              )
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                >
                  Log in (Includes 1-Click Demo Accounts)
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 bg-white px-5 py-2.5 font-semibold text-sm text-stone-800 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                >
                  Create an Account
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section
        aria-label="Key capabilities"
        className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800">
            <Globe2 className="h-5 w-5" />
          </div>
          <h2 className="font-semibold text-base text-stone-900">
            Cross-Timezone Precision
          </h2>
          <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
            Professionals set working hours in their own IANA timezone; members
            browse and book across a 28-day calendar in theirs.
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800">
            <Clock className="h-5 w-5" />
          </div>
          <h2 className="font-semibold text-base text-stone-900">
            Flexible 10-Min Grid & Buffers
          </h2>
          <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
            Up to 3 availability windows per weekday with 10, 20, or 30-minute
            post-session buffers snapshotted per booking.
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h2 className="font-semibold text-base text-stone-900">
            Atomic Reschedule & 24h Rule
          </h2>
          <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
            Members can cancel or atomically reschedule up to 24 hours before
            start time. PostgreSQL GiST constraints block double-bookings.
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800">
            <BellRing className="h-5 w-5" />
          </div>
          <h2 className="font-semibold text-base text-stone-900">
            Exactly-Once Reminders
          </h2>
          <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
            24-hour and 1-hour reminders are persisted in Postgres via pg-boss
            and delivered idempotently into the notification bell.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-stone-100/80 p-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <CalendarCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-800" />
            <div>
              <h3 className="font-semibold text-sm text-stone-900">
                Booking & Cancellation Policy Summary
              </h3>
              <p className="mt-0.5 text-stone-700 text-xs leading-relaxed">
                Minimum booking notice is <strong>2 hours</strong> before session
                start. Members can cancel or reschedule when at least{' '}
                <strong>24 hours</strong> remain before start time. Professionals
                can cancel upcoming sessions at any time.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
