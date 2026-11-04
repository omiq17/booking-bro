# AGENTS.md — Agent Operating & Logging Rules

## 1. What This Repo Is

This repository contains the **ThoughtFull Engineering Take-Home Assignment: Session Booking with Reminders** — an end-to-end mental health session booking platform where members discover professionals across timezones, view available 50-minute slots over a 4-week window, book/cancel/reschedule sessions safely without double-booking, and receive reliable 24-hour and 1-hour in-app reminders.

## 2. Log File — Location And Lifecycle

- **Path:** The session and turn tracking log file is strictly named `log.txt` and must reside in the **repository root** directory (`/Users/rakib/code/booking-bro/log.txt`) next to `AGENTS.md`.
- **Relative Resolution:** Always resolve `log.txt` relative to the repository root where `AGENTS.md` lives so it works across clones, containers, and OS environments.
- **Append-Only:** All AI coding assistants, agents, sub-agents, and worktrees must write to this shared `log.txt` file in an **append-only** manner. Never overwrite, reorder, truncate, or delete prior log entries.

## 3. Session Start

At the beginning of any new agent session (or when switching harnesses/sessions):
1. Read `AGENTS.md` and `DECISIONS.md`.
2. Check that `log.txt` exists at the repository root (create it if missing).
3. Append a `SESSION START` entry following **§5.1** before or alongside the first response.

## 4. Project Rules

- **Own Work & Explainability:** Every decision and line of code must be clear, concise, and explainable. Record architectural choices and trade-offs in `DECISIONS.md` and AI collaboration notes in `AI_USAGE.md`.
- **Fictional Data Only:** Never use or log real personal or health data anywhere in code, tests, seeds, or `log.txt`.
- **Credential & Secret Security:** Never commit secrets or log credentials. Load configuration via environment variables or uncommitted `.env` files.
- **Backend Access Control:** Always identify the user from the server-side session token/cookie (`req.user`), never from a client-supplied user ID.

## 5. Log Format

### 5.1 Session Start Entry

Append this block whenever a new coding session starts:

```markdown
## [ISO-8601 TIMESTAMP] SESSION START
tool=<exact_harness_or_coding_agent_name> model=<exact_runtime_model_name>
Repo Root: <absolute_path>
Branch: <git_branch_or_unknown>
Worktree: <worktree_path_or_main>
Parent Agent: <parent_agent_name_or_none>
Language: ts
Time Remaining: <Xd Yh Zm, or not configured>
```

**Mandatory `tool=` and `model=` rules:**
- `tool=` and `model=` must use exact runtime names (e.g., `tool=Antigravity`, `model=Gemini 4 Argon` or `model=Claude Opus 5.5`).
- Never use placeholders like `unknown`, `default`, or generic labels like `AI` or `LLM`.

### 5.2 Per-Turn Entry

Append this block after every user message the agent responds to:

```markdown
## [ISO-8601 TIMESTAMP] <short title, max 80 chars>
User Prompt (verbatim, secrets redacted): <exact user message, with secrets replaced by [REDACTED]>
Agent Response Summary: <2-5 sentences: what was done, why, and any important decision>
Actions:
- <file edited / command run / tool invoked>
Context: tool=<exact_harness_or_coding_agent_name> model=<exact_runtime_model_name> Branch: <git_branch_or_unknown>
```

### 5.3 Sub-Agent & Worktree Rules

- Every spawned sub-agent or isolated worktree agent must append its own `SESSION START` (with `Parent Agent: <parent_conversation_or_agent_id>`) and `Per-Turn Entry` blocks directly to the top-level repository `log.txt`.
- Sub-agents must never create separate per-folder `log.txt` files.

### 5.4 What Not To Log

Never write any of the following to `log.txt`:
- API keys, tokens, session cookies, passwords, password hashes, OAuth codes, database credentials, or private keys (replace with `[REDACTED]` if present in a prompt).
- Real personal identifiable information (PII) or health data.
- Full contents of large files, build outputs, or binary blobs — reference them by file path instead.
