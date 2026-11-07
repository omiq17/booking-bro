# AI Usage

I used AI as a pair-programmer and sounding board. Final decisions and every line of code are mine,
and I can explain them.

---

## Table of Contents

- [1. Models Used](#1-models-used)
- [2. How I Used It, by Phase](#2-how-i-used-it-by-phase)
- [3. Where I Overwrote/Improved the AI](#3-where-i-overwroteimproved-the-ai)
  - [1. Slot layout: split availability windows + flexible start times](#1-slot-layout-split-availability-windows--flexible-start-times-instead-of-a-fixed-hourly-grid)
  - [2. Web framework: Next.js instead of React + Vite](#2-web-framework-nextjs-instead-of-react--vite)
  - [3. Notification triggers: no notification on initial booking & counterparty-only cancel/reschedule alerts](#3-notification-triggers-interview-me-no-notification-on-initial-booking--counterparty-only-cancelreschedule-alerts)
  - [4. Reschedule reminder logic: skip 24h reminder for near-term slots](#4-reschedule-reminder-logic-skip-24h-reminder-for-near-term-slots)
  - [5. Session mutation schema: require updated_at and separate in-place cancel from new-row reschedule](#5-session-mutation-schema-require-updated_at-and-separate-in-place-cancel-from-new-row-reschedule)
  - [6. Test environment: Docker Compose Postgres instead of Testcontainers](#6-test-environment-docker-compose-postgres-instead-of-testcontainers)
  - [7. Password hashing inputs: scrutinizing mutable attributes vs. cryptographic salt](#7-password-hashing-inputs-scrutinizing-mutable-attributes-timezonetimestamp-vs-cryptographic-salt)
  - [8. Frontend UI/UX: Design system, healthcare palette, theme mode options, and mobile-first responsiveness](#8-frontend-uiux-design-system-healthcare-palette-theme-mode-options-and-mobile-first-responsiveness)

---

## 1. Models Used

| Model             | Used for                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Sonnet 4.6 | Reading the task PDF, summarising requirements, Next.js vs Vite lookup                                                                 |
| Claude Opus 4.6   | Choosing the stack, business logic discussions, planning docs, security review, Phase 4 implementation (Tasks 10–14), DB seed, UI/UX polish, and `README.md` architecture diagrams |
| Gemini 4 Argon    | Setting up `AGENTS.md` / `log.txt`, state & DST analysis, `/interview-me`, `/spec-driven-development`, and Phase 1, 2 & 3 implementation |
| Gemini 3.5 Flash  | Usual general tasks, refinement validation, spec review, TDD test suite auditing & decision recording                                  |

**Agent features used:**
- Planning mode (`/plan`) to draft and review plans before any files were written
- Skill `/interview-me` (`interview-me`) to stress-test scope, reminder triggers, minimum booking notice, and schedule-edit edge cases
- Skill `/context-engineering` (`context-engineering`) to audit project rules, context hierarchy, and session-boundary readiness before scaffolding
- Skill `/idea-refine` (`idea-refine`) to stress-test all design decisions against the brief's requirements and surface hidden UX/technical assumptions
- Skill `/spec-driven-development` (`spec-driven-development`) to author the capability map, database/API contracts, and test specification in [SPEC.md](SPEC.md)
- Skill `/constraint-driven-development` (`constraint-driven-development`) to establish an unbendable quality bar contract in `CONSTRAINTS.md` before implementation
- Skill `/planning-and-task-breakdown` (`planning-and-task-breakdown`) to decompose the specification into 14 verifiable tasks and 4 checkpoints in `tasks/plan.md` and `tasks/todo.md`
- Skills `/incremental-implementation` (`incremental-implementation`) and `/test-driven-development` (`test-driven-development`) to build Phase 1 (`packages/shared`), Phase 2 (`apps/api`), and Phase 3 (`pg-boss` reminders, booking engine, real-Postgres concurrency suite)
- Skill `/frontend-ui-engineering` (`frontend-ui-engineering`) to validate WCAG 2.1 AA/AAA contrast ratios, establish an intentional healthcare aesthetic, solve 10-minute slot density on mobile screens, and map the TanStack Query data flow
- Skill `/code-review-and-quality` (`code-review-and-quality`) to perform a 5-axis system review (Correctness, Readability, Architecture, Security, Performance), mutation testing verification, and dead-code audit across all workspaces
- `ctx7` CLI rule to verify current documentation for Next.js, Tailwind CSS, and TanStack Query
- Workspace rule (`.agents/rules/logging.md`) enforcing turn-by-turn logging into [log.txt](log.txt) per [AGENTS.md](AGENTS.md)
- Subagent `test-engineer` (`QA Test Strategy Reviewer`) invoked to audit `SPEC.md` and Section 6 (Testing Strategy) for missing edge cases, schema/contract traps, and test-isolation hazards.

---

## 2. How I Used It, by Phase

| Phase          | What the AI did                                                                   | What I decided                                         |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Task overview  | Read the PDF and summarised requirements                                          | Checked it against the original brief                  |
| Tech stack     | Compared options (Vite vs Next.js, date-fns vs Luxon, Redis vs Postgres queues, JWT vs sessions, TanStack Query vs Redux/Zustand) | Chose TypeScript, Next.js, TanStack Query, Tailwind CSS, Fastify + Zod, Postgres, Luxon, pg-boss |
| Double-booking | Explained 9 approaches and their trade-offs                                       | Chose Postgres exclusion constraints                   |
| Slot layout    | Proposed a fixed hourly grid and reviewed my multi-window alternative             | Chose up to 3 windows/day (≥ 50m), 10-min steps, and 10/20/30-min buffers |
| Business rules (`/interview-me`) | Ran one-question-at-a-time interview on extras, reminder testing, and schedule changes | Chose `docker compose up` + seed data, 2h minimum notice, cancel/reschedule notifications only, and keeping existing bookings when hours change |
| Specification (`/spec-driven-development`) | Drafted 6-module capability map, SQL schema, API contracts, and unit/concurrency test matrix in `SPEC.md` | Scrutinized and refined: skipping past 24h reminders on reschedule, adding `updated_at` to `booking_sessions`, 7-day session expiry behavior, and using Docker Postgres directly instead of Testcontainers |
| Test strategy audit (`test-engineer`) | Audited `SPEC.md` §6 and surfaced edge cases, schema constraint traps, and Vitest/Postgres isolation hazards | Confirmed attaching `'session_rescheduled'` notifications to `newSession.id`, `excludeSessionId` for same-day +10m reschedule, buffer-change snapshot tests, member/pro buffer asymmetry, and sequential test isolation |
| Task breakdown (`/planning-and-task-breakdown`) | Decomposed `SPEC.md` into 14 dependency-ordered tasks across 4 phases with explicit acceptance criteria and checkpoints in `tasks/plan.md` & `tasks/todo.md` | Reviewed and approved task granularity and verification checkpoints before implementation |
| Phase 1: Shared Domain (`/test-driven-development`) | Built `@booking-bro/shared` (Zod schemas, Luxon slot generator, and 31 unit tests) | Verified all 31 unit tests pass with `> 93%` coverage |
| Phase 2: DB, Auth & Availability API (`/incremental-implementation`) | Built Drizzle schema, `0000_init.sql` (`btree_gist` constraints), Fastify app factory, `argon2id` cookie auth, and availability routes | Provisioned Postgres (`booking_bro` + `booking_bro_test`) and verified DB constraints and API routes |
| Phase 3: Booking Engine, `pg-boss` & Concurrency Tests (`/test-driven-development`) | Built transactional `pg-boss` reminder worker, booking/cancel/atomic-reschedule service, and 27 real-PostgreSQL concurrency & integration tests | Verified all 58 unit and integration tests pass against real PostgreSQL |
| Phase 4: Next.js Web UI (Tasks 10–13) (`/frontend-ui-engineering`) | Built Next.js 15 App Router pages, 28-day `CalendarPicker`, `RescheduleModal`, 15s notification bell, and 6 frontend unit tests | Refined UI copy, redesigned compact Navbar & avatar menu, added OS-synced Light/Dark mode, top-right Toast, and counterparty-only notifications |
| Phase 4: Seed, Docker & Final Docs (Task 14) (`/documentation-and-adrs`) | Built idempotent demo seed (`seed.ts`), multi-stage `Dockerfile` + `docker-compose.yml`, `README.md` Mermaid diagrams, and `DECISIONS.md` §§9–11 | Verified `pnpm db:seed`, `pnpm test` (64/64 passing), `pnpm typecheck`, and `pnpm build` |

---

## 3. Where I Overwrote/Improved the AI

### 1. Slot layout: split availability windows + flexible start times instead of a fixed hourly grid

- **AI suggested:** an hourly grid (one working range per day, sessions start on the hour, with a fixed 10-minute break)
- **I chose:** up to 3 availability windows per weekday (each ≥ 50 minutes), a buffer each professional picks from **10, 20, or 30 minutes**, and start times every 10 minutes
- **Why:** supports real-world split shifts (such as lunch breaks), gives members more start-time flexibility, and gives professionals simple buffer choices
- **Effect:** validation enforces non-overlapping windows ≥ 50 mins per day, and the double-booking constraint covers session + buffer (`blocked_until`)

### 2. Web framework: Next.js instead of React + Vite

- **AI suggested:** a plain React + Vite SPA
- **I chose:** Next.js (App Router) paired with the standalone Fastify + Zod API
- **Why:** Next.js gives structured file-based routing, layouts, and a production growth path (such as SSR/SEO for public professional profiles), while `/api` rewrites and client-rendered calendar views keep the clean Fastify boundary and avoid timezone hydration issues

### 3. Notification triggers (`/interview-me`): no notification on initial booking & counterparty-only cancel/reschedule alerts

- **AI suggested:** sending an immediate in-app notification on every new booking, and sending cancel/reschedule notifications to both the actor and the counterparty
- **I chose:** scheduled `24h` and `1h` reminders for both participants, and cancel/reschedule bell notifications **only for the counterparty** while the person performing the action sees an immediate top-right Toast (with no notification on initial booking)
- **Why:** matches the specification (`"When a session is booked, reminders are scheduled for 24 hours and 1 hour before it starts... Cancelling or rescheduling updates the reminders"`) and avoids notifying a user in their own bell for an action they just took themselves

### 4. Reschedule reminder logic: skip 24h reminder for near-term slots

- **AI draft specified:** rescheduling cancels old jobs and schedules new 24h and 1h reminder jobs for the new slot
- **I identified & overrode:** caught that when rescheduling into an available slot that is less than 24 hours away (e.g. 10 hours from now), the 24-hour reminder is already in the past and must be skipped rather than scheduled
- **Why:** avoids queuing past-due reminders that would immediately fire upon rescheduling

### 5. Session mutation schema: require updated_at and separate in-place cancel from new-row reschedule

- **AI draft missed:** `updated_at` column on `booking_sessions`
- **I insisted:** adding `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` to `booking_sessions` and explicitly specifying that cancellation updates the existing row in place (`status = 'cancelled'`, `updated_at = now()`), whereas rescheduling updates the old row (`status = 'rescheduled'`) and inserts a new row (`status = 'booked'`) in the same transaction
- **Why:** ensures accurate audit timestamps for status changes and avoids unique constraint conflicts on reminders

### 6. Test environment: Docker Compose Postgres instead of Testcontainers

- **AI suggested:** `@testcontainers/postgresql` to spin up disposable containers during `pnpm test`
- **I chose:** running integration tests directly against the Docker Compose PostgreSQL instance using an isolated `booking_bro_test` database
- **Why:** eliminates heavy container-orchestration dependencies (`dockerode`), avoids macOS Docker socket mounting quirks, and cuts test startup time by 6–8 seconds while still running against real PostgreSQL 16 with `btree_gist`

### 7. Password hashing inputs: scrutinizing mutable attributes (timezone/timestamp) vs. cryptographic salt

- **I identified & probed:** caught that mixing mutable user attributes like timezone or timestamps into password hashing is problematic because timezone and timestamps change over time
- **Resolution:** clarified that mutable attributes (`timezone`, `updated_at`, `role`) remain strictly as separate database columns, while `argon2id` generates its own independent 16-byte random salt embedded into the PHC string format, guaranteeing credential verification remains decoupled from user profile updates

### 8. Frontend UI/UX: Design system, healthcare palette, theme mode options, and mobile-first responsiveness

- **AI initial inclination:** Jumping directly into scaffolding components with default AI styles, technical backend jargon in the UI, and generic layout patterns.
- **I directed & structured:**
  - **Calming Healthcare Palette & Light/Dark Theme:** Established an accessible forest-teal and warm-linen palette (WCAG AAA contrast) with automatic OS theme detection (`prefers-color-scheme`) and a 1-click `Sun` / `Moon` toggle.
  - **2-Column & Mobile Stepper Calendar:** Used a 2-column date/time picker on desktop and a touch-friendly stepper on mobile so 10-minute slots stay easy to scan.
  - **Clean Copy & Compact Navigation:** Removed internal technical terms (`GiST`, `pg-boss`) from user-facing text, replaced wide dropdowns with a compact `City · UTC+X` timezone pill and avatar menu, and added a 3-second top-right Toast for action feedback.
  - **Lightweight Stack:** Used pure Tailwind CSS + Lucide Icons + TanStack Query (with Next.js `/api` rewrites) instead of heavy UI libraries.
- **Why:** Keeps the interface calm, fast, and human-friendly for mental-health users across desktop and mobile.
