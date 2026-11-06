import {
  type AnyPgColumn,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['member', 'professional']);

export const sessionStatusEnum = pgEnum('session_status', [
  'booked',
  'cancelled',
  'rescheduled',
]);

export const notificationKindEnum = pgEnum('notification_kind', [
  'reminder_24h',
  'reminder_1h',
  'session_cancelled',
  'session_rescheduled',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull(),
  timezone: text('timezone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const authSessions = pgTable('auth_sessions', {
  idHash: text('id_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const professionalProfiles = pgTable('professional_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  specialty: text('specialty')
    .notNull()
    .default('Counsellor & Wellbeing Coach'),
  bio: text('bio').notNull().default(''),
  bufferMinutes: smallint('buffer_minutes').notNull().default(10),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const availabilityWindows = pgTable('availability_windows', {
  id: uuid('id').primaryKey().defaultRandom(),
  professionalId: uuid('professional_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  weekday: smallint('weekday').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bookingSessions = pgTable('booking_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  professionalId: uuid('professional_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }).notNull(),
  bufferMinutes: smallint('buffer_minutes').notNull(),
  status: sessionStatusEnum('status').notNull().default('booked'),
  rescheduledFromId: uuid('rescheduled_from_id').references(
    (): AnyPgColumn => bookingSessions.id,
  ),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledBy: uuid('cancelled_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => bookingSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('unique_session_user_notification').on(
      table.sessionId,
      table.userId,
      table.kind,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type ProfessionalProfileRow = typeof professionalProfiles.$inferSelect;
export type AvailabilityWindowRow = typeof availabilityWindows.$inferSelect;
export type BookingSessionRow = typeof bookingSessions.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
