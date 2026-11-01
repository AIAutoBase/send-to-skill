#!/usr/bin/env node
// send-to — deliver a short session summary (plus an optional file) to chat targets.
// Node 18+, no dependencies. Config: ~/.claude/send-to/config.json (+ optional .env next to it).
// Usage:
//   node send-to.mjs [send] --to telegram,buzz --title "..." (--text "..." | --text-file card.md) [--file notes.md] [--project name] [--dry-run]
//   node send-to.mjs test [--to ...]      send a one-line test message to each target
//   node send-to.mjs targets              list configured targets and whether they can run here
//   node send-to.mjs demo                 offline self-check (no network)
// Exit codes: 0 all sent · 1 at least one target failed · 2 bad input / no config

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = os.homedir();
const DIR = process.env.SEND_TO_DIR || path.join(HOME, '.claude', 'send-to');
const CONFIG_PATH = path.join(DIR, 'config.json');
const ENV_PATH = path.join(DIR, '.env');
const TYPES = ['telegram', 'whatsapp', 'buzz', 'imessage', 'webhook', 'slack', 'discord'];
const ALIASES = { n8n: 'webhook', make: 'webhook', zapier: 'webhook', wa: 'whatsapp', tg: 'telegram', sms: 'imessage' };

// ---------- config ----------
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val; // trimmed: trailing whitespace in a token breaks auth silently
  }
  return out;
}

export function expand(value, env) {
  if (typeof value === 'string') {
    const m = value.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
    return m ? (env[m[1]] ?? '') : value;
  }
  if (Array.isArray(value)) return value.map((v) => expand(v, env));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, env)]));
  return value;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) die(2, `No config at ${CONFIG_PATH}. Copy config.example.json there and fill it in (see README).`);
  const env = { ...process.env };
  if (fs.existsSync(ENV_PATH)) for (const [k, v] of Object.entries(parseEnvFile(fs.readFileSync(ENV_PATH, 'utf8')))) if (!(k in env)) env[k] = v;
  const cfg = expand(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')), env);
  cfg.targets ||= {};
  for (const [name, t] of Object.entries(cfg.targets)) {
    t.type = ALIASES[t.type] || t.type || name;
    t.type = ALIASES[t.type] || t.type;
    if (!TYPES.includes(t.type)) die(2, `Target "${name}": unknown type "${t.type}". Known: ${TYPES.join(', ')}`);
  }
  cfg.default ||= ['telegram'];
  return cfg;
}

function pickTargets(cfg, names) {
  const want = names?.length ? names : cfg.default;
  const picked = [];
  for (const n of want) {
    const key = ALIASES[n] || n;
    if (cfg.targets[key]) { picked.push([key, cfg.targets[key]]); continue; }
    const byType = Object.entries(cfg.targets).filter(([, t]) => t.type === key);
    if (!byType.length) die(2, `No target named or typed "${n}" in ${CONFIG_PATH}. Configured: ${Object.keys(cfg.targets).join(', ') || 'none'}`);
    picked.push(...byType);
  }
  return picked;
}

// ---------- helpers ----------
function die(code, msg) { console.error(msg); process.exit(code); }

export function chunk(text, max) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length || !out.length) out.push(rest);
  return out;
}

async function postJSON(url, body, headers = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
  return txt;
}

function fileInfo(file) {
  if (!file) return null;
  if (!fs.existsSync(file)) die(2, `File not found: ${file}`);
  return { name: path.basename(file), buf: fs.readFileSync(file), path: path.resolve(file) };
}

function need(t, keys) {
  const missing = keys.filter((k) => !t[k]);
  if (missing.length) throw new Error(`missing ${missing.join(', ')} (check config.json / .env)`);
}

// ---------- targets ----------
const senders = {
  async telegram(t, msg) {
    need(t, ['token', 'chat_id']);
    const api = `https://api.telegram.org/bot${t.token}`;
    for (const part of chunk(msg.text, 4000)) await postJSON(`${api}/sendMessage`, { chat_id: t.chat_id, text: part, disable_web_page_preview: true });
    if (msg.file) {
      const fd = new FormData();
      fd.append('chat_id', String(t.chat_id));
      fd.append('document', new Blob([msg.file.buf]), msg.file.name);
      const r = await fetch(`${api}/sendDocument`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`sendDocument HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  },

  async whatsapp(t, msg) {
    if ((t.provider || 'evolution') === 'twilio') {
      need(t, ['account_sid', 'auth_token', 'from', 'to']);
      const auth = 'Basic ' + Buffer.from(`${t.account_sid}:${t.auth_token}`).toString('base64');
      for (const part of chunk(msg.text, 1500)) {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.account_sid}/Messages.json`, {
          method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ From: t.from, To: t.to, Body: part }),
        });
        if (!r.ok) throw new Error(`Twilio HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
      if (msg.file) msg.notes.push('twilio: attachments need a public MediaUrl, file skipped');
      return;
    }
    need(t, ['url', 'instance', 'api_key', 'to']);
    const base = t.url.replace(/\/$/, '');
    const h = { apikey: t.api_key };
    for (const part of chunk(msg.text, 60000)) await postJSON(`${base}/message/sendText/${t.instance}`, { number: t.to, text: part }, h);
    if (msg.file) await postJSON(`${base}/message/sendMedia/${t.instance}`, {
      number: t.to, mediatype: 'document', mimetype: 'text/markdown', fileName: msg.file.name, caption: msg.title || '', media: msg.file.buf.toString('base64'),
    }, h);
  },

  async buzz(t, msg) {
    need(t, ['channel']);
    const bin = t.bin || 'buzz';
    const args = ['messages', 'send', '--channel', t.channel, '--content', '-'];
    // the relay's media store rejects text files (octet-stream); text goes inline, Buzz renders the markdown
    if (msg.file && /\.(md|txt|markdown|log|json|csv|yml|yaml)$/i.test(msg.file.name)) {
      msg.text += `\n\n---\n📎 **${msg.file.name}**\n\n${msg.file.buf.toString('utf8')}`;
      msg.file = null;
      msg.notes.push('text file sent inline');
    }
    let res;
    if (t.ssh) {
      // remote mode: the key lives in an env file ON the remote host; nothing secret travels on the command line
      need(t, ['env_file']);
      let remoteFile = '';
      if (msg.file) {
        remoteFile = `/tmp/send-to-${Date.now()}-${msg.file.name.replace(/[^\w.-]/g, '_')}`;
        const cp = spawnSync('scp', ['-q', msg.file.path, `${t.ssh}:${remoteFile}`], { encoding: 'utf8' });
        if (cp.status !== 0) throw new Error(`scp failed: ${cp.stderr.trim()}`);
        args.push('--file', remoteFile);
      }
      const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
      const cmd = `set -a; . ${q(t.env_file)}; set +a; ${q(bin)} ${args.map(q).join(' ')}${remoteFile ? `; rc=$?; rm -f ${q(remoteFile)}; exit $rc` : ''}`;
      res = spawnSync('ssh', [t.ssh, cmd], { input: msg.text, encoding: 'utf8' });
    } else {
      need(t, ['relay', 'private_key']);
      if (msg.file) args.push('--file', msg.file.path);
      res = spawnSync(bin, args, { input: msg.text, encoding: 'utf8', env: { ...process.env, BUZZ_RELAY_URL: t.relay, BUZZ_PRIVATE_KEY: t.private_key } });
    }
    if (res.error) throw new Error(res.error.message);
    if (res.status !== 0) throw new Error(`buzz exit ${res.status}: ${(res.stderr || res.stdout || '').trim().slice(0, 300)}`);
  },

  async imessage(t, msg) {
    if (process.platform !== 'darwin') { msg.skip = 'iMessage only works when send-to runs on a Mac'; return; }
    need(t, ['to']);
    const script = [
      'on run argv',
      '  set theTo to item 1 of argv',
      '  set theText to item 2 of argv',
      '  set thePath to item 3 of argv',
      '  tell application "Messages"',
      '    set svc to 1st account whose service type = iMessage',
      '    set who to participant theTo of svc',
      '    send theText to who',
      '    if thePath is not "" then send POSIX file thePath to who',
      '  end tell',
      'end run',
    ].join('\n');
    const tmp = path.join(os.tmpdir(), `send-to-${process.pid}.applescript`);
    fs.writeFileSync(tmp, script);
    try {
      const res = spawnSync('osascript', [tmp, t.to, msg.text, msg.file ? msg.file.path : ''], { encoding: 'utf8' });
      if (res.status !== 0) throw new Error(`osascript: ${(res.stderr || '').trim().slice(0, 300)}`);
    } finally { fs.rmSync(tmp, { force: true }); }
  },

  async webhook(t, msg) {
    need(t, ['url']);
    await postJSON(t.url, {
      source: 'send-to', title: msg.title, text: msg.text, project: msg.project, host: os.hostname(), sent_at: new Date().toISOString(),
      file: msg.file ? { name: msg.file.name, content_base64: msg.file.buf.toString('base64') } : null,
    }, t.headers || {});
  },

  async slack(t, msg) {
    need(t, ['url']);
    for (const part of chunk(msg.text, 3000)) await postJSON(t.url, { text: part });
    if (msg.file) msg.notes.push('slack: incoming webhooks cannot carry files, file skipped');
  },

  async discord(t, msg) {
    need(t, ['url']);
    for (const part of chunk(msg.text, 1900)) await postJSON(t.url, { content: part });
    if (msg.file) {
      const fd = new FormData();
      fd.append('files[0]', new Blob([msg.file.buf]), msg.file.name);
      const r = await fetch(t.url, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`discord file HTTP ${r.status}`);
    }
  },
};

// ---------- cli ----------
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith('--')) { const k = x.slice(2); const nxt = argv[i + 1]; if (nxt === undefined || nxt.startsWith('--')) a[k] = true; else { a[k] = nxt; i++; } }
    else a._.push(x);
  }
  return a;
}

async function run() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0] && !a._[0].startsWith('-') ? a._[0] : 'send';
  if (cmd === 'demo') return demo();
  const cfg = loadConfig();
  if (cmd === 'targets') {
    for (const [name, t] of Object.entries(cfg.targets)) {
      const here = t.type === 'imessage' && process.platform !== 'darwin' ? 'not available on this OS' : 'ok';
      console.log(`${name.padEnd(12)} ${t.type.padEnd(9)} ${here}${cfg.default.includes(name) || cfg.default.includes(t.type) ? '  (default)' : ''}`);
    }
    return;
  }
  const to = a.to ? String(a.to).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  const targets = pickTargets(cfg, to);
  const project = a.project || path.basename(process.cwd());
  let text = cmd === 'test' ? `send-to test from ${os.hostname()} — ${new Date().toLocaleString()}` : a['text-file'] ? fs.readFileSync(a['text-file'], 'utf8') : a.text;
  if (!text) die(2, 'Nothing to send: pass --text "..." or --text-file card.md');
  const title = a.title && a.title !== true ? String(a.title) : '';
  if (title && !text.startsWith(title)) text = `${title}\n\n${text}`;
  const file = cmd === 'test' ? null : fileInfo(a.file === true ? null : a.file);

  let failed = 0;
  for (const [name, t] of targets) {
    const msg = { title, text, file, project, notes: [], skip: null };
    if (a['dry-run']) { console.log(`DRY ${name} (${t.type}): ${text.length} chars${file ? ` + ${file.name} (${file.buf.length} B)` : ''}`); continue; }
    try {
      await senders[t.type](t, msg);
      if (msg.skip) console.log(`⏭  ${name}: ${msg.skip}`);
      else console.log(`✅ ${name}${msg.notes.length ? ' (' + msg.notes.join('; ') + ')' : ''}`);
    } catch (e) {
      failed++;
      console.log(`❌ ${name}: ${String(e.message || e).replace(/bot\d+:[\w-]+/g, 'bot<token>')}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

function demo() {
  const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
  const env = parseEnvFile('A=1\n# c\nB="two words"  \nC=\'x\'\nbad\nD=a=b');
  assert(env.A === '1' && env.B === 'two words' && env.C === 'x' && env.D === 'a=b' && !('bad' in env), 'env parsing');
  const cfg = expand({ t: { token: '$TOK', chat: '${CHAT}', plain: 'keep', n: 3 } }, { TOK: 'abc', CHAT: '42' });
  assert(cfg.t.token === 'abc' && cfg.t.chat === '42' && cfg.t.plain === 'keep' && cfg.t.n === 3, 'env expansion');
  const parts = chunk('a'.repeat(10) + '\n' + 'b'.repeat(10) + '\n' + 'c'.repeat(10), 25);
  assert(parts.length === 2 && parts[0] === 'a'.repeat(10) + '\n' + 'b'.repeat(10) && parts[1] === 'c'.repeat(10), 'chunk at newline');
  assert(chunk('', 10).length === 1 && chunk('x'.repeat(30), 10).length === 3, 'chunk edge cases');
  assert(ALIASES.n8n === 'webhook' && TYPES.length === 7, 'aliases');
  console.log('demo ok');
}

run().catch((e) => die(2, e.message));
