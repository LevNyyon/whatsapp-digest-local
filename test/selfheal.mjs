// Self-heal verification. No phone, no Chromium, does not touch the real daemon
// (uses a throwaway port + temp session dir). Proves:
//   1. reconnect backoff never gives up
//   2. the watchdog recovers a genuinely-stuck session and NEVER touches a live one
//   3. reset frees a wedged, pidfile-less daemon that is holding the port
import assert from 'node:assert';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// Point everything at throwaway paths/ports BEFORE importing the modules.
process.env.WA_SESSION_DIR = path.join(os.tmpdir(), 'wa-digest-selftest-session');
process.env.WA_DAEMON_PORT = '47299';

const wa = await import('../src/wa.js');
const dc = await import('../src/daemon-control.js');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, 'FAIL: ' + name); console.log('  ok -', name); pass++; };
const portListeners = (port) => {
  try {
    return execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .split(/\s+/).filter(Boolean);
  } catch { return []; }
};
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---- reconnect backoff never gives up ----
ok('backoff ramps (2s, 4s)', wa._reconnectDelay(0) === 2000 && wa._reconnectDelay(1) === 4000);
ok('backoff caps at 30s', wa._reconnectDelay(5) === 30000 && wa._reconnectDelay(50) === 30000);
ok('backoff NEVER gives up (finite forever)', wa._reconnectDelay(100000) === 30000);

// ---- watchdog decision: safety first, then recovery ----
const W = wa._watchdogShouldRecover;
const now = 1_000_000;
const base = { reconnecting: false, now, preAuthMs: 120000, postAuthMs: 600000 };
ok('NEVER touches a ready session', W({ ...base, authed: true, state: 'ready', notReadySince: now - 999999 }) === false);
ok('waits on qr (human needed)', W({ ...base, authed: false, state: 'qr', notReadySince: now - 999999 }) === false);
ok('waits on auth_failure (human needed)', W({ ...base, authed: false, state: 'auth_failure', notReadySince: now - 999999 }) === false);
ok('defers while a reconnect is scheduled', W({ ...base, authed: false, reconnecting: true, state: 'idle', notReadySince: now - 999999 }) === false);
ok('pre-auth: ignores a not-yet-stuck loading', W({ ...base, authed: false, state: 'loading', notReadySince: now - 10000 }) === false);
ok('pre-auth: RECOVERS a stuck WhatsApp-Web load (>2min)', W({ ...base, authed: false, state: 'loading', notReadySince: now - 130000 }) === true);
ok('post-auth: does NOT interrupt a slow sync (the big-account regression)', W({ ...base, authed: true, state: 'loading', notReadySince: now - 130000 }) === false);
ok('post-auth: RECOVERS a truly frozen sync (>10min)', W({ ...base, authed: true, state: 'loading', notReadySince: now - 610000 }) === true);
ok('no-op when notReadySince is null', W({ ...base, authed: false, state: 'idle', notReadySince: null }) === false);

// ---- reset frees a wedged, pidfile-less daemon (the exact dead-end) ----
const child = spawn(process.execPath, ['-e',
  "const http=require('http');const s=http.createServer(()=>{});" +
  "s.listen(47299,'127.0.0.1',()=>console.log('LISTENING'));setInterval(()=>{},1e9);"
], { stdio: ['ignore', 'pipe', 'ignore'] });
let childExited = false;
child.on('exit', () => { childExited = true; });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('wedged child never listened')), 5000);
  child.stdout.on('data', (d) => { if (String(d).includes('LISTENING')) { clearTimeout(t); resolve(); } });
});

ok('wedged daemon is holding the port', portListeners(47299).includes(String(child.pid)));
ok('daemon looks unhealthy (HTTP wedged)', (await dc.daemonHealthy()) === false);

await dc.killDaemon();           // the reset escape hatch
await new Promise((r) => setTimeout(r, 300));

ok('reset freed the port (wedged + NO pidfile)', portListeners(47299).length === 0);
ok('wedged process is dead', childExited || !isAlive(child.pid));

if (!childExited) { try { child.kill('SIGKILL'); } catch {} }
console.log(`\n${pass} checks passed`);
process.exit(0);
