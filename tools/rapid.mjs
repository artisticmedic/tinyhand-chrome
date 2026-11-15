import { launch, openFixture, wait } from './harness.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

const { context } = await launch({ deviceScaleFactor: 1 });
const { page, errors } = await openFixture(context, 'short.html');
await page.evaluate(() => {
  document.body.innerHTML = `
    <section id="outer" style="position:absolute;left:340px;top:200px;width:600px;height:400px;background:#dde7f7">
      <div id="middle" style="position:absolute;left:100px;top:70px;width:400px;height:260px;background:#f7e2c8">
        <div id="inner" style="position:absolute;left:90px;top:60px;width:220px;height:140px;background:#d4f0d8"><span style="display:block;height:100%;pointer-events:auto"></span></div>
      </div>
    </section>`;
  window.track = { clicks: 0, paths: { outer: [], middle: [], inner: [] } };
  document.addEventListener('click', () => window.track.clicks++, true);
  const sample = () => {
    for (const id of Object.keys(window.track.paths)) {
      const style = getComputedStyle(document.getElementById(id));
      if (style.display !== 'none') window.track.paths[id].push(parseFloat(style.translate) || 0);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
await wait(600);

const at = [640, 400];
await page.mouse.move(...at, { steps: 4 });
await page.keyboard.down('Alt');
await page.mouse.move(at[0] + 2, at[1] + 1);
await wait(300);
for (let i = 0; i < 3; i++) {
  await page.mouse.down();
  await page.mouse.up();
  await wait(150);
}
await wait(1200);

const state = () => page.evaluate(() => Object.fromEntries(['outer', 'middle', 'inner'].map((id) => [id, getComputedStyle(document.getElementById(id)).display])));
const gone = await state();
check('three quick ⌥-clicks on nested boxes knock off three different boxes', Object.values(gone).every((d) => d === 'none'), JSON.stringify(gone));

const track = await page.evaluate(() => window.track);
for (const [id, path] of Object.entries(track.paths)) {
  const travel = -Math.min(...path);
  const snapBack = path.some((x, i) => i > 0 && x > path[i - 1] + 4);
  check(`${id} flies off without snapping back`, travel > 150 && !snapBack, `travel ${Math.round(travel)}px, snap back ${snapBack}`);
}
check('the page sees none of the clicks', track.clicks === 0, `clicks ${track.clicks}`);

for (let i = 0; i < 3; i++) {
  await page.keyboard.press('KeyZ');
  await wait(100);
}
await page.keyboard.up('Alt');
await wait(400);
const back = await state();
check('three ⌥Z presses bring all three back', Object.values(back).every((d) => d !== 'none'), JSON.stringify(back));

await page.keyboard.down('Alt');
await page.mouse.move(600, 360, { steps: 3 });
await wait(300);
await page.mouse.down();
await page.mouse.up();
await page.waitForFunction(() => document.getElementById('inner').getAnimations().length);
const keyframes = await page.evaluate(() => document.getElementById('inner').getAnimations()[0].effect.getKeyframes()
  .slice(0, 2).map(({ offset, scale, transformOrigin }) => ({ offset, scale, transformOrigin })));
const [first, dent] = keyframes;
check('the knock-off first dents the box around the click point', first.transformOrigin === '70px 30px' && dent.scale === '0.965' && dent.offset === 0.06, JSON.stringify(keyframes));
await page.keyboard.press('KeyZ');
await page.keyboard.up('Alt');
await wait(300);

await page.evaluate(() => {
  const box = Object.assign(document.createElement('div'), { id: 'centred' });
  box.style.cssText = 'position:fixed;left:50%;top:70%;width:300px;height:120px;transform:translate(-50%,-50%);background:#e8dcf7';
  document.body.append(box);
  window.lefts = [];
  const sample = () => {
    if (getComputedStyle(box).display !== 'none') window.lefts.push(box.getBoundingClientRect().left);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
const centred = await page.locator('#centred').boundingBox();
await page.keyboard.down('Alt');
await page.mouse.move(centred.x + centred.width / 2, centred.y + centred.height / 2, { steps: 3 });
await wait(300);
await page.mouse.down();
await page.mouse.up();
await wait(1000);
await page.keyboard.up('Alt');
const lefts = await page.evaluate(() => window.lefts);
const rightward = Math.max(...lefts) - lefts[0];
check('a box with its own transform dents in place instead of jumping', rightward < 20 && Math.min(...lefts) < lefts[0] - 150, `furthest right ${rightward.toFixed(1)}px, travel ${(lefts[0] - Math.min(...lefts)).toFixed(0)}px`);

console.log('page errors:', errors.length ? errors : 'none');
await context.close();
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
process.exitCode = failed ? 1 : 0;
