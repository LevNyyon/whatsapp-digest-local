# WhatsApp Digest (local)

A small, **local, read-only** assistant that turns your recent WhatsApp chats into a short, prioritized digest — inside Claude.

Ask Claude *"give me my WhatsApp digest"* and you get back: what needs a reply, what's time-sensitive, and what's just FYI — plus the top 3 things to handle today.

It runs entirely on your own machine. There is **no send function** in the code. It only reads.

---

## What it is

WhatsApp Digest is an [MCP](https://modelcontextprotocol.io) server. It holds a WhatsApp Web session locally and exposes your recent messages to Claude as a few read-only tools. Claude does the thinking and writes the brief. You add it to Claude Desktop once, link your phone once, and then ask for a digest whenever you want.

It is the open, minimal core of a much larger operator hub — given away free.

## What it does

- Links to your WhatsApp via a QR scan (like WhatsApp Web), then remembers the session.
- Reads your **recent** chats and messages (default: last 24 hours).
- Reports unread counts so you can see what needs attention.
- Lets Claude group it all into a prioritized digest: **needs a reply / time-sensitive / FYI**.

## What it does NOT do

- **It never sends messages.** There is no send code path, by design.
- **It is not a cloud service.** Nothing is hosted; there is no server you sign up for.
- **It does not store or upload your messages.** This tool keeps no database. (See the privacy note below about Claude itself.)
- **It does not read deep history.** It sees what WhatsApp Web has synced — great for recent activity, weak for old archives.

## How it works

```
Your phone ──link──► WhatsApp helper (one shared local process) ──HTTP──► MCP server(s) ──► your AI app
```

- A single background **helper** holds one WhatsApp Web session (headless Chromium, like the WhatsApp Web you use in a browser). It listens on a fixed local port and **outlives app restarts**, so the session persists — you link once.
- Your MCP client starts an **MCP server per chat/session**; each one is a thin client that forwards to that single helper. Open as many as you like — they all share one session, so there are no duplicate logins and no re-scanning.
- **Your AI app is the brain.** No extra LLM API key needed — the app's own model does the reasoning.

## Requirements

- **Node.js 18+**
- An **MCP client that can run local servers** — Claude Desktop, Claude Code, Cursor, VS Code (Copilot), Windsurf, Cline, Zed, or your own agent. (The steps below use Claude Desktop; see [Works with any MCP client](#works-with-any-mcp-client) for the rest.)
- A WhatsApp account on your phone

## Install

```bash
git clone https://github.com/LevNyyon/whatsapp-digest-local.git
cd whatsapp-digest-local
npm install
```

> First install downloads a Chromium for WhatsApp Web (~150 MB). One time only.

**Add it to Claude Desktop.** Easiest — run the helper (it merges into your config and uses an absolute `node` path, which macOS GUI apps need):

```bash
node scripts/apply-to-claude-desktop.mjs
```

Or do it by hand. Open the config:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "whatsapp-digest": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/whatsapp-digest-local/src/index.js"]
    }
  }
}
```

> On macOS, use the **absolute** path to `node` (find it with `which node`). GUI apps don't inherit your shell `PATH`, so a bare `"node"` often fails to launch.

**Restart Claude Desktop.**

## First run — link your phone

In Claude, say:

> link my whatsapp

A page opens with a QR code. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device** → scan it. The page flips to **"Linked"** and the session is saved locally — you won't scan again.

## Use it

> give me my whatsapp digest

or

> what did I miss in the last 6 hours?

## Works with any MCP client

This is a standard **local MCP server** — not Claude-specific. Anything that can run a local (stdio) MCP server can use it: **Claude Desktop, Claude Code, Cursor, VS Code (Copilot), Windsurf, Cline, Zed**, or your own agent built on an MCP SDK. The model in that app does the digest reasoning, so any capable model works.

Most clients use the same config shape — only the file location differs per app:

```json
{
  "mcpServers": {
    "whatsapp-digest": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/whatsapp-digest-local/src/index.js"]
    }
  }
}
```

You get the same five tools and the `whatsapp_digest` prompt. The one limit: a **cloud-only client that accepts only remote MCP servers won't work** — the WhatsApp session has to run locally on your machine.

## The tools (all read-only)

| Tool | What it does |
|------|--------------|
| `whatsapp_status` | Is WhatsApp linked yet? |
| `link_whatsapp` | Opens the QR page to link your phone |
| `list_chats` | Recent chats + unread counts |
| `get_messages` | Messages from the last N hours (optionally one chat) |
| `reset_whatsapp` | Force a clean restart of the helper if it ever gets stuck (keeps your login) |

The helper is self-healing: it clears stale browser locks on start (so a crash can't wedge it), and auto-reconnects with backoff if WhatsApp drops. If it ever gets truly stuck, ask Claude to "reset whatsapp".

There is also a built-in **`whatsapp_digest` prompt** and an optional **Skill** (`skill/SKILL.md`) that teach Claude how to format a good brief.

## ⚠️ Safety & caveats — read this

- **Unofficial.** WhatsApp has no public API for this. `whatsapp-web.js` automates WhatsApp Web. Automating WhatsApp is **against WhatsApp's Terms of Service**.
- **Ban risk.** Your number can be rate-limited or **banned**. Use a number you are comfortable risking. This project is read-only specifically to stay on the lower-risk side, but the risk is not zero.
- **Privacy — your messages go to Claude when you ask for a digest.** This tool stores and uploads nothing on its own. But when Claude *reads* your messages to write the brief, that text is sent to Claude (Anthropic) like any other prompt. **Don't digest chats you wouldn't paste into Claude.**
- **It can break.** When WhatsApp changes WhatsApp Web, `whatsapp-web.js` may stop working until it's updated. That's the nature of unofficial tooling.
- **One session per number.** You can't run two WhatsApp Web automations on the same number at once.
- **Not affiliated** with WhatsApp or Meta in any way.
- **No warranty.** Provided "as is" (see [LICENSE](LICENSE)). You use it at your own risk.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `WA_SESSION_DIR` | `<install>/.wa-session` | Where the WhatsApp session is saved |
| `WA_DAEMON_PORT` | `47291` | Fixed local port the shared helper listens on |
| `WA_WEB_VERSION` | pinned | WhatsApp Web version to use (override if it goes stale) |

## Roadmap

- **v2 — auto mode:** a small always-on background process (cron) that builds the digest every morning and sends it to your own WhatsApp number, even when Claude is closed. (Needs an Anthropic API key, since there's no human in the loop.)
- **One-click install:** package as a `.dxt` Desktop Extension so install becomes a double-click with no terminal. A current-format `manifest.json` is included.

## License

[MIT](LICENSE) — free to use, modify, and distribute. Do what you like.
