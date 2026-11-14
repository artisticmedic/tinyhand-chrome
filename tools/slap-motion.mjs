import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const motion = [
  source.match(/^const SLAP_.+;$/gm).join('\n'),
  between('const easeOut =', '\nfunction drawImpact('),
  between('function startSlap(', '\nfunction releaseHand('),
  between('function route(', '\nconst HELLO_KEY'),
  between('chrome.runtime.onMessage.addListener(', '\nfunction isTracked('),
].join('\n');

function hand({ reduced = false, top = true, origin = 1700000000000 } = {}) {
  let now = 0;
  let receive;
  const packets = [];
  const overlay = { slaps: [], impact: null };
  const context = {
    overlay,
    IS_TOP: top,
    settings: { slap: true, draw: true },
    reducedMotion: { matches: reduced },
    performance: { timeOrigin: origin, now: () => now },
    pointAt() {},
    schedule() {},
    sendToParent: (packet) => packets.push(packet),
    chrome: { runtime: { onMessage: { addListener: (listener) => { receive = listener; } } } },
    childFrames: new Map([['child', { isConnected: true }]]),
    isAxisAligned: () => true,
    framePoint: (frame, x, y) => [x + 10, y + 20],
  };
  vm.runInNewContext(motion, context);
  return {
    overlay,
    packets,
    click(time) { now = time; context.route('slap', 100, 200); },
    pose(time) { now = time; return { ...context.slapPose(time) }; },
    relay(time, packet) {
      now = time;
      receive({ action: 'fromChild', id: 'child', packet }, null, () => {});
    },
  };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

function samePose(actual, expected) {
  for (const key of ['swing', 'scale', 'press']) near(actual[key], expected[key]);
}

test('a slap holds the wind-up, hits at 210 ms, overshoots once and settles', () => {
  const h = hand();
  h.click(0);
  samePose(h.pose(0), { swing: 0, scale: 1, press: 0 });
  assert.ok(h.pose(65).swing > 0.5);
  const peak = { swing: 0.64, scale: 1.18, press: 0 };
  samePose(h.pose(130), peak);
  samePose(h.pose(165), peak);
  let previous = peak.swing;
  for (let time = 166; time <= 240; time++) {
    const pose = h.pose(time);
    assert.ok(pose.swing < previous);
    previous = pose.swing;
    if (time < 210) assert.equal(h.overlay.impact, null);
    if (time === 210) {
      samePose(pose, { swing: 0, scale: 0.94, press: 1 });
      assert.equal(h.overlay.impact.start, 210);
    }
  }
  samePose(h.pose(240), { swing: -0.1, scale: 0.92, press: 0.8 });
  for (let time = 241; time <= 400; time++) {
    const pose = h.pose(time);
    assert.ok(pose.swing > previous && pose.swing <= 0);
    previous = pose.swing;
  }
  assert.deepEqual(h.pose(400), { swing: 0, scale: 1, press: 0, active: false });
  assert.equal(h.overlay.slaps.length, 0);
});

for (const reduced of [false, true]) {
  test(`ten clicks 150 ms apart retain all ten hits${reduced ? ' with reduced motion' : ''}`, () => {
    const h = hand({ reduced });
    const hits = [];
    let impact;
    for (let time = 0; time <= 1800; time++) {
      const before = h.pose(time);
      if (time <= 1350 && time % 150 === 0) h.click(time);
      const pose = h.pose(time);
      samePose(pose, before);
      if (reduced) samePose(pose, { swing: 0, scale: 1, press: 0 });
      if (h.overlay.impact !== impact && h.overlay.impact) {
        impact = h.overlay.impact;
        hits.push(time);
        assert.equal(impact.start, time);
        near(pose.swing, 0);
        near(pose.press, reduced ? 0 : 1);
      }
    }
    assert.deepEqual(hits, [210, 360, 510, 660, 810, 960, 1110, 1260, 1410, 1560]);
    assert.equal(h.overlay.slaps.length, 0);
  });
}

test('interruptions preserve the current pose and both hit deadlines in every phase', () => {
  for (const time of [1, 70, 130, 150, 180, 209, 210, 225, 240, 300, 399]) {
    const h = hand();
    h.click(0);
    const before = h.pose(time);
    h.click(time);
    samePose(h.pose(time), before);
    if (time < 210) near(h.pose(210).swing, 0);
    assert.equal(h.overlay.impact.start, 210);
    samePose(h.pose(time + 210), { swing: 0, scale: 0.94, press: 1 });
    assert.equal(h.overlay.impact.start, time + 210);
  }
});

test('nested iframe relays preserve the originating click time across clock origins', () => {
  const child = hand({ top: false });
  const middle = hand({ top: false, origin: 1700000000100 });
  const parent = hand({ origin: 1700000000500 });
  child.click(800);
  middle.relay(720, child.packets[0]);
  parent.relay(335, middle.packets[0]);
  assert.equal(middle.packets[0].time, 1700000000800);
  parent.pose(509);
  assert.equal(parent.overlay.impact, null);
  samePose(parent.pose(510), { swing: 0, scale: 0.94, press: 1 });
  assert.deepEqual({ ...parent.overlay.impact }, { x: 120, y: 240, start: 510 });
});

test('a delayed iframe click can arrive after a later top-frame click without losing either hit', () => {
  const child = hand({ top: false });
  const parent = hand();
  child.click(0);
  parent.click(50);
  const before = parent.pose(100);
  parent.relay(100, child.packets[0]);
  samePose(parent.pose(100), before);
  samePose(parent.pose(210), { swing: 0, scale: 0.94, press: 1 });
  assert.equal(parent.overlay.impact.start, 210);
  samePose(parent.pose(260), { swing: 0, scale: 0.94, press: 1 });
  assert.equal(parent.overlay.impact.start, 260);
});
