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
      if (style.display !== 'none') window.track.paths[id].push(new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform).e);
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

console.log('page errors:', errors.length ? errors : 'none');
await context.close();
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
process.exitCode = failed ? 1 : 0;
