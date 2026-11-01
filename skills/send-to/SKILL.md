---
name: send-to
description: Send a short record of what was done this session (and optionally the full session notes) to Telegram, WhatsApp, Buzz, iMessage, an n8n/Make/Zapier webhook, Slack or Discord. Use when the user says "send to", "send it to", "envíalo a", "mándalo a", "/send-to", "post this to telegram/buzz/whatsapp", or wants a record of the session delivered somewhere. Also handles "/send-to setup" and "/send-to test".
---

# send-to

Script: `~/.claude/skills/send-to/send-to.mjs` (Node 18+, no dependencies). Run it with its full path: `node ~/.claude/skills/send-to/send-to.mjs ...` (Windows: `node $HOME\.claude\skills\send-to\send-to.mjs ...`).
Config lives OUTSIDE the skill folder so updates never clobber it: `~/.claude/send-to/config.json` and secrets in `~/.claude/send-to/.env`. Never print, echo or paste a token, key or webhook URL; refer to them by variable name.

## 1. Which targets

Read the user's phrase. Words map to targets: telegram/tg · whatsapp/wa · buzz · imessage/messages · n8n/make/zapier/webhook · slack · discord. Several at once is fine ("send to buzz and telegram" → `--to buzz,telegram`). No target named → omit `--to` and the config's `default` list is used (shipped default: telegram). If the user names a target that is not configured, the script says so; offer `/send-to setup` for that target instead of guessing.

## 2. Build the card (what gets sent)

Write a short plain-text card to a temp file (for example `$TMPDIR/send-to-card.md`), then pass it with `--text-file`. Keep it under 30 lines, no secrets, no raw logs. Template:

```
✅ <project or folder name> — <YYYY-MM-DD HH:mm>

Done
- <one line per finished item, what changed and where>

Pending / next
- <one line per open item, or "nothing">

Verified: <what was actually tested, or "not verified">
Resume: claude --resume <session id, if known>
```

Use the markdown only where it reads well as plain text (Telegram and WhatsApp show it raw). If the user says what to send ("send the deploy summary", "send the error"), that content replaces the template.

## 3. Attach the full notes when they exist

Pass `--file <path>` when there is a fuller record worth attaching, in this order of preference: a file the user named; the newest file in `.claude/sessions/` of the current project; `.claude/SESSION.md`; otherwise no attachment (the card alone is fine). Attachments go where the target supports them (Telegram, WhatsApp via Evolution, Buzz, Discord, webhook as base64); the script notes when a target cannot carry a file.

## 4. Send and report

```
node ~/.claude/skills/send-to/send-to.mjs --to telegram,buzz --text-file "<card>" [--file "<notes>"] [--project "<name>"]
```

The script prints one line per target (✅ sent, ❌ failed with reason, ⏭ skipped with reason) and keeps going when one fails. Repeat those lines to the user verbatim and nothing more. Exit 1 means at least one target failed: say which and the reason, do not retry blindly. Add `--dry-run` first when the user is unsure what will go out.

## Setup and test

- `/send-to setup` or a missing config: open `README.md` in this folder (`~/.claude/skills/send-to/README.md`), ask which targets the user wants, walk them through that target's section only, write `~/.claude/send-to/config.json` (start from `config.example.json`) and `~/.claude/send-to/.env` (mode 600 on macOS/Linux), then run `test`.
- `/send-to test [--to x]`: `node ~/.claude/skills/send-to/send-to.mjs test --to telegram` sends a one-line test message. Run it after every setup change.
- `targets`: `node ~/.claude/skills/send-to/send-to.mjs targets` lists what is configured and whether it can run on this machine (iMessage only works on macOS).
- `demo`: offline self-check, no network, no config needed.

## Rules

- Nothing is sent without the user asking for it in this turn. Do not auto-send at session end unless a session-closing skill the user installed calls this one.
- One card per request. Do not split one summary into several messages by hand; the script chunks long text itself.
- If the card would contain credentials, file paths with secrets, or customer data, say so and strip them before sending.
