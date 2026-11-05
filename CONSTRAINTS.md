# Quality Constraints Contract (`CONSTRAINTS.md`)

This document establishes the project's non-negotiable quality bar for **BookingBro**.
Agents and humans must satisfy these checks before declaring any task complete.
**Rule:** This file does not get weakened or bypassed to make a change pass.

---

## 1. The Floor (Always Enforced Across Every Edit)

- **Zero Suppression Comments:** No `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, or `istanbul ignore` comments added to bypass compiler checks or test coverage.
- **Zero Unimplemented Stubs:** No `throw new Error("Not implemented")`, `// TODO: implement`, or empty `catch {}` blocks in committed code.
- **Zero Skipped Tests:** No `.skip` or `.only` left in test files; no tests deleted without explicit human approval.
- **Zero Secrets in Code or Logs:** Passwords, tokens, cookies, and keys must never be committed or logged (redacted as `[REDACTED]`).
- **Zero Unhandled Server Errors:** Every API endpoint returns typed Zod responses and structured JSON error objects (`code`, `message`, `statusCode`).

---

## 2. Enforced with Numbers & Commands

| Dimension | Rule | Checked by | Runs at |
| :--- | :--- | :--- | :--- |
| **Type Safety** | Zero TypeScript compiler errors (`strict: true`, zero `any`) | `pnpm typecheck` | Every edit / build |
| **Code Style & Lint** | Zero lint or formatting errors | `pnpm lint` | Task end, PR |
| **Unit & Integration Tests** | 100% test pass rate across all suites | `pnpm test` | Task end, PR |
| **Core Domain Coverage** | Changed lines in `packages/shared` ≥ 80% covered | `vitest run --coverage` | Task end, PR |
| **Concurrency Guarantees** | Zero double-booking under concurrent requests (SQLSTATE `23P01` mapped to `409`) | Real Postgres integration tests (`apps/api/tests/concurrency.test.ts`) | Task end, PR |
| **Idempotency** | Duplicate reminder job delivery produces 0 duplicate notifications | Real Postgres reminder tests (`apps/api/tests/reminders.test.ts`) | Task end, PR |

---

## 3. Check Commands & Speed Budgets

```bash
# Fast check (< 5s) — run after modifying code
pnpm typecheck

# Verification check (< 30s) — run when finishing a task slice
pnpm typecheck && pnpm test

# Full quality gate — run before committing a completed module
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. Exceptions

| ID | Rule | Scope | Reason | Owner | Expires |
| :--- | :--- | :--- | :--- | :--- | :--- |
| *None* | — | — | — | — | — |
*(No exceptions granted. Any exception requires explicit user sign-off and an expiration date.)*
