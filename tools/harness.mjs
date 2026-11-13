import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const exe = process.env.CHROMIUM || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const ext = process.env.EXT_DIR || root;
export const out = path.join(root, 'out');
mkdirSync(out, { recursive: true });

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launch(options = {}) {
  const profile = path.join(os.tmpdir(), `tinyhand-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: exe,
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport: { width: 1280, height: 800 },
    screen: { width: 1512, height: 982 },
    ...options,
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  for (let i = 0; i < 50 && !(await worker.evaluate(() => chrome.storage.local.get('style'))).style; i++) await wait(100);
  for (const page of context.pages()) {
    if (page.url().startsWith('chrome-extension://')) await page.close();
  }
  const set = (values) => worker.evaluate((v) => chrome.storage.local.set(v), values);
  return { context, worker, set, id: new URL(worker.url()).host };
}

export async function openFixture(context, file = 'calendar.html') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:8741/${file}`);
  await page.waitForFunction(() => getComputedStyle(document.documentElement).cursor === 'none', null, { timeout: 10000 });
  return { page, errors };
}
