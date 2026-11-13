// Renders the Chrome Web Store images with the real extension running:
// five 1280x800 screenshots and the 440x280 promo tile, into store/images/.
// Each is drawn at 2x and scaled down. Needs store/ served on 8743:
//   python3 -m http.server 8743 --bind 127.0.0.1 -d store
// Usage: node tools/store-shots.mjs [name shown on the tile]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ext = process.env.EXT_DIR || root;
const raw = path.join(root, 'out', 'store-raw');
const images = path.join(root, 'store', 'images');
mkdirSync(raw, { recursive: true });
mkdirSync(images, { recursive: true });
const exe = process.env.CHROMIUM || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8743';
const tileName = process.argv[2] || 'TinyHand';

async function launch(viewport, screen) {
  const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), `tinyhand-store-${Date.now()}-${Math.random()}`), {
    executablePath: exe, headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport, screen, deviceScaleFactor: 2,
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  for (let i = 0; i < 50 && !(await worker.evaluate(() => chrome.storage.local.get('style'))).style; i++) await wait(100);
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension')) await p.close();
  const set = (v) => worker.evaluate((x) => chrome.storage.local.set(x), v);
  return { context, worker, set };
}

async function ready(page) {
  await page.waitForFunction(() => getComputedStyle(document.documentElement).cursor === 'none', null, { timeout: 10000 });
  await wait(400);
}

async function settle(page, x, y) {
  await page.mouse.move(x - 120, y + 160);
  await page.mouse.move(x, y, { steps: 25 });
  await wait(2200);
}

async function center(page, sel, fx = 0.5, fy = 0.5) {
  const b = await page.locator(sel).boundingBox();
  return [b.x + b.width * fx, b.y + b.height * fy];
}

async function stroke(page, points, meta = false) {
  await page.keyboard.down('Shift');
  if (meta) await page.keyboard.down('Meta');
  await page.mouse.move(...points[0]);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...p, { steps: 4 });
  await page.mouse.up();
  if (meta) await page.keyboard.up('Meta');
  await page.keyboard.up('Shift');
}

function ellipse(cx, cy, rx, ry, turns = 1.08, start = -2.3) {
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const a = start + (i / 48) * Math.PI * 2 * turns;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

const shots = [];
async function save(page, name) {
  const file = path.join(raw, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(name);
  return file;
}

// --- 1280x800 screenshots
{
  const { context, set } = await launch({ width: 1280, height: 800 }, { width: 1512, height: 982 });
  const page = await context.newPage();
  await page.goto(`${BASE}/demo.html`);
  await ready(page);

  // 1. Pointing at the week that jumped.
  const [hx, hy] = await center(page, '#peak', 0.5, 0.12);
  await settle(page, hx, hy);
  await save(page, '1-point');

  // 2. Drawing: a ring around the peak and an arrow to the button.
  await set({ fade: 0 });
  await wait(200);
  const [px, py] = await center(page, '#peak', 0.5, 0.35);
  await stroke(page, ellipse(px, py, 44, 70));
  const ship = await page.locator('#ship').boundingBox();
  const ex = ship.x + ship.width * 0.62;
  const ey = ship.y - 6;
  await stroke(page, [[ex + 300, ey - 120], [ex + 200, ey - 80], [ex + 100, ey - 36], [ex + 8, ey - 2]], true);
  await settle(page, px + 46, py - 40);
  await save(page, '2-draw');
  await page.keyboard.press('Escape');
  await set({ fade: 3 });

  // 3. Slap: hold Option over the at-risk card, then the swing, as screencast frames.
  const [rx, ry] = await center(page, '#task-risk', 0.45, 0.55);
  await settle(page, rx, ry);
  await page.keyboard.down('Alt');
  await page.mouse.move(rx + 1, ry + 1);
  await wait(400);
  await save(page, '3a-outlined');
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push(f.data);
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 2560, maxHeight: 1600 });
  await wait(300);
  await page.mouse.down();
  await page.mouse.up();
  await wait(1200);
  await cdp.send('Page.stopScreencast');
  await page.keyboard.up('Alt');
  frames.forEach((data, i) => writeFileSync(path.join(raw, `3-slap-frame-${String(i).padStart(2, '0')}.png`), Buffer.from(data, 'base64')));
  // About two thirds of the way through, the card is mid-flight. Check the pick by eye.
  const pick = Number(process.env.SLAP_FRAME ?? Math.floor(frames.length * 0.65));
  writeFileSync(path.join(raw, '3-slap.png'), Buffer.from(frames[pick], 'base64'));
  console.log('slap frames', frames.length, 'picked', pick);
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Alt');

  // 4. Another hand, with the popup.
  await set({ style: 'robot' });
  await wait(500);
  const [sx, sy] = await center(page, '#task-done', 0.35, 0.45);
  await settle(page, sx, sy);
  await save(page, '4-robot');
  await set({ style: 'glove' });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 600 });
  await popup.goto(`chrome-extension://${new URL(context.serviceWorkers()[0].url()).host}/popup/popup.html`);
  await popup.evaluate(() => chrome.storage.local.set({ style: 'robot' }));
  await wait(500);
  const h = await popup.evaluate(() => document.body.scrollHeight);
  await popup.setViewportSize({ width: 340, height: h });
  await popup.screenshot({ path: path.join(raw, 'popup.png') });
  await popup.evaluate(() => chrome.storage.local.set({ style: 'glove' }));
  await popup.close();

  // 5. The Settings page, which shows the hand and has a practice area.
  // Captured at 960x600 so the narrow page fills the frame when scaled up.
  await set({ style: 'lavender', fade: 0 });
  const options = await context.newPage();
  await options.setViewportSize({ width: 960, height: 600 });
  await options.goto(`chrome-extension://${new URL(context.serviceWorkers()[0].url()).host}/options/options.html`);
  await wait(800);
  const [nx, ny] = await center(options, '.note:nth-child(3)', 0.5, 0.5);
  await stroke(options, [[nx + 260, ny + 40], [nx + 180, ny + 30], [nx + 110, ny + 8]], true);
  const [n1x, n1y] = await center(options, '.note:nth-child(1)', 0.5, 0.45);
  await settle(options, n1x, n1y);
  await options.screenshot({ path: path.join(raw, '5-settings.png') });
  await set({ style: 'glove', fade: 3 });
  await context.close();
}

// --- 440x280 promo tile
{
  const { context } = await launch({ width: 440, height: 280 }, { width: 900, height: 620 });
  const page = await context.newPage();
  await page.goto(`${BASE}/tile.html?name=${encodeURIComponent(tileName)}`);
  await ready(page);
  const b = await page.locator('#title').boundingBox();
  await settle(page, b.x + b.width - 4, b.y + b.height * 0.45);
  await page.screenshot({ path: path.join(raw, 'tile.png') });
  await context.close();
}

execFileSync('python3', [path.join(root, 'tools', 'store-compose.py'), raw, images], { stdio: 'inherit' });
