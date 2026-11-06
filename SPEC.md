# Technical Specification: BookingBro — Session Booking with Reminders

> **Status:** Approved & Finalized  
> **Related Docs:** [DECISIONS.md](DECISIONS.md) · [AI_USAGE.md](AI_USAGE.md) · [AGENTS.md](AGENTS.md) · [CONSTRAINTS.md](CONSTRAINTS.md) · [docs/intent/booking-bro.md](docs/intent/booking-bro.md)

---

## Table of Contents

- [Assumptions Surfaced](#assumptions-surfaced)
- [Capability Map & Build Order](#capability-map--build-order)
- [1. Objective & Detailed Feature Specification](#1-objective--detailed-feature-specification-brief-2)
  - [1.1 Users & Roles](#11-users--roles)
  - [1.2 Sign Up, Login, Logout, Session Expiry & Server-Side Identity](#12-sign-up-login-logout-session-expiry--server-side-identity)
  - [1.3 Professional Availability & Slot Layout](#13-professional-availability--slot-layout)
  - [1.4 Find a Professional, 4-Week Calendar & Booking Flow](#14-find-a-professional-4-week-calendar--booking-flow)
  - [1.5 No Double-Booking & Concurrency Guarantees](#15-no-double-booking--concurrency-guarantees)
  - [1.6 My Sessions (Member & Professional Views)](#16-my-sessions-member--professional-views)
  - [1.7 Cancel & Reschedule (24-Hour Rule & Atomic Transaction)](#17-cancel--reschedule-24-hour-rule--atomic-transaction)
  - [1.8 Reminders & In-App Notifications](#18-reminders--in-app-notifications)
- [2. Tech Stack & Database Schema](#2-tech-stack--database-schema)
  - [2.1 Stack & Versions](#21-stack--versions)
  - [2.2 PostgreSQL Schema](#22-postgresql-schema-appsapisrcdbschemats--sql-migration)
- [3. Commands](#3-commands)
- [4. Project Structure](#4-project-structure)
- [5. Code Style & Standard Practices](#5-code-style--standard-practices)
- [6. Testing Strategy](#6-testing-strategy-brief-3)
  - [6.1 Pure Unit Tests (`packages/shared/tests/`)](#61-pure-unit-tests-packagessharedtests--fast-deterministic)
  - [6.2 Database & API Integration Tests (`apps/api/tests/`)](#62-database--api-integration-tests-appsapitests--real-postgresql)
- [7. Boundaries](#7-boundaries)
- [8. Success Criteria](#8-success-criteria)
- [9. Review Sign-Off & Resolutions](#9-review-sign-off--resolutions)

---

## Assumptions Surfaced

1. **Web-only responsive UI:** Desktop and mobile-web browsers are targeted via Next.js (App Router) and Tailwind CSS; no native mobile app is required.
2. **Role immutability after signup:** A user chooses either `member` or `professional` at signup along with their IANA timezone.
3. **Professional profile metadata:** Signing up as a `professional` automatically creates a default profile (specialty, short bio, `buffer_minutes = 10`) and sensible default Mon–Fri working hours (`09:00–12:00`, `13:00–17:00`) that the professional can immediately customize in their Availability Editor.
4. **Calendar visibility for members:** When an authenticated member views a professional's 4-week calendar, the API returns only free slot start/end timestamps (never who booked other slots) and automatically excludes times where the requesting member already has an overlapping `booked` session with any professional.
5. **Reschedule scope:** A member reschedules an existing session with the **same professional** to a new available slot in the 4-week window.
6. **In-app notifications scope:** Notifications are created for (a) **24-hour reminders**, (b) **1-hour reminders**, (c) **session cancelled** events, and (d) **session rescheduled** events — for both the member and the professional. Initial booking does not create a notification (the confirmation screen + "My Sessions" view serves that purpose).

---

## Capability Map & Build Order

Because BookingBro spans several independently testable capabilities, the system is decomposed into six modules with strict one-way dependencies (no cycles):

| Module ID | Responsibility | Depends On |
| :--- | :--- | :--- |
| `shared-domain` | Zod schemas, DTO types, IANA timezone validator, pure Luxon slot generator, 24h & 2h rule evaluators | — |
| `db-and-auth` | Drizzle schema, SQL migrations (`btree_gist` exclusion constraints), `argon2id` hashing, `HttpOnly` cookie session middleware | `shared-domain` |
| `availability-and-slots` | Professional directory/profile API, weekly availability CRUD (1–3 windows/day ≥ 50m, 10/20/30m buffer), 4-week on-the-fly slot API | `shared-domain`, `db-and-auth` |
| `booking-and-sessions` | Concurrency-safe booking, member/professional session lists, 24h-enforced cancel, atomic transactional reschedule | `availability-and-slots`, `db-and-auth` |
| `reminders-and-notifications` | `pg-boss` worker, transactional job scheduling/cancellation (24h & 1h), idempotent notification delivery & polling API | `booking-and-sessions`, `db-and-auth` |
| `web-ui` | Next.js App Router pages, 2-column 4-week calendar, confirmation flow, My Sessions, Availability Editor, Notification Bell | All API modules + `shared-domain` |

**Build Order:** `shared-domain` → `db-and-auth` → `availability-and-slots` → `booking-and-sessions` → `reminders-and-notifications` → `web-ui`

---

## 1. Objective & Detailed Feature Specification (Brief §2)

**BookingBro** enables members to discover mental-health professionals across countries and timezones, inspect a 4-week calendar of 50-minute slots in their own timezone, book/cancel/reschedule sessions without double-booking, and receive reliable 24-hour and 1-hour in-app reminders.

### 1.1 Users & Roles
- **Roles:** `'member'` | `'professional'`.
- **Timezone:** Every user selects a valid IANA timezone (validated via `Intl.supportedValuesOf('timeZone')`, e.g., `'Asia/Singapore'`, `'Europe/London'`, `'America/New_York'`) at signup. Users may also update their timezone in settings.
- **Session length:** Strictly **50 minutes** (`end_at = start_at + 50 minutes`) between one member and one professional.

### 1.2 Sign Up, Login, Logout, Session Expiry & Server-Side Identity
- **Password Hashing:** Only the plain-text `password` string is hashed via `argon2id` (`argon2.hash(password)`), which embeds its own cryptographic random salt. User fields like `email`, `name`, `role`, and `timezone` are stored as separate columns so changing `timezone` never affects `password_hash`.
- **Session Expiry (`7 days`):** Each login/signup sets `expires_at = now() + interval '7 days'` on `auth_sessions` and `Max-Age=604800` on the `sid` cookie.
  - **When a session expires:** The Fastify `preHandler` checks `WHERE id_hash = sha256(sid) AND expires_at > now()`. If expired, the server deletes the expired `auth_sessions` row, clears the `sid` cookie, and returns `401 Unauthorized` (causing the frontend to clear the `['me']` cache and redirect to `/login`).
- **Endpoints:**
  - `POST /api/auth/signup` — Creates user (`email`, `password_hash`, `name`, `role`, `timezone`), creates a 7-day `auth_sessions` row (`id_hash = sha256(token)`), and sets `Set-Cookie: sid=<32-byte-hex>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` (`Secure` in production).
  - `POST /api/auth/login` — Verifies email + `argon2id` hash (returning identical `401 Invalid email or password` on failure to prevent user enumeration) and sets the `sid` cookie.
  - `POST /api/auth/logout` — Deletes the `auth_sessions` row matching `sha256(cookie.sid)` and clears the cookie.
  - `GET /api/auth/me` — Returns the authenticated user `{ id, email, name, role, timezone }` from `req.user`.
- **Security invariant:** Protected routes resolve the actor exclusively from `req.user` (populated by Fastify `preHandler` session lookup). Client-supplied `memberId` or `professionalId` fields for the actor are ignored/rejected.

### 1.3 Professional Availability & Slot Layout
- **Weekly Working Hours (`availability_windows`):**
  - Each professional sets working windows for ISO weekdays `1` (Monday) through `7` (Sunday) in their own IANA timezone.
  - **Max 3 windows per weekday** (e.g., `09:00–12:00`, `13:00–17:00`, `19:00–21:00`).
  - **10-minute alignment:** `start_time` and `end_time` must fall on `:00, :10, :20, :30, :40, :50`.
  - **Minimum duration:** Each window must span **at least 50 minutes** (`end_time - start_time >= 50m`, and `>= 50` real elapsed UTC minutes on any given calendar date).
  - **Non-overlapping with gap:** On the same weekday, sorted windows must satisfy `window[i].end_time < window[i + 1].start_time`.
- **Configurable Buffer (`buffer_minutes`):**
  - Each professional selects a post-session buffer of **`10`, `20`, or `30` minutes** (default `10`).
- **On-the-Fly Slot Generation (`generateAvailableSlots`):**
  - Given a date range `[fromUTC, toUTC]` (4 weeks = 28 days in the requesting user's timezone):
    1. Iterate over each local calendar date in the **professional's IANA timezone** that overlaps the 4-week window (padded by ±1 day in the professional's local zone so cross-midnight timezone shifts never clip valid slots at `[fromUTC, toUTC]` boundaries).
    2. For each availability window on that weekday, step `candidateStart` in **10-minute increments** (`start_time`, `start_time + 10m`, …) in the professional's local zone.
    3. Discard `candidateStart` if it falls into a **DST spring-forward gap** (where Luxon shifts the non-existent wall-clock hour). For a **DST fall-back repeated hour**, Luxon deterministically resolves the earlier offset.
    4. Convert `candidateStart` to UTC (`startUTC`), compute `endUTC = startUTC + 50m`, and `blockedUntilUTC = endUTC + pro.bufferMinutes`.
    5. Verify `endUTC <= windowEndUTC` and ` startUTC >= fromUTC && startUTC <= toUTC` (the 50-minute session must finish within the working window; the buffer may extend past the window).
    6. Verify **2-hour minimum booking notice**: `startUTC >= nowUTC + 2 hours`.
    7. Verify **no professional conflict**: `[startUTC, blockedUntilUTC)` does not overlap `[b.start_at, b.blocked_until)` for any existing `booked` session of that professional (excluding `excludeSessionId` when rescheduling).
    8. Verify **no member conflict**: `[startUTC, endUTC)` does not overlap `[m.start_at, m.end_at)` for any existing `booked` session of the requesting member across all professionals (excluding `excludeSessionId` when rescheduling).
- **Schedule Edits:** Updating working windows or `buffer_minutes` immediately affects future `GET /api/professionals/:id/slots` calls and new candidate slots; existing `booked` rows retain their snapshotted `blocked_until` and remain valid and untouched.

### 1.4 Find a Professional, 4-Week Calendar & Booking Flow
- **Directory (`GET /api/professionals`):** Lists all professionals with `id`, `name`, `specialty`, `bio`, `timezone`, and `bufferMinutes`.
- **Profile & Calendar (`GET /api/professionals/:id` & `GET /api/professionals/:id/slots`):**
  - Returns the professional's public profile and the array of available UTC slots `{ startAt, endAt }` for the next 28 days. Accepts an optional `?excludeSessionId=<uuid>` query parameter (verified to belong to `req.user.id`) so a member opening the reschedule picker can see adjacent 10-minute slots overlapping their own current booking on the same day.
  - **Privacy:** Never returns booked rows or other members' names/IDs.
  - **Two-column UI:**
    - **Left column:** 4-week (28-day) calendar grid in the member's timezone showing available slot counts per day.
    - **Right column:** Available start-time pills for the selected date grouped into **Morning** (`< 12:00`), **Afternoon** (`12:00–16:59`), and **Evening** (`>= 17:00`) in the member's timezone.
- **Confirmation Screen:** Selecting a time opens a confirmation step displaying the professional's name, local date/time in the member's timezone (with the professional's local time shown as secondary context), 50-minute duration, and the 24-hour cancellation/reschedule policy before the member clicks **Confirm Booking**.

### 1.5 No Double-Booking & Concurrency Guarantees
- **Database Exclusion Constraints (`btree_gist`):**
  - `no_professional_overlap`: prevents any two rows with `status = 'booked'` and equal `professional_id` from having overlapping `tstzrange(start_at, blocked_until, '[)')`.
  - `no_member_overlap`: prevents any two rows with `status = 'booked'` and equal `member_id` from having overlapping `tstzrange(start_at, end_at, '[)')`.
- **Booking (`POST /api/sessions`):**
  1. Re-validates on the server that the requested `startAt` is a currently valid generated slot for `professionalId` and `req.user.id` (`>= now + 2h`, inside a working window).
  2. In a single database transaction: inserts the `booking_sessions` row (`status = 'booked'`, snapshotting `blocked_until = end_at + buffer_minutes`) and enqueues due `pg-boss` reminder jobs.
  3. If a concurrent request wins the slot or creates a member overlap, Postgres raises SQLSTATE `23P01`, which the API catches and returns as `409 Conflict` (`{ code: 'SLOT_CONFLICT', message: 'This time slot was just taken or conflicts with another session in your schedule.' }`).

### 1.6 My Sessions (Member & Professional Views)
- **`GET /api/sessions`:**
  - **For a Member (`req.user.role === 'member'`):** Returns the member's own sessions split into **Upcoming** (`end_at > now()` and `status = 'booked'`) and **Past / Inactive** (`end_at <= now()` or `status IN ('cancelled', 'rescheduled')`), including the professional's name and timezone.
  - **For a Professional (`req.user.role === 'professional'`):** Returns the professional's own schedule of **Upcoming** sessions (`status = 'booked'`, ordered by `start_at ASC`) with the **member's name**, plus past/cancelled sessions.

### 1.7 Cancel & Reschedule (24-Hour Rule & Atomic Transaction)
- **Cancellation (`POST /api/sessions/:id/cancel`):**
  - Verifies the session belongs to `req.user.id` (as member or professional) and is currently `status = 'booked'`.
  - **If `req.user.role === 'member'`:** Checks `start_at - now() >= 24 hours`. If `< 24 hours`, rejects with `422 Unprocessable Entity` (`{ code: 'WITHIN_24_HOURS', message: 'Members cannot cancel or reschedule a session within 24 hours of its start time.' }`).
  - **If `req.user.role === 'professional'`:** Allowed at any time (`start_at > now()`).
  - **Transaction (updates existing row, no new row created):** Updates the existing `booking_sessions` row (`status = 'cancelled'`, `cancelled_at = now()`, `cancelled_by = req.user.id`, `updated_at = now()`); cancels pending 24h/1h `pg-boss` jobs for that session; inserts `'session_cancelled'` notifications for both member and professional.
- **Reschedule (`POST /api/sessions/:id/reschedule` — Member only):**
  - Verifies the session belongs to `req.user.id` (`member`), is `status = 'booked'`, and satisfies **`start_at - now() >= 24 hours`** (otherwise rejects with `422 WITHIN_24_HOURS`).
  - Verifies the new `newStartAt` satisfies all slot rules (`>= now() + 2h`, inside the professional's availability windows), **excluding `oldSession.id`** from existing bookings so the member can reschedule by ±10–40 minutes into an adjacent slot on the same day.
  - **Single Atomic Transaction:**
    1. Marks the existing session row `status = 'rescheduled'`, `updated_at = now()` (which immediately releases its GiST exclusion range so adjacent slots on the same day can even be chosen).
    2. Inserts a **new** `booking_sessions` row with `status = 'booked'`, `rescheduled_from_id = oldSession.id`, new `start_at`, `end_at`, and `blocked_until`.
    3. Cancels old pending `pg-boss` reminder jobs and schedules new `pg-boss` reminder jobs (`24h` and `1h`) for the new session ID via a Drizzle transaction adapter (`tx`) — **skipping the 24h reminder if `newStartAt - 24h <= now()`** (for example, when rescheduling into a slot 3–23 hours from now).
    4. Inserts `'session_rescheduled'` notifications for both member and professional referencing **`session_id = newSession.id`** (ensuring chained reschedules `A → B → C` never collide on `UNIQUE (session_id, user_id, kind)`).
  - **Atomicity guarantee:** If step 2 violates `no_professional_overlap` or `no_member_overlap` (`23P01`), the entire transaction (including job mutations) rolls back — the old session remains `status = 'booked'` with its original reminders intact. The member is **never** left with 0 or 2 booked sessions.

### 1.8 Reminders & In-App Notifications
- **Scheduling Rules:**
  - For a booked session starting at `start_at`, two reminder times are computed in UTC:
    - `remind24hAt = start_at - 24 hours` (`kind = 'reminder_24h'`)
    - `remind1hAt  = start_at - 1 hour` (`kind = 'reminder_1h'`)
  - **Skip past reminders:** Any reminder where `remindAt <= now()` at booking/reschedule time is **not scheduled**. (Exception: the seed script may insert near-due jobs to demonstrate live delivery on startup.)
  - For each non-past reminder time, jobs are enqueued in `pg-boss` (using `startAfter: remindAt` and `singletonKey: "${sessionId}:${userId}:${kind}"`) inside the booking/reschedule transaction for both `member_id` and `professional_id`.
- **Exactly-Once Delivery Across Restarts:**
  1. **Persistence:** `pg-boss` stores jobs in PostgreSQL (`pgboss.job`), surviving container/process restarts.
  2. **Send-Time Verification:** When the worker processes a reminder job `{ sessionId, userId, kind }`, it queries `booking_sessions WHERE id = sessionId`. If the row is no longer `status = 'booked'`, the worker exits cleanly without creating a notification.
  3. **Idempotent Insert:** The `notifications` table enforces `UNIQUE (session_id, user_id, kind)`. The worker executes `INSERT INTO notifications ... ON CONFLICT (session_id, user_id, kind) DO NOTHING`. Even if `pg-boss` retries a job after an unclean crash, a duplicate notification can never be created.
- **Why Server-Side Idempotency Is Required (`UNIQUE (session_id, user_id, kind)`):**
  Even though reminders are triggered by the server (`pg-boss` worker) rather than the client, background job queues provide **at-least-once** execution: if the server crashes or restarts *after* inserting the notification row into Postgres but *before* `pg-boss` marks the job completed, `pg-boss` will re-run the job on restart. The `UNIQUE (session_id, user_id, kind)` constraint with `ON CONFLICT DO NOTHING` guarantees the retry is a safe no-op so each reminder is delivered **exactly once, including after a server restart**.
- **In-App Notification UI (Bell Badge + Notification List):**
  The brief specifies: *"Reminders are delivered as in-app notifications (a notification list in the app)."* A badge alone only shows a count without the reminder message, so the navbar includes a **Notification Bell with an unread count badge** that opens a **Notification List panel** displaying the full reminder/cancellation/reschedule messages and timestamps (in the user's timezone) for both members and professionals.
- **Notification Endpoints:**
  - `GET /api/notifications` — Returns notifications for `req.user.id` ordered by `created_at DESC`, plus `unreadCount`.
  - `POST /api/notifications/:id/read` & `POST /api/notifications/read-all` — Marks notification(s) as read.

---

## 2. Tech Stack & Database Schema

### 2.1 Stack & Versions
- **Runtime & Package Manager:** Node.js `>= 22`, `pnpm` `>= 9` workspaces
- **Shared (`packages/shared`):** TypeScript `^5.7`, `zod` `^3.24`, `luxon` `^3.5` (`@types/luxon`)
- **Backend (`apps/api`):** `fastify` `^5.2`, `@fastify/cookie` `^11.0`, `drizzle-orm` `^0.39`, `pg` `^8.13`, `pg-boss` `^10.1`, `argon2` `^0.41`
- **Frontend (`apps/web`):** `next` `^15.2` (App Router), `react` `^19.0`, `@tanstack/react-query` `^5.66`, `tailwindcss` `^4.0`, `lucide-react`
- **Testing:** `vitest` `^3.0` against the Docker Compose PostgreSQL 16 instance (using an isolated `booking_bro_test` database created automatically by the test setup — no heavy `@testcontainers/postgresql` wrapper needed)

### 2.2 PostgreSQL Schema (`apps/api/src/db/schema.ts` + SQL Migration)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE user_role AS ENUM ('member', 'professional');
CREATE TYPE session_status AS ENUM ('booked', 'cancelled', 'rescheduled');
CREATE TYPE notification_kind AS ENUM (
  'reminder_24h',
  'reminder_1h',
  'session_cancelled',
  'session_rescheduled'
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          user_role NOT NULL,
  timezone      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id_hash       TEXT PRIMARY KEY, -- SHA-256 hex of raw 32-byte cookie token
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE professional_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialty      TEXT NOT NULL DEFAULT 'Counsellor & Wellbeing Coach',
  bio            TEXT NOT NULL DEFAULT '',
  buffer_minutes SMALLINT NOT NULL DEFAULT 10 CHECK (buffer_minutes IN (10, 20, 30)),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE availability_windows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- 1=Mon .. 7=Sun
  start_time      TEXT NOT NULL, -- 'HH:mm' on 10-min boundary
  end_time        TEXT NOT NULL, -- 'HH:mm' on 10-min boundary
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE booking_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at            TIMESTAMPTZ NOT NULL,
  end_at              TIMESTAMPTZ NOT NULL,
  blocked_until       TIMESTAMPTZ NOT NULL,
  buffer_minutes      SMALLINT NOT NULL CHECK (buffer_minutes IN (10, 20, 30)),
  status              session_status NOT NULL DEFAULT 'booked',
  rescheduled_from_id UUID REFERENCES booking_sessions(id),
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_duration_50m CHECK (end_at = start_at + interval '50 minutes'),
  CONSTRAINT session_blocked_until_valid CHECK (blocked_until = end_at + (buffer_minutes * interval '1 minute')),
  CONSTRAINT member_not_professional CHECK (member_id <> professional_id)
);

-- Prevent double-booking a professional (includes their post-session buffer)
ALTER TABLE booking_sessions ADD CONSTRAINT no_professional_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(start_at, blocked_until, '[)') WITH &&
  ) WHERE (status = 'booked');

-- Prevent a member from booking overlapping sessions across any professionals
ALTER TABLE booking_sessions ADD CONSTRAINT no_member_overlap
  EXCLUDE USING gist (
    member_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status = 'booked');

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES booking_sessions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        notification_kind NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_session_user_notification UNIQUE (session_id, user_id, kind)
);
```

---

## 3. Commands

```bash
# Install all workspace dependencies
pnpm install

# Run database migrations & seed demo data
pnpm --filter @booking-bro/api db:migrate
pnpm --filter @booking-bro/api db:seed

# Start API (port 3001) and Web (port 3000) in development mode
pnpm dev

# Build all packages and apps
pnpm build

# Run full unit + integration test suite (single documented command required by Brief §3)
pnpm test

# Type-check all workspaces
pnpm typecheck

# Run the entire stack (Postgres + Migrations + Seed + API + Web) in one command
docker compose up --build
```

---

## 4. Project Structure

```text
booking-bro/
├── apps/
│   ├── api/                          → Fastify backend + Drizzle ORM + pg-boss worker
│   │   ├── drizzle/                  → SQL migration files (incl. btree_gist constraints)
│   │   ├── src/
│   │   │   ├── db/                   → schema.ts, client.ts, migrate.ts, seed.ts
│   │   │   ├── plugins/              → auth.ts (cookie session preHandler), error.ts
│   │   │   ├── routes/               → auth.ts, professionals.ts, availability.ts, sessions.ts, notifications.ts
│   │   │   ├── services/             → booking.service.ts, reminder.service.ts
│   │   │   ├── worker/               → boss.ts (pg-boss setup & reminder job handler)
│   │   │   ├── app.ts                → Fastify instance factory (used by server & tests)
│   │   │   └── server.ts             → Entrypoint starting HTTP server + pg-boss worker
│   │   └── tests/                    → Integration & concurrency tests (Vitest + Postgres)
│   └── web/                          → Next.js App Router frontend
│       ├── src/
│       │   ├── app/                  → Routes: /, /login, /signup, /professionals, /professionals/[id], /sessions, /availability
│       │   ├── components/           → Navbar, NotificationBell, CalendarPicker, ConfirmModal, RescheduleModal
│       │   └── lib/                  → api.ts (typed fetch client), query-client.tsx, time.ts
│       └── next.config.ts            → rewrites() proxying /api/:path* to Fastify
├── packages/
│   └── shared/                       → Shared Zod schemas, constants, and pure Luxon domain functions
│       ├── src/
│       │   ├── constants.ts          → SESSION_MINUTES=50, SLOT_STEP_MINUTES=10, MIN_NOTICE_HOURS=2, CANCEL_LOCK_HOURS=24
│       │   ├── schemas.ts            → Zod request/response schemas & inferred TS types
│       │   ├── slots.ts              → Pure slot generator & availability window validator
│       │   ├── rules.ts              → Pure 24h cancellation lock, 2h notice, & reminder timestamp calculator
│       │   └── index.ts
│       └── tests/                    → Pure unit tests (slot math, DST transitions, 24h rule, reminder times)
├── docs/
│   └── intent/booking-bro.md         → Confirmed Statement of Intent
├── docker-compose.yml                → Postgres 16 + API + Web single-command setup
├── AGENTS.md                         → Project context & logging rules
├── DECISIONS.md                      → Technical decisions, trade-offs, & healthcare production notes
├── AI_USAGE.md                       → AI tools, phases, and human overrides
├── SPEC.md                           → This specification
└── README.md                         → Setup, architecture diagram, and test instructions
```

---

## 5. Code Style & Standard Practices

- **Strict TypeScript:** `"strict": true`, `"noUncheckedIndexedAccess": true`, zero `any`.
- **Named exports** everywhere (except Next.js page/layout defaults required by App Router).
- **Pure Core, Imperative Shell & Injectable Clock:** All date/timezone/slot calculations and business rules live as pure, deterministic functions in `packages/shared` accepting an explicit `now: DateTime` parameter so unit tests never depend on wall-clock `Date.now()`. In `apps/api`, routes/services accept an injectable clock (`getNow(): DateTime`, defaulting to `() => DateTime.utc()`) and pass parameterized UTC timestamps (`$now`) to Drizzle SQL queries instead of relying on PostgreSQL wall-clock `now()` in `WHERE` filters.
- **Structured Error Handling:** Custom `AppError(statusCode, code, message)` mapped cleanly by a single Fastify error handler (`23P01` → `409 SLOT_CONFLICT`).

### Example: Pure Slot & Rule Evaluation (`packages/shared/src/rules.ts`)

```typescript
import { DateTime } from 'luxon';
import { CANCEL_LOCK_HOURS, MIN_NOTICE_HOURS, SESSION_MINUTES } from './constants.js';

export function canMemberModifySession(startAtIso: string, nowIso: string): {
  allowed: boolean;
  reason?: string;
} {
  const start = DateTime.fromISO(startAtIso, { zone: 'utc' });
  const now = DateTime.fromISO(nowIso, { zone: 'utc' });
  const hoursUntilStart = start.diff(now, 'hours').hours;

  if (hoursUntilStart < CANCEL_LOCK_HOURS) {
    return {
      allowed: false,
      reason: 'Sessions cannot be cancelled or rescheduled within 24 hours of the start time.',
    };
  }
  return { allowed: true };
}

export function computeReminderSchedule(startAtIso: string, nowIso: string): Array<{
  kind: 'reminder_24h' | 'reminder_1h';
  sendAtIso: string;
}> {
  const start = DateTime.fromISO(startAtIso, { zone: 'utc' });
  const now = DateTime.fromISO(nowIso, { zone: 'utc' });
  const candidates: Array<{ kind: 'reminder_24h' | 'reminder_1h'; sendAt: DateTime }> = [
    { kind: 'reminder_24h', sendAt: start.minus({ hours: 24 }) },
    { kind: 'reminder_1h', sendAt: start.minus({ hours: 1 }) },
  ];

  return candidates
    .filter((c) => c.sendAt > now)
    .map((c) => ({ kind: c.kind, sendAtIso: c.sendAt.toUTC().toISO()! }));
}
```

---

## 6. Testing Strategy (Brief §3)

All tests run with **one command (`pnpm test`)** via Vitest across two suites:

### 6.1 Pure Unit Tests (`packages/shared/tests/`) — Fast, Deterministic
1. **Slot Generation & Window Validation (`slots.test.ts`):**
   - Rejects > 3 windows/day, windows `< 50` minutes, off-grid times (`09:05`), and overlapping or touching windows (`09:00–12:00` + `12:00–15:00`).
   - Generates 10-minute step slots (`09:00, 09:10, …`) inside up to 3 windows where `start + 50m <= windowEnd`.
   - Enforces configurable buffer (`10`, `20`, `30` mins) in **both directions**: an existing booking at `10:00–10:50` with a `10m` buffer (`blocked_until = 11:00`) blocks candidate slots from `09:10` through `10:50`, leaving `09:00` and `11:00` available.
   - **Buffer snapshot immutability on config change:** When a professional updates `buffer_minutes` (`30m → 10m` or `10m → 30m`), existing bookings retain their snapshotted `b.blocked_until` while new candidate slots before/after use the updated `pro.bufferMinutes`.
   - Filters out slots overlapping any of the requesting member's own existing bookings (while allowing `excludeSessionId` self-exclusion when rescheduling).
   - Enforces the **2-hour minimum booking notice** (`start_at >= now + 2h`).
2. **Timezones & Daylight Saving Time (`timezones.test.ts`):**
   - Cross-timezone conversion: `Europe/London` professional (`09:00–12:00`) viewed by an `Asia/Singapore` member across the October/March DST transition shifts from `16:00 SGT` (`UTC+1`) to `17:00 SGT` (`UTC+0`).
   - **Cross-midnight date & ISO weekday shift:** Professional in `America/Los_Angeles` (`UTC-8`) working Sunday evening (`weekday = 7`) generates slots that appear on Monday morning (`weekday = 1`) for an `Asia/Singapore` (`UTC+8`) member without clipping at `[fromUTC, toUTC]` boundaries.
   - Half-hour / 45-minute offset zones (`Asia/Kolkata` `UTC+5:30`, `Asia/Kathmandu` `UTC+5:45`).
   - DST **Spring Forward** gap (`America/New_York` missing `02:00–02:59` hour): non-existent local start times are skipped, sessions spanning the gap require 50 real UTC minutes, and a window like `01:30–03:00` on spring-forward Sunday (only 30 real elapsed UTC minutes) is rejected as `< 50m`.
   - DST **Fall Back** repeated hour: resolves deterministically without duplicate UTC instants.
3. **24-Hour Rule & Reminder Scheduling (`rules.test.ts`):**
   - Member cancel/reschedule allowed at `>= 24h` (`24h 00m 00s`), blocked at `23h 59m 59s`.
   - Reminder calculator creates both `24h` and `1h` reminders when booked `> 24h` ahead, only `1h` when booked `2h–24h` ahead, and none if `< 1h`.

### 6.2 Database & API Integration Tests (`apps/api/tests/`) — Real PostgreSQL
- **Test-Isolation & `pg-boss` Infrastructure Rules (`booking_bro_test`):**
  - **Sequential file execution (`fileParallelism: false`):** Vitest runs API integration files sequentially and truncates application tables + `pgboss.job` (`TRUNCATE TABLE ... RESTART IDENTITY CASCADE`) between tests so parallel workers never wipe each other's rows.
  - **Injectable clock & parameterized SQL timestamps:** Tests control `getNow()` on the Fastify instance and bind parameterized UTC timestamps in Drizzle queries instead of raw SQL `now()`, eliminating clock skew between Node and the Postgres container.
  - **Transactional `pg-boss` adapter & direct job invocation:** `pg-boss` jobs are enqueued/cancelled through a Drizzle transaction adapter (`tx`) so failed reschedules roll back job mutations atomically, and `processReminderJob(job)` is invoked directly in tests for deterministic verification without polling sleeps.

1. **Concurrent Double-Booking & Buffer Asymmetry (`concurrency.test.ts`):**
   - Two members fire `POST /api/sessions` for the exact same professional and slot simultaneously via `Promise.allSettled`: **exactly one returns `201 Created` and the other returns `409 Conflict`**.
   - Two members book slots that overlap via the professional's buffer (`10:00` and `10:50` when buffer is `10m`): second fails with `409 Conflict`.
   - Same member attempts to book overlapping slots with **two different professionals**: second fails with `409 Conflict` (`no_member_overlap`).
   - **Member vs. Professional buffer asymmetry:** A member booked `10:00–10:50` with Professional A (`buffer = 30m`, `blocked_until = 11:20`) **can** book `10:50–11:40` back-to-back with Professional B (`[start_at, end_at)` half-open boundary), while Professional A remains blocked until `11:20`.
2. **Cancel, Atomic Reschedule, Schedule Edits & State Transitions (`sessions.test.ts`):**
   - Member blocked from cancelling or rescheduling within 24 hours (`422`), while professional can cancel anytime (`200`) for future sessions (`start_at > now()`) and is rejected (`422`) for past sessions (`start_at <= now()`).
   - Rescheduling to a free slot marks old session `'rescheduled'` and creates new `'booked'` session in one transaction.
   - **Adjacent same-day reschedule (`+10m`):** Rescheduling an existing `10:00` session to `10:10` on the same day succeeds (`200`) via `excludeSessionId` self-exclusion.
   - **Chained reschedules (`A → B → C`) + cancel (`C`):** Rescheduling twice in sequence and then cancelling succeeds without `notifications` unique constraint collision (`session_id = newSession.id`).
   - Rescheduling to a taken slot rolls back completely — original session remains `'booked'` and original `pg-boss` reminder jobs remain intact (never 0 or 2 sessions).
   - Professional changing working hours or `buffer_minutes` updates unbooked slots immediately while keeping existing `'booked'` sessions and their snapshotted `blocked_until` intact.
   - **Invalid state transitions & off-grid inputs:** Cancelling or rescheduling an already `'cancelled'` or `'rescheduled'` session returns `409`/`422`; booking `< now() + 2h` or off-grid (`09:05`) returns `422`.
3. **Reminders, Auth Lifecycle & Role-Based Access Control (`reminders-and-auth.test.ts`):**
   - Delivering a reminder job inserts into `notifications` once; running the same job payload a second time is a no-op (`UNIQUE (session_id, user_id, kind)` + `ON CONFLICT DO NOTHING`).
   - Delivering a reminder job for a session that was later cancelled or rescheduled produces no notification.
   - **Auth session expiry & signup validation:** Accessing `/api/auth/me` with an expired `auth_sessions` row (`expires_at <= now()`) deletes the row, clears the `sid` cookie, and returns `401`; case-insensitive duplicate email signup (`409`) and invalid IANA timezone (`400`) are rejected.
   - **RBAC & Calendar Privacy:** Unauthenticated requests return `401`; a `professional` calling `POST /api/sessions` or `POST /api/sessions/:id/reschedule` returns `403`; a `member` calling `PUT /api/availability` returns `403`; Member A cannot cancel, reschedule, view, or mark-read Member B's session/notification (`403`/`404`); `GET /api/professionals/:id/slots` returns strictly `{ startAt, endAt }[]` with zero booked-session or other-member metadata; client-sent `userId` in request body is ignored in favour of `req.user.id`.

---

## 7. Boundaries

- **Always do:**
  - Validate every API request body, query, and param with shared Zod schemas.
  - Resolve user identity from `req.user` (`HttpOnly` cookie session) on the server.
  - Run `pnpm typecheck` and `pnpm test` before committing implementation slices.
  - Log every prompt turn to `log.txt` and keep `DECISIONS.md` / `AI_USAGE.md` updated.
- **Ask first:**
  - Changing any database table structure or constraint defined in §2.2.
  - Adding external runtime dependencies not listed in §2.1.
- **Never do:**
  - Trust a `userId` or `role` sent in a request body/query for authorization.
  - Commit secrets, `.env` files, or real personal/health data.
  - Skip or weaken a failing test to make the test suite pass.

---

## 8. Success Criteria

1. All 10 must-have features in Brief §2 + the 2 chosen extras (`2-hour minimum booking notice` and `docker compose up` with seeded data) work end-to-end in the browser.
2. `pnpm test` passes 100% of unit and real-Postgres integration/concurrency tests in one command.
3. `docker compose up --build` starts Postgres, runs migrations, seeds demo members/professionals/sessions/reminders, and serves the app at `http://localhost:3000`.
4. `README.md`, `DECISIONS.md`, `AI_USAGE.md`, `SPEC.md`, and `log.txt` are complete, accurate, and human-readable.

---

## 9. Review Sign-Off & Resolutions

1. **Test database runner:** Use the Docker Compose PostgreSQL instance directly with an isolated `booking_bro_test` database (zero extra Testcontainers overhead, runs in < 1 second).
2. **Capability map & schema:** Confirmed with atomic reschedule, member schedule conflict filtering in slot generation, and 10/20/30-minute buffer choices across up to 3 daily windows.
3. **Quality contract:** Governed by [CONSTRAINTS.md](CONSTRAINTS.md). Phase 1 is formally approved.
