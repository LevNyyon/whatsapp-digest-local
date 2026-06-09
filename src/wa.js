// WhatsApp layer. Wraps whatsapp-web.js (WhatsApp Web via headless Chromium).
// Read-only: this module never exposes a send function to the MCP server.
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR =
  process.env.WA_SESSION_DIR || path.join(__dirname, '..', '.wa-session');
// The Chromium profile LocalAuth actually launches against.
const PROFILE_DIR = path.join(SESSION_DIR, 'session');
// A small marker we write once linked, so across daemon restarts we know a
// saved login exists and can answer "reconnecting, wait" instead of "scan a QR".
const LINKED_MARKER = path.join(SESSION_DIR, '.linked');

// Pin the WhatsApp Web version. Without this, whatsapp-web.js often hangs on the
// post-scan "loading" screen and never fires `ready`. Override with WA_WEB_VERSION
// if this one goes stale (see github.com/wppconnect-team/wa-version/tree/main/html).
const WEB_VERSION = process.env.WA_WEB_VERSION || '2.3000.1041001125-alpha';
const WEB_VERSION_REMOTE = `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WEB_VERSION}.html`;

let client = null;
let state = 'idle'; // idle | loading | qr | ready | auth_failure
let lastQr = null; // raw QR string from WhatsApp
let readyWaiters = [];
let lastOnQr = null; // remembered QR callback, reused on auto-reconnect
let reconnectTimer = null;
let reconnectAttempts = 0;

function setState(s) {
  state = s;
}

export function getState() {
  return { state, hasQr: !!lastQr, linked: hasSavedSession() };
}

export function getLastQr() {
  return lastQr;
}

// --- saved-session marker (survives daemon restarts) ---
function writeMarker() {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(LINKED_MARKER, '1');
  } catch {}
}
function removeMarker() {
  try {
    fs.rmSync(LINKED_MARKER, { force: true });
  } catch {}
}
export function hasSavedSession() {
  try {
    return fs.existsSync(LINKED_MARKER);
  } catch {
    return false;
  }
}

// Lazily create and start the WhatsApp client. Safe to call repeatedly.
export function ensureClient(onQr) {
  if (onQr) lastOnQr = onQr;
  if (client) return client;
  cleanupProfile();
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
    if (lastOnQr) lastOnQr(qr);
  });
  client.on('authenticated', () => {
    console.error('[wa] authenticated');
    writeMarker(); // we have a usable login now
    setState('loading');
  });
  client.on('auth_failure', (m) => {
    console.error('[wa] auth_failure:', m);
    removeMarker(); // saved login is bad -> a real re-link is needed
    setState('auth_failure');
  });
  client.on('ready', () => {
    console.error('[wa] ready');
    lastQr = null;
    reconnectAttempts = 0;
    writeMarker();
    setState('ready');
    readyWaiters.forEach((fn) => fn());
    readyWaiters = [];
  });
  client.on('disconnected', (r) => {
    console.error('[wa] disconnected:', r);
    // Only a real logout means the saved login is gone. Other drops are transient.
    if (r === 'LOGOUT' || r === 'UNPAIRED') removeMarker();
    setState('idle');
    scheduleReconnect();
  });

  client.initialize().catch((e) => {
    console.error('[wa] initialize error:', e?.message || e);
    setState('idle');
    scheduleReconnect();
  });

  return client;
}

// Before launching, kill any orphaned Chrome still holding our profile and drop
// stale lock files. A crashed previous run otherwise blocks the launch with
// "browser is already running". Safe: the daemon is the single owner.
function cleanupProfile() {
  try {
    if (process.platform !== 'win32') {
      execFileSync('pkill', ['-f', PROFILE_DIR], { stdio: 'ignore' });
    }
  } catch {
    /* pkill exits non-zero when nothing matches — fine */
  }
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.rmSync(path.join(PROFILE_DIR, f), { force: true });
    } catch {}
  }
}

// Reconnect ONLY in response to a real 'disconnected' event or an init failure
// (never on a guess), with backoff. We never tear down a connection that is
// actually up.
function scheduleReconnect() {
  if (reconnectTimer) return;
  if (reconnectAttempts >= 6) {
    console.error('[wa] auto-reconnect gave up after 6 tries; use reset to retry');
    return;
  }
  const delay = Math.min(30000, 2000 * 2 ** reconnectAttempts);
  reconnectAttempts++;
  console.error(
    `[wa] auto-reconnect in ${Math.round(delay / 1000)}s (try ${reconnectAttempts})`
  );
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await destroyClient();
    ensureClient();
  }, delay);
}

async function destroyClient() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    await client?.destroy();
  } catch {}
  client = null;
  lastQr = null;
  setState('idle');
}

// Hard reset exposed to the MCP layer (the reset_whatsapp tool). Last resort.
export async function resetClient() {
  reconnectAttempts = 0;
  await destroyClient();
  cleanupProfile();
  ensureClient();
  return getState();
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

// Gentle gate: if already connected, proceed (we trust it — no probing, no
// teardown). If not, start/continue connecting (restores a saved login with NO
// QR) and wait briefly. Only error out if it truly can't get ready.
async function ensureReadyOrThrow() {
  if (state === 'ready') return;
  ensureClient();
  const ok = await waitUntilReady(30000);
  if (ok) return;
  throw new Error(
    hasSavedSession()
      ? 'WhatsApp is reconnecting (restoring your saved login). Wait a few seconds and call get_messages again — no reset or QR needed.'
      : 'WhatsApp is not linked yet. Run link_whatsapp, scan the QR once, then try again.'
  );
}

// Race a promise against a timeout so one slow/hanging call can't stall forever.
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// Run async fn over items with at most `limit` in flight at once.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(limit, items.length) || 0;
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

// The first chat query after the session has been idle can be slow (WhatsApp Web
// re-syncs its store), so give it real headroom before declaring failure. This
// is what prevents the "helper got wedged" false alarm.
const GET_CHATS_TIMEOUT = 40000;

export async function listChats(limit = 30) {
  await ensureReadyOrThrow();
  console.error('[wa] listChats: fetching chat list…');
  const chats = await withTimeout(client.getChats(), GET_CHATS_TIMEOUT, 'getChats');
  console.error(`[wa] listChats: ${chats.length} chats`);
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
  maxChats = 15,
  perChat = 20,
} = {}) {
  await ensureReadyOrThrow();
  const cutoff = Date.now() - hours * 3600 * 1000;

  console.error('[wa] getMessages: fetching chat list…');
  let chats = await withTimeout(client.getChats(), GET_CHATS_TIMEOUT, 'getChats');
  console.error(`[wa] getMessages: ${chats.length} chats total`);
  chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (chatName) {
    const needle = chatName.toLowerCase();
    chats = chats
      .filter((c) => (c.name || '').toLowerCase().includes(needle))
      .slice(0, maxChats);
  } else {
    chats = chats
      .filter((c) => (c.timestamp || 0) * 1000 >= cutoff)
      .slice(0, maxChats);
  }
  console.error(`[wa] getMessages: ${chats.length} active chats, fetching in parallel…`);

  const results = await mapLimit(chats, 5, async (chat) => {
    let msgs;
    try {
      msgs = await withTimeout(
        chat.fetchMessages({ limit: perChat }),
        5000,
        `fetchMessages(${chat.name || 'chat'})`
      );
    } catch (e) {
      console.error(`[wa] skip "${chat.name || 'chat'}": ${e.message}`);
      return null;
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
    if (!recent.length) return null;
    return {
      chat: chat.name || chat.id?.user || 'Unknown',
      isGroup: !!chat.isGroup,
      unread: chat.unreadCount || 0,
      messageCount: recent.length,
      messages: recent,
    };
  });
  const out = results.filter(Boolean);
  console.error(`[wa] getMessages: done — ${out.length} chats with recent messages`);
  return out;
}
