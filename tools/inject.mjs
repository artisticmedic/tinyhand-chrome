import { launch, openFixture, wait } from './harness.mjs';

const { context, worker } = await launch();
const { page, errors } = await openFixture(context);
const overlays = () => page.evaluate(() => document.querySelectorAll('html > div[popover]').length);
const cursor = () => page.evaluate(() => getComputedStyle(document.documentElement).cursor);
const nudge = async (x) => { await page.mouse.move(x, 300, { steps: 4 }); await wait(300); };
await nudge(500);
console.log('start: overlays', await overlays());

await worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1:8741/*' });
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
});
await nudge(520);
console.log('after a duplicate injection: overlays', await overlays());

await page.evaluate(() => {
  window.seenMessages = [];
  window.addEventListener('message', (e) => window.seenMessages.push(JSON.stringify(e.data).slice(0, 80)));
});
await page.reload();
await page.waitForFunction(() => getComputedStyle(document.documentElement).cursor === 'none');
await page.evaluate(() => {
  window.seenMessages = [];
  window.addEventListener('message', (e) => window.seenMessages.push(JSON.stringify(e.data).slice(0, 80)));
});
await page.evaluate(() => window.postMessage('control', '*'));
const box = await page.locator('#f-cross').boundingBox();
for (let i = 0; i < 10; i++) await page.mouse.move(box.x + 20 + i * 10, box.y + 30);
await page.mouse.down();
await page.mouse.up();
await wait(500);
const seen = await page.evaluate(() => window.seenMessages);
console.log('messages the page saw during 10 moves and a click in the iframe:', seen.length, JSON.stringify([...new Set(seen)]));
const shadowReachable = await page.evaluate(() => document.querySelector('html > div[popover]').shadowRoot !== null);
console.log('overlay shadow root reachable from the page:', shadowReachable);

await page.mouse.move(300, 250, { steps: 4 });
await wait(1500);
const before = await page.screenshot();
await page.evaluate(() => {
  const fire = (type, x, y, buttons) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, buttons, button: 0, shiftKey: true, altKey: false, pointerType: 'mouse', bubbles: true }));
  fire('pointerdown', 700, 200, 1);
  for (let i = 0; i < 20; i++) fire('pointermove', 700 + i * 10, 200 + i * 5, 1);
  fire('pointerup', 900, 300, 0);
});
await wait(800);
const afterSynthetic = await page.screenshot();
console.log('synthetic Shift-drag from the page changed the picture:', !before.equals(afterSynthetic));
await page.keyboard.down('Shift');
await page.mouse.move(700, 200);
await page.mouse.down();
await page.mouse.move(900, 300, { steps: 10 });
await page.mouse.up();
await page.keyboard.up('Shift');
await page.mouse.move(300, 250, { steps: 4 });
await wait(1500);
console.log('control, a real Shift-drag changed the picture:', !afterSynthetic.equals(await page.screenshot()));
console.log('page errors:', errors.length ? errors : 'none');
await context.close();
