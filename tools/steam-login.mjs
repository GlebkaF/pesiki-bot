import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import QRCode from 'qrcode';
import { mkdir, writeFile, chmod, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';

const directory = resolve('data/steam');
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
let state = 'loading';
let png;
let session;
let generation = 0;
let retry;
const page = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Вход в Steam — Песики</title>
<body style="font:20px system-ui;text-align:center;padding:40px"><h1>Steam для Песиков</h1>
<p>Открой Steam на телефоне → Steam Guard → сканировать QR-код.<br>Подтверди вход для этого компьютера.</p>
<img id="qr" width="360" height="360" alt="QR-код Steam" hidden><p id="state">Загружаю QR-код…</p>
<script>
let generation = -1;
async function update() {
 try {
  const response = await fetch('/state'); const data = await response.json();
  const qr = document.getElementById('qr');
  qr.hidden = data.state !== 'ready';
  if (data.state === 'ready' && generation !== data.generation) {
   generation = data.generation; qr.src = '/qr.png?v=' + generation;
  }
  document.getElementById('state').textContent = ({loading:'Загружаю QR-код…',ready:'Отсканируй код в Steam Guard. Просроченный код обновится автоматически.',authenticated:'Вход подтверждён. Можно закрыть страницу.',error:'Steam не ответил. Повторяю запрос…'})[data.state];
  if (data.state !== 'authenticated') setTimeout(update, 2000);
 } catch { document.getElementById('state').textContent = 'Соединение закрыто. Вернись в Codex.'; }
}
update();
</script></body></html>`;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.url?.startsWith('/qr.png') && png && state === 'ready') {
    response.setHeader('Content-Type', 'image/png'); response.end(png);
  } else if (request.url === '/state') {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ state, generation }));
  } else if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(page);
  } else { response.writeHead(404); response.end(); }
});
await new Promise(accept => server.listen(0, '127.0.0.1', accept));
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(`STEAM_LOGIN_PAGE: ${url}`);
if (process.platform === 'darwin') execFile('open', [url]);

async function start() {
  state = 'loading'; png = undefined;
  session = new LoginSession(EAuthTokenPlatformType.SteamClient);
  const current = session;
  current.loginTimeout = 300_000;
  let ended = false;
  function retryLogin() {
    if (ended) return;
    ended = true; current.cancelLoginAttempt(); state = 'error'; png = undefined;
    console.log('Steam QR expired or unavailable; renewing.');
    retry = setTimeout(start, 3000);
  }
  current.on('timeout', retryLogin);
  current.on('error', retryLogin);
  current.on('authenticated', async () => {
    if (ended) return;
    ended = true;
    try {
      const path = resolve(directory, 'refresh-token');
      await writeFile(`${path}.tmp`, current.refreshToken, { mode: 0o600 });
      await chmod(`${path}.tmp`, 0o600);
      await rename(`${path}.tmp`, path);
      state = 'authenticated'; png = undefined;
      console.log('STEAM_AUTHENTICATED: token saved privately in data/steam/refresh-token');
      setTimeout(() => process.exit(0), 10_000);
    } catch { state = 'error'; console.error('Could not save Steam login'); process.exit(1); }
  });
  try {
    const { qrChallengeUrl } = await current.startWithQR();
    const next = await QRCode.toBuffer(qrChallengeUrl, { width: 360, margin: 3 });
    if (!ended) { png = next; state = 'ready'; generation++; console.log('STEAM_QR_READY'); }
  } catch { retryLogin(); }
}
function stop() { clearTimeout(retry); session?.cancelLoginAttempt(); server.close(); process.exit(1); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setTimeout(stop, 20 * 60_000).unref();
await start();
