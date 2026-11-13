// Headless check that injecting a second copy of the content script into a
// page with a live copy, as the service worker does after an install or
// update, leaves one hand. Needs the fixture on 8741/8742.
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const root = process.env.EXT_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const exe = process.env.CHROMIUM || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), `tinyhand-reload-${Date.now()}`), {
  executablePath: exe, headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  viewport: { width: 1280, height: 800 },
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
await wait(800);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:8741/calendar.html');
await page.waitForFunction(() => getComputedStyle(document.documentElement).cursor === 'none');
const overlays = () => page.evaluate(() => document.querySelectorAll('tinyhand-overlay').length);
const cursor = () => page.evaluate(() => getComputedStyle(document.documentElement).cursor);
const nudge = async (x) => { await page.mouse.move(x, 300, { steps: 4 }); await wait(300); };
await nudge(500);
console.log('start: overlays', await overlays());

// 1. A second copy injected next to a live one quits.
await worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1:8741/*' });
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
});
await nudge(520);
console.log('after a duplicate injection: overlays', await overlays());

// A real chrome.runtime.reload() can't be checked here: Chrome blocks an
// extension loaded with --load-extension once it reloads itself.

// What the embedding page can see while the pointer moves in a cross-origin
// iframe: only the frame's hello with its random id, no coordinates.
await page.evaluate(() => {
  window.seenMessages = [];
  window.addEventListener('message', (e) => window.seenMessages.push(JSON.stringify(e.data).slice(0, 80)));
});
await page.reload();
await page.waitForFunction(() => getComputedStyle(document.documentElement).cursor === 'none');
await page.evaluate(() => {
  window.seenMessages = [];
  window.addEventListener('message', (e) => window.seenMessages.push(JSON.stringify(e.data).slice(0, 80)));
});
// Positive control: the listener does hear messages.
await page.evaluate(() => window.postMessage('control', '*'));
const box = await page.locator('#f-cross').boundingBox();
for (let i = 0; i < 10; i++) await page.mouse.move(box.x + 20 + i * 10, box.y + 30);
await page.mouse.down();
await page.mouse.up();
await wait(500);
const seen = await page.evaluate(() => window.seenMessages);
console.log('messages the page saw during 10 moves and a click in the iframe:', seen.length, JSON.stringify([...new Set(seen)]));
console.log('page errors:', errors.length ? errors : 'none');
await context.close();
