# AI Usage

I used AI as a pair-programmer and sounding board. Final decisions and every line of code are mine,
and I can explain them.

## Tools

| Tool                      | Model             | Used for                                                                          |
| ------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| Antigravity (agentic IDE) | Claude Sonnet 5.5 | Reading the task PDF and summarising the requirements                             |
| Antigravity (agentic IDE) | Claude Opus 5.5   | Choosing the stack, business logic discussions, planning docs, security review    |
| Antigravity (agentic IDE) | Gemini 4 Argon    | Setting up `AGENTS.md` and the append-only `log.txt` audit trail                  |

**Agent features used:** planning mode (`/plan`) to draft and review plans before any files were written, and a workspace rule (`.agents/rules/logging.md`) enforcing turn-by-turn logging into [log.txt](log.txt) per [AGENTS.md](AGENTS.md).
No subagents used so far.

## How I used it, by phase

| Phase          | What the AI did                                                                   | What I decided                                         |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Task overview  | Read the PDF and summarised requirements                                          | Checked it against the original brief                  |
| Tech stack     | Compared options (Vite vs Next.js, date-fns vs Luxon, Redis vs Postgres queues, JWT vs sessions) | Chose TypeScript, Next.js, Fastify + Zod, Postgres, Luxon, pg-boss |
| Double-booking | Explained 9 approaches and their trade-offs                                       | Chose Postgres exclusion constraints                   |
| Slot layout    | Proposed a fixed hourly grid and reviewed my alternative for edge cases           | Chose flexible 10-minute steps with a professional-set buffer |
| Scaffold       | *(to be filled in)*                                                               |                                                        |

## Where I overrode the AI

### 1. Reminders: pg-boss instead of a hand-written table

- **AI suggested:** a plain `reminders` table polled with `FOR UPDATE SKIP LOCKED`
- **I chose:** pg-boss, for built-in retries, scheduling and monitoring, and an easy upgrade to email or SMS
- **What I added:** idempotent delivery (unique key + `ON CONFLICT DO NOTHING`), queuing in the same transaction,
  and a re-check at send time, so the brief's "delivered exactly once" requirement still holds

### 2. Slot layout: flexible start times instead of a fixed hourly grid

- **AI suggested:** an hourly grid (sessions start on the hour, with a fixed 10-minute break)
- **I chose:** a buffer each professional sets (10–60 minutes) and start times every 10 minutes
- **Why:** more choice for members and more control for professionals
- **Effect:** the double-booking constraint now covers session + buffer (`blocked_until`)

### 3. Web framework: Next.js instead of React + Vite

- **AI suggested:** a plain React + Vite SPA
- **I chose:** Next.js (App Router) paired with the standalone Fastify + Zod API
- **Why:** Next.js gives structured file-based routing, layouts, and a production growth path (such as SSR/SEO for public professional profiles), while `/api` rewrites and client-rendered calendar views keep the clean Fastify boundary and avoid timezone hydration issues
