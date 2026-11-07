# Decisions

A living record of key technical decisions. Each entry: what I chose, why, and what I traded off.
Sections marked *Provisional* may change during the build.

---

## Table of Contents

- [1. Tech Stack](#1-tech-stack)
  - [Why Next.js + Standalone Fastify API + TanStack Query](#why-nextjs--standalone-fastify-api--tanstack-query)
- [2. Preventing Double-Booking](#2-preventing-double-booking)
  - [Exclusion Constraints & Concurrency Handling](#exclusion-constraints--concurrency-handling)
  - [Reschedule in a Single Transaction](#reschedule-in-a-single-transaction)
- [3. Reminders](#3-reminders)
  - [pg-boss Architecture & Exactly-Once Delivery](#pg-boss-architecture--exactly-once-delivery)
- [4. Time and Timezones](#4-time-and-timezones)
  - [Luxon vs. date-fns & UTC Rules](#luxon-vs-date-fns--utc-rules)
- [5. Slot Layout](#5-slot-layout)
  - [On-the-Fly Generation & Buffer Options](#on-the-fly-generation--buffer-options)
  - [UI Layout for Slot Density](#ui-layout-for-slot-density)
- [6. Authentication](#6-authentication)
  - [Server-Side Sessions & argon2id Hashing](#server-side-sessions--argon2id-hashing)
- [7. Business Rules and Runtime Setup](#7-business-rules-and-runtime-setup)
- [8. Frontend Design System & Responsive Mobile Strategy](#8-frontend-design-system--responsive-mobile-strategy)
  - [Healthcare Color Palette & WCAG 2.1 AA/AAA Contrast](#healthcare-color-palette--wcag-21-aaaaa-contrast)
  - [Dark and Light Mode / Semantic Theming Strategy](#dark-and-light-mode--semantic-theming-strategy)
  - [Component Architecture & Why Pure Tailwind CSS + Lucide Icons](#component-architecture--why-pure-tailwind-css--lucide-icons)
  - [Mobile Responsiveness: 10-Minute Slot Density](#mobile-responsiveness-10-minute-slot-density)
  - [Frontend Data Flow & Cache Invalidation Lifecycle](#frontend-data-flow--cache-invalidation-lifecycle)
- [9. Known Limitations](#9-known-limitations)
- [10. What I Would Do Next with More Time](#10-what-i-would-do-next-with-more-time)
- [11. Running Safely in Production for a Healthcare Product](#11-running-safely-in-production-for-a-healthcare-product)

---

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

---

## 2. Preventing double-booking

**Decision:** Postgres exclusion constraints (with the `btree_gist` extension) are the final guarantee.

- `no_professional_overlap`: same `professional_id` + overlapping `[start_at, blocked_until)` (session + buffer)
- `no_member_overlap`: same `member_id` + overlapping `[start_at, end_at)`, which covers sessions with different professionals
- Both apply only `WHERE status = 'booked'`, so cancelled sessions free the time again

```sql
ALTER TABLE booking_sessions ADD CONSTRAINT no_professional_overlap
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

---

## 3. Reminders

**Decision:** pg-boss, a Postgres-backed job queue.

On booking, up to 4 jobs are queued (24h and 1h before, for the member and the professional).
Jobs whose time has already passed are skipped. Delivery is an in-app notification.
- **Cancel / reschedule updates:** cancelling a session cancels its pending 24h/1h jobs and creates a cancellation notification for the counterparty (the actor sees an immediate top-right toast); rescheduling cancels the old jobs, queues new 24h/1h jobs for the new time, and creates a reschedule notification for the professional. New bookings do **not** generate an immediate notification.

**Why not Redis + BullMQ:**
- One more service to run, secure and make durable
- Built for high-throughput queues; this app sends a few reminders an hour
- Booking would be saved in Postgres but its jobs in Redis, so a crash between the two loses reminders

**Why pg-boss:** runs on the existing Postgres, supports delayed jobs, retries and archiving, and is safe with multiple workers.

**Delivered exactly once:** pg-boss runs each job *at least* once, so delivery is made idempotent:
1. Jobs are queued **in the same transaction** as the booking, cancel or reschedule via a Drizzle `{ executeSql }` adapter
2. `notifications` has `UNIQUE (session_id, user_id, kind)` and inserts use `ON CONFLICT DO NOTHING`
3. At send time the worker re-checks that the session is still booked at the same time, and skips it otherwise
4. Jobs survive restarts because they are stored in Postgres

**Trade-off:** more moving parts than a plain reminders table, but it adds retries,
monitoring and an easy path to real email or SMS later.

---

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

---

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

**UI layout for slot density:** To cleanly present up to ~44 candidate slots per day without overwhelming the member with an 880-button 4-week grid, the calendar uses a **two-column layout**:
- Left column: 4-week interactive date picker highlighting dates with available openings
- Right column: Available slots for the selected date grouped by Morning, Afternoon, and Evening pills

**Why:** supports realistic split shifts (lunch/evening breaks) without a separate breaks table, gives members flexible start times, and keeps professional rest options simple (10/20/30 mins).

**Trade-off:** short unusable gaps can appear (for example, a 09:20 booking leaves 09:00–09:20 empty). This is accepted for flexibility.

---

## 6. Authentication

**Decision:** server-side sessions.

- An HttpOnly, Secure, SameSite=Lax cookie holds a random token; only its SHA-256 hash is stored in the database
- Passwords are hashed with **argon2id** (OWASP baseline: 19 MiB memory, 2 iterations, parallelism 1). Chosen over argon2i because argon2id keeps argon2i's data-independent side-channel resistance in its first pass while remaining strong against GPU and time-memory trade-off (TMTO) cracking after a database leak (RFC 9106 / OWASP recommendation).
- Every request gets the user from the session; client-sent user IDs are never trusted
- **Why not JWT:** logout and revocation need a denylist; with sessions, logout is deleting a row

---

## 7. Business rules and runtime setup

- **24-hour rule:** compared in real elapsed UTC hours (`start_at - now() >= 24h`). Within 24 hours, member cancel and reschedule are blocked with a clear error message. Professionals can cancel at any time.
- **2-hour minimum booking notice:** slots starting less than 2 hours from `now()` are hidden in the calendar and rejected by the API.
- **One-command Docker setup & seeded data:** `docker compose up` starts Postgres, runs migrations, seeds fictional member/professional accounts (including sessions with due/near-due reminders so `pg-boss` delivery is immediately visible), and runs the API and web app.

---

## 8. Frontend Design System & Responsive Mobile Strategy

### Healthcare Color Palette & WCAG 2.1 AA/AAA Contrast
Mental health and wellbeing session booking demands an anxiety-reducing, calming aesthetic:
- **Primary Brand:** Deep Forest Teal/Emerald (`emerald-800` `#065F46`, hover `emerald-900` `#064E3B`). Contrast ratio with white is **7.8:1** (exceeds WCAG AAA requirement of 7:1).
- **Background Surface:** Warm Linen Off-White (`stone-50` `#FAFAF9`) paired with white card surfaces and subtle `stone-200` borders. Avoids harsh, eye-straining pure white with pure black.
- **Text:** Deep Charcoal Slate (`stone-900` `#1C1917` on `stone-50` = **14.2:1 contrast ratio**, far exceeding AAA).
- **States:** Multi-channel indicators (color + icon + explicit copy):
  - Confirmed: `emerald-600` with `CheckCircle` icon.
  - Locked (< 24h): `amber-800` on `amber-100` with `Lock` icon and helper tooltip.
  - Cancelled: `rose-700` on `rose-50` with `XCircle` icon.

### Dark and Light Mode / Semantic Theming Strategy
- **Why Warm Linen over Blinding White:** Pure `#FFFFFF` backgrounds with pure `#000000` text create glare and visual fatigue for users seeking care. The warm linen palette (`stone-50` / `stone-100` / `stone-900`) delivers low-glare, eye-friendly readability with full AAA compliance.
- **OS-Aware Default + 1-Click Theme Toggle:** On first visit, an inline `<head>` script inspects `window.matchMedia('(prefers-color-scheme: dark)')` and `localStorage` before first paint so there is zero flash of unstyled content (FOUC). Users can override the theme at any time via the `Sun` / `Moon` toggle in the top navbar, which switches `html.dark` between Warm Linen / Forest Teal (Light Mode) and Midnight Slate / Mint Emerald (Dark Mode).

### Component Architecture & Why Pure Tailwind CSS + Lucide Icons
- **Rejected HeroUI (formerly NextUI):** Adds ~220KB bundle overhead, requires client-side providers, and fights Next.js 15 App Router streaming.
- **Rejected full Shadcn CLI generation:** Running CLI code generators in a pnpm monorepo introduces configuration drift and unnecessary package dependencies.
- **Chosen: The Shadcn Pattern (Pure Tailwind CSS + Lucide React + Accessible Primitives):**
  - Modular, accessible components (`Button`, `Card`, `Badge`, `Modal`, `CalendarPicker`).
  - Strict keyboard accessibility with visible focus rings (`focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2`).
  - Zero heavy external runtime styling dependencies.

### Mobile Responsiveness: 10-Minute Slot Density
Presenting dozens of 10-minute start times across 28 days is unusable if rendered in a desktop 2-column format on mobile screens.
- **Desktop (>= 1024px):** 2-column master-detail (Left: 28-day calendar picker showing available openings; Right: Morning, Afternoon, and Evening grouped pills).
- **Mobile (< 1024px):** Stepper/sheet layout:
  1. Date picker grid with high-contrast dots and large touch targets (`min-h-[44px]`).
  2. Selecting a date scrolls or slides up the Morning/Afternoon/Evening time pills.
  3. Modals render as slide-up bottom sheets (`rounded-t-2xl`) for natural thumb reach.

### Frontend Data Flow & Cache Invalidation Lifecycle
- **Same-Origin Proxy:** Next.js `rewrites()` proxies `/api/:path*` to Fastify (`http://localhost:3001/api/:path*`), keeping `HttpOnly; SameSite=Lax` cookies same-origin with zero CORS complexity.
- **TanStack Query Cache Structure:**
  - `['auth', 'me']`: Refreshed on login, logout, and timezone switch.
  - `['slots', proId, activeDate]`: Invalidated immediately on booking, cancel, reschedule, or timezone change.
  - `['sessions']`: Invalidated on booking, cancel, or reschedule.
  - `['notifications']`: Polled every 15 seconds to update the notification bell counter badge in real time.

---

## 9. Known Limitations

1. **Weekly Recurring Availability Without Date-Specific Overrides:**
   - Professionals configure recurring weekday windows (`Mon–Sun`, up to 3 windows/day). Date-specific holiday exceptions or one-off out-of-office blocks (for example, blocking a specific Tuesday afternoon next month without editing every Tuesday) are not yet modeled in a separate overrides table.
2. **10-Minute Step Fragmentation Trade-Off:**
   - Allowing members to book on any 10-minute boundary (`09:00, 09:10, 09:20…`) maximizes member convenience but can leave 10–40 minute unbookable pockets between sessions (for example, booking `09:20–10:10` leaves `09:00–09:20` too short for a 50-minute session).
3. **In-App Notifications Only (No External Email/SMS Provider Wired):**
   - Reminders (`24h` and `1h`), cancellations, and reschedules are delivered reliably into the `notifications` table and polled every 15 seconds in the web UI. If a user does not have the web app open and has not configured email/push, they will not see an external alert until they open the app.
4. **No Email Verification or CAPTCHA Bot Protection on Sign-Up:**
   - Per the take-home scope, new accounts are activated immediately upon sign-up without an email verification step or CAPTCHA challenge (such as Cloudflare Turnstile or reCAPTCHA) to block automated bot registrations.

---

## 10. What I Would Do Next with More Time

1. **Date-Specific Availability Overrides & External Calendar Sync (Google / Outlook):**
   - Add an `availability_exceptions` table (`professional_id`, `date`, `is_unavailable`, optional custom windows) and two-way `.ics` / Google Calendar OAuth sync so external busy blocks automatically subtract from on-the-fly slot generation.
2. **Multi-Channel Notification Fan-Out (Email, SMS & Web Push):**
   - Extend `processReminderJob` in `reminder.service.ts` to dispatch transactional emails (via Postmark/SES with `.ics` calendar attachments) and Web Push / WhatsApp notifications alongside the in-app notification row, using per-channel idempotency keys.
3. **Smart Slot Packing ("Minimize Gaps" Mode for Professionals):**
   - Give professionals an optional toggle to restrict member start times to slots that pack contiguously against window edges or existing `blocked_until` boundaries, eliminating 10–30 minute calendar fragments while keeping the 10-minute grid math.
4. **Code Review Hardening, Boundary Tightening & Query Indexing:**
   - Run another review-agent pass to tighten type and transaction boundaries (shared response DTO schemas between API and web, stricter Drizzle/`pg-boss` transaction client checks), add composite B-tree indexes and pagination on `notifications` and `booking_sessions`, and clean up unused helpers and duplicate test cases.

---

## 11. Running Safely in Production for a Healthcare Product

Operating a mental health and counselling scheduling platform in production (under regulations such as HIPAA, GDPR, or Singapore PDPA) requires hardening across four pillars:

1. **PHI / PII Data Minimization & Encryption:**
   - **Encryption in Transit & at Rest:** Enforce TLS 1.3 across all public and internal service links; enable AES-256 disk and database encryption (RDS / Cloud SQL KMS) plus column-level envelope encryption for sensitive clinical intake notes if added later.
   - **Strict Calendar Privacy:** The public slots endpoint (`GET /api/professionals/:id/slots`) already strips all member identities and session IDs, returning only `{ startAt, endAt }[]` intervals so one patient can never infer another patient's identity or schedule.
2. **Authentication, MFA & Session Hardening:**
   - Require Multi-Factor Authentication (TOTP / WebAuthn passkeys) for all professional accounts and offer it to members.
   - Add rate limiting (`@fastify/rate-limit` backed by Redis or Postgres) on `/api/auth/login` and `/api/auth/signup` with exponential backoff and account lockout alerts to prevent credential stuffing.
   - Enforce `Secure; HttpOnly; SameSite=Lax` cookies behind a strict Content Security Policy (CSP) and CSRF Origin verification header check.
3. **Immutable Audit Logging:**
   - Introduce an append-only `audit_logs` table (shipped to immutable object storage such as AWS S3 Object Lock) recording every authentication event, schedule change, booking, cancellation, reschedule, and clinical record access (`actor_id`, `action`, `resource_id`, `ip_hash`, `user_agent`, `created_at`) without ever logging passwords, session tokens, or raw health notes.
4. **Separate Worker Fleet & Dead-Letter Alerting:**
   - Run the `pg-boss` worker fleet as an independent deployment from the Fastify HTTP API so reminder processing scales independently.
   - Configure `pg-boss` dead-letter queues (`deadLetter`) and Prometheus/OpenTelemetry metrics on queue depth, job latency, and failed reminder deliveries with PagerDuty alerts if any `24h` or `1h` reminder lags by more than 2 minutes.

