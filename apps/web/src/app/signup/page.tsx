'use client';

import type { UserRole } from '@booking-bro/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  Globe,
  Stethoscope,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { detectBrowserTimezone, getTimezoneOptions } from '@/lib/time';

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [role, setRole] = useState<UserRole>('member');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timezone, setTimezone] = useState('Asia/Singapore');
  const [specialty, setSpecialty] = useState('Clinical Psychologist & Coach');
  const [bio, setBio] = useState(
    'Supporting members with structured 50-minute sessions tailored to personal growth and wellbeing.',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(detectBrowserTimezone());
  }, []);

  const timezoneOptions = getTimezoneOptions(timezone);

  const signupMutation = useMutation({
    mutationFn: () =>
      api.auth.signup({
        name,
        email,
        password,
        role,
        timezone,
        ...(role === 'professional'
          ? {
              specialty: specialty.trim() || 'Counsellor & Wellbeing Coach',
              bio: bio.trim(),
            }
          : {}),
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.me, res.user);
      void queryClient.invalidateQueries();
      if (res.user.role === 'professional') {
        router.push('/availability');
      } else {
        router.push('/professionals');
      }
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Could not create account. Please verify your inputs.');
      }
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    signupMutation.mutate();
  }

  return (
    <div className="mx-auto max-w-xl py-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs sm:p-8">
        <div className="mb-6">
          <h1 className="font-bold text-2xl text-stone-900 tracking-tight">
            Create your BookingBro account
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Choose your role and confirm your local timezone for accurate
            session times and reminders.
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-rose-800 text-sm"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <fieldset>
            <legend className="mb-2 block font-medium text-sm text-stone-800">
              I am joining as a
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole('member')}
                aria-pressed={role === 'member'}
                className={`flex min-h-[56px] items-center gap-3 rounded-xl border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                  role === 'member'
                    ? 'border-emerald-800 bg-emerald-50/70 text-emerald-950 ring-1 ring-emerald-800'
                    : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                }`}
              >
                <User className="h-5 w-5 shrink-0 text-emerald-800" />
                <div>
                  <p className="font-semibold text-sm">Member</p>
                  <p className="text-stone-600 text-xs">Book 50m sessions</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRole('professional')}
                aria-pressed={role === 'professional'}
                className={`flex min-h-[56px] items-center gap-3 rounded-xl border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                  role === 'professional'
                    ? 'border-emerald-800 bg-emerald-50/70 text-emerald-950 ring-1 ring-emerald-800'
                    : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                }`}
              >
                <Stethoscope className="h-5 w-5 shrink-0 text-emerald-800" />
                <div>
                  <p className="font-semibold text-sm">Professional</p>
                  <p className="text-stone-600 text-xs">Host & manage hours</p>
                </div>
              </button>
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="signup-name"
              className="mb-1.5 block font-medium text-sm text-stone-800"
            >
              Full name
            </label>
            <input
              id="signup-name"
              type="text"
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                role === 'professional' ? 'Dr. Jordan Patel' : 'Samira Chen'
              }
              className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            />
          </div>

          <div>
            <label
              htmlFor="signup-email"
              className="mb-1.5 block font-medium text-sm text-stone-800"
            >
              Email address
            </label>
            <input
              id="signup-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            />
          </div>

          <div>
            <label
              htmlFor="signup-password"
              className="mb-1.5 block font-medium text-sm text-stone-800"
            >
              Password (minimum 8 characters)
            </label>
            <input
              id="signup-password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            />
          </div>

          <div>
            <label
              htmlFor="signup-timezone"
              className="mb-1.5 flex items-center gap-1.5 font-medium text-sm text-stone-800"
            >
              <Globe className="h-4 w-4 text-emerald-800" />
              <span>Your IANA Timezone</span>
            </label>
            <select
              id="signup-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            >
              {timezoneOptions.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-stone-500 text-xs">
              Auto-detected from your browser. You can change this anytime in
              the top navigation bar.
            </p>
          </div>

          {role === 'professional' && (
            <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
              <div>
                <label
                  htmlFor="signup-specialty"
                  className="mb-1 block font-medium text-sm text-stone-800"
                >
                  Professional Specialty
                </label>
                <input
                  id="signup-specialty"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className="min-h-[42px] w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                />
              </div>

              <div>
                <label
                  htmlFor="signup-bio"
                  className="mb-1 block font-medium text-sm text-stone-800"
                >
                  Short Bio
                </label>
                <textarea
                  id="signup-bio"
                  rows={3}
                  maxLength={500}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                />
                <p className="mt-1 text-stone-500 text-xs">
                  Default working hours (Mon–Fri 09:00–12:00 & 13:00–17:00) are
                  automatically seeded and can be customized right after signup.
                </p>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={signupMutation.isPending}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            <span>
              {signupMutation.isPending
                ? 'Creating account…'
                : 'Create account'}
            </span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-stone-600">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-semibold text-emerald-800 underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
