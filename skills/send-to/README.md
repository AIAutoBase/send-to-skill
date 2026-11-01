# send-to — a Claude Code skill that delivers your session record anywhere

When you finish a piece of work in Claude Code you say **"send it to telegram"**, **"mándalo a buzz y whatsapp"** or just **`/send-to`**, and a short card lands in the chat you chose:

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

Targets supported: **Telegram · WhatsApp (Evolution API or Twilio) · Buzz · iMessage (Mac only) · any webhook (n8n, Make, Zapier) · Slack · Discord.** You can send to several at once. One failing target never blocks the others.

The skill is two files: `SKILL.md` tells Claude what to write and when; `send-to.mjs` does the sending (Node 18+, zero dependencies). Your configuration and secrets live outside the skill folder, so updating the skill never touches them.

---

## Install

1. Copy the `send-to` folder to `~/.claude/skills/send-to/` (Windows: `%USERPROFILE%\.claude\skills\send-to\`).
2. Create the config folder `~/.claude/send-to/` and copy `config.example.json` there as `config.json`. Delete the targets you will not use.
3. Create `~/.claude/send-to/.env` with the secrets your targets need (one `KEY=value` per line). On macOS/Linux: `chmod 600 ~/.claude/send-to/.env`.
4. Run the self-check and then a real test:

```
node ~/.claude/skills/send-to/send-to.mjs demo
node ~/.claude/skills/send-to/send-to.mjs test --to telegram
```

Inside Claude Code, `/send-to setup` walks you through the same steps.

### config.json in one minute

```json
{
  "default": ["telegram"],
  "targets": {
    "telegram": { "type": "telegram", "token": "$TELEGRAM_BOT_TOKEN", "chat_id": "$TELEGRAM_CHAT_ID" }
  }
}
```

- `default`: where a plain `/send-to` goes. One or many.
- Each key under `targets` is a name you can say ("send to family" works if you named a target `family`). `type` picks the sender.
- Any value written as `$NAME` is read from `~/.claude/send-to/.env` or from your environment. Keep secrets there, not in the JSON.
- Values that are not secret (chat ids, phone numbers, channel ids, URLs without tokens) can be written directly.

### Command reference

```
node send-to.mjs --to telegram,buzz --text-file card.md [--file notes.md] [--title "..."] [--project name] [--dry-run]
node send-to.mjs test [--to name]     one-line test message
node send-to.mjs targets              what is configured, and whether it can run on this OS
node send-to.mjs demo                 offline self-check
```

Exit code 0 = everything sent, 1 = at least one target failed, 2 = bad input or missing config.

---

## Target setup, step by step

### Telegram

You need a bot token and the id of the chat the bot should write to.

1. In Telegram open **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`. BotFather replies with the token (looks like `123456789:AAF...`). That is `TELEGRAM_BOT_TOKEN`.
2. Open a chat with your new bot and send it any message. Bots cannot write to you until you write first.
3. Get the chat id:
   ```
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```
   Look for `"chat":{"id":123456789,...}`. That number is `TELEGRAM_CHAT_ID`.
   - For a **group**: add the bot to the group, send a message in the group, run the same curl. Group ids are negative (`-100...` for supergroups).
   - If the result is empty: send another message and retry, or run `curl -s "https://api.telegram.org/bot<TOKEN>/deleteWebhook"` once (a leftover webhook swallows updates).
4. `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456789:AAF...
   TELEGRAM_CHAT_ID=123456789
   ```
5. Config: `{ "type": "telegram", "token": "$TELEGRAM_BOT_TOKEN", "chat_id": "$TELEGRAM_CHAT_ID" }`
6. Test: `node ~/.claude/skills/send-to/send-to.mjs test --to telegram`

Limits handled for you: messages over 4,000 characters are split; attachments go as a document.

### WhatsApp with Evolution API (self-hosted, free)

Evolution API links **your own WhatsApp number** through the official multi-device protocol and exposes a REST API. Best option if you already run Docker on a server.

1. Deploy Evolution API v2 with Docker following the official guide: <https://doc.evolution-api.com> (Install → Docker). Minimum: the API container, PostgreSQL and Redis. Set `AUTHENTICATION_API_KEY` to a long random string in the compose `.env`. Keep the port on `127.0.0.1` or behind HTTPS; the API key is the only lock.
2. Create an instance (replace host and key):
   ```
   curl -s -X POST http://127.0.0.1:8080/instance/create \
     -H "apikey: <API_KEY>" -H "content-type: application/json" \
     -d '{"instanceName":"me","integration":"WHATSAPP-BAILEYS","qrcode":true}'
   ```
3. Show the QR and scan it from the phone that owns the number (WhatsApp → Linked devices → Link a device):
   ```
   curl -s http://127.0.0.1:8080/instance/connect/me -H "apikey: <API_KEY>"
   ```
   The response holds a base64 QR image; open it in a browser (`data:image/png;base64,...`) or use the Evolution manager UI at `/manager`.
4. Confirm: `curl -s http://127.0.0.1:8080/instance/connectionState/me -H "apikey: <API_KEY>"` should say `"state":"open"`.
5. `.env`: `EVOLUTION_API_KEY=<API_KEY>`
6. Config. `to` is the destination number with country code, digits only, no `+` (you can send to yourself):
   ```json
   { "type": "whatsapp", "provider": "evolution", "url": "http://127.0.0.1:8080", "instance": "me", "api_key": "$EVOLUTION_API_KEY", "to": "17875551234" }
   ```
7. Test: `node ~/.claude/skills/send-to/send-to.mjs test --to whatsapp`

Notes: if the instance drops to `close` (phone offline for weeks, number re-registered), repeat step 3. Attachments are sent as a document with the card as caption.

### WhatsApp with Twilio (hosted)

Good when you do not run a server. Twilio's sandbox is free for testing; a production sender needs WhatsApp Business approval.

1. Create a Twilio account, open **Messaging → Try it out → Send a WhatsApp message**. Follow the sandbox instructions: from your phone send the join code (`join <two-words>`) to the sandbox number shown (usually `+1 415 523 8886`).
2. From the Twilio console copy **Account SID** and **Auth Token**.
3. `.env`:
   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   ```
4. Config (`from` is the sandbox or your approved sender, `to` is your phone, both with the `whatsapp:` prefix and E.164 format):
   ```json
   { "type": "whatsapp", "provider": "twilio", "account_sid": "$TWILIO_ACCOUNT_SID", "auth_token": "$TWILIO_AUTH_TOKEN", "from": "whatsapp:+14155238886", "to": "whatsapp:+17875551234" }
   ```
5. Test: `node ~/.claude/skills/send-to/send-to.mjs test --to whatsapp-twilio`

Limits: the sandbox only reaches phones that joined it, and only for 24 hours after your last message to it (send the join code again if a test fails with error 63016). Files are not attached on Twilio (it needs a public media URL); the card text is still sent.

### Buzz (Block's team chat on your own relay)

[Buzz](https://github.com/block/buzz) is a self-hosted team chat where people and AI agents share channels. send-to posts with the official `buzz` CLI, as a member identity of your relay.

**A. Get the CLI.** Download it from the project's releases or build it: `cargo build --release -p buzz-cli` inside a clone of the repo (needs Rust; ~5 minutes). Put the binary somewhere on `PATH` or note its full path.

**B. Create an identity for send-to.** Generate a Nostr key pair, for example on the relay host with `buzz-admin generate-key` (prints a public key and a secret `nsec...`). Treat the secret like a password. Then the relay owner authorizes the public key: `./run.sh add-member <pubkey>` in the relay's compose folder, or claim an invite link with that key. Membership of the relay and membership of a channel are two different things.

**C. Find the channel and join it.** With the key exported:
```
export BUZZ_RELAY_URL=https://buzz.example.com
export BUZZ_PRIVATE_KEY=nsec1...
buzz channels list                      # prints channel UUIDs
buzz channels join --channel <uuid>     # once per channel
buzz users set-profile --name "Claude"  # optional: the display name people will see
```
`BUZZ_RELAY_URL` must be the public **https** URL of the relay; the relay's request signing rejects `http://` or a LAN address when it does not match its own canonical URL.

**D. Configure.** Two modes:

- *Local* (the `buzz` binary runs on this machine):
  ```json
  { "type": "buzz", "channel": "<uuid>", "relay": "https://buzz.example.com", "private_key": "$BUZZ_PRIVATE_KEY", "bin": "buzz" }
  ```
  `.env`: `BUZZ_PRIVATE_KEY=nsec1...`

- *Remote over SSH* (the binary and the key live on a server you can `ssh` into without a password). The key never leaves that server:
  ```json
  { "type": "buzz", "channel": "<uuid>", "ssh": "user@server", "env_file": "~/.config/send-to/buzz.env", "bin": "/home/user/bin/buzz" }
  ```
  On the server create `~/.config/send-to/buzz.env` (mode 600) with `BUZZ_RELAY_URL=https://...` and `BUZZ_PRIVATE_KEY=nsec1...`. Attachments are copied with `scp` to `/tmp` on the server and deleted after the send.

**E. Test:** `node ~/.claude/skills/send-to/send-to.mjs test --to buzz`

Notes: markdown renders natively in Buzz, so the card looks best there. Uploaded files keep no filename on the relay (they are addressed by hash); the card says what the file is. Videos with metadata are rejected by the relay (`422 non-canonical metadata`); strip metadata with ffmpeg first if you ever attach one.

### iMessage (macOS only)

send-to drives the **Messages** app that is already signed in on the Mac where Claude Code runs, through AppleScript. Nothing to install and no API key, but it only works on that Mac. On Windows or Linux the target is reported as skipped, never as an error.

1. Open **Messages** on the Mac and make sure it is signed in with your Apple ID (Messages → Settings → iMessage). The recipient must be an iMessage user (blue bubbles); SMS relay through an iPhone is not used.
2. Make sure a conversation with the recipient already exists in Messages (send them one message by hand once).
3. Config (phone in E.164 format or the Apple ID email):
   ```json
   { "type": "imessage", "to": "+17875551234" }
   ```
   Sending to yourself works: use your own number or Apple ID.
4. Test: `node ~/.claude/skills/send-to/send-to.mjs test --to imessage`

   The first time, macOS asks whether the app running Claude Code (Terminal, iTerm, VS Code...) may control Messages. Click **Allow**. If you clicked Don't Allow, fix it in **System Settings → Privacy & Security → Automation** and enable Messages under that app.

Notes: attachments are sent as a second message. Group chats are not supported; name a person.

### Webhook: n8n, Make, Zapier, your own endpoint

send-to POSTs one JSON body per send. Anything that can receive a webhook can react: append a row to a sheet, email the summary, log to Notion, trigger a deploy.

Payload:
```json
{
  "source": "send-to",
  "title": "✅ my-shop-api — 2026-11-01 17:42",
  "text": "the whole card as plain text",
  "project": "my-shop-api",
  "host": "my-laptop",
  "sent_at": "2026-11-01T21:42:10.000Z",
  "file": { "name": "2026-11-01-session.md", "content_base64": "..." }
}
```
`file` is `null` when nothing was attached.

**n8n**
1. New workflow → add a **Webhook** node. HTTP Method `POST`, Path `send-to`, Respond `Immediately`.
2. Authentication → **Header Auth** → create a credential: name `x-send-to-secret`, value = a long random string.
3. Add what should happen next (for example **Google Sheets → Append row** with `{{ $json.body.title }}` and `{{ $json.body.text }}`, or **Gmail → Send**). To use the attachment, add a **Convert to File** node with `{{ $json.body.file.content_base64 }}` (Base64 → file).
4. **Activate** the workflow. Copy the **Production URL** (`https://n8n.example.com/webhook/send-to`). The Test URL (`/webhook-test/`) only answers while you click "Listen for test event".
5. `.env`: `N8N_WEBHOOK_SECRET=<the same random string>`
6. Config:
   ```json
   { "type": "webhook", "url": "https://n8n.example.com/webhook/send-to", "headers": { "x-send-to-secret": "$N8N_WEBHOOK_SECRET" } }
   ```
7. Test: `node ~/.claude/skills/send-to/send-to.mjs test --to n8n`

**Make / Zapier / anything else:** create a "Custom webhook" (Make) or "Catch Hook" (Zapier) trigger, copy its URL into `url`, no headers needed. Send a test so the platform learns the payload shape, then build the rest of the scenario.

### Slack

1. <https://api.slack.com/apps> → **Create New App → From scratch** → name it, pick your workspace.
2. **Incoming Webhooks** → turn on → **Add New Webhook to Workspace** → choose the channel → copy the URL (`https://hooks.slack.com/services/...`).
3. `.env`: `SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...`
4. Config: `{ "type": "slack", "url": "$SLACK_WEBHOOK_URL" }`
5. Test: `node ~/.claude/skills/send-to/send-to.mjs test --to slack`

Incoming webhooks carry text only; attachments are skipped with a note.

### Discord

1. In your server, open the channel → **Edit channel → Integrations → Webhooks → New Webhook** → **Copy Webhook URL**.
2. `.env`: `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...`
3. Config: `{ "type": "discord", "url": "$DISCORD_WEBHOOK_URL" }`
4. Test: `node ~/.claude/skills/send-to/send-to.mjs test --to discord`

Messages over 1,900 characters are split; attachments are uploaded as files.

---

## Security

- Secrets live only in `~/.claude/send-to/.env` (mode 600) or your environment. The JSON holds `$NAMES`, never values. Never commit either file.
- A bot token or webhook URL is a password: anyone holding it can post as you. Rotate it from the provider if it leaks (BotFather `/revoke`, Slack/Discord delete the webhook, Evolution change `AUTHENTICATION_API_KEY`).
- The card is written by Claude from the session. The skill instructs it to strip credentials, customer data and raw logs; glance at it with `--dry-run` the first few times.
- Keep Evolution API and n8n behind HTTPS or on localhost. Both are "key equals full access" services.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No config at ...` | Create `~/.claude/send-to/config.json` (copy `config.example.json`). |
| `missing token, chat_id` | The `$NAME` in config has no value: add it to `.env` or export it. |
| Telegram `chat not found` | Send a message to the bot first (DM), or re-check the group id sign. |
| Evolution `401` | Key mismatch: use the value of `AUTHENTICATION_API_KEY` inside the running container. |
| Evolution `state: close` | Re-link the phone (QR). |
| Buzz `auth error` / exit 3 | Public key not a relay member, or `BUZZ_RELAY_URL` is not the relay's public https URL. |
| Buzz "not a channel member" | `buzz channels join --channel <uuid>` once. |
| iMessage `Not authorized to send Apple events` | System Settings → Privacy & Security → Automation → allow Messages for your terminal app. |
| iMessage `Can't get participant` | Start the conversation by hand once, check the number/email format. |
| n8n `404` | Workflow not activated, or you used the test URL. |

## License

MIT. Built by AI Auto Base for the community. Buzz is a project by Block, Inc.; Evolution API, Twilio, Telegram, Slack, Discord and n8n are trademarks of their owners.
