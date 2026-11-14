import { launch, openFixture, wait } from './harness.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

const { context, id } = await launch({ deviceScaleFactor: 1 });
const { page } = await openFixture(context, 'update.html');
const cdp = await context.newCDPSession(page);
const exceptions = [];
cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
await cdp.send('Runtime.enable');
await page.frameLocator('#child').locator('#status').waitFor();
await wait(800);

const child = () => page.frames().find((f) => f.url().includes(':8742/'));
const state = async () => ({
  overlays: await page.evaluate(() => document.querySelectorAll('html > div[popover]').length),
  cursor: await page.evaluate(() => getComputedStyle(document.documentElement).cursor),
  frameCursor: await child().evaluate(() => getComputedStyle(document.documentElement).cursor),
  box: await page.evaluate(() => getComputedStyle(document.getElementById('box')).display),
});
const wiggle = async () => {
  for (let i = 0; i < 6; i++) await page.mouse.move(700 + i * 15, 600 + i * 5);
  for (let i = 0; i < 6; i++) await page.mouse.move(300 + i * 15, 320 + i * 3);
  await wait(500);
};

const box = await page.locator('#box').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
await page.keyboard.down('Alt');
await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 1);
await wait(300);
await page.mouse.down();
await page.mouse.up();
await wait(900);
await page.keyboard.up('Alt');
check('before the update: the box is slapped', (await state()).box === 'none');

const extensions = await context.newPage();
await extensions.goto('chrome://extensions');
await extensions.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
await wait(300);

const nextWorker = context.waitForEvent('serviceworker', { predicate: (w) => w.url().includes(id) });
await extensions.evaluate((extensionId) => chrome.developerPrivate.reload(extensionId, { failQuietly: true }), id);
const worker = await nextWorker;
await wait(1500);
await page.bringToFront();
await wiggle();
const updated = await state();
check('after the update: one overlay, the cursor hidden in page and frame, the slap undone', updated.overlays === 1 && updated.cursor === 'none' && updated.frameCursor === 'none' && updated.box !== 'none', JSON.stringify(updated));

await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
await wait(500);
await wiggle();
const off = await state();
check('hand turned off after the update: the real cursor is back in page and frame', off.overlays === 0 && off.cursor !== 'none' && off.frameCursor !== 'none', JSON.stringify(off));

await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
await wait(500);
await wiggle();
check('hand back on', (await state()).cursor === 'none');

await extensions.evaluate((extensionId) => chrome.management.setEnabled(extensionId, false), id);
await wait(500);
await page.bringToFront();
await wiggle();
const disabled = await state();
check('extension disabled: the hand is gone and the real cursor is back in page and frame', disabled.overlays === 0 && disabled.cursor !== 'none' && disabled.frameCursor !== 'none', JSON.stringify(disabled));

check('no uncaught exceptions in any world', exceptions.length === 0, exceptions.join(' | '));
await context.close();
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
process.exitCode = failed ? 1 : 0;
