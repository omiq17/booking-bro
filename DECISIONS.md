# Decisions

A living record of key technical decisions. Each entry: what I chose, why, and what I traded off.
Sections marked *Provisional* may change during the build.

## 1. Tech stack

| Area     | Choice                                | Why                                                                                  |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| Language | TypeScript (Node.js) end to end       | My strongest stack; shared types and Zod schemas between API and web                 |
| API      | Fastify + Zod                         | Lightweight, typed request validation; clean standalone API boundary                 |
| Database | PostgreSQL                            | Exclusion constraints, `timestamptz`, transactional job queue                        |
| ORM      | Drizzle                               | Close to SQL; custom migrations for constraints                                      |
| Web      | Next.js (App Router) + TanStack Query + Tailwind CSS | File-based routing, server-state caching, utility-first styling, and `/api` rewrites to Fastify |
| Jobs     | pg-boss                               | See [§3](#3-reminders)                                                               |
| Time     | Luxon                                 | See [§4](#4-time-and-timezones)                                                      |
| Tests    | Vitest + Docker Postgres (`booking_bro_test`) | Real Postgres for concurrency & exclusion-constraint tests without Testcontainers overhead |
| Repo     | pnpm workspaces monorepo              | `apps/api`, `apps/web`, `packages/shared`                                            |

### Why Next.js + standalone Fastify API + TanStack Query
- **Structured frontend & growth:** Next.js App Router provides file-based routing, role-based layouts, and SSR/SEO capability as the platform grows (for example, public professional profiles and directories).
- **Separate Fastify backend:** All business logic, database access, session validation, and `pg-boss` workers stay in `apps/api`. Next.js proxies `/api/*` via `rewrites()` so `HttpOnly` session cookies remain same-origin, and client components (`"use client"` + TanStack Query) render timezone-sensitive calendars without SSR hydration mismatches. Keeping the API separate also means future mobile apps can share the exact same backend contract.
- **State management without Redux/Zustand:** Server state (authenticated user `['me']`, available slots, sessions, and 15s-polled notifications) lives in TanStack Query's cache; selection state lives in the URL; modal/form state uses local `useState`. Adding Redux or Zustand would only duplicate the server cache.

## 2. Preventing double-booking

**Decision:** Postgres exclusion constraints (with the `btree_gist` extension) are the final guarantee.

- `no_professional_overlap`: same `professional_id` + overlapping `[start_at, blocked_until)` (session + buffer)
- `no_member_overlap`: same `member_id` + overlapping `[start_at, end_at)`, which covers sessions with different professionals
- Both apply only `WHERE status = 'booked'`, so cancelled sessions free the time again

```sql
ALTER TABLE sessions ADD CONSTRAINT no_professional_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(start_at, blocked_until, '[)') WITH &&
  ) WHERE (status = 'booked');
```

**How concurrency is handled:** when two members book the same time, Postgres lets one insert win.
The other fails with `23P01`, which the API returns as `409 Slot just taken`.

**Why:** built into Postgres and enforced for every write, with no locks to manage and no deadlock risk.
It takes two migration statements and only blocks true overlaps.

**Alternatives considered:**

| Option                       | Why not                                                     |
| ---------------------------- | ----------------------------------------------------------- |
| Check then insert in the API | Race between the check and the insert                       |
| In-memory or Redis lock      | Single process only / lock expiry, extra infrastructure     |
| `SELECT … FOR UPDATE`        | Every code path must remember to lock, plus deadlock risk   |
| `SERIALIZABLE` isolation     | Retry logic needed everywhere                               |

**Layers:** the UI hides taken times → the API validates business rules → the database guarantees no overlap.

**Reschedule in a single transaction:**
- To prevent ghost reminders and avoid collision on `UNIQUE (session_id, user_id, kind)`, rescheduling marks the existing session `status = 'rescheduled'`, cancels its pending reminder jobs, and inserts a new session row with `status = 'booked'` for the new time, enqueuing new 24h/1h reminders.
- Because this occurs in a single database transaction, if the new slot has a conflict, the entire operation rolls back—guaranteeing the member is never left with 0 or 2 sessions and preserving clean audit history.

## 3. Reminders

**Decision:** pg-boss, a Postgres-backed job queue.

On booking, up to 4 jobs are queued (24h and 1h before, for the member and the professional).
Jobs whose time has already passed are skipped. Delivery is an in-app notification.
- **Cancel / reschedule updates:** cancelling a session cancels its pending 24h/1h jobs and creates a cancellation notification; rescheduling cancels the old jobs, queues new 24h/1h jobs for the new time, and creates a reschedule notification. New bookings do **not** generate an immediate notification.

**Why not Redis + BullMQ:**

- One more service to run, secure and make durable
- Built for high-throughput queues; this app sends a few reminders an hour
- Booking would be saved in Postgres but its jobs in Redis, so a crash between the two loses reminders

**Why pg-boss:** runs on the existing Postgres, supports delayed jobs, retries and archiving, and is safe with multiple workers.

**Delivered exactly once:** pg-boss runs each job *at least* once, so delivery is made idempotent:

1. Jobs are queued **in the same transaction** as the booking, cancel or reschedule
2. `notifications` has `UNIQUE (session_id, user_id, kind)` and inserts use `ON CONFLICT DO NOTHING`
3. At send time the worker re-checks that the session is still booked at the same time, and skips it otherwise
4. Jobs survive restarts because they are stored in Postgres

**Trade-off:** more moving parts than a plain reminders table, but it adds retries,
monitoring and an easy path to real email or SMS later.

## 4. Time and timezones

**Decision:** Luxon over date-fns.

|                  | Luxon                                     | date-fns                                 |
| ---------------- | ----------------------------------------- | ---------------------------------------- |
| Timezones        | Built in (IANA zone on every value)       | Needs a separate add-on on top of `Date` |
| Daylight saving  | Handled when converting local time to UTC | Handled manually across two libraries    |
| Fit for this app | Timezone-heavy domain → clear, safe code  | Better for simple formatting             |

**Rules:**

- All instants are stored as UTC `timestamptz`
- Working hours are stored as local time plus the professional's IANA timezone
- Start times are generated per local date, then converted to UTC. Times that don't exist (spring-forward gap) are dropped.
- The API returns UTC; the web app shows times in the member's timezone

## 5. Slot layout

**Decision:** up to 3 availability windows per weekday, 10-minute start steps, and a buffer (10, 20, or 30 minutes) chosen by each professional.

- **Availability windows:** a professional can set **up to 3 working windows per weekday** (for example, `09:00–12:00`, `13:00–17:00`, `19:00–21:00`), aligned to 10-minute boundaries:
  - Each window must be **at least 50 minutes** long (the minimum duration of one session)
  - Windows on the same day must be strictly ordered with a gap (`prev.end_time < next.start_time`) so duplicate slots cannot be generated
- **Session length:** always **50 minutes**
- **Buffer options:** each professional chooses **10, 20, or 30 minutes** (default 10), which blocks time after each session (`blocked_until = end_at + buffer`)
- **Bookable start times:** generated **on the fly** (no pre-generated slots table). Members can start at **any 10-minute step** inside a working window (`09:00, 09:10, 09:20 …`) if:
  - it's at least **2 hours in the future** (2-hour minimum booking notice)
  - the 50-minute session fits inside that availability window in real elapsed UTC minutes (`end_utc - start_utc == 50 minutes`; the buffer after the session may extend past the window)
  - `[start, end + buffer)` doesn't overlap any existing booking of that professional (including that booking's own buffer)
  - `[start, end)` does not overlap any existing `booked` session of the **requesting member** across all professionals (the generator factors in the member's full booking history so they are not shown slots they cannot book)
- **Schedule & buffer edits:** because slots are computed on the fly, updating working hours or buffer time updates unbooked member slots immediately. Existing `booked` sessions (and their saved `blocked_until` buffer) remain valid and untouched unless the professional explicitly cancels them.
- **UI layout for slot density:** To cleanly present up to ~44 candidate slots per day without overwhelming the member with an 880-button 4-week grid, the calendar uses a **two-column layout**:
  - Left column: 4-week interactive date picker highlighting dates with available openings
  - Right column: Available slots for the selected date grouped by Morning, Afternoon, and Evening pills

**Why:** supports realistic split shifts (lunch/evening breaks) without a separate breaks table, gives members flexible start times, and keeps professional rest options simple (10/20/30 mins).

**Trade-off:** short unusable gaps can appear (for example, a 09:20 booking leaves 09:00–09:20 empty). This is accepted for flexibility.

## 6. Authentication

**Decision:** server-side sessions.

- An HttpOnly, Secure, SameSite=Lax cookie holds a random token; only its SHA-256 hash is stored in the database
- Passwords are hashed with **argon2id** (OWASP baseline: 19 MiB memory, 2 iterations, parallelism 1). Chosen over argon2i because argon2id keeps argon2i's data-independent side-channel resistance in its first pass while remaining strong against GPU and time-memory trade-off (TMTO) cracking after a database leak (RFC 9106 / OWASP recommendation).
- Every request gets the user from the session; client-sent user IDs are never trusted
- **Why not JWT:** logout and revocation need a denylist; with sessions, logout is deleting a row

## 7. Business rules and runtime setup

- **24-hour rule:** compared in real elapsed UTC hours (`start_at - now() >= 24h`). Within 24 hours, member cancel and reschedule are blocked with a clear error message. Professionals can cancel at any time.
- **2-hour minimum booking notice:** slots starting less than 2 hours from `now()` are hidden in the calendar and rejected by the API.
- **One-command Docker setup & seeded data:** `docker compose up` starts Postgres, runs migrations, seeds fictional member/professional accounts (including sessions with due/near-due reminders so `pg-boss` delivery is immediately visible), and runs the API and web app.

## Still to decide

- Known limitations
- What I would do next with more time
- Running this safely in production for a healthcare product
