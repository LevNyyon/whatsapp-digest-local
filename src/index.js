#!/usr/bin/env node
// WhatsApp Digest — a local, read-only MCP server.
// Exposes your recent WhatsApp activity to Claude so it can build a digest.
// Nothing leaves your machine except the message text you ask Claude to read.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  ensureClient,
  getState,
  getLastQr,
  listChats,
  getMessages,
} from './wa.js';
import { startQrServer, getQrUrl, openBrowser } from './qr-server.js';

const DIGEST_INSTRUCTIONS = `You are this person's WhatsApp chief of staff. Build a short, prioritized digest of recent WhatsApp activity.

Steps:
1. Call get_messages (default last 24 hours). Optionally call list_chats for unread counts.
2. Group what you find into:
   - NEEDS A REPLY — direct questions or asks pointed at the user, still open.
   - TIME-SENSITIVE — anything with a date, deadline, payment, or "today/tomorrow".
   - FYI — useful but no action needed.
3. For each item: one line — who, the gist, and (if any) the action. Quote sparingly.
4. Put unread / most-active chats first. Skip noise (stickers, "ok", group spam).
5. End with a one-line "Top 3 to handle today".

Keep it tight and skimmable. No preamble. If nothing important happened, say so plainly.`;

const server = new McpServer({
  name: 'whatsapp-digest',
  version: '0.1.0',
});

// Start linking: boot the WhatsApp client and open the local QR page.
async function beginLink() {
  ensureClient();
  const { url } = await startQrServer(() => ({
    state: getState().state,
    qr: getLastQr(),
  }));
  openBrowser(url);
  return url;
}

server.registerTool(
  'whatsapp_status',
  {
    title: 'WhatsApp status',
    description:
      'Check whether WhatsApp is linked and ready. Returns the connection state and, if linking is in progress, the QR page URL.',
    inputSchema: {},
  },
  async () => {
    const s = getState();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ...s, linkUrl: getQrUrl() }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  'link_whatsapp',
  {
    title: 'Link WhatsApp',
    description:
      'Begin linking WhatsApp. Opens a local web page showing a QR code to scan from your phone (WhatsApp → Linked Devices → Link a Device). The session is saved locally so you only scan once.',
    inputSchema: {},
  },
  async () => {
    const url = await beginLink();
    return {
      content: [
        {
          type: 'text',
          text:
            `Linking started. A page should have opened in your browser. ` +
            `If not, open it yourself:\n\n${url}\n\n` +
            `On your phone: WhatsApp → Settings → Linked Devices → Link a Device → scan the QR. ` +
            `The page will say "Linked" when done — then ask me for your digest.`,
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
      'List recent WhatsApp chats with unread counts and last-activity time. Use to see what needs attention.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ limit }) => {
    const data = await listChats(limit ?? 30);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  'get_messages',
  {
    title: 'Get recent messages',
    description:
      'Get WhatsApp messages from the last N hours (default 24), optionally filtered to one chat by name fragment. This is the raw material for a digest.',
    inputSchema: {
      hours: z.number().int().min(1).max(168).optional(),
      chat: z.string().optional(),
    },
  },
  async ({ hours, chat }) => {
    const data = await getMessages({ hours: hours ?? 24, chatName: chat ?? null });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// Native MCP prompt so "digest" is one click in Claude even without the Skill.
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
console.error('[whatsapp-digest] MCP server ready (stdio).');
