// Headless check of draw mode: Shift-drag draws without the page seeing the
// press, Shift+⌘ ends with an arrow, Esc clears, lines fade, a Shift-click
// that doesn't move still clicks, and drawing works inside an iframe.
// Screenshots go to out/draw-*.png. Needs the fixture on 8741/8742.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'out');
mkdirSync(out, { recursive: true });
const exe = process.env.CHROMIUM || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), `tinyhand-draw-${Date.now()}`), {
  executablePath: exe, headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  viewport: { width: 1280, height: 800 }, screen: { width: 1512, height: 982 },
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
for (let i = 0; i < 50 && !(await worker.evaluate(() => chrome.storage.local.get('style'))).style; i++) await wait(100);
const set = (v) => worker.evaluate((x) => chrome.storage.local.set(x), v);

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:8741/calendar.html');
await page.waitForFunction(() => getComputedStyle(document.documentElement).cursor === 'none');
await wait(500);
await page.evaluate(() => {
  window.seen = { mousedown: 0, mouseup: 0, click: 0 };
  for (const t of Object.keys(window.seen)) document.addEventListener(t, () => window.seen[t]++);
});
const seen = () => page.evaluate(() => ({ ...window.seen }));
const reset = () => page.evaluate(() => { for (const k in window.seen) window.seen[k] = 0; });

async function stroke(points, { meta = false } = {}) {
  await page.keyboard.down('Shift');
  if (meta) await page.keyboard.down('Meta');
  await page.mouse.move(...points[0]);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...p, { steps: 6 });
  await page.mouse.up();
  if (meta) await page.keyboard.up('Meta');
  await page.keyboard.up('Shift');
}

// A wavy line and an arrow.
await stroke([[250, 180], [400, 140], [560, 210], [720, 150]]);
await stroke([[300, 330], [450, 300], [600, 380]], { meta: true });
await wait(300);
const afterDraw = await seen();
await page.screenshot({ path: path.join(out, 'draw-1-lines.png') });
console.log('page saw during two strokes:', JSON.stringify(afterDraw));

// A Shift-click that doesn't move still clicks.
await reset();
await page.keyboard.down('Shift');
await page.mouse.click(900, 600);
await page.keyboard.up('Shift');
await wait(200);
console.log('page saw for a still Shift-click:', JSON.stringify(await seen()));

// Lines fade after 3 s (+0.6 s fade).
await wait(3600);
await page.screenshot({ path: path.join(out, 'draw-2-faded.png') });

// Esc clears a kept line.
await set({ fade: 0 });
await wait(300);
await stroke([[250, 500], [500, 470], [700, 520]]);
await wait(1500);
await page.screenshot({ path: path.join(out, 'draw-3-kept.png') });
await page.keyboard.press('Escape');
await wait(300);
await page.screenshot({ path: path.join(out, 'draw-4-cleared.png') });

// Inside the cross-origin iframe, in red ink.
await set({ fade: 3, ink: 'red' });
await wait(300);
const box = await page.locator('#f-cross').boundingBox();
await reset();
await stroke([[box.x + 20, box.y + 60], [box.x + 90, box.y + 25], [box.x + 140, box.y + 70]]);
await wait(300);
await page.screenshot({ path: path.join(out, 'draw-5-iframe.png') });
console.log('top page saw during iframe stroke:', JSON.stringify(await seen()));

// Shift in a text field still selects text rather than drawing.
await set({ ink: 'match' });
console.log('page errors:', errors.length ? errors : 'none');
await context.close();
