import path from 'node:path';
import { launch, openFixture, out, wait } from './harness.mjs';

const { context, set } = await launch();
const { page, errors } = await openFixture(context);
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

await stroke([[250, 180], [400, 140], [560, 210], [720, 150]]);
await stroke([[300, 330], [450, 300], [600, 380]], { meta: true });
await wait(300);
const afterDraw = await seen();
await page.screenshot({ path: path.join(out, 'draw-1-lines.png') });
console.log('page saw during two strokes:', JSON.stringify(afterDraw));

await reset();
await page.keyboard.down('Shift');
await page.mouse.click(900, 600);
await page.keyboard.up('Shift');
await wait(200);
console.log('page saw for a still Shift-click:', JSON.stringify(await seen()));

await wait(3600);
await page.screenshot({ path: path.join(out, 'draw-2-faded.png') });

await set({ fade: 0 });
await wait(300);
await stroke([[250, 500], [500, 470], [700, 520]]);
await wait(1500);
await page.screenshot({ path: path.join(out, 'draw-3-kept.png') });
await page.keyboard.press('Escape');
await wait(300);
await page.screenshot({ path: path.join(out, 'draw-4-cleared.png') });

await set({ fade: 3, ink: 'red' });
await wait(300);
const box = await page.locator('#f-cross').boundingBox();
await reset();
await stroke([[box.x + 20, box.y + 60], [box.x + 90, box.y + 25], [box.x + 140, box.y + 70]]);
await wait(300);
await page.screenshot({ path: path.join(out, 'draw-5-iframe.png') });
console.log('top page saw during iframe stroke:', JSON.stringify(await seen()));

await set({ ink: 'match' });
console.log('page errors:', errors.length ? errors : 'none');
await context.close();
