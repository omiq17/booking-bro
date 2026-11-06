'use client';

import type { NotificationKind } from '@booking-bro/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarClock,
  Check,
  CheckCheck,
  Clock,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type AuthUserDto, api, type NotificationItemDto } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { formatNotificationTimestamp } from '@/lib/time';

function getNotificationBadge(kind: NotificationKind): {
  label: string;
  className: string;
  Icon: typeof Clock;
} {
  switch (kind) {
    case 'reminder_24h':
      return {
        label: '24h Reminder',
        className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        Icon: CalendarClock,
      };
    case 'reminder_1h':
      return {
        label: '1h Reminder',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
        Icon: Clock,
      };
    case 'session_cancelled':
      return {
        label: 'Cancelled',
        className: 'bg-rose-50 text-rose-700 border-rose-200',
        Icon: XCircle,
      };
    case 'session_rescheduled':
      return {
        label: 'Rescheduled',
        className: 'bg-sky-50 text-sky-800 border-sky-200',
        Icon: RefreshCw,
      };
  }
}

export function NotificationBell({ user }: { user: AuthUserDto }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.notifications.list(),
    refetchInterval: 15_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications,
      });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications,
      });
    },
  });

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const unreadCount = data?.unreadCount ?? 0;
  const items: NotificationItemDto[] = data?.notifications ?? [];

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : 'Notifications'
        }
        aria-expanded={open}
        className="relative inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-stone-700 transition hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className=" -right-1.5 -top-1.5 absolute inline-flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full bg-emerald-800 px-1.5 font-semibold text-[11px] text-white shadow-xs">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="In-app notifications"
          className="fixed inset-x-3 top-16 z-50 max-h-[80vh] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between border-stone-200 border-b bg-stone-50/80 px-4 py-3">
            <div>
              <h2 className="font-semibold text-sm text-stone-900">
                Notifications & Reminders
              </h2>
              <p className="text-stone-600 text-xs">
                Live updates · {user.timezone}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={markAllReadMutation.isPending}
                onClick={() => markAllReadMutation.mutate()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-emerald-800 text-xs transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[60vh] divide-y divide-stone-100 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-sm text-stone-600">
                Loading notifications…
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="mx-auto mb-2 h-7 w-7 text-stone-400" />
                <p className="font-medium text-sm text-stone-800">
                  No notifications yet
                </p>
                <p className="mt-1 text-stone-600 text-xs">
                  24-hour and 1-hour session reminders, cancellations, and
                  reschedules appear here.
                </p>
              </div>
            ) : (
              items.map((item) => {
                const isUnread = item.readAt === null;
                const badge = getNotificationBadge(item.kind);
                const BadgeIcon = badge.Icon;

                return (
                  <div
                    key={item.id}
                    className={`px-4 py-3.5 transition ${
                      isUnread ? 'bg-emerald-50/35' : 'bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-[11px] ${badge.className}`}
                      >
                        <BadgeIcon className="h-3 w-3" />
                        {badge.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-stone-500">
                          {formatNotificationTimestamp(
                            item.createdAt,
                            user.timezone,
                          )}
                        </span>
                        {isUnread && (
                          <button
                            type="button"
                            onClick={() => markReadMutation.mutate(item.id)}
                            disabled={markReadMutation.isPending}
                            title="Mark as read"
                            className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-1.5 py-0.5 font-medium text-[11px] text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                          >
                            <Check className="h-3 w-3 text-emerald-800" />
                            Read
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1.5 font-semibold text-sm text-stone-900">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-stone-700 text-xs leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
