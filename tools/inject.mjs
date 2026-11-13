import { launch, openFixture, wait } from './harness.mjs';

const { context, worker } = await launch();
const { page, errors } = await openFixture(context);
const overlays = () => page.evaluate(() => document.querySelectorAll('tinyhand-overlay').length);
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
console.log('page errors:', errors.length ? errors : 'none');
await context.close();
