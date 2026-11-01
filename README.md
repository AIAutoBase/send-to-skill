# send-to

![send-to: say "send it to telegram" and a card with what was done lands in your chat](assets/send-to-banner.png)

Repos: [AIAutoBase/send-to-skill](https://github.com/AIAutoBase/send-to-skill) · [roughboy99/send-to-skill](https://github.com/roughboy99/send-to-skill)

A Claude Code skill. When a piece of work is done you say **"send it to telegram"**,
**"mándalo a buzz y whatsapp"** or just **`/send-to`**, and a short card with what
was done, what is pending and how to resume lands in the chat you chose.

```
✅ my-shop-api — 2026-11-01 17:42

Done
- Added /orders/export (CSV), tested with 3 sample orders
- Fixed the timezone bug in invoice dates

Pending / next
- Deploy to staging

Verified: unit tests pass (14/14)
Resume: claude --resume 2dbbff89
```

Targets: **Telegram · WhatsApp (Evolution API or Twilio) · Buzz · iMessage (Mac) ·
any webhook (n8n, Make, Zapier) · Slack · Discord.** Several at once. One failing
target never blocks the others. Node 18+, zero dependencies, secrets stay in a
file outside the skill.

## Install

```powershell
git clone https://github.com/AIAutoBase/send-to-skill.git   # mirror: https://github.com/roughboy99/send-to-skill
Copy-Item -Recurse send-to-skill/skills/send-to "$HOME/.claude/skills/"      # macOS/Linux: cp -r send-to-skill/skills/send-to ~/.claude/skills/
New-Item -ItemType Directory -Force "$HOME/.claude/send-to"
Copy-Item "$HOME/.claude/skills/send-to/config.example.json" "$HOME/.claude/send-to/config.json"
node "$HOME/.claude/skills/send-to/send-to.mjs" demo
```

Then open Claude Code and say `/send-to setup`, or follow the per-target steps in
[skills/send-to/README.md](skills/send-to/README.md) (Telegram, WhatsApp, Buzz,
iMessage, n8n/Make/Zapier, Slack, Discord) and run
`node ~/.claude/skills/send-to/send-to.mjs test --to telegram`.

## How it works

1. Claude reads your phrase and picks the targets (none named → the `default` list in your config).
2. It writes a short card from the session: done, pending, what was verified, how to resume.
3. If the project has session notes (`.claude/sessions/*.md` or `.claude/SESSION.md`) they go along as an attachment where the target allows it.
4. `send-to.mjs` delivers and prints one line per target: ✅ sent, ❌ failed and why, ⏭ skipped and why.

Nothing is ever sent unless you ask for it in that turn.

## License

MIT. Buzz is a project by Block, Inc. Evolution API, Twilio, Telegram, Slack,
Discord, n8n, Make and Zapier belong to their owners.

---

## 📋 Latest Changes

<!-- LATEST:BEGIN -->
## [0.3.0] - 2026-11-01

### Added
- add robot courier hero illustration and 1280x640 README banner



## [0.2.0] - 2026-11-01

### Added
- send-to skill public release (Telegram, WhatsApp, Buzz, iMessage, webhook, Slack, Discord)



## [0.1.0] - 2026-11-01

### Added
- Initial release. Project established with local-git versioning.
<!-- LATEST:END -->

See full [CHANGELOG.md](CHANGELOG.md) for complete history.



