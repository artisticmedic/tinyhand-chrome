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
  window.track = { clicks: 0, paths: { outer: [], middle: [], inner: [] }, frames: [] };
  document.addEventListener('click', () => window.track.clicks++, true);
  const sample = (time) => {
    window.track.frames.push([time, document.getElementById('inner').getAnimations().length]);
    for (const id of Object.keys(window.track.paths)) {
      const style = getComputedStyle(document.getElementById(id));
      if (style.display !== 'none') window.track.paths[id].push(style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).e);
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
  const travel = path[0] - Math.min(...path);
  const snapBack = path.some((x, i) => i > 0 && x > path[i - 1] + 4);
  check(`${id} flies off without snapping back`, travel > 150 && !snapBack, `travel ${Math.round(travel)}px, snap back ${snapBack}`);
}
const start = track.frames.findIndex(([, animations]) => animations > 0);
let stall = 0;
let stallEnd = 0;
for (let i = 1; i <= start; i++) {
  const gap = track.frames[i][0] - track.frames[i - 1][0];
  if (track.frames[start][0] - track.frames[i][0] < 400 && gap > stall) [stall, stallEnd] = [gap, track.frames[i][0]];
}
const afterStall = track.frames[start][0] - stallEnd;
check('the first slap of the session knocks off on time even when starting the sound stalls the page', stall < 100 || afterStall < 80, `longest frame before the knock-off ${Math.round(stall)}ms, knock-off ${Math.round(afterStall)}ms after it`);
check('the page sees none of the clicks', track.clicks === 0, `clicks ${track.clicks}`);

for (let i = 0; i < 3; i++) {
  await page.keyboard.press('KeyZ');
  await wait(100);
}
await page.keyboard.up('Alt');
await wait(400);
const back = await state();
check('three ⌥Z presses bring all three back', Object.values(back).every((d) => d !== 'none'), JSON.stringify(back));

await page.evaluate(() => {
  document.body.insertAdjacentHTML('beforeend', `
    <style>#hovered { background: rgb(220, 220, 220) } #hovered:hover { background: rgb(255, 0, 0) }</style>
    <div id="tailwind" style="position:fixed;left:50%;top:12%;width:300px;height:100px;translate:-50% -50%;background:#dde7f7"></div>
    <div id="scaled" style="position:fixed;left:60px;top:300px;width:200px;height:100px;transform:scale(1.2);background:#f7e2c8"></div>
    <div id="centred" style="position:fixed;left:50%;top:88%;width:300px;height:100px;transform:translate(-50%,-50%);background:#e8dcf7"></div>
    <div id="hovered" style="position:fixed;left:1000px;top:300px;width:200px;height:100px"></div>`);
});

const close = (a, b) => Math.abs(a - b) < 1;
const round = (rect) => Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, Math.round(v * 10) / 10]));
for (const [id, dx, dy, label] of [
  ['inner', -40, -40, 'a plain box'],
  ['tailwind', 90, 20, 'a box centred with the translate property'],
  ['scaled', 60, -20, 'a box with its own transform scale'],
  ['centred', -100, 25, 'a box centred with a transform'],
]) {
  const before = await page.locator(`#${id}`).boundingBox();
  const x = before.x + before.width / 2 + dx;
  const y = before.y + before.height / 2 + dy;
  await page.keyboard.down('Alt');
  await page.mouse.move(x, y, { steps: 3 });
  await wait(300);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction((id) => document.getElementById(id).getAnimations().length, id);
  const hit = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const animations = el.getAnimations();
    const rectAt = (time) => {
      for (const animation of animations) { animation.pause(); animation.currentTime = time; }
      const { left, top, width, height } = el.getBoundingClientRect();
      return { left, top, width, height };
    };
    return { start: rectAt(0), dent: rectAt(560 * 0.06) };
  }, id);
  const still = close(hit.start.left, before.x) && close(hit.start.top, before.y);
  const dented = close(hit.dent.width, before.width * 0.965) && close(x - hit.dent.left, (x - before.x) * 0.965) && close(y - hit.dent.top, (y - before.y) * 0.965);
  check(`${label} dents around the click point without jumping`, still && dented, `before ${JSON.stringify(round(before))}, hit ${JSON.stringify(round(hit.start))}, dent ${JSON.stringify(round(hit.dent))}`);

  await page.keyboard.press('KeyZ');
  await page.waitForFunction((id) => document.getElementById(id).getAnimations().some((a) => a.effect.getKeyframes()[0].transform === 'scale(0.96)'), id);
  const undo = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const animations = el.getAnimations();
    const centreAt = (time) => {
      for (const animation of animations) { animation.pause(); animation.currentTime = time; }
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2, r.width];
    };
    const during = [0, 110].map(centreAt);
    for (const animation of animations) animation.cancel();
    const r = el.getBoundingClientRect();
    return { during, settled: [r.left + r.width / 2, r.top + r.height / 2, r.width] };
  }, id);
  const [cx, cy, width] = undo.settled;
  const inPlace = undo.during.every(([x, y]) => close(x, cx) && close(y, cy)) && close(undo.during[0][2], width * 0.96);
  check(`⌥Z brings ${label} back in place`, inPlace, JSON.stringify(undo));
  await page.keyboard.up('Alt');
  await wait(300);
}

const hovered = await page.locator('#hovered').boundingBox();
await page.keyboard.down('Alt');
await page.mouse.move(hovered.x + 100, hovered.y + 50, { steps: 3 });
await wait(300);
await page.mouse.down();
await page.mouse.up();
await wait(60);
const windUp = await page.evaluate(() => getComputedStyle(document.getElementById('hovered')).backgroundColor);
check('a hovered box keeps its hover style until the hand lands', windUp === 'rgb(255, 0, 0)', windUp);
await wait(800);
await page.keyboard.press('KeyZ');
await page.keyboard.up('Alt');

console.log('page errors:', errors.length ? errors : 'none');
await context.close();
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
process.exitCode = failed ? 1 : 0;
