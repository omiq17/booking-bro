# AI Usage

I used AI as a pair-programmer and sounding board. Final decisions and every line of code are mine,
and I can explain them.

## Tools

| Tool                      | Model             | Used for                                                                          |
| ------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| Antigravity (agentic IDE) | Claude Sonnet 5.5 | Reading the task PDF, summarising requirements, Next.js vs Vite lookup            |
| Antigravity (agentic IDE) | Claude Opus 5.5   | Choosing the stack, business logic discussions, planning docs, security review    |
| Antigravity (agentic IDE) | Gemini 4 Argon    | Setting up `AGENTS.md` / `log.txt`, state & DST analysis, `/interview-me`, `/spec-driven-development` |
| Antigravity (agentic IDE) | Gemini 3.8 Flash  | Refinement validation, spec review & decision recording                           |

**Agent features used:**
- Planning mode (`/plan`) to draft and review plans before any files were written
- Skill `/interview-me` (`interview-me`) to stress-test scope, reminder triggers, minimum booking notice, and schedule-edit edge cases
- Skill `/context-engineering` (`context-engineering`) to audit project rules, context hierarchy, and session-boundary readiness before scaffolding
- Skill `/idea-refine` (`idea-refine`) to stress-test all design decisions against the brief's requirements and surface hidden UX/technical assumptions
- Skill `/spec-driven-development` (`spec-driven-development`) to author the capability map, database/API contracts, and test specification in [SPEC.md](SPEC.md)
- Skill `/constraint-driven-development` (`constraint-driven-development`) to establish an unbendable quality bar contract in `CONSTRAINTS.md` before implementation
- `ctx7` CLI rule to verify current Next.js v16 and TanStack Query v5 documentation
- Workspace rule (`.agents/rules/logging.md`) enforcing turn-by-turn logging into [log.txt](log.txt) per [AGENTS.md](AGENTS.md)
- No subagents used so far.

## How I used it, by phase

| Phase          | What the AI did                                                                   | What I decided                                         |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Task overview  | Read the PDF and summarised requirements                                          | Checked it against the original brief                  |
| Tech stack     | Compared options (Vite vs Next.js, date-fns vs Luxon, Redis vs Postgres queues, JWT vs sessions, TanStack Query vs Redux/Zustand) | Chose TypeScript, Next.js, TanStack Query, Tailwind CSS, Fastify + Zod, Postgres, Luxon, pg-boss |
| Double-booking | Explained 9 approaches and their trade-offs                                       | Chose Postgres exclusion constraints                   |
| Slot layout    | Proposed a fixed hourly grid and reviewed my multi-window alternative             | Chose up to 3 windows/day (≥ 50m), 10-min steps, and 10/20/30-min buffers |
| Business rules (`/interview-me`) | Ran one-question-at-a-time interview on extras, reminder testing, and schedule changes | Chose `docker compose up` + seed data, 2h minimum notice, cancel/reschedule notifications only, and keeping existing bookings when hours change |
| Specification (`/spec-driven-development`) | Drafted 6-module capability map, SQL schema, API contracts, and unit/concurrency test matrix in `SPEC.md` | Scrutinized and refined: skipping past 24h reminders on reschedule, adding `updated_at` to `booking_sessions`, 7-day session expiry behavior, and using Docker Postgres directly instead of Testcontainers |
| Scaffold       | *(to be filled in)*                                                               |                                                        |

## Where I overrode the AI

### 1. Slot layout: split availability windows + flexible start times instead of a fixed hourly grid

- **AI suggested:** an hourly grid (one working range per day, sessions start on the hour, with a fixed 10-minute break)
- **I chose:** up to 3 availability windows per weekday (each ≥ 50 minutes), a buffer each professional picks from **10, 20, or 30 minutes**, and start times every 10 minutes
- **Why:** supports real-world split shifts (such as lunch breaks), gives members more start-time flexibility, and gives professionals simple buffer choices
- **Effect:** validation enforces non-overlapping windows ≥ 50 mins per day, and the double-booking constraint covers session + buffer (`blocked_until`)

### 2. Web framework: Next.js instead of React + Vite

- **AI suggested:** a plain React + Vite SPA
- **I chose:** Next.js (App Router) paired with the standalone Fastify + Zod API
- **Why:** Next.js gives structured file-based routing, layouts, and a production growth path (such as SSR/SEO for public professional profiles), while `/api` rewrites and client-rendered calendar views keep the clean Fastify boundary and avoid timezone hydration issues

### 3. Notification triggers (`/interview-me`): no notification on initial booking

- **AI suggested:** sending an immediate in-app notification on every new booking in addition to 24h/1h reminders and cancel/reschedule updates
- **I chose:** only the scheduled 24h and 1h reminders plus cancel and reschedule notifications (no new-booking notification)
- **Why:** matches the specification (`"When a session is booked, reminders are scheduled for 24 hours and 1 hour before it starts... Cancelling or rescheduling updates the reminders"`) and avoids cluttering the notification list with redundant confirmation noise

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
