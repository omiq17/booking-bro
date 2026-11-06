'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  Check,
  ChevronDown,
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
import { useEffect, useRef, useState } from 'react';
import { NotificationBell } from '@/components/NotificationBell';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { formatTimezonePillLabel, getTimezoneOptions } from '@/lib/time';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  const cleanParts = parts.filter(
    (p) => !/^(dr\.?|prof\.?|mr\.?|mrs\.?|ms\.?)$/i.test(p),
  );
  const active = cleanParts.length > 0 ? cleanParts : parts;
  if (active.length === 1) {
    return (active[0]?.slice(0, 2) ?? 'U').toUpperCase();
  }
  const first = active[0]?.[0] ?? '';
  const second = active[1]?.[0] ?? '';
  return `${first}${second}`.toUpperCase();
}

function getFirstName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Account';
  if (/^(dr\.?|prof\.?)$/i.test(parts[0] ?? '')) {
    return `${parts[0]} ${parts[1] ?? ''}`.trim();
  }
  return parts[0] ?? name;
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tzDropdownOpen, setTzDropdownOpen] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);

  const tzRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

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
      setTzDropdownOpen(false);
      setAccountDropdownOpen(false);
      router.push('/login');
    },
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (tzRef.current && !tzRef.current.contains(target)) {
        setTzDropdownOpen(false);
      }
      if (accountRef.current && !accountRef.current.contains(target)) {
        setAccountDropdownOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setTzDropdownOpen(false);
        setAccountDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    setTzDropdownOpen(false);
    setAccountDropdownOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  const timezoneOptions = getTimezoneOptions(user?.timezone);
  const activeTzPill = user ? formatTimezonePillLabel(user.timezone) : null;

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
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
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
                    className={`inline-flex min-h-[38px] items-center gap-2 rounded-lg px-3 py-1.5 font-medium text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 ${
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

        <div className="flex items-center gap-2 sm:gap-2.5">
          {isLoading ? (
            <div className="h-9 w-32 animate-pulse rounded-full bg-stone-100" />
          ) : user ? (
            <>
              {/* Compact Timezone Dropdown Pill */}
              <div ref={tzRef} className="relative hidden md:block">
                <button
                  type="button"
                  id="navbar-tz-button"
                  onClick={() => {
                    setTzDropdownOpen((prev) => !prev);
                    setAccountDropdownOpen(false);
                  }}
                  aria-expanded={tzDropdownOpen}
                  aria-haspopup="listbox"
                  disabled={timezoneMutation.isPending}
                  className={`inline-flex min-h-[36px] items-center gap-2 rounded-full border px-3 py-1.5 font-medium text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                    tzDropdownOpen
                      ? 'border-emerald-600 bg-emerald-50/80 text-emerald-950 ring-2 ring-emerald-700/20'
                      : 'border-stone-200 bg-stone-50/90 text-stone-700 hover:border-stone-300 hover:bg-stone-100'
                  }`}
                  title={`Active timezone: ${user.timezone}`}
                >
                  <Globe
                    className={`h-3.5 w-3.5 ${
                      tzDropdownOpen ? 'text-emerald-800' : 'text-stone-500'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{activeTzPill?.shortLabel ?? user.timezone}</span>
                  <ChevronDown
                    className={`h-3 w-3 text-stone-400 transition-transform duration-150 ${
                      tzDropdownOpen ? 'rotate-180 text-emerald-800' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {tzDropdownOpen && (
                  <div
                    role="listbox"
                    aria-label="Select display timezone"
                    className="absolute right-0 mt-2 w-72 rounded-2xl border border-stone-200 bg-white p-2 shadow-xl ring-1 ring-black/5 z-50 animate-in fade-in zoom-in-95"
                  >
                    <div className="border-stone-100 border-b px-2.5 pb-2 pt-1">
                      <p className="font-semibold text-xs text-stone-900">
                        Display Timezone
                      </p>
                      <p className="text-[11px] text-stone-500">
                        Slots & reminders adapt in real time
                      </p>
                    </div>

                    <div className="mt-1 max-h-60 overflow-y-auto py-1">
                      {timezoneOptions.map((tz) => {
                        const isSelected = tz.value === user.timezone;
                        return (
                          <button
                            key={tz.value}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              timezoneMutation.mutate(tz.value);
                              setTzDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                              isSelected
                                ? 'bg-emerald-50 font-semibold text-emerald-900'
                                : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
                            }`}
                          >
                            <span className="truncate pr-2">{tz.label}</span>
                            {isSelected && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Notification Bell */}
              <NotificationBell user={user} />

              {/* Unified User Profile Dropdown Pill */}
              <div ref={accountRef} className="relative hidden md:block">
                <button
                  type="button"
                  id="navbar-user-menu-button"
                  onClick={() => {
                    setAccountDropdownOpen((prev) => !prev);
                    setTzDropdownOpen(false);
                  }}
                  aria-expanded={accountDropdownOpen}
                  aria-haspopup="menu"
                  className={`inline-flex min-h-[38px] items-center gap-2 rounded-full border pl-1 pr-2.5 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                    accountDropdownOpen
                      ? 'border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-700/20'
                      : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
                  }`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-800 font-bold text-[11px] text-white shadow-2xs">
                    {getInitials(user.name)}
                  </span>
                  <span className="max-w-[120px] truncate font-semibold text-stone-900">
                    {getFirstName(user.name)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wider ${
                      user.role === 'professional'
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-stone-100 text-stone-700'
                    }`}
                  >
                    {user.role === 'professional' ? 'Pro' : 'Member'}
                  </span>
                  <ChevronDown
                    className={`h-3 w-3 text-stone-400 transition-transform duration-150 ${
                      accountDropdownOpen ? 'rotate-180 text-emerald-800' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {accountDropdownOpen && (
                  <div
                    role="menu"
                    aria-label="User account menu"
                    className="absolute right-0 mt-2 w-60 rounded-2xl border border-stone-200 bg-white p-2 shadow-xl ring-1 ring-black/5 z-50 animate-in fade-in zoom-in-95"
                  >
                    <div className="flex items-center gap-2.5 px-2.5 pb-2.5 pt-1.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-800 font-bold text-xs text-white shadow-2xs">
                        {getInitials(user.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-xs text-stone-900">
                          {user.name}
                        </p>
                        <p className="truncate text-[11px] text-stone-500">
                          {user.email}
                        </p>
                      </div>
                    </div>

                    <div className="border-stone-100 border-t pt-1">
                      <button
                        type="button"
                        onClick={() => logoutMutation.mutate()}
                        disabled={logoutMutation.isPending}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        <LogOut className="h-3.5 w-3.5 text-rose-600" />
                        <span>Log out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile hamburger menu toggle */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label="Toggle navigation menu"
                aria-expanded={mobileMenuOpen}
                className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-stone-200 bg-white p-2 text-stone-700 md:hidden"
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
                className="inline-flex min-h-[38px] items-center justify-center rounded-lg px-3.5 py-1.5 font-medium text-sm text-stone-700 transition hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-emerald-800 px-4 py-1.5 font-semibold text-sm text-white shadow-xs transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {user && mobileMenuOpen && (
        <div className="border-stone-200 border-t bg-stone-50 px-4 py-4 md:hidden">
          <div className="mb-3 flex items-center gap-3 border-stone-200 border-b pb-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-800 font-bold text-sm text-white shadow-2xs">
              {getInitials(user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="truncate font-semibold text-sm text-stone-900">
                  {user.name}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wider ${
                    user.role === 'professional'
                      ? 'bg-emerald-100 text-emerald-900'
                      : 'bg-stone-200 text-stone-800'
                  }`}
                >
                  {user.role}
                </span>
              </div>
              <p className="truncate text-stone-600 text-xs">{user.email}</p>
            </div>
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
