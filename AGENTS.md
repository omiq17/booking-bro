# Agent Guidelines & Project Context (`AGENTS.md`)

This document is the primary context and rulebook for AI coding agents working on **BookingBro — A Session Booking App with Reminders**.

## 1. Tech Stack & Monorepo Layout

- **Monorepo (`pnpm` workspaces):** `apps/api` (backend), `apps/web` (frontend), `packages/shared` (Zod schemas, types, Luxon slot/timezone helpers).
- **Backend (`apps/api`):** Node.js, TypeScript, Fastify, Zod, Drizzle ORM, PostgreSQL (`btree_gist` exclusion constraints), `pg-boss` (in-app reminder jobs), `argon2` (`argon2id`).
- **Frontend (`apps/web`):** Next.js (App Router), TypeScript, TanStack Query (server-state cache & 15s notification polling), Tailwind CSS (`rewrites()` proxying `/api/*` to Fastify).
- **Time & Timezones:** Luxon (`timestamptz` UTC in DB and API payloads; IANA timezone names stored per user and used for slot generation and UI display).
- **Testing:** Vitest + Testcontainers (real PostgreSQL for concurrency and exclusion-constraint tests).

### Standard Commands
- **Install:** `pnpm install`
- **Dev (all):** `pnpm dev`
- **Build:** `pnpm build`
- **Test (single command):** `pnpm test`
- **Typecheck:** `pnpm typecheck`
- **Docker (Postgres + API + Web + seed):** `docker compose up`

## 2. Domain Invariants & Code Conventions

- **Session Duration:** Always **50 minutes** (`end_at = start_at + 50m`).
- **Availability Windows:** Up to **3 windows per weekday** per professional, aligned to 10-minute boundaries, each **≥ 50 minutes** in real elapsed UTC time, strictly non-overlapping with a gap (`prev.end < next.start`).
- **Buffer & Start Grid:** Professionals choose a buffer of **10, 20, or 30 minutes** (default 10), saved per booking (`blocked_until = end_at + buffer`). Bookable start times step every **10 minutes** (`09:00, 09:10, …`) and are computed **on the fly**.
- **Booking & Cancellation Rules:**
  - **2-hour minimum booking notice:** `start_at >= now() + 2 hours`.
  - **24-hour member lock:** Members can cancel or reschedule only when `start_at - now() >= 24 hours` (blocked within 24 hours). Professionals can cancel at any time.
  - **Schedule edits:** Changing working hours or buffer updates unbooked slots immediately; existing `booked` sessions remain valid and untouched.
  - **No double-booking:** Enforced in Postgres via `EXCLUDE USING gist` on `professional_id` (`[start_at, blocked_until)`) and `member_id` (`[start_at, end_at)`) where `status = 'booked'`. The slot generator also filters out slots overlapping any of the requesting member's existing bookings.
  - **Atomic Reschedule:** In one transaction, marks existing session `status = 'rescheduled'`, cancels old reminder jobs, and inserts a new session row (`status = 'booked'`) with new reminders.
- **Calendar UI Layout:** Two-column layout (left: 4-week date picker; right: Morning/Afternoon/Evening time pills for selected date) to manage 10-minute slot density.
- **Reminders:** 24h and 1h before `start_at` for both member and professional via `pg-boss` (skipping any already in the past), delivered idempotently (`UNIQUE (session_id, user_id, kind)` + `ON CONFLICT DO NOTHING`) and re-checked at send time. Cancelling or rescheduling updates the jobs and creates a cancel/reschedule notification (no notification on initial booking).

## 3. Core Engineering & Security Boundaries

- **Human Ownership & Living Docs:** Keep [DECISIONS.md](DECISIONS.md) and [AI_USAGE.md](AI_USAGE.md) updated whenever an architectural/product decision is made or refined, or when a skill/subagent is used.
- **Server-Side Identity Only:** Always resolve the authenticated user from the server session cookie (`req.user`), never from a client-supplied user ID.
- **Synthetic Data Only:** Use fictional names, emails, and schedules in code, tests, seeds, and logs. Never include real personal or health data.
- **No Secrets in Git or Logs:** Never commit or log passwords, password hashes, session tokens, API keys, or `.env` values. Redact sensitive strings as `[REDACTED]`.

## 4. Turn-by-Turn Prompt Log (`log.txt`)

Every user interaction with the AI assistant is recorded in `/Users/rakib/code/booking-bro/log.txt` at the repository root.

- **Per-Turn Entries Only:** Log one entry per user prompt (no session-start banners).
- **Append-Only:** New turns are appended to the end of `log.txt`. Never delete or reorder past turns.
- **Token Telemetry:** Read `input_tokens`, `cache_read_tokens`, and `output_tokens` for the turn from `.system_generated/logs/transcript.jsonl`.

### Entry Template

```markdown
---
### Turn #<NN> — <YYYY-MM-DD HH:MM:SS (UTC+8)> — <Short Title>
- **Model:** `<Model Name>` (`<Tool/IDE>`) | **Branch:** `<git_branch>`
- **Tokens:** Input: `<in>` (Cached: `<cached>`) | Output: `<out>`

**User Prompt:**
> <Verbatim user prompt, with any secrets replaced by [REDACTED]>

**Output Summary:**
<Concise summary of the explanation, decision, or code produced>

**Actions:**
- <Files created/edited or commands executed>
```
