(() => {
const INSTANCE_EVENT = 'tinyhand:instance';
const ALIVE_EVENT = 'tinyhand:alive';
let answered = false;
const onAlive = () => { answered = true; };
document.addEventListener(ALIVE_EVENT, onAlive);
document.dispatchEvent(new CustomEvent(INSTANCE_EVENT));
document.removeEventListener(ALIVE_EVENT, onAlive);
if (answered) return;

const IS_TOP = window === window.top;
const IS_EXTENSION_PAGE = location.protocol === 'chrome-extension:';
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const IS_MAC = /Mac/.test(navigator.platform);
const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const wantsArrow = (event) => (IS_MAC ? event.metaKey : event.ctrlKey);

// Extension pages' CSP doesn't treat use_dynamic_url's addresses as 'self'.
function extensionUrl(file) {
  return IS_EXTENSION_PAGE ? `/${file}` : chrome.runtime.getURL(file);
}

const GRIP_DEPTH = 0.12;
const GRIP_LEAN = 0.30;
const GRIP_FOLLOW_PER_MS = 0.0048;
const LIFT = 0.06;
const PRESS_SCALE = 0.06;
const PRESS_DECAY_PER_MS = 0.011;

const SLAP_WIND_MS = 125;
const SLAP_STRIKE_MS = 50;
const SLAP_IMPACT_MS = SLAP_WIND_MS + SLAP_STRIKE_MS;
const SLAP_CONTACT_MS = 24;
const SLAP_RELEASE_MS = 270;
const SLAP_WIND = 0.7;
const SLAP_RECOIL = 0.07;

const INK_START_PX = 4;
const INK_STEP_PX = 1.5;
const INK_WIDTH = 0.0055;
const INK_FADE_MS = 600;

let settings = null;
let catalog = null;
let insertedCss = null;

let audioContext;
const buffers = new Map();

function playTap(id) {
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume();
  if (!buffers.has(id)) {
    buffers.set(id, fetch(extensionUrl(`sounds/tap_${id}.wav`))
      .then((response) => response.arrayBuffer())
      .then((data) => audioContext.decodeAudioData(data)));
  }
  buffers.get(id).then(
    (buffer) => {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start();
    },
    () => buffers.delete(id)
  );
}

function playSlap(delay) {
  audioContext ??= new AudioContext();
  const ctx = audioContext;
  if (ctx.state === 'suspended') ctx.resume();
  const when = ctx.currentTime + delay;

  const length = Math.floor(ctx.sampleRate * 0.18);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.022));
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1600;
  band.Q.value = 0.8;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 1.4;
  noise.connect(band).connect(noiseGain).connect(ctx.destination);
  noise.start(when);

  const thump = ctx.createOscillator();
  thump.frequency.setValueAtTime(160, when);
  thump.frequency.exponentialRampToValueAtTime(60, when + 0.08);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.6, when);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
  thump.connect(thumpGain).connect(ctx.destination);
  thump.start(when);
  thump.stop(when + 0.13);
}

function setStyles(css) {
  if (css === insertedCss) return;
  const previous = insertedCss;
  insertedCss = css;
  if (IS_EXTENSION_PAGE) {
    pageStyle ??= document.createElement('style');
    pageStyle.textContent = css || '';
    if (!pageStyle.isConnected) document.documentElement.append(pageStyle);
    return;
  }
  send({ action: 'setCursorCss', css, previous });
}

function send(message) {
  if (chrome.runtime?.id) return chrome.runtime.sendMessage(message).catch(() => null);
  retire();
  return Promise.resolve(null);
}

let pageStyle = null;

function openOrClosedShadowRoot(el) {
  if (el.shadowRoot) return el.shadowRoot;
  if (chrome.runtime?.id) return chrome.dom?.openOrClosedShadowRoot(el) ?? null;
  retire();
  return null;
}

function scannedShadowRoot(el) {
  if (el.localName.includes('-') && el instanceof HTMLElement && el !== overlay.host) return openOrClosedShadowRoot(el);
  return el.shadowRoot;
}

const CURSOR_ATTR = `data-tinyhand-${randomHex(4)}`;
const HIDE_CSS = `:root[${CURSOR_ATTR}], :root[${CURSOR_ATTR}] * { cursor: none !important; }`;
// :is() carries its weightiest argument, so this beats a component's own !important.
const SHADOW_CSS = ':is(*, #tinyhand#tinyhand#tinyhand) { cursor: none !important; }';
let realCursor = false;
let cursorHidden = false;

function hideCursor() {
  cursorHidden = !realCursor;
  document.documentElement?.toggleAttribute(CURSOR_ATTR, cursorHidden);
  setStyles(cursorHidden ? HIDE_CSS : null);
  shadowSheet.replaceSync(cursorHidden ? SHADOW_CSS : '');
}

const shadowSheet = new CSSStyleSheet();
let shadowRoots = new WeakSet();
let shadowRootRefs = new Set();
let watchingShadowRoots = false;

const shadowObserver = new MutationObserver((records) => {
  if (cursorHidden && document.documentElement?.hasAttribute(CURSOR_ATTR) === false) document.documentElement.setAttribute(CURSOR_ATTR, '');
  const seen = new Set();
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) findShadowRoots(node, seen);
    }
  }
});

function findShadowRoots(node, seen = new Set()) {
  if (seen.has(node)) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (el) => (seen.has(el) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (el.nodeType !== Node.ELEMENT_NODE) continue;
    seen.add(el);
    adoptShadowRoot(scannedShadowRoot(el));
  }
}

function adoptShadowRoot(root) {
  if (!root) return;
  if (!root.adoptedStyleSheets.includes(shadowSheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, shadowSheet];
  }
  if (shadowRoots.has(root)) return;
  shadowRoots.add(root);
  shadowRootRefs.add(new WeakRef(root));
  shadowObserver.observe(root, { childList: true, subtree: true });
  findShadowRoots(root);
}

function stopWatchingShadowRoots() {
  shadowObserver.disconnect();
  shadowRoots = new WeakSet();
  shadowRootRefs = new Set();
  watchingShadowRoots = false;
}

function watchShadowRoots() {
  if (watchingShadowRoots) return;
  watchingShadowRoots = true;
  shadowObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: [CURSOR_ATTR] });
  findShadowRoots(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => findShadowRoots(document), { once: true });
  }
}

const overlay = {
  host: null,
  canvas: null,
  ctx: null,
  inkCanvas: null,
  inkCtx: null,
  strokes: [],
  width: 0,
  height: 0,
  dpr: 1,
  images: new Map(),
  image: null,
  cursor: null,
  gripX: null,
  held: false,
  press: 0,
  lastFrame: 0,
  frame: 0,
  hideTimer: 0,
  filter: '',
  slaps: [],
};

function createOverlay() {
  const host = document.createElement('div');
  host.setAttribute('popover', 'manual');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'all: initial', 'position: fixed', 'inset: 0', 'width: 100%', 'height: 100%',
    'margin: 0', 'padding: 0', 'border: 0', 'background: transparent', 'overflow: visible',
    'pointer-events: none', 'z-index: 2147483647', 'display: block', 'contain: strict',
  ].map((rule) => `${rule} !important`).join(';');
  const root = host.attachShadow({ mode: 'closed' });
  const layer = () => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    return canvas;
  };
  overlay.inkCanvas = layer();
  overlay.canvas = layer();
  root.append(overlay.inkCanvas, overlay.canvas);
  overlay.host = host;
  overlay.ctx = overlay.canvas.getContext('2d');
  overlay.inkCtx = overlay.inkCanvas.getContext('2d');
  new ResizeObserver(resizeOverlay).observe(host);
}

function mountOverlay() {
  if (!(document.documentElement instanceof HTMLElement)) return;
  if (!overlay.host) createOverlay();
  const host = overlay.host;
  if (!host.isConnected) {
    document.documentElement.append(host);
    resizeOverlay();
    raiseOverlay();
  }
}

function raiseOverlay() {
  const host = overlay.host;
  if (!host?.isConnected) return;
  if (host.matches(':popover-open')) host.hidePopover();
  host.showPopover();
}

function resizeOverlay() {
  const { host, canvas } = overlay;
  if (!host?.isConnected) return;
  const dpr = Math.min(devicePixelRatio, 3);
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (width === overlay.width && height === overlay.height && dpr === overlay.dpr) return;
  overlay.width = width;
  overlay.height = height;
  overlay.dpr = dpr;
  for (const layer of [canvas, overlay.inkCanvas]) {
    layer.width = Math.round(width * dpr);
    layer.height = Math.round(height * dpr);
  }
  schedule();
}

function unmountOverlay() {
  cancelAnimationFrame(overlay.frame);
  overlay.frame = 0;
  overlay.cursor = null;
  overlay.gripX = null;
  overlay.strokes = [];
  overlay.host?.remove();
}

function loadImage(id) {
  if (!overlay.images.has(id)) {
    overlay.images.set(id, fetch(extensionUrl(`hands/${id}.png`))
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob)));
  }
  return overlay.images.get(id);
}

function useStyle(id) {
  overlay.image = null;
  if (id === 'laser') return;
  loadImage(id).then((bitmap) => {
    if (settings?.style === id) {
      overlay.image = bitmap;
      schedule();
    }
  }, () => overlay.images.delete(id));
}

function schedule() {
  if (!overlay.frame && overlay.host?.isConnected) overlay.frame = requestAnimationFrame(draw);
}

function screenHeight() {
  return screen.height;
}

function sizeFraction() {
  return catalog.SIZES.find((s) => s.id === settings.size).frac;
}

function draw(now) {
  overlay.frame = 0;
  const dt = overlay.lastFrame ? Math.min(64, now - overlay.lastFrame) : 16;
  overlay.lastFrame = now;
  const { ctx, inkCtx, width: W, height: H, dpr } = overlay;
  for (const c of [ctx, inkCtx]) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
  }
  let moving = settings ? drawInk(now) : false;
  if (!settings || !overlay.cursor) {
    if (moving) schedule();
    else overlay.lastFrame = 0;
    return;
  }

  if (!overlay.held && overlay.press > 0.002) {
    overlay.press *= Math.max(0, 1 - PRESS_DECAY_PER_MS * dt);
    moving = true;
  } else if (!overlay.held) {
    overlay.press = 0;
  }
  const slap = slapPose(now);
  if (slap.active) moving = true;
  updateShadow(slap);

  if (settings.style === 'laser') {
    drawLaser();
  } else if (drawHand(dt, slap)) {
    moving = true;
  }
  if (moving) schedule();
  else overlay.lastFrame = 0;
}

function drawHand(dt, slap) {
  const image = overlay.image;
  if (!image) return false;
  const hand = catalog.HANDS.find((h) => h.id === settings.style);
  const { ctx, width: W, height: H, cursor } = overlay;
  const screenH = screenHeight();
  const [tx, ty] = hand.tip;
  const [wx, wy] = hand.wrist;
  const press = Math.max(overlay.press, slap.press);
  const handLength = sizeFraction() * screenH * (1 - PRESS_SCALE * press) * slap.scale;
  const s = handLength / Math.hypot(wx - tx, wy - ty);

  const targetX = Math.min(Math.max(cursor.x + GRIP_LEAN * W, W * 0.15), W * 1.05);
  overlay.gripX = overlay.gripX == null
    ? targetX
    : overlay.gripX + (targetX - overlay.gripX) * Math.min(1, dt * GRIP_FOLLOW_PER_MS);
  const grip = { x: overlay.gripX, y: H + GRIP_DEPTH * screenH };

  const aimAngle = Math.atan2(cursor.y - grip.y, cursor.x - grip.x);
  const imageAngle = Math.atan2(ty - wy, tx - wx);
  const rotation = aimAngle - imageAngle;
  const dx = (wx - tx) * s;
  const dy = (wy - ty) * s;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const wrist = { x: cursor.x + dx * cos - dy * sin, y: cursor.y + dx * sin + dy * cos };

  const stickWidth = Math.max(4, hand.h * s * 0.07);
  const nx = -(wrist.y - grip.y);
  const ny = wrist.x - grip.x;
  const nl = Math.hypot(nx, ny) || 1;
  const mx = (wrist.x + grip.x) / 2;
  const my = (wrist.y + grip.y) / 2;
  const ox = (nx / nl) * (stickWidth / 2);
  const oy = (ny / nl) * (stickWidth / 2);
  const shade = ctx.createLinearGradient(mx - ox, my - oy, mx + ox, my + oy);
  shade.addColorStop(0, hand.stick[2]);
  shade.addColorStop(0.35, hand.stick[1]);
  shade.addColorStop(0.55, hand.stick[0]);
  shade.addColorStop(1, hand.stick[2]);
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(slap.swing);
  ctx.translate(-grip.x, -grip.y);
  ctx.strokeStyle = shade;
  ctx.lineWidth = stickWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(grip.x, grip.y);
  ctx.lineTo(wrist.x, wrist.y);
  ctx.stroke();

  ctx.translate(cursor.x, cursor.y);
  ctx.rotate(rotation);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, -tx * s, -ty * s, hand.w * s, hand.h * s);
  ctx.restore();

  return Math.abs(targetX - overlay.gripX) > 0.3;
}

function drawLaser() {
  const { ctx, cursor } = overlay;
  const r = Math.max(4, screenHeight() * 0.0038 * (sizeFraction() / 0.13)) * (1 + 0.2 * overlay.press);
  ctx.save();
  ctx.shadowColor = '#ff2a1f';
  ctx.shadowBlur = r * (2.2 + overlay.press);
  ctx.fillStyle = '#ff2a1f';
  ctx.beginPath();
  ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 220, 213, 0.95)';
  ctx.beginPath();
  ctx.arc(cursor.x, cursor.y, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawInk(now) {
  const { inkCtx: ctx, strokes } = overlay;
  let busy = false;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    let alpha = 1;
    if (!stroke.ended) {
      busy = true;
    } else if (stroke.fadeAfter > 0) {
      const age = now - stroke.ended - stroke.fadeAfter;
      if (age >= INK_FADE_MS) {
        strokes.splice(i, 1);
        continue;
      }
      if (age > 0) alpha = 1 - easeIn(age / INK_FADE_MS);
      busy = true;
    }
    drawStroke(ctx, stroke, alpha);
  }
  return busy;
}

function drawStroke(ctx, stroke, alpha) {
  const p = stroke.points;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  if (p.length === 1) ctx.lineTo(p[0].x, p[0].y);
  for (let k = 1; k < p.length; k++) {
    const mid = { x: (p[k - 1].x + p[k].x) / 2, y: (p[k - 1].y + p[k].y) / 2 };
    ctx.quadraticCurveTo(p[k - 1].x, p[k - 1].y, mid.x, mid.y);
  }
  if (p.length > 1) ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
  if (stroke.arrow) addArrowHead(ctx, p, Math.max(14, stroke.width * 3.2));
  ctx.stroke();
  ctx.restore();
}

function addArrowHead(ctx, points, size) {
  const end = points[points.length - 1];
  let back = points[0];
  for (let i = points.length - 1; i >= 0; i--) {
    if (Math.hypot(end.x - points[i].x, end.y - points[i].y) >= size * 1.2) {
      back = points[i];
      break;
    }
  }
  const length = Math.hypot(end.x - back.x, end.y - back.y);
  if (length <= 1) return;
  const head = Math.min(size, length * 0.8);
  const angle = Math.atan2(end.y - back.y, end.x - back.x);
  for (const side of [-1, 1]) {
    const a = angle + Math.PI + side * (Math.PI / 7);
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x + Math.cos(a) * head, end.y + Math.sin(a) * head);
  }
}

function inkColor() {
  return catalog.INKS.find((c) => c.id === settings.ink).color
    ?? catalog.STYLES.find((s) => s.id === settings.style).ink;
}

const MAX_STROKES = 200;

function startInk(x, y) {
  mountOverlay();
  if (overlay.strokes.length >= MAX_STROKES) overlay.strokes.shift();
  overlay.strokes.push({
    points: [{ x, y }],
    color: inkColor(),
    width: Math.max(3, screenHeight() * INK_WIDTH),
    arrow: false,
    ended: 0,
    fadeAfter: settings.fade * 1000,
  });
  schedule();
}

function currentStroke() {
  const last = overlay.strokes[overlay.strokes.length - 1];
  return last && !last.ended ? last : null;
}

function extendInk(x, y, arrow) {
  const stroke = currentStroke();
  if (!stroke) return;
  stroke.arrow = arrow;
  const last = stroke.points[stroke.points.length - 1];
  if (Math.hypot(x - last.x, y - last.y) >= INK_STEP_PX) stroke.points.push({ x, y });
  schedule();
}

function endInk(arrow) {
  const stroke = currentStroke();
  if (!stroke) return;
  stroke.arrow = arrow;
  stroke.ended = performance.now();
  schedule();
}

function clearInk() {
  if (!overlay.strokes.length) return;
  overlay.strokes = [];
  schedule();
}

const easeIn = (k) => k * k * k;
const STILL = { swing: 0, scale: 0, press: 0 };

function hermite(p0, m0, p1, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (3 * u2 - 2 * u3) * p1;
}

function slapPose(now) {
  const rest = { swing: 0, scale: 1, press: 0, active: false };
  while (overlay.slaps.length) {
    const slap = overlay.slaps[0];
    const next = overlay.slaps[1];
    if ((next && now >= next.start) || now >= slap.hit + SLAP_CONTACT_MS + SLAP_RELEASE_MS) {
      overlay.slaps.shift();
      continue;
    }
    return reducedMotion?.matches ? { ...rest, active: true } : { ...slapPoseAt(slap, now), active: true };
  }
  return rest;
}

function slapPoseAt(slap, now) {
  const { start, hit, from, velocity } = slap;
  const span = hit - start;
  const strike = Math.min(SLAP_STRIKE_MS, span * 0.4);
  const wind = span - strike;
  const reach = Math.max(0.3, Math.min(1, wind / (0.75 * SLAP_WIND_MS)));
  const peak = { swing: SLAP_WIND * reach, scale: 1 + 0.18 * reach, press: 0 };
  if (now < hit - strike) {
    const u = Math.max(0, (now - start) / wind);
    const pose = {};
    for (const key of ['swing', 'scale', 'press']) pose[key] = hermite(from[key], 0.8 * (peak[key] - from[key]) + velocity[key] * wind, peak[key], u);
    return pose;
  }
  if (now < hit) {
    const k = ((now - hit + strike) / strike) ** 2;
    return { swing: peak.swing * (1 - k), scale: peak.scale + (0.94 - peak.scale) * k, press: k };
  }
  const r = now - hit - SLAP_CONTACT_MS;
  if (r < 0) return { swing: 0, scale: 0.94, press: 1 };
  return {
    swing: -SLAP_RECOIL * (r / 45) * Math.exp(1 - r / 45),
    scale: 1 - 0.06 * (1 + r / 50) * Math.exp(-r / 50),
    press: (1 + r / 40) * Math.exp(-r / 40),
  };
}

function slapVelocity(slap, now) {
  const a = slapPoseAt(slap, now - 1);
  const b = slapPoseAt(slap, now);
  return { swing: b.swing - a.swing, scale: b.scale - a.scale, press: b.press - a.press };
}

function updateShadow(slap) {
  let filter = 'none';
  if (settings.shadow && settings.style !== 'laser') {
    const press = Math.max(overlay.press, slap.press);
    const raise = slap.scale > 1 ? 1 + (slap.scale - 1) * 3 : 1;
    const lift = LIFT * screenHeight() * (1 - 0.8 * press) * raise;
    const blur = Math.max(1, lift * 0.35) + 5 * press;
    const alpha = 0.26 + 0.02 * press;
    filter = `drop-shadow(${(lift * 0.6).toFixed(1)}px ${lift.toFixed(1)}px ${blur.toFixed(1)}px rgba(0,0,0,${alpha.toFixed(3)}))`;
  }
  if (filter !== overlay.filter) {
    overlay.filter = filter;
    overlay.canvas.style.filter = filter;
  }
}

function pointAt(x, y) {
  if (!settings) return;
  clearTimeout(overlay.hideTimer);
  mountOverlay();
  overlay.cursor = { x, y };
  schedule();
}

function pressAt(x, y) {
  pointAt(x, y);
  overlay.held = true;
  overlay.press = 1;
  schedule();
}

function startSlap(x, y, time) {
  pointAt(x, y);
  const now = performance.now();
  const from = slapPose(now);
  const hit = time - performance.timeOrigin + SLAP_IMPACT_MS;
  overlay.slaps.push({ start: now, hit, from, velocity: STILL });
  overlay.slaps.sort((a, b) => a.hit - b.hit);
  for (let i = 1; i < overlay.slaps.length; i++) {
    const previous = overlay.slaps[i - 1];
    const next = overlay.slaps[i];
    next.start = Math.max(now, Math.min(previous.hit + SLAP_CONTACT_MS, next.hit));
    next.from = slapPoseAt(previous, next.start);
    next.velocity = slapVelocity(previous, next.start);
  }
  schedule();
}

function releaseHand() {
  if (!overlay.held) return;
  overlay.held = false;
  schedule();
}

function leaveSoon() {
  clearTimeout(overlay.hideTimer);
  overlay.hideTimer = setTimeout(() => {
    overlay.cursor = null;
    overlay.held = false;
    schedule();
  }, 120);
}

function route(type, x, y, buttons = 0, arrow = false, time = performance.timeOrigin + performance.now()) {
  if (!IS_TOP) {
    sendToParent({ type, x, y, buttons, arrow, time });
    return;
  }
  if (type === 'ink-start' && !settings.draw) return;
  if (type === 'slap' && !settings.slap) return;
  if (type === 'ink-start') startInk(x, y);
  else if (type === 'ink-move') { pointAt(x, y); extendInk(x, y, arrow); }
  else if (type === 'ink-end') endInk(arrow);
  else if (type === 'clear') clearInk();
  else if (type === 'down') pressAt(x, y);
  else if (type === 'up') { pointAt(x, y); endInk(arrow); releaseHand(); }
  else if (type === 'leave') leaveSoon();
  else if (type === 'release') releaseHand();
  else if (type === 'slap') startSlap(x, y, time);
  else {
    pointAt(x, y);
    if (buttons & 1) extendInk(x, y, arrow);
    else releaseHand();
  }
}

const HELLO_KEY = '__tinyhandFrame';
const ownFrameId = IS_TOP ? null : randomHex(12);
const childFrames = new Map();

function sayHello() {
  if (!IS_TOP) window.parent.postMessage({ [HELLO_KEY]: ownFrameId }, '*');
}

function sendToParent(packet) {
  send({ action: 'toParent', id: ownFrameId, packet }).then((reply) => {
    if (reply?.unknown) sayHello();
    if (Boolean(reply?.unsupported) === realCursor) return;
    realCursor = !realCursor;
    if (settings) hideCursor();
  });
}

function frameElementFor(source) {
  const roots = [document];
  for (const ref of shadowRootRefs) {
    const root = ref.deref();
    if (root?.host.isConnected) roots.push(root);
    else shadowRootRefs.delete(ref);
  }
  for (const root of roots) {
    for (const frame of root.querySelectorAll('iframe, frame')) {
      if (frame.contentWindow === source) return frame;
    }
  }
  return null;
}

function isAxisAligned(frame) {
  for (let el = frame; el instanceof Element; el = el.parentElement || el.getRootNode().host) {
    const style = getComputedStyle(el);
    if (style.rotate !== 'none' || style.scale.includes('-')) return false;
    if (style.transform === 'none') continue;
    const m = new DOMMatrixReadOnly(style.transform);
    if (!m.is2D || m.b || m.c || m.a < 0 || m.d < 0) return false;
  }
  return true;
}

function framePoint(frame, x, y) {
  const rect = frame.getBoundingClientRect();
  const style = getComputedStyle(frame);
  const sx = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
  const sy = frame.offsetHeight ? rect.height / frame.offsetHeight : 1;
  const left = frame.clientLeft + (parseFloat(style.paddingLeft) || 0);
  const top = frame.clientTop + (parseFloat(style.paddingTop) || 0);
  return [rect.left + (left + x) * sx, rect.top + (top + y) * sy];
}

window.addEventListener('message', (event) => {
  const id = event.data?.[HELLO_KEY];
  if (!event.isTrusted || !/^[0-9a-f]{24}$/.test(id) || !event.source) return;
  const frame = frameElementFor(event.source);
  if (!frame) return;
  const known = childFrames.get(id);
  if (known && known !== frame && known.isConnected) return;
  let replaces = null;
  for (const [other, el] of childFrames) {
    if (el === frame && other !== id) replaces = other;
  }
  childFrames.delete(replaces);
  childFrames.set(id, frame);
  send({ action: 'claimFrame', id, replaces });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'unslap') unslap();
  if (message.action !== 'fromChild' || !settings) return;
  const frame = childFrames.get(message.id);
  if (!frame?.isConnected) {
    childFrames.delete(message.id);
    return;
  }
  const { type, x, y, buttons, arrow, time } = message.packet;
  if (!isAxisAligned(frame)) {
    route('leave', 0, 0);
    sendResponse({ unsupported: true });
    return;
  }
  const [px, py] = framePoint(frame, x, y);
  route(type, px, py, buttons, arrow, time);
});

function isTracked(event) {
  if (settings && !chrome.runtime?.id) retire();
  return settings && event.isTrusted && event.pointerType !== 'touch';
}

let gesture = null;

window.addEventListener('pointermove', (event) => {
  if (!isTracked(event)) return;
  const { clientX: x, clientY: y } = event;
  lastPointer = { x, y };
  if (settings.slap && event.altKey && !gesture) highlight(slapTarget(x, y));
  else unhighlight();
  if (gesture && !(event.buttons & 1)) endGesture(x, y, wantsArrow(event));
  if (gesture) {
    if (!gesture.drawing && Math.hypot(x - gesture.x, y - gesture.y) >= INK_START_PX) {
      gesture.drawing = true;
      mute(['mouseup', 'click', 'dblclick']);
      route('ink-start', gesture.x, gesture.y);
    }
    if (gesture.drawing) {
      route('ink-move', x, y, event.buttons, wantsArrow(event));
      return;
    }
  }
  route('move', x, y, event.buttons, wantsArrow(event));
}, true);

window.addEventListener('pointerdown', (event) => {
  if (!isTracked(event)) return;
  const { clientX: x, clientY: y } = event;
  if (gesture) endGesture(x, y, false);
  clearTimeout(mutedTimer);
  muted = null;
  if (event.button === 0 && event.altKey && settings.slap) {
    swallow(event);
    mute(['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick']);
    slapAt(x, y);
    return;
  }
  if (event.button === 0 && event.shiftKey && settings.draw && !isEditable(event)) {
    swallow(event);
    mute(['mousedown']);
    gesture = { x, y, drawing: false };
  }
  if (event.button === 0) {
    route('down', x, y, event.buttons);
    if (settings.sound) playTap(settings.sound);
  } else {
    route('move', x, y, event.buttons);
  }
}, true);

function endGesture(x, y, arrow) {
  if (gesture?.drawing) route('ink-end', x, y, 0, arrow);
  gesture = null;
  unmuteSoon();
}

window.addEventListener('pointerup', (event) => {
  if (!isTracked(event)) return;
  if (muted) unmuteSoon();
  if (gesture) endGesture(event.clientX, event.clientY, wantsArrow(event));
  if (muted?.has('mouseup')) swallow(event);
  route('up', event.clientX, event.clientY, event.buttons, wantsArrow(event));
}, true);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settings && event.isTrusted) route('clear', 0, 0);
}, true);

window.addEventListener('pointercancel', (event) => {
  if (!isTracked(event)) return;
  clearTimeout(mutedTimer);
  muted = null;
  if (gesture?.drawing) route('ink-end', 0, 0);
  gesture = null;
  route('release', 0, 0);
}, true);

document.addEventListener('pointerout', (event) => {
  if (!settings || event.relatedTarget) return;
  route('leave', event.clientX, event.clientY, 0);
}, true);

window.addEventListener('pointerover', (event) => {
  if (!watchingShadowRoots) return;
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node !== overlay.host) adoptShadowRoot(openOrClosedShadowRoot(node));
  }
}, true);

if (IS_TOP) {
  window.addEventListener('resize', resizeOverlay);
  document.addEventListener('toggle', (event) => {
    if (event.target !== overlay.host && event.newState === 'open') raiseOverlay();
  }, true);
  document.addEventListener('fullscreenchange', () => raiseOverlay());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseHand();
  });
}

let lastPointer = null;
let highlighted = null;
const slapped = [];
let muted = null;
let mutedTimer = 0;

function swallow(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function mute(types) {
  clearTimeout(mutedTimer);
  muted = new Set([...(muted || []), ...types]);
  mutedTimer = setTimeout(expireMute, 5000);
}

function expireMute() {
  if (gesture) mutedTimer = setTimeout(expireMute, 5000);
  else muted = null;
}

function unmuteSoon() {
  clearTimeout(mutedTimer);
  mutedTimer = setTimeout(() => { muted = null; }, 400);
}

for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick']) {
  window.addEventListener(type, (event) => {
    if (!muted?.has(type)) return;
    swallow(event);
    if (type === 'click') setTimeout(() => { muted = null; }, 0);
  }, true);
}

function deepest(el, inner) {
  for (let depth = 0; el instanceof HTMLElement && depth < 32; depth++) {
    const root = openOrClosedShadowRoot(el);
    const next = root && inner(root);
    if (!next || !root.contains(next)) break;
    el = next;
  }
  return el;
}

function deepElementFromPoint(x, y) {
  return deepest(document.elementFromPoint(x, y), (root) => root.elementFromPoint(x, y));
}

const SECTION_TAGS = new Set(['SECTION', 'ARTICLE', 'ASIDE', 'NAV', 'HEADER', 'FOOTER', 'FIGURE', 'LI', 'TR', 'TABLE', 'FORM', 'BUTTON', 'IMG', 'VIDEO', 'CANVAS', 'svg', 'IFRAME', 'PICTURE', 'DIALOG']);

function looksLikeBox(el, style) {
  if (SECTION_TAGS.has(el.tagName)) return true;
  const background = style.backgroundColor;
  if (background && !/rgba\([^)]*,\s*0\)|transparent/.test(background)) return true;
  if (style.backgroundImage !== 'none') return true;
  if (style.boxShadow !== 'none') return true;
  return ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none');
}

function slapTarget(x, y) {
  const viewArea = window.innerWidth * window.innerHeight;
  let el = deepElementFromPoint(x, y);
  for (let up = el; up; up = parentOf(up)) {
    if (slapped.some((entry) => entry.el === up)) el = parentOf(up);
  }
  let fallback = null;
  while (el && el !== document.documentElement && el !== document.body) {
    if (el.style && el !== overlay.host) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const block = style.display !== 'inline' && style.display !== 'contents' && rect.width >= 24 && rect.height >= 16;
      if (block && rect.width * rect.height > viewArea * 0.6) break;
      if (block) {
        fallback ??= el;
        if (looksLikeBox(el, style)) return el;
      }
    }
    el = parentOf(el);
  }
  return fallback;
}

function parentOf(el) {
  return el.parentElement || el.getRootNode()?.host || null;
}

function saveProp(el, prop) {
  return [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
}

function restoreProp(el, prop, [value, priority]) {
  if (value) el.style.setProperty(prop, value, priority);
  else el.style.removeProperty(prop);
}

function highlight(el) {
  if (highlighted?.el === el) return;
  unhighlight();
  if (!el) return;
  highlighted = { el, outline: saveProp(el, 'outline'), offset: saveProp(el, 'outline-offset') };
  el.style.setProperty('outline', '2px solid rgba(135, 84, 242, 0.95)', 'important');
  el.style.setProperty('outline-offset', '-2px', 'important');
}

function unhighlight() {
  if (!highlighted) return;
  const { el, outline, offset } = highlighted;
  highlighted = null;
  restoreProp(el, 'outline', outline);
  restoreProp(el, 'outline-offset', offset);
}

function slapAt(x, y) {
  const el = slapTarget(x, y);
  unhighlight();
  route('slap', x, y, 0);
  if (settings.sound) playSlap(SLAP_IMPACT_MS / 1000);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const transformOrigin = `${x - rect.left}px ${y - rect.top}px`;
  const entry = { el, transformOrigin, display: saveProp(el, 'display'), pointerEvents: saveProp(el, 'pointer-events'), timer: 0, animation: null };
  el.style.setProperty('pointer-events', 'none', 'important');
  slapped.push(entry);
  if (!IS_EXTENSION_PAGE) send({ action: 'slapped' });
  entry.timer = setTimeout(() => knockOff(entry), SLAP_IMPACT_MS);
}

function knockOff(entry) {
  entry.timer = 0;
  const { el, transformOrigin } = entry;
  const rect = el.getBoundingClientRect();
  const dx = -(rect.right + 120);
  const animation = reducedMotion?.matches
    ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' })
    : el.animate([
      { transform: 'none', transformOrigin, opacity: 1, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
      { transform: 'scale(0.965)', transformOrigin, opacity: 1, offset: 0.06, easing: 'cubic-bezier(0.25, 0.6, 0.4, 1)' },
      { opacity: 1, offset: 0.3 },
      { transform: `translate(${dx}px, -90px) rotate(-32deg) scale(0.6)`, transformOrigin, opacity: 0 },
    ], { duration: 560, fill: 'forwards' });
  entry.animation = animation;
  const hide = () => {
    if (!slapped.includes(entry)) return;
    el.style.setProperty('display', 'none', 'important');
    animation.cancel();
  };
  animation.finished.then(hide, hide);
}

function putBack(entry) {
  clearTimeout(entry.timer);
  entry.animation?.cancel();
  restoreProp(entry.el, 'display', entry.display);
  restoreProp(entry.el, 'pointer-events', entry.pointerEvents);
}

function unslap() {
  const last = slapped.pop();
  if (!last) return false;
  putBack(last);
  last.el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
  return true;
}

function isEditable(event) {
  const inner = event.type === 'keydown'
    ? (root) => root.activeElement
    : (root) => root.elementFromPoint(event.clientX, event.clientY);
  const target = deepest(event.composedPath()[0], inner);
  return target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '');
}

window.addEventListener('keydown', (event) => {
  if (!settings?.slap || !event.isTrusted) return;
  if (event.key === 'Alt' && lastPointer) highlight(slapTarget(lastPointer.x, lastPointer.y));
  if (!event.altKey || event.code !== 'KeyZ' || isEditable(event)) return;
  swallow(event);
  if (IS_EXTENSION_PAGE) unslap();
  else send({ action: 'unslap' });
}, true);

window.addEventListener('keyup', (event) => {
  if (event.key === 'Alt') unhighlight();
}, true);

window.addEventListener('blur', () => {
  unhighlight();
  if (IS_TOP) releaseHand();
  if (gesture) endGesture(lastPointer?.x ?? 0, lastPointer?.y ?? 0, false);
  else if (muted) unmuteSoon();
});

function topHostname() {
  const origins = location.ancestorOrigins;
  if (IS_TOP || !origins.length) return location.hostname;
  return URL.parse(origins[origins.length - 1])?.hostname ?? location.hostname;
}

function standDown() {
  settings = null;
  cursorHidden = false;
  document.documentElement?.removeAttribute(CURSOR_ATTR);
  unhighlight();
  gesture = null;
  clearTimeout(mutedTimer);
  muted = null;
  shadowSheet.replaceSync('');
  stopWatchingShadowRoots();
  if (IS_TOP) unmountOverlay();
}

async function apply() {
  if (IS_TOP) catalog ??= await import(extensionUrl('shared/catalog.js'));
  const stored = IS_TOP
    ? catalog.normalize(await chrome.storage.local.get(catalog.DEFAULTS))
    : await chrome.storage.local.get(null);
  const xmlTop = IS_TOP && !(document.documentElement instanceof HTMLElement);
  if (!stored.enabled || xmlTop || stored.disabledSites?.includes(topHostname())) {
    standDown();
    setStyles(null);
    return;
  }

  const muteLaser = stored.style === 'laser' && !stored.laserSound;
  const previousStyle = settings?.style;
  settings = {
    style: stored.style,
    size: stored.size,
    shadow: stored.shadow,
    sound: stored.handSound && !muteLaser ? stored.sound : null,
    slap: stored.slap,
    draw: stored.draw,
    ink: stored.ink,
    fade: stored.fade,
  };
  if (!settings.slap) unhighlight();

  hideCursor();
  watchShadowRoots();
  sayHello();

  if (IS_TOP) {
    if (settings.style !== previousStyle || !overlay.image) useStyle(settings.style);
    schedule();
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') apply();
});

function retire() {
  for (const entry of slapped.splice(0)) putBack(entry);
  standDown();
}

document.addEventListener(INSTANCE_EVENT, () => {
  if (chrome.runtime?.id) document.dispatchEvent(new CustomEvent(ALIVE_EVENT));
  else retire();
});

apply();
})();
