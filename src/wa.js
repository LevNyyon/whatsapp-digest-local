// WhatsApp layer. Wraps whatsapp-web.js (WhatsApp Web via headless Chromium).
// Read-only: this module never exposes a send function to the MCP server.
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR =
  process.env.WA_SESSION_DIR || path.join(__dirname, '..', '.wa-session');

// Pin the WhatsApp Web version. Without this, whatsapp-web.js often hangs on the
// post-scan "loading" screen and never fires `ready`. Override with WA_WEB_VERSION
// if this one goes stale (see github.com/wppconnect-team/wa-version/tree/main/html).
const WEB_VERSION = process.env.WA_WEB_VERSION || '2.3000.1041001125-alpha';
const WEB_VERSION_REMOTE = `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WEB_VERSION}.html`;

let client = null;
let state = 'idle'; // idle | loading | qr | ready | auth_failure
let lastQr = null; // raw QR string from WhatsApp
let readyWaiters = [];

function setState(s) {
  state = s;
}

export function getState() {
  return { state, hasQr: !!lastQr };
}

export function getLastQr() {
  return lastQr;
}

// Lazily create and start the WhatsApp client. Safe to call repeatedly.
// `onQr` is called with the raw QR string each time WhatsApp issues a new one.
export function ensureClient(onQr) {
  if (client) return client;
  setState('loading');

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    webVersionCache: {
      type: 'remote',
      remotePath: WEB_VERSION_REMOTE,
    },
  });

  client.on('loading_screen', (percent, message) =>
    console.error(`[wa] loading_screen ${percent}% ${message || ''}`)
  );
  client.on('change_state', (s) => console.error('[wa] change_state:', s));
  client.on('qr', (qr) => {
    console.error('[wa] qr received (scan it)');
    lastQr = qr;
    setState('qr');
    if (onQr) onQr(qr);
  });
  client.on('authenticated', () => {
    console.error('[wa] authenticated');
    setState('loading');
  });
  client.on('auth_failure', (m) => {
    console.error('[wa] auth_failure:', m);
    setState('auth_failure');
  });
  client.on('ready', () => {
    console.error('[wa] ready');
    lastQr = null;
    setState('ready');
    readyWaiters.forEach((fn) => fn());
    readyWaiters = [];
  });
  client.on('disconnected', (r) => {
    console.error('[wa] disconnected:', r);
    setState('idle');
  });

  client.initialize().catch((e) => {
    setState('idle');
    console.error('[wa] initialize error:', e?.message || e);
  });

  return client;
}

export function waitUntilReady(timeoutMs = 90000) {
  if (state === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    readyWaiters.push(() => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

function requireReady() {
  if (state !== 'ready') {
    throw new Error(
      'WhatsApp is not linked yet. Run the link_whatsapp tool, scan the QR, then try again.'
    );
  }
}

export async function listChats(limit = 30) {
  requireReady();
  const chats = await client.getChats();
  return chats
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit)
    .map((c) => ({
      name: c.name || c.id?.user || 'Unknown',
      isGroup: !!c.isGroup,
      unread: c.unreadCount || 0,
      lastActivity: c.timestamp
        ? new Date(c.timestamp * 1000).toISOString()
        : null,
    }));
}

export async function getMessages({
  hours = 24,
  chatName = null,
  maxChats = 30,
  perChat = 40,
} = {}) {
  requireReady();
  const cutoff = Date.now() - hours * 3600 * 1000;

  let chats = await client.getChats();
  chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (chatName) {
    const needle = chatName.toLowerCase();
    chats = chats.filter((c) => (c.name || '').toLowerCase().includes(needle));
  } else {
    chats = chats.slice(0, maxChats);
  }

  const out = [];
  for (const chat of chats) {
    let msgs = [];
    try {
      msgs = await chat.fetchMessages({ limit: perChat });
    } catch {
      continue;
    }
    const recent = msgs
      .filter((m) => (m.timestamp || 0) * 1000 >= cutoff)
      .map((m) => ({
        from: m.fromMe
          ? 'me'
          : m._data?.notifyName || m.author || m.from || 'unknown',
        body: m.body || (m.hasMedia ? '[media]' : ''),
        time: new Date((m.timestamp || 0) * 1000).toISOString(),
        fromMe: !!m.fromMe,
      }));
    if (recent.length) {
      out.push({
        chat: chat.name || chat.id?.user || 'Unknown',
        isGroup: !!chat.isGroup,
        unread: chat.unreadCount || 0,
        messageCount: recent.length,
        messages: recent,
      });
    }
  }
  return out;
}
