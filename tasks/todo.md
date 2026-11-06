# Task Breakdown (`tasks/todo.md`)

> **Plan Document:** [tasks/plan.md](plan.md)  
> **Governing Spec & Quality Bar:** [SPEC.md](../SPEC.md) · [CONSTRAINTS.md](../CONSTRAINTS.md)

---

## Phase 1: Workspace Foundation & Shared Pure Domain (`packages/shared`)

## Task 1: Monorepo Workspace, TypeScript/Lint Config & Docker Postgres Setup

**Description:** Initialize the `pnpm` workspaces monorepo root (`packages/shared`, `apps/api`, `apps/web`), strict shared TypeScript configuration (`strict: true`, `noUncheckedIndexedAccess: true`), root ESLint/test scripts, `.env.example`, and the PostgreSQL 16 service in `docker-compose.yml` (provisioning both `booking_bro` and `booking_bro_test` databases with `btree_gist`).

**Acceptance criteria:**
- [x] `pnpm-workspace.yaml` and root `package.json` define `dev`, `build`, `test`, `typecheck`, and `lint` scripts across workspaces.
- [x] `tsconfig.base.json` enforces `"strict": true` and `"noUncheckedIndexedAccess": true` with zero `any`.
- [x] `docker-compose.yml` defines PostgreSQL 16 with an init script creating `booking_bro` and `booking_bro_test` with `CREATE EXTENSION IF NOT EXISTS btree_gist;`.

**Verification:**
- [x] Tests pass: `pnpm --filter @booking-bro/shared test` (workspace runner resolves cleanly)
- [x] Build succeeds: `pnpm typecheck`
- [x] Manual check: Verify `docker compose up -d postgres` starts healthy and both `booking_bro` and `booking_bro_test` databases exist.

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `.env.example`
- `docker-compose.yml`

**Estimated scope:** Medium: 3-5 files

---

## Task 2: Shared Constants, Zod Schemas & Pure 24h/Reminder Rules (`packages/shared`)

**Description:** Create `@booking-bro/shared` with domain constants (`SESSION_MINUTES = 50`, `SLOT_STEP_MINUTES = 10`, `MIN_NOTICE_HOURS = 2`, `CANCEL_LOCK_HOURS = 24`, `ALLOWED_BUFFERS = [10, 20, 30]`), shared Zod request/response schemas (including IANA timezone validation via Luxon `IANAZone.isValidZone` and `09:00` 10-minute grid validation), and pure functions in `rules.ts` (`canMemberModifySession`, `computeReminderSchedule`, `meetsMinimumNotice`) with unit tests in `rules.test.ts`.

**Acceptance criteria:**
- [x] Zod schemas validate signup/login payloads (rejecting invalid IANA timezones like `'Mars/Phobos'`), availability windows (`1..3` per weekday, 10-min grid), and booking/reschedule payloads.
- [x] `canMemberModifySession(startAtIso, nowIso)` returns `allowed: true` at `>= 24h 00m 00s` and `allowed: false` at `23h 59m 59s`.
- [x] `computeReminderSchedule(startAtIso, nowIso)` returns both `24h` and `1h` reminders when `> 24h` away, only `1h` when `2h–24h` away, and `[]` when `< 1h` away.

**Verification:**
- [x] Tests pass: `pnpm --filter @booking-bro/shared test tests/rules.test.ts`
- [x] Build succeeds: `pnpm --filter @booking-bro/shared typecheck`
- [x] Manual check: Confirm zero wall-clock `Date.now()` calls inside `packages/shared/src/rules.ts`.

**Dependencies:** Task 1

**Files likely touched:**
- `packages/shared/package.json`
- `packages/shared/src/constants.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/rules.ts`
- `packages/shared/tests/rules.test.ts`

**Estimated scope:** Medium: 3-5 files

---

## Task 3: Pure On-the-Fly Slot Generator, Window Validator & Timezone/DST Unit Tests (`packages/shared`)

**Description:** Implement `validateAvailabilityWindows` and `generateAvailableSlots` in `packages/shared/src/slots.ts` using Luxon, handling up to 3 windows/weekday (`>= 50` real elapsed UTC minutes, non-overlapping with gap `prev.end < next.start`), 10-minute step increments, ±1 day boundary padding for cross-midnight timezone shifts, DST spring-forward/fall-back transitions, bidirectional `10`/`20`/`30m` buffer blocking, member self-overlap filtering, and `excludeSessionId` exclusion for rescheduling. Write comprehensive unit tests in `slots.test.ts` and `timezones.test.ts`.

**Acceptance criteria:**
- [x] `validateAvailabilityWindows` rejects > 3 windows/weekday, off-grid times (`09:05`), touching/overlapping windows (`09:00–12:00` + `12:00–15:00`), and windows `< 50` real UTC minutes (including DST spring-forward short windows like `01:30–03:00`).
- [x] `generateAvailableSlots` enforces 2h minimum notice, bidirectional buffer blocking, buffer config change snapshot immutability (`30m -> 10m` and `10m -> 30m` around an existing booking), member self-overlap filtering, and `excludeSessionId` exclusion.
- [x] `timezones.test.ts` passes cross-zone (`Europe/London` ↔ `Asia/Singapore` across BST/GMT), cross-midnight weekday shifts (`America/Los_Angeles` Sunday evening → `Asia/Singapore` Monday morning), `UTC+5:30`/`UTC+5:45` offsets, and DST spring-forward/fall-back tests.

**Verification:**
- [x] Tests pass: `pnpm --filter @booking-bro/shared test`
- [x] Build succeeds: `pnpm --filter @booking-bro/shared build && pnpm typecheck`
- [x] Manual check: Run `pnpm --filter @booking-bro/shared test --coverage` and verify `>= 80%` line coverage in `packages/shared`.

**Dependencies:** Task 2

**Files likely touched:**
- `packages/shared/src/slots.ts`
- `packages/shared/src/index.ts`
- `packages/shared/tests/slots.test.ts`
- `packages/shared/tests/timezones.test.ts`

**Estimated scope:** Medium: 3-5 files

---

## Checkpoint 1: After Tasks 1–3 (Shared Domain Foundation)
- [x] All unit tests in `packages/shared` pass (`pnpm --filter @booking-bro/shared test`)
- [x] Coverage in `packages/shared` is `>= 80%` (`CONSTRAINTS.md`)
- [x] `pnpm typecheck` passes with zero errors

---

## Phase 2: Database Schema, Authentication & Availability API (`apps/api`)

## Task 4: Drizzle ORM Schema, PostgreSQL `btree_gist` Migration & DB Client

**Description:** Set up `apps/api` with Drizzle ORM (`schema.ts`), database connection pool (`client.ts`), and programmatic SQL migration runner (`migrate.ts`) executing `drizzle/0000_init.sql` (including `CREATE EXTENSION IF NOT EXISTS btree_gist`, all 6 tables: `users`, `auth_sessions`, `professional_profiles`, `availability_windows`, `booking_sessions` with `updated_at` and partial GiST exclusion constraints `no_professional_overlap` and `no_member_overlap`, and `notifications` with `UNIQUE (session_id, user_id, kind)`).

**Acceptance criteria:**
- [x] `drizzle/0000_init.sql` and `src/db/schema.ts` match `SPEC.md` §2.2 exactly, including case-insensitive email handling and both partial GiST exclusion constraints (`WHERE status = 'booked'`).
- [x] `pnpm --filter @booking-bro/api db:migrate` applies cleanly and idempotently against `booking_bro` and `booking_bro_test`.
- [x] Database client exports typed Drizzle instance and raw `pg.Pool` for `pg-boss` and transactional queries.

**Verification:**
- [x] Tests pass: `pnpm --filter @booking-bro/api db:migrate`
- [x] Build succeeds: `pnpm --filter @booking-bro/api typecheck`
- [x] Manual check: Inspect `\d booking_sessions` and `\d notifications` in Postgres to confirm `no_professional_overlap`, `no_member_overlap`, and `notifications_session_id_user_id_kind_key` constraints exist.

**Dependencies:** Task 1, Task 3

**Files likely touched:**
- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/client.ts`
- `apps/api/src/db/migrate.ts`
- `apps/api/drizzle/0000_init.sql`

**Estimated scope:** Medium: 5 files

---

## Task 5: Fastify App Factory, Injectable Clock, Cookie Session Auth & Auth Routes

**Description:** Build the Fastify application factory (`app.ts`) with an injectable clock (`app.getNow()`, defaulting to `() => DateTime.utc()`), centralized `AppError` / Postgres `23P01` error handler (`plugins/error.ts`), `HttpOnly` cookie session `preHandler` (`plugins/auth.ts`), and auth routes (`routes/auth.ts`: `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/users/me/timezone`) using `argon2id` and parameterized UTC SQL timestamps.

**Acceptance criteria:**
- [x] `POST /api/auth/signup` hashes passwords with `argon2id`, normalizes email to lowercase (returning `409` on case-insensitive duplicate), seeds default profile + Mon–Fri windows for `professional` signups, and sets a 7-day `HttpOnly; SameSite=Lax` `sid` cookie.
- [x] `plugins/auth.ts` resolves `req.user` strictly from `auth_sessions` using parameterized `app.getNow()`; if `expires_at <= now`, it deletes the expired row, clears the `sid` cookie, and returns `401 Unauthorized`.
- [x] `PATCH /api/users/me/timezone` validates the new IANA timezone and updates `users.timezone` and `users.updated_at`.

**Verification:**
- [x] Tests pass: `pnpm --filter @booking-bro/api typecheck`
- [x] Build succeeds: `pnpm --filter @booking-bro/api build`
- [x] Manual check: Verify `plugins/error.ts` maps Postgres `23P01` to `409 SLOT_CONFLICT` and Zod errors to `400 VALIDATION_ERROR`.

**Dependencies:** Task 4

**Files likely touched:**
- `apps/api/src/plugins/error.ts`
- `apps/api/src/plugins/auth.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/app.ts`

**Estimated scope:** Medium: 4 files

---

## Task 6: Professional Directory, Availability Editor & On-the-Fly Slots Routes

**Description:** Implement `routes/professionals.ts` (`GET /api/professionals`, `GET /api/professionals/:id`, `GET /api/professionals/:id/slots` with optional `?excludeSessionId=<uuid>`) and `routes/availability.ts` (`GET /api/availability/me`, `PUT /api/availability` restricted to `role === 'professional'`). Create the integration test setup helper (`apps/api/tests/setup.ts`) that runs migrations and truncates tables between tests.

**Acceptance criteria:**
- [x] `PUT /api/availability` rejects `member` callers with `403`, validates `bufferMinutes` (`10|20|30`) and up to 3 windows/weekday (`>= 50m` real UTC duration, 10m grid, non-overlapping with gap), and atomically replaces the professional's windows.
- [x] `GET /api/professionals/:id/slots` computes 28 days of free slots on the fly using `generateAvailableSlots`, filtering out the requesting member's own booked sessions across all professionals and honoring `?excludeSessionId=<uuid>`.
- [x] `GET /api/professionals/:id/slots` returns strictly `{ professional, slots: [{ startAt, endAt }] }` with zero booked-session or other-member metadata.

**Verification:**
- [x] Tests pass: `pnpm --filter @booking-bro/api typecheck`
- [x] Build succeeds: `pnpm --filter @booking-bro/api build`
- [x] Manual check: Confirm schedule edits never mutate existing rows in `booking_sessions`.

**Dependencies:** Task 5

**Files likely touched:**
- `apps/api/src/routes/professionals.ts`
- `apps/api/src/routes/availability.ts`
- `apps/api/tests/setup.ts`

**Estimated scope:** Medium: 3 files

---

## Checkpoint 2: After Tasks 4–6 (Database, Auth & Availability API)
- [x] Migrations run cleanly on `booking_bro` and `booking_bro_test`
- [x] `pnpm --filter @booking-bro/api typecheck` and `pnpm --filter @booking-bro/api build` succeed with zero errors

---

## Phase 3: Booking Engine, Reminders & Real-Postgres Integration Suite (`apps/api`)

## Task 7: Transactional `pg-boss` Reminder Worker & Notifications Routes

**Description:** Implement `worker/boss.ts` (`pg-boss` lifecycle + `processReminderJob` handler), `services/reminder.service.ts` (scheduling/cancelling `reminder_24h` and `reminder_1h` jobs via a Drizzle transaction `db` adapter `{ executeSql }` so job inserts/cancellations participate in the caller's DB transaction `tx`), and `routes/notifications.ts` (`GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`).

**Acceptance criteria:**
- [ ] `scheduleSessionReminders(tx, boss, session, now)` skips any reminder with `sendAt <= now` and enqueues non-past `24h`/`1h` jobs for both member and professional using `singletonKey: "${sessionId}:${userId}:${kind}"` on the `tx` connection.
- [ ] `processReminderJob(job)` re-queries `booking_sessions` at send time (exiting cleanly if `status !== 'booked'`) and executes `INSERT INTO notifications ... ON CONFLICT (session_id, user_id, kind) DO NOTHING`.
- [ ] `POST /api/notifications/:id/read` enforces ownership (`user_id = req.user.id`, returning `404` if another user attempts to mark it read).

**Verification:**
- [ ] Tests pass: `pnpm --filter @booking-bro/api typecheck`
- [ ] Build succeeds: `pnpm --filter @booking-bro/api build`
- [ ] Manual check: Confirm `processReminderJob` is exported as a standalone function so integration tests can invoke it directly without polling sleeps.

**Dependencies:** Task 6

**Files likely touched:**
- `apps/api/src/worker/boss.ts`
- `apps/api/src/services/reminder.service.ts`
- `apps/api/src/routes/notifications.ts`

**Estimated scope:** Medium: 3 files

---

## Task 8: Booking Creation, 24h Cancel & Atomic Reschedule Service and Routes

**Description:** Implement `services/booking.service.ts` and `routes/sessions.ts` (`POST /api/sessions`, `GET /api/sessions`, `POST /api/sessions/:id/cancel`, `POST /api/sessions/:id/reschedule`), plus `src/server.ts` entrypoint. Enforce RBAC (`member`-only booking/rescheduling, participant-only cancel), 2h minimum notice, 24h member lock vs anytime professional cancel (for future sessions `start_at > now`), in-place row update on cancel, and single-transaction atomic reschedule (`status = 'rescheduled'` on old row + new `'booked'` row + transactional `pg-boss` update + `'session_rescheduled'` notifications referencing `session_id = newSession.id`).

**Acceptance criteria:**
- [ ] `POST /api/sessions` rejects `professional` callers (`403`), validates `startAt` against generated slots (`422` if off-grid/`< 2h`/outside window), inserts the `booking_sessions` row with snapshotted `blocked_until` + `pg-boss` reminders in one transaction, and maps `23P01` to `409 SLOT_CONFLICT`.
- [ ] `POST /api/sessions/:id/cancel` blocks members within 24 hours (`422 WITHIN_24_HOURS`), allows professionals anytime before `start_at` (`422` if `start_at <= now`), rejects already `'cancelled'`/`'rescheduled'` rows (`409`), updates the existing row in place (`updated_at = now`), cancels pending reminders, and creates `'session_cancelled'` notifications.
- [ ] `POST /api/sessions/:id/reschedule` excludes `oldSession.id` during slot validation (allowing same-day `+10m` shifts), atomically marks old row `'rescheduled'`, inserts new `'booked'` row, schedules non-past reminders on `tx`, attaches `'session_rescheduled'` notifications to `newSession.id`, and rolls back completely if the target slot conflicts (`23P01`).

**Verification:**
- [ ] Tests pass: `pnpm --filter @booking-bro/api typecheck`
- [ ] Build succeeds: `pnpm --filter @booking-bro/api build`
- [ ] Manual check: Verify `GET /api/sessions` returns upcoming and past/inactive sessions with `professionalName` for members and `memberName` for professionals.

**Dependencies:** Task 7

**Files likely touched:**
- `apps/api/src/services/booking.service.ts`
- `apps/api/src/routes/sessions.ts`
- `apps/api/src/server.ts`

**Estimated scope:** Medium: 3 files

---

## Task 9: Real-PostgreSQL Concurrency, Session Lifecycle & Reminder/RBAC Integration Tests

**Description:** Configure `apps/api/vitest.config.ts` with `fileParallelism: false` for deterministic isolation on `booking_bro_test` and implement the 3 real-PostgreSQL integration test suites specified in `SPEC.md` §6.2: `concurrency.test.ts`, `sessions.test.ts`, and `reminders-and-auth.test.ts`.

**Acceptance criteria:**
- [ ] `concurrency.test.ts` proves: (1) simultaneous same-slot booking returns one `201` + one `409`, (2) buffer-overlap booking returns `409`, (3) same-member cross-professional overlap returns `409`, and (4) member vs. professional buffer asymmetry allows a member booked `10:00–10:50` with Pro A (`buffer = 30m`) to book `10:50–11:40` back-to-back with Pro B while Pro A remains blocked until `11:20`.
- [ ] `sessions.test.ts` proves: 24h member lock (`422`) vs pro cancel (`200` future / `422` past), atomic reschedule rollback on conflict, adjacent same-day `+10m` reschedule (`200`), chained reschedules `A → B → C` + cancel `C` without notification unique constraint collision, schedule/buffer edits preserving existing bookings, and invalid state transition rejection (`409`/`422`).
- [ ] `reminders-and-auth.test.ts` proves: idempotent reminder delivery (`ON CONFLICT DO NOTHING`), cancelled/rescheduled reminder suppression, expired `auth_sessions` cleanup (`401`), case-insensitive duplicate email (`409`), invalid timezone (`400`), cross-role `403` RBAC checks, actor spoofing protection, and calendar privacy (`{ startAt, endAt }[]` only).

**Verification:**
- [ ] Tests pass: `pnpm test` (runs both `@booking-bro/shared` unit tests and `@booking-bro/api` Postgres integration tests in one command)
- [ ] Build succeeds: `pnpm typecheck`
- [ ] Manual check: Verify `pnpm test` completes in `< 30s` with 0 skipped tests.

**Dependencies:** Task 8

**Files likely touched:**
- `apps/api/vitest.config.ts`
- `apps/api/tests/concurrency.test.ts`
- `apps/api/tests/sessions.test.ts`
- `apps/api/tests/reminders-and-auth.test.ts`

**Estimated scope:** Medium: 4 files

---

## Checkpoint 3: After Tasks 7–9 (Complete Backend & Real-Postgres Test Suite)
- [ ] `pnpm test` passes 100% of unit and real-Postgres integration/concurrency tests in a single command
- [ ] `pnpm typecheck` passes across `packages/shared` and `apps/api`
- [ ] Review test output against `CONSTRAINTS.md` before building UI

---

## Phase 4: Next.js Web Application, Docker Seed & Documentation (`apps/web` + Root)

## Task 10: Next.js App Router Scaffold, `/api` Proxy, Typed Fetch Client & Layout Shell

**Description:** Scaffold `apps/web` (Next.js App Router, TypeScript, Tailwind CSS, TanStack Query v5, Lucide icons), configure `next.config.ts` with `rewrites()` proxying `/api/:path*` to Fastify (`API_INTERNAL_URL || 'http://localhost:3001'`), implement the typed API client (`lib/api.ts`), Luxon display helpers (`lib/time.ts`), TanStack Query provider (`lib/query-client.tsx`), and top `Navbar.tsx` (displaying user role badge, active IANA timezone switcher, navigation links, and logout).

**Acceptance criteria:**
- [ ] `next.config.ts` proxies `/api/:path*` so browser requests and `HttpOnly` cookies stay same-origin on `http://localhost:3000`.
- [ ] `lib/api.ts` provides typed helper methods for auth, professionals, slots, sessions, availability, and notifications, surfacing structured API error messages (`code`, `message`).
- [ ] `Navbar.tsx` allows switching the user's IANA timezone via `PATCH /api/users/me/timezone` and immediately invalidates slot/session queries.

**Verification:**
- [ ] Tests pass: `pnpm --filter @booking-bro/web typecheck`
- [ ] Build succeeds: `pnpm --filter @booking-bro/web build`
- [ ] Manual check: Verify `Navbar` renders role-appropriate links (`Find a Professional` + `My Sessions` for members; `My Schedule` + `Availability` for professionals).

**Dependencies:** Task 8

**Files likely touched:**
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/time.ts`
- `apps/web/src/components/Navbar.tsx`

**Estimated scope:** Medium: 5 files

---

## Task 11: Login, Signup (with IANA Timezone Picker) & `NotificationBell` Drawer

**Description:** Implement `/login` (including 1-click demo account fill buttons for fast reviewer testing), `/signup` (role selector `member` vs `professional`, specialty/bio fields for professionals, and IANA timezone selector auto-detected via `Intl.DateTimeFormat().resolvedOptions().timeZone`), root `app/layout.tsx`, and `NotificationBell.tsx` (polling `/api/notifications` every 15s via TanStack Query, showing unread count badge, and opening a dropdown list with reminder/cancel/reschedule badges and mark-as-read actions).

**Acceptance criteria:**
- [ ] Users can sign up as `member` or `professional` with an auto-detected or manually chosen IANA timezone, log in, and log out.
- [ ] `NotificationBell` polls `/api/notifications` when authenticated, displays the unread badge count, and lets users mark individual or all notifications as read with instant cache invalidation.
- [ ] Unauthenticated visitors attempting protected actions are cleanly guided to `/login`.

**Verification:**
- [ ] Tests pass: `pnpm --filter @booking-bro/web typecheck`
- [ ] Build succeeds: `pnpm --filter @booking-bro/web build`
- [ ] Manual check: Sign up, log in, and open the notification bell panel in the browser.

**Dependencies:** Task 10

**Files likely touched:**
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/signup/page.tsx`
- `apps/web/src/components/NotificationBell.tsx`

**Estimated scope:** Medium: 4 files

---

## Task 12: Professional Directory, Two-Column 4-Week Calendar & Booking Confirmation Flow

**Description:** Build `/professionals` (directory cards showing name, specialty, bio, timezone, and buffer) and `/professionals/[id]` featuring the **two-column 4-week calendar layout** (`CalendarPicker.tsx`: left column 28-day grid with available slot counts per day in the member's timezone; right column Morning/Afternoon/Evening 10-minute start-time pills for the selected date) and `ConfirmModal.tsx` (displaying professional name, local date/time in member's timezone + professional's local time, 50-minute duration, and 24-hour cancellation policy before calling `POST /api/sessions`).

**Acceptance criteria:**
- [ ] Selecting a professional renders a 28-day calendar in the member's timezone where dates with 0 free slots are disabled and dates with slots show Morning/Afternoon/Evening time pills on click.
- [ ] Clicking a time pill opens the confirmation modal showing all required session details; confirming creates the booking (`POST /api/sessions`) and redirects/updates `My Sessions`.
- [ ] If a slot was just taken (`409 SLOT_CONFLICT`), the modal displays a clear conflict alert and refreshes available slots automatically.

**Verification:**
- [ ] Tests pass: `pnpm --filter @booking-bro/web typecheck`
- [ ] Build succeeds: `pnpm --filter @booking-bro/web build`
- [ ] Manual check: Book a 50-minute session as a member and verify the slot + buffer window immediately disappears from the professional's calendar.

**Dependencies:** Task 11

**Files likely touched:**
- `apps/web/src/app/professionals/page.tsx`
- `apps/web/src/app/professionals/[id]/page.tsx`
- `apps/web/src/components/CalendarPicker.tsx`
- `apps/web/src/components/ConfirmModal.tsx`

**Estimated scope:** Medium: 4 files

---

## Task 13: My Sessions View (Cancel & Reschedule Modal) & Professional Availability Editor

**Description:** Build `/sessions` (unified role-aware view: for members, Upcoming vs Past/Cancelled/Rescheduled sessions with **Cancel** and **Reschedule** buttons disabled + tooltipped when `< 24h` away; for professionals, Upcoming schedule showing **member names** and anytime **Cancel** button), `RescheduleModal.tsx` (reusing `CalendarPicker` with `?excludeSessionId=<id>` to execute atomic `POST /api/sessions/:id/reschedule`), `/availability` (professional editor for `10`/`20`/`30m` buffer and up to 3 windows/weekday with live validation), and `/` landing page.

**Acceptance criteria:**
- [ ] In `/sessions`, members can cancel or reschedule sessions `>= 24h` away (including rescheduling by +10 minutes on the same day via `RescheduleModal`), and see a clear disabled lock badge on sessions `< 24h` away; professionals see upcoming sessions with member names and can cancel anytime.
- [ ] In `/availability`, professionals can configure `10`, `20`, or `30` minute buffers and up to 3 windows (`>= 50m`, 10-min grid) per weekday, with clear inline error messages if windows overlap, touch, or are `< 50m`.
- [ ] Saving availability immediately updates unbooked slots on `/professionals/[id]` while leaving existing booked sessions in `/sessions` untouched.

**Verification:**
- [ ] Tests pass: `pnpm --filter @booking-bro/web typecheck`
- [ ] Build succeeds: `pnpm --filter @booking-bro/web build`
- [ ] Manual check: Test member reschedule (`>= 24h`), member `< 24h` lock state, professional cancel, and professional availability edit in the browser.

**Dependencies:** Task 12

**Files likely touched:**
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/sessions/page.tsx`
- `apps/web/src/components/RescheduleModal.tsx`
- `apps/web/src/app/availability/page.tsx`

**Estimated scope:** Medium: 4 files

---

## Task 14: Demo Seed Script, Full-Stack `docker compose up` & Final Documentation

**Description:** Implement `apps/api/src/db/seed.ts` (seeding synthetic demo professionals in `Asia/Singapore` and `Europe/London`, demo members in `Asia/Singapore` and `America/New_York`, upcoming sessions `> 24h` and `< 24h` away, and a near-due `pg-boss` reminder job that fires within ~10 seconds of startup so reviewers immediately see live in-app reminder delivery), add `api` and `web` Dockerfiles/`docker-compose.yml` services, complete the remaining sections of `DECISIONS.md` (limitations, next steps, healthcare production readiness), and write `README.md` with architecture diagram and 1–2 command setup/test instructions.

**Acceptance criteria:**
- [ ] `pnpm --filter @booking-bro/api db:seed` populates synthetic demo accounts, availability windows, sessions (`> 24h` and `< 24h`), and a near-due reminder job idempotently.
- [ ] `docker compose up --build` starts Postgres, runs migrations + seed, starts the Fastify API + `pg-boss` worker, and serves the Next.js web app at `http://localhost:3000`.
- [ ] `DECISIONS.md` (all 5 required questions from Brief §3), `AI_USAGE.md`, `README.md`, and `log.txt` are complete and accurate.

**Verification:**
- [ ] Tests pass: `pnpm test`
- [ ] Build succeeds: `pnpm typecheck && pnpm lint && pnpm build`
- [ ] Manual check: Run `docker compose up --build` and verify login, booking, reschedule, cancel, and live reminder notification delivery in the browser.

**Dependencies:** Task 9, Task 13

**Files likely touched:**
- `apps/api/src/db/seed.ts`
- `docker-compose.yml`
- `DECISIONS.md`
- `README.md`
- `AI_USAGE.md`

**Estimated scope:** Medium: 5 files

---

## Checkpoint 4: After Tasks 10–14 (Full-Stack Verification & Submission Gate)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors)
- [ ] `pnpm test` passes 100% of unit + real-Postgres integration & concurrency suites
- [ ] `pnpm build` succeeds across all workspaces
- [ ] `CONSTRAINTS.md` floor check passes (0 `@ts-ignore`, 0 `eslint-disable`, 0 `.skip`/`.only`, 0 `TODO` stubs, 0 secrets)
- [ ] Review with human before final submission
