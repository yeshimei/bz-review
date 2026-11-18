/* 把 index.html 截成一张高清长图（Edge headless + CDP，不依赖 npm 包） */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const SCALE = Number(process.argv[2] || 2);
const PAGE = pathToFileURL(path.join(dir, 'index.html')).href;
const CDP = 9361;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edge = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--allow-file-access-from-files',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'bz-procompare-' + process.pid)}`,
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  PAGE,
], { stdio: 'ignore' });

let page = null;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (page) break;
  } catch {
    /* 还没起来 */
  }
  await sleep(250);
}
if (!page) {
  edge.kill();
  throw new Error('Edge 没起来');
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1080,
  height: 1500,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(500);
await ev('document.fonts.ready.then(() => true)');
await sleep(250);

const metrics = await ev(`JSON.stringify({
  w: document.documentElement.scrollWidth,
  h: document.documentElement.scrollHeight,
  rows: document.querySelectorAll('#plan tbody tr:not(.grp)').length,
  groups: document.querySelectorAll('#plan tr.grp').length,
  proYes: document.querySelectorAll('#plan td.pro .yes').length,
  freeYes: document.querySelectorAll('#plan td.free .yes').length,
  wrapped: [...document.querySelectorAll('#plan td.f')]
    .filter(td => td.textContent.trim() && td.getBoundingClientRect().height > 44)
    .map(td => ({ t: td.textContent.trim(), h: Math.round(td.getBoundingClientRect().height) })),
  overflowBottom: (() => {
    const card = document.querySelector('.card').getBoundingClientRect();
    const tf = document.querySelector('#plan tfoot').getBoundingClientRect();
    return Math.round(card.bottom - tf.bottom);
  })(),
})`);
console.log('metrics', metrics);

const m = JSON.parse(metrics);
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: m.w, height: m.h, scale: SCALE },
});
const buf = Buffer.from(shot.result.data, 'base64');
fs.writeFileSync(path.join(OUT, 'pro-compare.png'), buf);
console.log('shot pro-compare.png', `${m.w}x${m.h} @${SCALE}x = ${m.w * SCALE}x${m.h * SCALE}`, `${(buf.length / 1024 / 1024).toFixed(2)} MB`);

ws.close();
edge.kill();
process.exit(0);
