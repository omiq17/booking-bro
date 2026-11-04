---
description: Mandatory append-only turn logging to root log.txt following AGENTS.md §5
---

# Mandatory Turn Logging (`log.txt`)

On every user turn in `/Users/rakib/code/booking-bro`, you MUST follow `/Users/rakib/code/booking-bro/AGENTS.md`:

1. **Append-Only:** Append a per-turn entry (§5.2 of `AGENTS.md`) to `/Users/rakib/code/booking-bro/log.txt` using `write_file` with `Append: true` before finishing your response. Never overwrite, reorder, or truncate `log.txt`.
2. **Exact Format:**
   ```markdown
   ## [ISO-8601 TIMESTAMP] <short title, max 80 chars>
   User Prompt (verbatim, secrets redacted): <exact user message, with secrets replaced by [REDACTED]>
   Agent Response Summary: <2-5 sentences: what was done, why, and any important decision>
   Actions:
   - <file edited / command run / tool invoked>
   Context: tool=Antigravity model=<exact_runtime_model_name> Branch: <git_branch_or_unknown>
   ```
3. **No Secrets:** Redact any credentials, tokens, cookies, or keys as `[REDACTED]`.
