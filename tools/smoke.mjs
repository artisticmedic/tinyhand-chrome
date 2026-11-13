// Headless smoke test. Loads the extension in Chrome for Testing (Playwright's
// copy), checks that every fixture case hides the real cursor, drives the
// pointer, and screenshots the drawn hand to out/. The overlay is page
// content, so headless screenshots show it; the real pointer they don't.
// Needs the fixture served on 8741 and 8742 (see README).
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

const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), `tinyhand-smoke-${Date.now()}`), {
  executablePath: exe,
  headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  viewport: { width: 1280, height: 800 },
  screen: { width: 1512, height: 982 },
  deviceScaleFactor: 2,
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
const set = (values) => worker.evaluate((v) => chrome.storage.local.set(v), values);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50 && !(await worker.evaluate(() => chrome.storage.local.get('style'))).style; i++) await wait(100);
console.log('defaults', JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null))));

const port = Number(process.env.FIXTURE_PORT || 8741);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/calendar.html`);
await page.waitForFunction(() => getComputedStyle(document.documentElement).cursor === 'none', null, { timeout: 10000 });
await wait(800);

let fails = 0;
for (const report of await page.evaluate(() => window.tinyhandReport())) {
  const bad = report.rows.filter((r) => !r.pass);
  fails += bad.length;
  console.log(`cursor hidden ${report.frame.replace(/^http:\/\/127.0.0.1:\d+/, '')}: ${report.rows.length - bad.length}/${report.rows.length}`);
  for (const r of bad) console.log('  FAIL', r.case, 'got', String(r.got).slice(0, 60));
}

const shots = [];
async function shot(name, x, y, { down = false, settle = 1500 } = {}) {
  await page.mouse.move(x, y, { steps: 8 });
  if (down) await page.mouse.down();
  await wait(settle);
  const file = path.join(out, `smoke-${name}.png`);
  await page.screenshot({ path: file });
  if (down) await page.mouse.up();
  shots.push({ name, file, x, y });
}

const cdp = await context.newCDPSession(page);
const audio = { states: [], sources: 0 };
cdp.on('WebAudio.contextCreated', (e) => audio.states.push(e.context.contextState));
cdp.on('WebAudio.contextChanged', (e) => audio.states.push(e.context.contextState));
cdp.on('WebAudio.audioNodeCreated', (e) => { if (e.node.nodeType === 'AudioBufferSourceNode') audio.sources++; });
await cdp.send('WebAudio.enable');

await shot('middle', 640, 300);
await shot('pressed', 640, 300, { down: true, settle: 30 });
await shot('left', 120, 250);
await shot('bottom-right', 1200, 760);
// Into the cross-origin iframe: the hand has to follow via postMessage.
const frameBox = await page.locator('#f-cross').boundingBox();
await shot('cross-origin-iframe', frameBox.x + 60, frameBox.y + 30);
await wait(800);
console.log('audio:', audio.states.join(' -> ') || 'none', '| buffer sources started', audio.sources);

for (const [style, extra] of [['robot', {}], ['laser', {}], ['glove', { shadow: false }]]) {
  await set({ style, shadow: true, ...extra });
  await wait(500);
  await shot(`${style}${extra.shadow === false ? '-noshadow' : ''}`, 640, 300);
}
await set({ style: 'glove', shadow: true });

await set({ enabled: false });
await wait(600);
const offCursor = await page.evaluate(() => getComputedStyle(document.documentElement).cursor);
const overlayLeft = await page.evaluate(() => !!document.querySelector('tinyhand-overlay'));
await shot('off', 640, 300, { settle: 300 });
await set({ enabled: true });
await wait(600);
const onCursor = await page.evaluate(() => getComputedStyle(document.documentElement).cursor);
console.log('off: cursor', offCursor, '| overlay in DOM', overlayLeft, '| back on: cursor', onCursor);

// A modal dialog goes in the top layer; the overlay should stay above it.
await page.evaluate(() => document.querySelector('dialog')?.showModal());
await shot('over-modal-dialog', 640, 300);
await page.keyboard.press('Escape');

console.log('page errors:', errors.length ? errors : 'none');
console.log(fails ? `${fails} fixture failures` : 'fixture: all pass');
console.log('SHOTS', JSON.stringify(shots));
await context.close();
