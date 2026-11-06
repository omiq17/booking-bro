'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Calendar,
  Clock,
  Globe,
  Stethoscope,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export default function ProfessionalsDirectoryPage() {
  const { data: user, isLoading: isAuthLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.auth.me(),
  });

  const {
    data: directoryData,
    isLoading: isDirectoryLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.professionals,
    queryFn: () => api.professionals.list(),
    enabled: Boolean(user),
  });

  if (isAuthLoading) {
    return (
      <div className="space-y-4 py-6">
        <div className="h-10 w-64 animate-pulse rounded-xl bg-stone-200" />
        <div className="grid gap-5 md:grid-cols-2">
          <div className="h-56 animate-pulse rounded-2xl bg-white" />
          <div className="h-56 animate-pulse rounded-2xl bg-white" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-xs">
        <UserCheck className="mx-auto mb-3 h-10 w-10 text-emerald-800" />
        <h1 className="font-bold text-xl text-stone-900">
          Sign in to Browse Professionals
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Please log in as a member to view 4-week availability calendars in
          your local timezone and book 50-minute sessions.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white hover:bg-emerald-900"
          >
            Log in
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/signup"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-stone-300 bg-white px-5 py-2.5 font-semibold text-sm text-stone-800 hover:bg-stone-100"
          >
            Sign up
          </Link>
        </div>
      </div>
    );
  }

  const professionals = directoryData?.professionals ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 border-stone-200 border-b pb-5 sm:flex-row sm:items-end">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-0.5 font-semibold text-emerald-800 text-xs">
            <Stethoscope className="h-3.5 w-3.5" />
            Verified Professionals
          </span>
          <h1 className="mt-2 font-bold text-2xl text-stone-900 tracking-tight sm:text-3xl">
            Find a Professional
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Select a professional to view their 4-week calendar converted into
            your active timezone (<strong>{user.timezone}</strong>).
          </p>
        </div>
      </div>

      {isDirectoryLoading ? (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="h-60 animate-pulse rounded-2xl border border-stone-200 bg-white p-6" />
          <div className="h-60 animate-pulse rounded-2xl border border-stone-200 bg-white p-6" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 text-sm">
          Failed to load professionals. Please refresh the page.
        </div>
      ) : professionals.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center">
          <p className="font-semibold text-base text-stone-800">
            No professionals found
          </p>
          <p className="mt-1 text-sm text-stone-600">
            Check back soon or sign up a professional account to start offering
            sessions.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {professionals.map((pro) => (
            <article
              key={pro.id}
              className="flex flex-col justify-between rounded-2xl border border-stone-200 bg-white p-6 shadow-xs transition hover:border-emerald-700/60 hover:shadow-md"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-lg text-stone-900">
                      {pro.name}
                    </h2>
                    <p className="font-medium text-emerald-800 text-sm">
                      {pro.specialty}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 font-medium text-stone-700 text-xs">
                    <Globe className="h-3.5 w-3.5 text-emerald-800" />
                    {pro.timezone}
                  </span>
                </div>

                <p className="mt-3 text-sm text-stone-600 leading-relaxed">
                  {pro.bio ||
                    'Dedicated 50-minute wellbeing and counselling sessions tailored to your goals.'}
                </p>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-stone-100 border-t pt-4">
                <div className="flex items-center gap-3 text-stone-600 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-emerald-800" />
                    50m session
                  </span>
                  <span>·</span>
                  <span>{pro.bufferMinutes}m rest buffer</span>
                </div>

                <Link
                  href={`/professionals/${pro.id}`}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
                >
                  <Calendar className="h-4 w-4" />
                  <span>View 4-Week Calendar</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
