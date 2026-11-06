'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  KeyRound,
  Stethoscope,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

interface DemoAccount {
  label: string;
  role: 'member' | 'professional';
  email: string;
  timezone: string;
  note: string;
}

const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    label: 'Mei Lin Tan',
    role: 'member',
    email: 'mei.tan@example.com',
    timezone: 'Asia/Singapore',
    note: 'Member · Has upcoming >24h & <24h sessions',
  },
  {
    label: 'Alex Rivera',
    role: 'member',
    email: 'alex.rivera@example.com',
    timezone: 'America/New_York',
    note: 'Member · Cross-timezone booking view (ET)',
  },
  {
    label: 'Dr. Aisha Lim',
    role: 'professional',
    email: 'dr.aisha.lim@example.com',
    timezone: 'Asia/Singapore',
    note: 'Professional · Clinical Psychologist (10m buffer)',
  },
  {
    label: 'Dr. Oliver Grant',
    role: 'professional',
    email: 'dr.oliver.grant@example.com',
    timezone: 'Europe/London',
    note: 'Professional · CBT & Executive Coach (20m buffer)',
  },
] as const;

const DEMO_PASSWORD = 'Password123!';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      api.auth.login(credentials),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.me, res.user);
      void queryClient.invalidateQueries();
      if (res.user.role === 'professional') {
        router.push('/sessions');
      } else {
        router.push('/professionals');
      }
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Unable to log in. Please check your credentials.');
      }
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    loginMutation.mutate({ email, password });
  }

  function handleQuickDemoFill(account: DemoAccount) {
    setErrorMessage(null);
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    loginMutation.mutate({
      email: account.email,
      password: DEMO_PASSWORD,
    });
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-8 py-4 lg:grid-cols-12">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs sm:p-8 lg:col-span-7">
        <div className="mb-6">
          <h1 className="font-bold text-2xl text-stone-900 tracking-tight">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Sign in to book a 50-minute session or manage your schedule.
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="mb-1.5 block font-medium text-sm text-stone-800"
            >
              Email address
            </label>
            <input
              id="login-email"
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
              htmlFor="login-password"
              className="mb-1.5 block font-medium text-sm text-stone-800"
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            />
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 py-2.5 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            <span>{loginMutation.isPending ? 'Signing in…' : 'Log in'}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-stone-600">
          Don&apos;t have an account yet?{' '}
          <Link
            href="/signup"
            className="font-semibold text-emerald-800 underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>

      <aside className="rounded-2xl border border-stone-200 bg-stone-100/90 p-6 lg:col-span-5">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-emerald-800" />
          <h2 className="font-semibold text-sm text-stone-900">
            1-Click Demo Accounts
          </h2>
        </div>
        <p className="mb-4 text-stone-600 text-xs leading-relaxed">
          Click any demo account below to sign in immediately and explore
          cross-timezone booking, schedule locks, or availability management.
        </p>

        <div className="space-y-2.5">
          {DEMO_ACCOUNTS.map((acc) => {
            const isPro = acc.role === 'professional';
            return (
              <button
                key={acc.email}
                type="button"
                disabled={loginMutation.isPending}
                onClick={() => handleQuickDemoFill(acc)}
                className="flex w-full items-start gap-3 rounded-xl border border-stone-200 bg-white p-3 text-left transition hover:border-emerald-700 hover:bg-emerald-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:opacity-50"
              >
                <span
                  className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    isPro
                      ? 'bg-emerald-100 text-emerald-900'
                      : 'bg-stone-100 text-stone-700'
                  }`}
                >
                  {isPro ? (
                    <Stethoscope className="h-4 w-4" />
                  ) : (
                    <UserCheck className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold text-stone-900 text-xs">
                      {acc.label}
                    </p>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-[10px] text-stone-700">
                      {acc.timezone}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-stone-600">
                    {acc.note}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
