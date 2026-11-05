# Statement of Intent — BookingBro

Confirmed via `/interview-me` on 2026-11-05.

- **Outcome:** **BookingBro** — a full-stack TypeScript session-booking web application (`apps/api` Fastify + Zod + Drizzle + Postgres + `pg-boss`, `apps/web` Next.js App Router + TanStack Query + Tailwind CSS, `packages/shared` Zod + Luxon) for booking 50-minute sessions with automated reminders.
- **User:** Members seeking support and professionals managing their availability across different countries and IANA timezones.
- **Why now:** Deliver a complete, end-to-end booking and reminder system where cross-timezone/DST accuracy, database-enforced concurrency, and clean, explainable code are first-class requirements.
- **Success:**
  1. One command (`docker compose up`) boots Postgres, runs migrations, seeds demo accounts (including near-due sessions so `pg-boss` reminders are immediately visible), and starts the API and web app.
  2. One command (`pnpm test`) runs unit and real-Postgres integration tests covering on-the-fly slot generation (up to 3 windows/day ≥ 50 mins, 10-min steps, 10/20/30-min buffers), DST/timezone transitions, the 2-hour minimum booking notice, the 24-hour member cancel/reschedule lock, concurrent double-booking and member-overlap rejection (`EXCLUDE USING gist`), and idempotent 24h/1h + cancel/reschedule notifications.
  3. Clear, up-to-date `README.md`, [DECISIONS.md](../../DECISIONS.md), [AI_USAGE.md](../../AI_USAGE.md), and append-only [log.txt](../../log.txt).
- **Constraint:** Every line of code is clean and human-owned; user identity always resolves from the server-side `HttpOnly` session cookie (`argon2id` password hashes); synthetic data only.
- **Out of scope:** Blocked-off holiday dates, live cloud deployment, Redis/BullMQ, Redux/Zustand, new-booking notifications, password reset, email/SMS/push delivery, OAuth, payments, video calls, recurring sessions, and external calendar sync.
