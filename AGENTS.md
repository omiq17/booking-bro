# Agent Guidelines & Prompt Audit Log (`AGENTS.md`)

This document defines the working rules and prompt-logging format for AI coding agents assisting on the **BookingBro- A Session Booking App with Reminders** project.

## 1. Core Engineering Rules

- **Human Ownership:** The developer makes and reviews every architectural and code decision. Record major technical choices and trade-offs in [DECISIONS.md](DECISIONS.md) and AI collaboration notes in [AI_USAGE.md](AI_USAGE.md).
- **Server-Side Identity Only:** Always resolve the authenticated user from the server session (`req.user`), never from a client-supplied user ID.
- **Synthetic Data Only:** Use fictional names, emails, and schedules in code, tests, seeds, and logs. Never include real personal or health data.
- **No Secrets in Git or Logs:** Never commit or log passwords, password hashes, session tokens, API keys, or `.env` values. Redact sensitive strings as `[REDACTED]`.

## 2. Turn-by-Turn Prompt Log (`log.txt`)

Every user interaction with the AI assistant is recorded in `/Users/rakib/code/booking-bro/log.txt` at the repository root.

- **Per-Turn Entries Only:** Log one entry per user prompt (no session-start banners).
- **Append-Only:** New turns are appended to the end of `log.txt`. Never delete or reorder past turns.
- **Token Telemetry:** Read `input_tokens`, `cache_read_tokens`, and `output_tokens` for the turn from the conversation transcript (`.system_generated/logs/transcript.jsonl`).

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
