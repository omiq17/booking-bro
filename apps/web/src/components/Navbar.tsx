'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  Clock,
  Globe,
  HeartHandshake,
  LogOut,
  Menu,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { NotificationBell } from '@/components/NotificationBell';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { getTimezoneOptions } from '@/lib/time';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: user, isLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.auth.me(),
  });

  const timezoneMutation = useMutation({
    mutationFn: (timezone: string) => api.auth.updateTimezone(timezone),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.me, res.user);
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.availability });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.me, null);
      queryClient.clear();
      setMobileMenuOpen(false);
      router.push('/login');
    },
  });

  const timezoneOptions = getTimezoneOptions(user?.timezone);

  const navLinks =
    user?.role === 'professional'
      ? [
          {
            href: '/sessions',
            label: 'My Schedule',
            Icon: Calendar,
          },
          {
            href: '/availability',
            label: 'Availability & Buffer',
            Icon: Clock,
          },
        ]
      : user?.role === 'member'
        ? [
            {
              href: '/professionals',
              label: 'Find a Professional',
              Icon: Users,
            },
            {
              href: '/sessions',
              label: 'My Sessions',
              Icon: Calendar,
            },
          ]
        : [];

  return (
    <header className="sticky top-0 z-40 border-stone-200 border-b bg-white/95 backdrop-blur-xs">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-lg font-bold text-lg text-stone-900 tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-800 text-white shadow-xs">
              <HeartHandshake className="h-5 w-5" />
            </span>
            <span>BookingBro</span>
          </Link>

          {user && (
            <nav
              aria-label="Primary navigation"
              className="hidden items-center gap-1 md:flex"
            >
              {navLinks.map(({ href, label, Icon }) => {
                const isActive =
                  pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 py-2 font-medium text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 ${
                      isActive
                        ? 'bg-emerald-50 font-semibold text-emerald-900'
                        : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {isLoading ? (
            <div className="h-9 w-28 animate-pulse rounded-lg bg-stone-100" />
          ) : user ? (
            <>
              <div className="hidden items-center gap-2 lg:flex">
                <Globe className="h-4 w-4 text-stone-500" aria-hidden="true" />
                <label htmlFor="navbar-tz-select" className="sr-only">
                  Active Timezone
                </label>
                <select
                  id="navbar-tz-select"
                  value={user.timezone}
                  disabled={timezoneMutation.isPending}
                  onChange={(e) => timezoneMutation.mutate(e.target.value)}
                  className="min-h-[38px] max-w-[215px] truncate rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 font-medium text-stone-800 text-xs transition hover:border-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                >
                  {timezoneOptions.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              <NotificationBell user={user} />

              <div className="hidden items-center gap-2 border-stone-200 border-l pl-2.5 sm:flex">
                <div className="text-right">
                  <p className="font-semibold text-stone-900 text-xs leading-tight">
                    {user.name}
                  </p>
                  <span
                    className={`mt-0.5 inline-block rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wider ${
                      user.role === 'professional'
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-stone-200 text-stone-800'
                    }`}
                  >
                    {user.role}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  title="Log out"
                  aria-label="Log out"
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-200 bg-white p-2 text-stone-700 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label="Toggle navigation menu"
                aria-expanded={mobileMenuOpen}
                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-200 bg-white p-2 text-stone-700 md:hidden"
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg px-3.5 py-2 font-medium text-sm text-stone-700 transition hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>

      {user && mobileMenuOpen && (
        <div className="border-stone-200 border-t bg-stone-50 px-4 py-4 md:hidden">
          <div className="mb-3 flex items-center justify-between border-stone-200 border-b pb-3">
            <div>
              <p className="font-semibold text-sm text-stone-900">
                {user.name}
              </p>
              <p className="text-stone-600 text-xs">{user.email}</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 font-semibold text-xs capitalize ${
                user.role === 'professional'
                  ? 'bg-emerald-100 text-emerald-900'
                  : 'bg-stone-200 text-stone-800'
              }`}
            >
              {user.role}
            </span>
          </div>

          <div className="mb-3 space-y-1">
            {navLinks.map(({ href, label, Icon }) => {
              const isActive =
                pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2.5 font-medium text-sm ${
                    isActive
                      ? 'bg-emerald-800 text-white'
                      : 'text-stone-800 hover:bg-stone-200/70'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </div>

          <div className="mb-3">
            <label
              htmlFor="mobile-tz-select"
              className="mb-1 block font-medium text-stone-700 text-xs"
            >
              Your Active Timezone
            </label>
            <select
              id="mobile-tz-select"
              value={user.timezone}
              disabled={timezoneMutation.isPending}
              onChange={(e) => timezoneMutation.mutate(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
            >
              {timezoneOptions.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-700 text-sm transition hover:bg-rose-100"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
