#!/usr/bin/env node
// The single "owner" process. It holds the one WhatsApp session and serves it
// over a FIXED localhost port. Only one daemon can run — it binds the port, and
// a second one exits on EADDRINUSE. It is spawned detached by the MCP server, so
// it OUTLIVES Claude Desktop restarts: the session stays linked, no re-scan.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import {
  ensureClient,
  getState,
  getLiveStatus,
  getLastQr,
  listChats,
  getMessages,
  resetClient,
  startHeartbeat,
} from './wa.js';

const PORT = Number(process.env.WA_DAEMON_PORT || 47291);
const PIDFILE = path.join(os.tmpdir(), `whatsapp-digest-daemon.${PORT}.pid`);

const QR_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Link WhatsApp — WhatsApp Digest</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #f7f4ee; color: #23211c; margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; }
  .card { background: #fffdf8; border: 1px solid #e4ddcf; border-radius: 14px;
    padding: 32px 36px; max-width: 380px; text-align: center;
    box-shadow: 0 1px 0 #fff inset, 0 10px 30px rgba(60,50,30,.08); }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { font-size: 13px; line-height: 1.5; color: #6b6557; margin: 6px 0; }
  .qr { width: 280px; height: 280px; margin: 18px auto; display: flex;
    align-items: center; justify-content: center; border: 1px solid #ece5d6;
    border-radius: 10px; background: #fff; }
  .qr img { width: 260px; height: 260px; image-rendering: pixelated; }
  .status { font-size: 13px; font-weight: 600; margin-top: 10px; }
  .ok { color: #2e7d32; } .muted { color: #9a9384; }
  ol { text-align: left; font-size: 12.5px; color: #6b6557; padding-left: 18px; }
</style></head><body>
  <div class="card">
    <h1>Link WhatsApp</h1>
    <p class="muted">Runs on your machine. Read-only.</p>
    <div class="qr" id="qr"><span class="muted">starting…</span></div>
    <div class="status" id="status">Waiting…</div>
    <ol>
      <li>Open WhatsApp on your phone</li>
      <li>Settings → <b>Linked Devices</b> → <b>Link a Device</b></li>
      <li>Scan the code above</li>
    </ol>
  </div>
<script>
  async function tick() {
    try {
      const d = await (await fetch('/qr-status')).json();
      const qr = document.getElementById('qr'), st = document.getElementById('status');
      if (d.state === 'ready') {
        qr.innerHTML = '<div style="font-size:64px">✓</div>';
        st.innerHTML = '<span class="ok">Linked! Close this tab and go back to Claude.</span>';
        return;
      }
      if (d.state === 'qr' && d.qrImage) {
        qr.innerHTML = '<img alt="QR" src="' + d.qrImage + '" />';
        st.textContent = 'Scan the code with your phone';
      } else if (d.state === 'loading') { st.textContent = 'Connecting…'; }
      else { st.textContent = 'Waiting…'; }
    } catch (e) {}
    setTimeout(tick, 2500);
  }
  tick();
</script></body></html>`;

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    switch (url.pathname) {
      case '/health':
        return sendJson(res, 200, { ok: true, pid: process.pid });
      case '/status':
        return sendJson(res, 200, {
          ...(await getLiveStatus()),
          qrUrl: `http://localhost:${PORT}/qr`,
        });
      case '/link':
        ensureClient();
        return sendJson(res, 200, { qrUrl: `http://localhost:${PORT}/qr` });
      case '/qr':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(QR_PAGE);
      case '/qr-status': {
        const s = getState();
        const qr = getLastQr();
        let qrImage = null;
        if (s.state === 'qr' && qr) {
          try {
            qrImage = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
          } catch {}
        }
        return sendJson(res, 200, { state: s.state, qrImage });
      }
      case '/chats':
        return sendJson(
          res,
          200,
          await listChats(Number(url.searchParams.get('limit') || 30))
        );
      case '/messages':
        return sendJson(
          res,
          200,
          await getMessages({
            hours: Number(url.searchParams.get('hours') || 24),
            chatName: url.searchParams.get('chat') || null,
          })
        );
      case '/reset':
        return sendJson(res, 200, await resetClient());
      case '/shutdown':
        sendJson(res, 200, { ok: true });
        try {
          fs.rmSync(PIDFILE, { force: true });
        } catch {}
        return server.close(() => process.exit(0));
      default:
        return sendJson(res, 404, { error: 'not found' });
    }
  } catch (e) {
    sendJson(res, 500, { error: e?.message || String(e) });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[daemon] port ${PORT} already in use — another daemon owns the session. Exiting.`);
    process.exit(0);
  }
  console.error('[daemon] server error:', e?.message || e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`[daemon] listening on http://localhost:${PORT} (pid ${process.pid})`);
  try {
    fs.writeFileSync(PIDFILE, String(process.pid));
  } catch {}
  // Start WhatsApp immediately so the saved session is restored and held alive.
  ensureClient();
  // Keep it alive across sleeps/idle so the first request of the day just works.
  startHeartbeat();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      fs.rmSync(PIDFILE, { force: true });
    } catch {}
    process.exit(0);
  });
}
