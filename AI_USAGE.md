# AI Usage

I used AI as a pair-programmer and sounding board. Final decisions and every line of code are mine,
and I can explain them.

## Tools

| Tool                      | Model             | Used for                                                                          |
| ------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| Antigravity (agentic IDE) | Claude Sonnet 5.5 | Reading the task PDF, summarising requirements, Next.js vs Vite lookup            |
| Antigravity (agentic IDE) | Claude Opus 5.5   | Choosing the stack, business logic discussions, planning docs, security review    |
| Antigravity (agentic IDE) | Gemini 4 Argon    | Setting up `AGENTS.md` / `log.txt`, state & DST analysis, `/interview-me` session |
| Antigravity (agentic IDE) | Gemini 3.8 Flash  | Refinement validation (two-column UI, member conflict filtering, atomic reschedule) |

**Agent features used:**
- Planning mode (`/plan`) to draft and review plans before any files were written
- Skill `/interview-me` (`interview-me`) to stress-test scope, reminder triggers, minimum booking notice, and schedule-edit edge cases
- Skill `/context-engineering` (`context-engineering`) to audit project rules, context hierarchy, and session-boundary readiness before scaffolding
- Skill `/idea-refine` (`idea-refine`) to stress-test all design decisions against the brief's requirements and surface hidden UX/technical assumptions
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
| Scaffold       | *(to be filled in)*                                                               |                                                        |

## Where I overrode the AI

### 1. Reminders: pg-boss instead of a hand-written table

- **AI suggested:** a plain `reminders` table polled with `FOR UPDATE SKIP LOCKED`
- **I chose:** pg-boss, for built-in retries, scheduling and monitoring, and an easy upgrade to email or SMS
- **What I added:** idempotent delivery (unique key + `ON CONFLICT DO NOTHING`), queuing in the same transaction,
  and a re-check at send time, so the brief's "delivered exactly once" requirement still holds

### 2. Slot layout: split availability windows + flexible start times instead of a fixed hourly grid

- **AI suggested:** an hourly grid (one working range per day, sessions start on the hour, with a fixed 10-minute break)
- **I chose:** up to 3 availability windows per weekday (each ≥ 50 minutes), a buffer each professional picks from **10, 20, or 30 minutes**, and start times every 10 minutes
- **Why:** supports real-world split shifts (such as lunch breaks), gives members more start-time flexibility, and gives professionals simple buffer choices
- **Effect:** validation enforces non-overlapping windows ≥ 50 mins per day, and the double-booking constraint covers session + buffer (`blocked_until`)

### 3. Web framework: Next.js instead of React + Vite

- **AI suggested:** a plain React + Vite SPA
- **I chose:** Next.js (App Router) paired with the standalone Fastify + Zod API
- **Why:** Next.js gives structured file-based routing, layouts, and a production growth path (such as SSR/SEO for public professional profiles), while `/api` rewrites and client-rendered calendar views keep the clean Fastify boundary and avoid timezone hydration issues

### 4. Notification triggers (`/interview-me`): no notification on initial booking

- **AI suggested:** sending an immediate in-app notification on every new booking in addition to 24h/1h reminders and cancel/reschedule updates
- **I chose:** only the scheduled 24h and 1h reminders plus cancel and reschedule notifications (no new-booking notification)
- **Why:** matches the specification (`"When a session is booked, reminders are scheduled for 24 hours and 1 hour before it starts... Cancelling or rescheduling updates the reminders"`) and avoids cluttering the notification list with redundant confirmation noise
