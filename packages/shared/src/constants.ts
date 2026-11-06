export const SESSION_MINUTES = 50;
export const SLOT_STEP_MINUTES = 10;
export const MIN_NOTICE_HOURS = 2;
export const CANCEL_LOCK_HOURS = 24;
export const MAX_WINDOWS_PER_DAY = 3;
export const ALLOWED_BUFFERS = [10, 20, 30] as const;
export const DEFAULT_BUFFER_MINUTES = 10;
export const CALENDAR_WEEKS = 4;
export const CALENDAR_DAYS = 28;
export const AUTH_SESSION_DAYS = 7;

export type AllowedBufferMinutes = (typeof ALLOWED_BUFFERS)[number];
export type UserRole = 'member' | 'professional';
export type SessionStatus = 'booked' | 'cancelled' | 'rescheduled';
export type NotificationKind =
  | 'reminder_24h'
  | 'reminder_1h'
  | 'session_cancelled'
  | 'session_rescheduled';
