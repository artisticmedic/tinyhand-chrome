import { launch, openFixture, wait } from './harness.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

async function blankPage(context) {
  const { page, errors } = await openFixture(context, 'short.html');
  await page.evaluate(() => {
    document.documentElement.style.background = '#fff';
    document.body.innerHTML = '';
    window.seen = { mousedown: 0, mouseup: 0, click: 0 };
    for (const type of Object.keys(window.seen)) document.addEventListener(type, () => window.seen[type]++);
  });
  return { page, errors };
}

async function colors(page, points) {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ png, points }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = new OffscreenCanvas(img.width, img.height);
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0);
    return points.map(([x, y]) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3));
  }, { png, points });
}

const isRed = ([r, g, b]) => r > 180 && g < 120 && b < 120;

async function drag(page, points, { shift = true, meta = false, pause = 0 } = {}) {
  if (shift) await page.keyboard.down('Shift');
  if (meta) await page.keyboard.down('Meta');
  await page.mouse.move(...points[0]);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    await page.mouse.move(...p, { steps: 8 });
    if (pause) await wait(pause);
  }
  await page.mouse.up();
  if (meta) await page.keyboard.up('Meta');
  if (shift) await page.keyboard.up('Shift');
}

async function park(page) {
  await page.mouse.move(60, 760, { steps: 4 });
  await wait(300);
}

function wings([x, y], d = 15) {
  const a = Math.PI / 7;
  return [[x - d * Math.cos(a), y - d * Math.sin(a)], [x - d * Math.cos(a), y + d * Math.sin(a)]];
}

const { context, set, worker } = await launch({ deviceScaleFactor: 1 });
await set({ ink: 'red', fade: 3 });
const { page, errors } = await blankPage(context);

await page.evaluate(() => {
  const frame = document.createElement('iframe');
  frame.id = 'cross';
  frame.src = 'http://127.0.0.1:8742/frame.html';
  frame.style.cssText = 'position:absolute;left:640px;top:200px;width:500px;height:300px;border:0';
  document.body.append(frame);
});
await page.frameLocator('#cross').locator('.chip').waitFor();
await wait(800);

await drag(page, [[300, 300], [500, 300], [900, 300]], { meta: true });
await park(page);
const intoFrame = await colors(page, wings([900, 300]));
check('arrow drawn from the page into an iframe keeps its arrowhead', intoFrame.every(isRed), JSON.stringify(intoFrame));

await drag(page, [[1000, 420], [800, 420], [400, 420]], { meta: true });
await park(page);
const outOfFrame = await colors(page, wings([400, 420]).map(([x, y]) => [800 - x, y]));
check('arrow drawn from an iframe out to the page keeps its arrowhead', outOfFrame.every(isRed), JSON.stringify(outOfFrame));

await drag(page, [[300, 560], [500, 560]]);
await park(page);
const plain = await colors(page, wings([500, 560]));
check('control: a plain stroke has no arrowhead', !plain.some(isRed), JSON.stringify(plain));
await page.keyboard.press('Escape');
await wait(300);

await page.evaluate(() => {
  const button = document.createElement('button');
  button.textContent = 'Target';
  button.style.cssText = 'position:absolute;left:200px;top:620px;width:240px;height:80px';
  document.body.append(button);
  for (const type of Object.keys(window.seen)) window.seen[type] = 0;
});
await drag(page, [[120, 650], [160, 655], [200, 660], [260, 665], [300, 660], [320, 660]], { pause: 1100 });
await wait(300);
const longDrag = await page.evaluate(() => ({ ...window.seen }));
check('a drawing drag longer than 5 s keeps its release and click from the page', longDrag.mouseup === 0 && longDrag.click === 0, JSON.stringify(longDrag));

await page.evaluate(() => {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:520px;top:620px';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = '<input value="select this text please" style="font:20px system-ui;width:300px;height:40px">';
  const input = root.querySelector('input');
  window.closedInput = { input, mousedowns: 0, keyZ: 0 };
  input.addEventListener('mousedown', () => window.closedInput.mousedowns++);
  input.addEventListener('keydown', (event) => { if (event.code === 'KeyZ') window.closedInput.keyZ++; });
  document.body.append(host);
});
await drag(page, [[530, 640], [700, 640]]);
await wait(200);
const selection = await page.evaluate(() => {
  const { input, mousedowns } = window.closedInput;
  return { mousedowns, selected: input.selectionEnd - input.selectionStart };
});
check('Shift-drag inside an input in a closed shadow root selects text', selection.mousedowns > 0 && selection.selected > 0, JSON.stringify(selection));
await page.mouse.click(600, 640);
await page.keyboard.down('Alt');
await page.keyboard.press('KeyZ');
await page.keyboard.up('Alt');
check('⌥Z reaches an input in a closed shadow root', (await page.evaluate(() => window.closedInput.keyZ)) > 0);

await page.keyboard.down('Shift');
await page.mouse.move(150, 120);
await page.mouse.down();
await page.mouse.move(400, 120, { steps: 10 });
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await wait(3900);
const afterBlur = await colors(page, [[300, 120]]);
await page.mouse.up();
await page.keyboard.up('Shift');
check('a stroke ends and fades when the window loses focus mid-drag', !isRed(afterBlur[0]), JSON.stringify(afterBlur));

const sameFrame = await page.evaluate(() => new Promise((resolve) => {
  const frame = document.createElement('iframe');
  frame.id = 'same';
  frame.src = 'frame.html';
  frame.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:60px;border:0';
  frame.onload = () => resolve(true);
  document.body.append(frame);
}));
await wait(500);
const claims = () => worker.evaluate(async () => {
  const { parentFrames } = await chrome.storage.session.get('parentFrames');
  return JSON.stringify(parentFrames).match(/[0-9a-f]{24}/g)?.length ?? 0;
});
const claimsBefore = await claims();
const same = page.frames().find((f) => f.url().endsWith(':8741/frame.html'));
await same.evaluate(() => {
  for (let i = 0; i < 2000; i++) {
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
    parent.postMessage({ __tinyhandFrame: id }, '*');
  }
});
await wait(2500);
const claimsAfter = await claims();
check('2000 forged frame hellos don\'t grow the shared claim list', sameFrame && claimsAfter <= claimsBefore + 1, `${claimsBefore} -> ${claimsAfter}`);
await drag(page, [[700, 380], [1000, 380]]);
await park(page);
check('control: the cross-origin iframe still draws after the flood', isRed((await colors(page, [[850, 380]]))[0]));
await page.keyboard.press('Escape');

const cross = page.frames().find((f) => f.url().includes(':8742/'));
const frameCursor = () => cross.evaluate(() => getComputedStyle(document.documentElement).cursor);
await page.evaluate(() => { document.getElementById('cross').style.transform = 'rotate(180deg)'; });
for (let i = 0; i < 6; i++) await page.mouse.move(800 + i * 20, 350);
await wait(300);
const rotated = await frameCursor();
await page.evaluate(() => { document.getElementById('cross').style.transform = ''; });
for (let i = 0; i < 6; i++) await page.mouse.move(800 + i * 20, 360);
await wait(300);
const upright = await frameCursor();
check('a rotated iframe shows the real cursor, and hides it again once upright', rotated !== 'none' && upright === 'none', `rotated ${rotated}, upright ${upright}`);
await context.close();

const touch = await launch({ deviceScaleFactor: 1, hasTouch: true });
await touch.set({ ink: 'red', fade: 3 });
const touchPage = (await blankPage(touch.context)).page;
const cdp = await touch.context.newCDPSession(touchPage);
await touchPage.keyboard.down('Shift');
await touchPage.mouse.move(150, 300);
await touchPage.mouse.down();
await touchPage.mouse.move(350, 300, { steps: 8 });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 900, y: 650 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await touchPage.mouse.move(700, 300, { steps: 8 });
await touchPage.mouse.up();
await touchPage.keyboard.up('Shift');
await park(touchPage);
check('a finger tap doesn\'t end a mouse stroke in progress', isRed((await colors(touchPage, [[600, 300]]))[0]));
await touch.context.close();

console.log('page errors:', errors.length ? errors : 'none');
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
process.exitCode = failed ? 1 : 0;
