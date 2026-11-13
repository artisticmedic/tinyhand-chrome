import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { launch, openFixture, out, wait } from './harness.mjs';

const { context } = await launch({ deviceScaleFactor: 1 });
const { page, errors } = await openFixture(context);
await wait(600);

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

await page.mouse.click(x, y);
await wait(200);
console.log('plain click reaches page:', (await page.evaluate(() => window.pageClicks)) > 0);
console.log('page errors:', errors.length ? errors : 'none');
await context.close();
