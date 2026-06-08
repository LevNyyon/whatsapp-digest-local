// Tiny local web page that shows a live-refreshing QR code for linking
// WhatsApp. WhatsApp rotates the QR every ~20s, so the page polls /status
// and swaps the image instead of showing one stale code.
import http from 'node:http';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';

let server = null;
let port = null;
let infoProvider = () => ({ state: 'idle', qr: null });

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Link WhatsApp — WhatsApp Digest</title>
<style>
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #f7f4ee; color: #23211c; margin: 0;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
  }
  .card {
    background: #fffdf8; border: 1px solid #e4ddcf; border-radius: 14px;
    padding: 32px 36px; max-width: 380px; text-align: center;
    box-shadow: 0 1px 0 #fff inset, 0 10px 30px rgba(60,50,30,.08);
  }
  h1 { font-size: 18px; margin: 0 0 4px; letter-spacing: .2px; }
  p { font-size: 13px; line-height: 1.5; color: #6b6557; margin: 6px 0; }
  .qr { width: 280px; height: 280px; margin: 18px auto; display: flex;
        align-items: center; justify-content: center;
        border: 1px solid #ece5d6; border-radius: 10px; background: #fff; }
  .qr img { width: 260px; height: 260px; image-rendering: pixelated; }
  .status { font-size: 13px; font-weight: 600; margin-top: 10px; }
  .ok { color: #2e7d32; }
  .muted { color: #9a9384; }
  ol { text-align: left; font-size: 12.5px; color: #6b6557; padding-left: 18px; }
  code { background: #f0ebe0; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Link WhatsApp</h1>
    <p class="muted">WhatsApp Digest runs on your machine. Read-only.</p>
    <div class="qr" id="qr"><span class="muted">starting…</span></div>
    <div class="status" id="status">Waiting for QR…</div>
    <ol>
      <li>Open WhatsApp on your phone</li>
      <li>Settings → <b>Linked Devices</b> → <b>Link a Device</b></li>
      <li>Point your phone at the code above</li>
    </ol>
  </div>
<script>
  async function tick() {
    try {
      const r = await fetch('/status');
      const d = await r.json();
      const qr = document.getElementById('qr');
      const st = document.getElementById('status');
      if (d.state === 'ready') {
        qr.innerHTML = '<div style="font-size:64px">✓</div>';
        st.innerHTML = '<span class="ok">Linked! You can close this tab and go back to Claude.</span>';
        return; // stop polling
      }
      if (d.state === 'qr' && d.qrImage) {
        qr.innerHTML = '<img alt="QR" src="' + d.qrImage + '" />';
        st.textContent = 'Scan the code with your phone';
      } else if (d.state === 'loading') {
        st.textContent = 'Connecting…';
      } else {
        st.textContent = 'Waiting for QR…';
      }
    } catch (e) { /* server not ready yet */ }
    setTimeout(tick, 2500);
  }
  tick();
</script>
</body>
</html>`;

async function handler(req, res) {
  if (req.url && req.url.startsWith('/status')) {
    const info = infoProvider();
    let qrImage = null;
    if (info.state === 'qr' && info.qr) {
      try {
        qrImage = await QRCode.toDataURL(info.qr, { margin: 1, width: 320 });
      } catch {
        /* ignore render errors */
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ state: info.state, qrImage }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
}

// Start (once) the local QR page. `provider` returns { state, qr }.
export function startQrServer(provider) {
  infoProvider = provider;
  if (server) return Promise.resolve({ url: getQrUrl() });
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve({ url: getQrUrl() });
    });
  });
}

export function getQrUrl() {
  return port ? `http://localhost:${port}` : null;
}

// Best-effort: open the user's default browser at the QR page.
export function openBrowser(url) {
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
  } catch {
    /* user can open the URL manually */
  }
}
