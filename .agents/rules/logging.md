---
description: Append a structured per-turn entry with readable time and token stats to log.txt
---

# Per-Turn Audit Logging (`log.txt`)

On every user turn in `/Users/rakib/code/booking-bro`, append a new turn entry to `/Users/rakib/code/booking-bro/log.txt` using `write_file` (`Append: true`) following `/Users/rakib/code/booking-bro/AGENTS.md`:

1. **No Session Start Banner:** Only log per-turn entries.
2. **Token Stats:** Sum `input_tokens`, `cache_read_tokens`, and `output_tokens` for the turn from `<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` (if the final response step is still in progress when writing `log.txt`, include tokens recorded across the turn's steps so far).
3. **Format:**
   ```markdown
   ---
   ### Turn #<NN> — <YYYY-MM-DD HH:MM:SS (UTC+8)> — <Short Title>
   - **Model:** `<Model Name>` (`Antigravity`) | **Branch:** `<git_branch>`
   - **Tokens:** Input: `<in>` (Cached: `<cached>`) | Output: `<out>`

   **User Prompt:**
   > <Verbatim user prompt, secrets redacted>

   **Output Summary:**
   <Concise summary of the response and decisions>

   **Actions:**
   - <Files modified or commands run>
   ```
