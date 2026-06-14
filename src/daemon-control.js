// Lifecycle control for the single shared background daemon: health-check,
// spawn-if-needed, call, and a RELIABLE kill. Split out of index.js so the kill
// path can be tested on its own (it is the reset escape hatch and must work even
// when the daemon is wedged).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const daemonPath = path.join(here, 'daemon.js');

export const PORT = Number(process.env.WA_DAEMON_PORT || 47291);
export const BASE = `http://localhost:${PORT}`;
const LOG = path.join(os.tmpdir(), `whatsapp-digest-daemon.${PORT}.log`);
const PIDFILE = path.join(os.tmpdir(), `whatsapp-digest-daemon.${PORT}.pid`);

export async function daemonHealthy() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// Make sure the shared daemon is running; spawn it detached if not.
export async function ensureDaemon() {
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

export async function callDaemon(pathname, opts) {
  await ensureDaemon();
  const r = await fetch(`${BASE}${pathname}`, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`helper ${pathname} failed: ${text}`);
  return text; // JSON string, passed straight through to Claude
}

// Kill whatever process is LISTENING on the daemon port, independent of the
// pidfile. This is the crux of a reliable reset: a wedged daemon may stop
// answering HTTP while still holding the port, and its pidfile is often stale or
// missing, so a pidfile-only SIGKILL misses and the zombie keeps the port,
// blocking any fresh start. Killing by port frees it for certain.
export function killByPort(port = PORT) {
  if (process.platform === 'win32') return; // lsof-free; pidfile path covers Windows
  let pids = [];
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    pids = out.split(/\s+/).map((s) => Number(s.trim())).filter(Boolean);
  } catch {
    /* lsof exits non-zero when nothing is listening, which is fine */
  }
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  return pids;
}

// Stop the helper for a clean restart. Ask it nicely, then SIGKILL by pidfile,
// then SIGKILL by port (the reliable path), and confirm the port is actually
// free before returning so the caller's respawn can bind it.
export async function killDaemon() {
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
  killByPort(PORT);
  for (let i = 0; i < 20; i++) {
    if (!(await daemonHealthy())) return;
    killByPort(PORT); // catch a daemon mid-shutdown that re-bound
    await new Promise((r) => setTimeout(r, 300));
  }
}
