# Implementation Plan: BookingBro — Session Booking with Reminders

> **Phase:** Phase 2 & 3 of `spec-driven-development` (`Plan` & `Tasks` via `/planning-and-task-breakdown`)  
> **Task List Target:** [tasks/todo.md](todo.md)  
> **Governing Contracts:** [SPEC.md](../SPEC.md) · [CONSTRAINTS.md](../CONSTRAINTS.md) · [DECISIONS.md](../DECISIONS.md) · [AGENTS.md](../AGENTS.md)

---

## 1. Overview

Build **BookingBro**, a full-stack TypeScript session-booking web application with automated in-app reminders in a `pnpm` workspaces monorepo (`packages/shared`, `apps/api`, `apps/web`). Members can browse professionals, view available 50-minute slots across a 4-week calendar in their own IANA timezone (with a 2-hour minimum booking notice and automatic filtering of slots that conflict with the member's existing bookings), book sessions, and cancel or atomically reschedule up to 24 hours before start time. Professionals configure up to 3 non-overlapping availability windows per weekday (`>= 50m` each, 10-minute grid) and a 10, 20, or 30-minute post-session buffer, view upcoming sessions with member names, and cancel at any time. Double-booking is prevented under concurrent load by PostgreSQL `btree_gist` exclusion constraints, and 24h/1h reminders are scheduled and delivered idempotently via `pg-boss` into an in-app notification drawer.

---

## 2. Architecture Decisions

- **Pure Core, Imperative Shell (`packages/shared`):** All Luxon timezone/DST math, 10-minute slot generation, availability window validation, 24-hour modification lock, and reminder timestamp calculations live in pure functions accepting an explicit `now: DateTime` / `nowIso: string` parameter.
- **Injectable Server Clock & Parameterized SQL Timestamps (`apps/api`):** Fastify routes and services use an injectable `app.getNow()` clock and pass parameterized UTC timestamps to Drizzle SQL queries instead of raw SQL `now()`, eliminating clock skew between Node tests and the Docker PostgreSQL container.
- **Database-Level Concurrency (`btree_gist`):** Partial GiST exclusion constraints (`WHERE status = 'booked'`) enforce `no_professional_overlap` on `tstzrange(start_at, blocked_until, '[)')` and `no_member_overlap` on `tstzrange(start_at, end_at, '[)')`, mapping SQLSTATE `23P01` to `409 SLOT_CONFLICT`.
- **Atomic Reschedule & Self-Exclusion:** Rescheduling runs in a single database transaction that marks the old session `'rescheduled'`, inserts a new `'booked'` row (`rescheduled_from_id`), updates `pg-boss` jobs via a Drizzle transaction adapter (`tx`), and attaches `'session_rescheduled'` notifications to `session_id = newSession.id`. Both `GET /api/professionals/:id/slots?excludeSessionId=...` and server-side reschedule validation exclude the session being rescheduled so shifting by ±10 minutes on the same day works seamlessly.
- **Exactly-Once Reminders (`pg-boss` + Unique Constraint):** Reminder jobs (`reminder_24h`, `reminder_1h`) are persisted in Postgres, re-verify `booking_sessions.status === 'booked'` at send time, and insert into `notifications` with `UNIQUE (session_id, user_id, kind)` + `ON CONFLICT DO NOTHING`.
- **Same-Origin Next.js Proxy (`apps/web`):** Next.js `rewrites()` proxies `/api/:path*` to Fastify (`http://localhost:3001/api/:path*`), keeping `HttpOnly; SameSite=Lax` session cookies same-origin with zero CORS complexity.

---

## 3. Dependency Graph

```text
1. Monorepo Config & Docker Postgres (Task 1)
   │
   └──► 2. Shared Constants, Schemas & Pure Rules (Task 2)
          │
          └──► 3. Pure Slot Generator & Timezone/DST Suite (Task 3)
                 │  [Checkpoint 1: Shared Domain Verified]
                 ▼
          4. Drizzle Schema, GiST Migrations & DB Client (Task 4)
                 │
                 ├──► 5. Fastify App, Injectable Clock & Cookie Auth (Task 5)
                 │      │
                 │      └──► 6. Professionals, Availability & Slots API (Task 6)
                 │             │  [Checkpoint 2: Auth & Availability API Verified]
                 │             ▼
                 │      7. Transactional pg-boss Worker & Notifications API (Task 7)
                 │             │
                 │             └──► 8. Booking, Cancel & Atomic Reschedule API (Task 8)
                 │                    │
                 │                    └──► 9. Real-Postgres Concurrency & Integration Suite (Task 9)
                 │                           │  [Checkpoint 3: Backend & All Tests Verified]
                 │                           ▼
                 └────────────────────► 10. Next.js Scaffold, API Client & Navbar Shell (Task 10)
                                               │
                                               ├──► 11. Auth Pages & NotificationBell Drawer (Task 11)
                                               ├──► 12. Professional Directory & 2-Column Calendar Booking UI (Task 12)
                                               └──► 13. My Sessions (Cancel/Reschedule) & Availability Editor UI (Task 13)
                                                      │
                                                      └──► 14. Seed Script, Docker Compose & Final Docs (Task 14)
                                                             │  [Checkpoint 4: Full-Stack Verification]
```

---

## 4. Ordered Task Index

Full task definitions with acceptance criteria, verification commands, dependencies, and file lists are tracked in [tasks/todo.md](todo.md):

### Phase 1: Workspace Foundation & Shared Pure Domain (`packages/shared`)
- [x] **Task 1:** Monorepo Workspace, TypeScript/Lint Config & Docker Postgres Setup
- [x] **Task 2:** Shared Constants, Zod Schemas & Pure 24h/Reminder Rules (`packages/shared`)
- [x] **Task 3:** Pure On-the-Fly Slot Generator, Window Validator & Timezone/DST Unit Tests (`packages/shared`)
- [x] **Checkpoint 1:** Shared Domain & Pure Unit Tests (`pnpm --filter @booking-bro/shared test` & `pnpm typecheck`)

### Phase 2: Database Schema, Authentication & Availability API (`apps/api`)
- [x] **Task 4:** Drizzle ORM Schema, PostgreSQL `btree_gist` Migration & DB Client
- [x] **Task 5:** Fastify App Factory, Injectable Clock, Cookie Session Auth & Auth Routes
- [x] **Task 6:** Professional Directory, Availability Editor & On-the-Fly Slots Routes
- [x] **Checkpoint 2:** Database, Auth & Availability API (`pnpm --filter @booking-bro/api typecheck` & migrations check)

### Phase 3: Booking Engine, Reminders & Real-Postgres Integration Suite (`apps/api`)
- [x] **Task 7:** Transactional `pg-boss` Reminder Worker & Notifications Routes
- [x] **Task 8:** Booking Creation, 24h Cancel & Atomic Reschedule Service and Routes
- [x] **Task 9:** Real-PostgreSQL Concurrency, Session Lifecycle & Reminder/RBAC Integration Tests
- [x] **Checkpoint 3:** Complete Backend & Real-Postgres Test Suite (`pnpm test` passes 100% of unit + integration tests)

### Phase 4: Next.js Web Application, Docker Seed & Documentation (`apps/web` + Root)
- [ ] **Task 10:** Next.js App Router Scaffold, `/api` Proxy, Typed Fetch Client & Layout Shell
- [ ] **Task 11:** Login, Signup (with IANA Timezone Picker) & `NotificationBell` Drawer
- [ ] **Task 12:** Professional Directory, Two-Column 4-Week Calendar & Booking Confirmation Flow
- [ ] **Task 13:** My Sessions View (Cancel & Reschedule Modal) & Professional Availability Editor
- [ ] **Task 14:** Demo Seed Script, Full-Stack `docker compose up` & Final `DECISIONS.md` / `README.md`
- [ ] **Checkpoint 4:** Full-Stack Verification & Submission Gate

---

## 5. Risks and Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **Vitest parallel test workers wiping shared tables in `booking_bro_test`** | High | Set `fileParallelism: false` in `apps/api/vitest.config.ts` and run `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` (including `pgboss.job`) in `beforeEach`. |
| **Clock skew between Node tests and PostgreSQL `now()`** | High | Pass an injectable `getNow()` clock into Fastify services and bind parameterized UTC timestamps (`$now`) in Drizzle SQL queries instead of raw SQL `now()`. |
| **Orphan `pg-boss` jobs on failed reschedule (`23P01` rollback)** | High | Pass a Drizzle transaction adapter (`{ executeSql }`) into `boss.send()` so reminder job rows are written on the same DB transaction (`tx`) and roll back atomically on conflict. |
| **Same-day adjacent reschedule (+10m) blocked by self-overlap** | Med | Support `?excludeSessionId=<uuid>` on `GET /api/professionals/:id/slots` and exclude `oldSession.id` during `POST /api/sessions/:id/reschedule` slot validation. |
| **Chained reschedule `notifications` unique constraint collision** | Med | Attach `'session_rescheduled'` notifications to `session_id = newSession.id` (each reschedule creates a fresh UUID row). |
| **Next.js SSR hydration mismatch on local timezone formatting** | Med | Render timezone-dependent calendar dates and slot pills in client components after auth/timezone state resolves. |

---

## 6. Standing Definition of Done

Every task in [tasks/todo.md](todo.md) must satisfy both its task-specific Acceptance Criteria and the project-wide [CONSTRAINTS.md](../CONSTRAINTS.md) floor:
- Zero TypeScript errors (`pnpm typecheck`) and zero lint errors (`pnpm lint`).
- Zero `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `.skip`, `.only`, or unimplemented `TODO` stubs.
- New behavior is covered by automated tests that pass in `pnpm test`.
- Living documentation (`DECISIONS.md`, `AI_USAGE.md`, `log.txt`) stays synchronized at every turn.

---

## 7. Open Questions

- None — all architectural, schema, edge-case, and testing decisions are finalized in [SPEC.md](../SPEC.md) and [CONSTRAINTS.md](../CONSTRAINTS.md). Ready for human review of this plan before Phase 4 (`Build`).
