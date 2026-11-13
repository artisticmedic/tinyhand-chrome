// Headless smoke test: loads the extension in Playwright's Chromium, waits for
// the service worker to draw the cursors, checks the fixture's computed
// cursors, and writes a contact sheet of the drawn images to out/.
// Usage: node tools/smoke.mjs [style ...]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = require(pwPath);

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'out');
mkdirSync(out, { recursive: true });
const exe = process.env.CHROMIUM || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const profile = path.join(os.tmpdir(), `tinyhand-smoke-${Date.now()}`);

const context = await chromium.launchPersistentContext(profile, {
  executablePath: exe,
  headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  viewport: { width: 1200, height: 800 },
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
const id = new URL(worker.url()).host;
console.log('extension id', id);

const waitCursors = async (pred = () => true) => {
  for (let i = 0; i < 100; i++) {
    const c = await worker.evaluate(() => chrome.storage.local.get(null));
    if (c.cursors && pred(c)) return c;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('cursors never appeared');
};

const first = await waitCursors();
console.log('defaults', JSON.stringify({ ...first, cursors: undefined }));
console.log('cursor css bytes idle', first.cursors.idle.length, 'pressed', first.cursors.pressed.length, 'length', first.cursors.length, 'sound', first.cursors.sound);

const styles = process.argv.slice(2);
const sheet = await context.newPage();
await sheet.goto(`chrome-extension://${id}/test/sheet.html?styles=${encodeURIComponent(styles.join(','))}`);
await sheet.waitForFunction(() => window.sheetDone === true, null, { timeout: 60000 });
const sheetInfo = await sheet.evaluate(() => window.sheetInfo);
console.log(JSON.stringify(sheetInfo, null, 1));
await sheet.screenshot({ path: path.join(out, 'sheet.png'), fullPage: true });

// Fixture: computed cursors in every frame, shadow roots, the pressed state.
const port = Number(process.env.FIXTURE_PORT || 8741);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/calendar.html`);
await page.waitForFunction(() => getComputedStyle(document.documentElement).cursor.includes('image-set'), null, { timeout: 10000 });
await page.waitForTimeout(800);
const reports = await page.evaluate(() => window.tinyhandReport());
let fails = 0;
for (const report of reports) {
  const bad = report.rows.filter((r) => !r.pass);
  fails += bad.length;
  console.log(`${report.frame.replace(/^http:\/\/127.0.0.1:\d+/, '')}: ${report.rows.length - bad.length}/${report.rows.length} pass${report.styleInjected ? '' : ' (no style)'}`);
  for (const r of bad) console.log('  FAIL', r.case, 'expect', r.expect, 'got', String(r.got).slice(0, 60));
}
await page.mouse.move(400, 300);
await page.mouse.down();
const pressed = await page.evaluate(() => document.documentElement.hasAttribute('data-tinyhand-pressed'));
await page.mouse.up();
const heldAfterUp = await page.evaluate(() => document.documentElement.hasAttribute('data-tinyhand-pressed'));
await page.waitForTimeout(200);
const releasedLater = !(await page.evaluate(() => document.documentElement.hasAttribute('data-tinyhand-pressed')));
console.log('pressed on mousedown', pressed, '| still pressed right after a quick mouseup', heldAfterUp, '| released after 200ms', releasedLater);
console.log('page errors', errors.length ? errors : 'none');

// Turning the hand off removes the styles; turning it back on restores them.
await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
await page.waitForTimeout(500);
const offCursor = await page.evaluate(() => getComputedStyle(document.documentElement).cursor);
await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
await page.waitForTimeout(500);
const onCursor = await page.evaluate(() => getComputedStyle(document.documentElement).cursor.slice(0, 30));
console.log('cursor when off:', offCursor, '| when back on:', onCursor);

// Changing the style redraws the cursor.
const before = (await waitCursors()).cursors.idle;
await worker.evaluate(() => chrome.storage.local.set({ style: 'robot' }));
const after = await waitCursors((c) => c.cursors.idle !== before);
console.log('style change redraws:', after.cursors.idle !== before, '| sound', after.cursors.sound);
await worker.evaluate(() => chrome.storage.local.set({ style: 'glove' }));
await waitCursors((c) => c.cursors.idle === before);

for (const [name, url, size] of [['popup', 'popup/popup.html', { width: 340, height: 560 }], ['options', 'options/options.html', { width: 900, height: 1500 }]]) {
  const p = await context.newPage();
  await p.setViewportSize(size);
  await p.goto(`chrome-extension://${id}/${url}`);
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
}
console.log(fails ? `${fails} fixture failures` : 'fixture: all pass');
await context.close();
