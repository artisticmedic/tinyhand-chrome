// Headless check of slap-to-remove: Option-hover outlines, Option-click slaps
// the element away without the page seeing the click, Option-Z restores it.
// Writes frames of the swing to out/slap-*.png. Needs the fixture on 8741/8742.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ext = process.env.EXT_DIR || root;
const out = path.join(root, 'out');
mkdirSync(out, { recursive: true });
const exe = process.env.CHROMIUM || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), `tinyhand-slap-${Date.now()}`), {
  executablePath: exe, headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 800 }, screen: { width: 1512, height: 982 }, deviceScaleFactor: 1,
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
for (let i = 0; i < 50 && !(await worker.evaluate(() => chrome.storage.local.get('style'))).style; i++) await wait(100);

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:8741/calendar.html');
await page.waitForFunction(() => getComputedStyle(document.documentElement).cursor === 'none');
await wait(600);

// Count clicks the page sees on the target.
const sel = '[data-case="plain"], [data-case*="plain"]';
const found = await page.evaluate((sel) => {
  const el = document.querySelector(sel) || [...document.querySelectorAll('[data-case]')].find((e) => /plain/i.test(e.textContent));
  if (!el) return null;
  el.id ||= 'slap-target';
  window.pageClicks = 0;
  el.addEventListener('click', () => window.pageClicks++);
  el.addEventListener('mousedown', () => window.pageClicks++);
  const r = el.getBoundingClientRect();
  return { id: el.id, x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.textContent.trim().slice(0, 30) };
}, sel);
console.log('target', JSON.stringify(found));
const { x, y } = found;

await page.mouse.move(x, y, { steps: 6 });
await wait(400);
await page.keyboard.down('Alt');
await page.mouse.move(x + 2, y + 1);
await wait(300);
const outline = await page.evaluate((id) => getComputedStyle(document.getElementById(id)).outlineStyle, found.id);
await page.screenshot({ path: path.join(out, 'slap-0-outlined.png') });

// Record the swing as a screencast; screenshots are too slow to catch it.
const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', (f) => {
  frames.push({ data: f.data, t: f.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
await wait(300);
const clickAt = Date.now() / 1000;
await page.mouse.down();
await page.mouse.up();
await wait(900);
await cdp.send('Page.stopScreencast');
const { writeFileSync } = await import('node:fs');
const picked = [];
for (const ms of [0, 50, 100, 140, 175, 210, 260, 330, 450, 700]) {
  const target = clickAt + ms / 1000;
  const f = frames.filter((x) => x.t >= target)[0];
  if (f && !picked.includes(f)) {
    picked.push(f);
    writeFileSync(path.join(out, `slap-cast-${String(Math.round((f.t - clickAt) * 1000)).padStart(3, '0')}.png`), Buffer.from(f.data, 'base64'));
  }
}
console.log('screencast frames', frames.length, 'saved', picked.length);
await page.keyboard.up('Alt');
const after = await page.evaluate((id) => ({ display: getComputedStyle(document.getElementById(id)).display, clicks: window.pageClicks }), found.id);
console.log('outline while ⌥ held:', outline, '| after slap: display', after.display, '| page saw clicks/mousedowns:', after.clicks);

await page.keyboard.down('Alt');
await page.keyboard.press('KeyZ');
await page.keyboard.up('Alt');
await wait(400);
const restored = await page.evaluate((id) => getComputedStyle(document.getElementById(id)).display, found.id);
const outlineLeft = await page.evaluate((id) => document.getElementById(id).getAttribute('style'), found.id);
console.log('after ⌥Z: display', restored, '| inline style left behind:', JSON.stringify(outlineLeft));

// Plain click still reaches the page.
await page.mouse.click(x, y);
await wait(200);
console.log('plain click reaches page:', (await page.evaluate(() => window.pageClicks)) > 0);
console.log('page errors:', errors.length ? errors : 'none');
await context.close();
