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

const server = new McpServer({ name: 'whatsapp-digest', version: '0.2.0' });

server.registerTool(
  'whatsapp_status',
  {
    title: 'WhatsApp status',
    description:
      'Check whether WhatsApp is linked and ready. Returns the shared session state.',
    inputSchema: {},
  },
  async () => ({ content: [{ type: 'text', text: await callDaemon('/status') }] })
);

server.registerTool(
  'link_whatsapp',
  {
    title: 'Link WhatsApp',
    description:
      'Begin linking WhatsApp. Opens a local QR page (served by the shared helper at a fixed URL). You only ever scan once; the session is reused after that.',
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
      'Get WhatsApp messages from the last N hours (default 24), optionally filtered to one chat by name fragment. The raw material for a digest.',
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
