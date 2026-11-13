import path from 'node:path';
import { launch, openFixture, out, wait } from './harness.mjs';

const { context, worker, set } = await launch({ deviceScaleFactor: 2 });
console.log('defaults', JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null))));
const { page, errors } = await openFixture(context);
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
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

await page.evaluate(() => document.querySelector('dialog')?.showModal());
await shot('over-modal-dialog', 640, 300);
await page.keyboard.press('Escape');

console.log('page errors:', errors.length ? errors : 'none');
console.log(fails ? `${fails} fixture failures` : 'fixture: all pass');
console.log('SHOTS', JSON.stringify(shots));
await context.close();
