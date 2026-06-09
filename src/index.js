#!/usr/bin/env node
// WhatsApp Digest — MCP server (thin client).
// Claude Desktop spawns one of these PER CHAT. They must NOT each open their own
// WhatsApp browser (only one process can hold the session). So instead, every
// copy talks to a single shared background daemon on a fixed port, spawning it
// once if it isn't already running. The daemon outlives Claude restarts, so the
// session persists and never needs re-linking.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const daemonPath = path.join(here, 'daemon.js');
const PORT = Number(process.env.WA_DAEMON_PORT || 47291);
const BASE = `http://localhost:${PORT}`;
const LOG = path.join(os.tmpdir(), 'whatsapp-digest-daemon.log');
const PIDFILE = path.join(os.tmpdir(), `whatsapp-digest-daemon.${PORT}.pid`);

const DIGEST_INSTRUCTIONS = `You are this person's WhatsApp chief of staff. Build a short, prioritized digest of recent WhatsApp activity.

Steps:
1. Call get_messages (default last 24 hours). Optionally call list_chats for unread counts.
2. Group into: NEEDS A REPLY (open questions/asks aimed at the user), TIME-SENSITIVE (dates, deadlines, payments, "today/tomorrow"), FYI (no action).
3. One line per item: who, the gist, the action if any. Quote sparingly.
4. Unread / most-active chats first. Skip noise (stickers, "ok", group spam).
5. End with "Top 3 to handle today".
Keep it tight and skimmable. No preamble. If nothing important happened, say so.`;

async function daemonHealthy() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// Make sure the shared daemon is running; spawn it detached if not.
async function ensureDaemon() {
  if (await daemonHealthy()) return;
  const out = fs.openSync(LOG, 'a');
  spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await daemonHealthy()) return;
  }
  throw new Error(`WhatsApp helper did not start in time. See ${LOG}`);
}

async function callDaemon(pathname, opts) {
  await ensureDaemon();
  const r = await fetch(`${BASE}${pathname}`, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`helper ${pathname} failed: ${text}`);
  return text; // JSON string, passed straight through to Claude
}

// Stop the helper: ask it to shut down, then hard-kill via the PID file if it's
// wedged and still answering. Used by the reset tool to guarantee a fresh start.
async function killDaemon() {
  try {
    await fetch(`${BASE}/shutdown`, { signal: AbortSignal.timeout(2000) });
  } catch {}
  try {
    const pid = Number(fs.readFileSync(PIDFILE, 'utf8').trim());
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  } catch {}
  for (let i = 0; i < 12; i++) {
    if (!(await daemonHealthy())) return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  try {
    spawn(cmd, [url], {
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    }).unref();
  } catch {}
}

const server = new McpServer({ name: 'whatsapp-digest', version: '0.1.0' });

server.registerTool(
  'whatsapp_status',
  {
    title: 'WhatsApp status',
    description:
      'Check whether WhatsApp is connected. If state is not "ready" but "linked" is true, the saved login is just reconnecting — wait a few seconds and call get_messages (it reconnects on its own). Do not reset or re-link in that case.',
    inputSchema: {},
  },
  async () => ({ content: [{ type: 'text', text: await callDaemon('/status') }] })
);

server.registerTool(
  'link_whatsapp',
  {
    title: 'Link WhatsApp',
    description:
      'First-time setup only, or after the user logged the device out. Opens a local QR page. Only call this if get_messages explicitly says "not linked yet". If a saved login already exists, the tools reconnect on their own with no QR — do NOT call this just because the session looks idle or asleep.',
    inputSchema: {},
  },
  async () => {
    const text = await callDaemon('/link', { method: 'POST' });
    let qrUrl = BASE + '/qr';
    try {
      qrUrl = JSON.parse(text).qrUrl || qrUrl;
    } catch {}
    openBrowser(qrUrl);
    return {
      content: [
        {
          type: 'text',
          text:
            `Linking. A page should open in your browser; if not, open:\n\n${qrUrl}\n\n` +
            `On your phone: WhatsApp → Settings → Linked Devices → Link a Device → scan. ` +
            `The page says "Linked" when done. You won't need to scan again.`,
        },
      ],
    };
  }
);

server.registerTool(
  'list_chats',
  {
    title: 'List chats',
    description:
      'List recent WhatsApp chats with unread counts and last-activity time.',
    inputSchema: { limit: z.number().int().min(1).max(100).optional() },
  },
  async ({ limit }) => ({
    content: [{ type: 'text', text: await callDaemon(`/chats?limit=${limit ?? 30}`) }],
  })
);

server.registerTool(
  'get_messages',
  {
    title: 'Get recent messages',
    description:
      'Get WhatsApp messages from the last N hours (default 24), optionally filtered to one chat by name fragment. The raw material for a digest. This AUTOMATICALLY reconnects a sleeping or idle session and waits for it — you do NOT need to call reset_whatsapp or link_whatsapp first. If it returns a "reconnecting" message, just call get_messages again in a few seconds.',
    inputSchema: {
      hours: z.number().int().min(1).max(168).optional(),
      chat: z.string().optional(),
    },
  },
  async ({ hours, chat }) => {
    const qs = new URLSearchParams({ hours: String(hours ?? 24) });
    if (chat) qs.set('chat', chat);
    return { content: [{ type: 'text', text: await callDaemon(`/messages?${qs}`) }] };
  }
);

server.registerTool(
  'reset_whatsapp',
  {
    title: 'Reset WhatsApp helper',
    description:
      'LAST RESORT. Only call this if the user explicitly says it is stuck AFTER get_messages has been retried and still fails. Routine requests reconnect on their own, so do NOT call this for a normal digest. It keeps the saved login (no re-scan).',
    inputSchema: {},
  },
  async () => {
    await killDaemon();
    const text = await callDaemon('/status'); // respawns a fresh helper
    return {
      content: [{ type: 'text', text: `Helper restarted clean.\n${text}` }],
    };
  }
);

server.registerPrompt(
  'whatsapp_digest',
  {
    title: 'WhatsApp digest',
    description: 'Build a prioritized digest of recent WhatsApp activity.',
    argsSchema: {},
  },
  () => ({
    messages: [
      { role: 'user', content: { type: 'text', text: DIGEST_INSTRUCTIONS } },
    ],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[whatsapp-digest] MCP proxy ready (stdio).');
