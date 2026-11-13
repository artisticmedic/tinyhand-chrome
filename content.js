// TinyHand for Chrome - content script
//
// Hides the real cursor in every frame and, in the top frame, draws TinyHand's
// hand on a stick that reaches up from below the bottom of the window to the
// pointer. Frames pass the pointer up to their parent, so the hand follows it
// into iframes too. The drawing follows TinyHand's ArmView.swift and its site
// pointer (docs/pointer.js), github.com/nilbuild/tinyhand, MIT, © 2026 Kamran
// Ahmed. Hiding the cursor with a user-origin stylesheet, in shadow roots
// too, follows Purrsor (github.com/lihbr/purrsor, MIT, © Lucie Haberer).

const IS_TOP = window === window.top;
const MESSAGE_KEY = '__tinyhand';

// TinyHand's numbers (ArmView.swift), as fractions of the screen height.
const GRIP_DEPTH = 0.12; // the stick is held this far below the bottom edge
const GRIP_LEAN = 0.30; // ...and this far to the right of the pointer, as a fraction of the width
const GRIP_FOLLOW_PER_MS = 0.0048; // 0.08 per frame at 60 fps
const LIFT = 0.06; // shadow distance
const PRESS_SCALE = 0.06; // the hand shrinks 6% on a tap
const PRESS_DECAY_PER_MS = 0.011; // 0.18 per frame at 60 fps

// The slap: the stick winds back to the right, swings through the target and
// past it, then settles. Times in ms from the click, angles in radians about
// the grip. The swing crosses the target at SLAP_IMPACT_MS.
const SLAP_WIND_MS = 110;
const SLAP_HIT_MS = 170;
const SLAP_END_MS = 430;
const SLAP_IMPACT_MS = 165;
const SLAP_WIND = 0.38;
const SLAP_FOLLOW = 0.1;
const IMPACT_MS = 300;

let settings = null; // { style, size, shadow, sound, slap }, or null while the hand is off here
let catalog = null;
let insertedCss = null;

// ---------------------------------------------------------------- sound

let audioContext;
const buffers = new Map(); // sound id -> Promise<AudioBuffer>

// Created inside a pointerdown handler, which carries user activation, so
// autoplay policy lets the AudioContext start.
function playTap(id) {
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume();
  if (!buffers.has(id)) {
    buffers.set(id, fetch(chrome.runtime.getURL(`sounds/tap_${id}.wav`))
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
    // Fails when the extension was reloaded under this page; retry next click.
    () => buffers.delete(id)
  );
}

// A slap, made rather than recorded: a burst of band-passed noise over a short
// falling thump, scheduled `delay` seconds ahead to land on the impact.
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

// ---------------------------------------------------------------- hiding the cursor

// The service worker inserts the CSS with chrome.scripting.insertCSS as a
// user-origin stylesheet. User !important beats every author rule, including a
// site's own !important, and the sheet lives outside the DOM, so a page that
// rewrites <head> cannot remove it. `css` is null to remove the styles.
function setStyles(css) {
  if (css === insertedCss) return;
  const previous = insertedCss;
  insertedCss = css;
  chrome.runtime.sendMessage({ action: 'setCursorCss', css, previous });
}

const HIDE_CSS = ':root, :root * { cursor: none !important; }';

// Chromium doesn't apply user stylesheets inside shadow roots, so every shadow
// root also adopts shadowSheet. chrome.dom reaches closed roots as well.
const shadowSheet = new CSSStyleSheet();
const shadowRoots = new WeakSet();
let watchingShadowRoots = false;

const shadowObserver = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) findShadowRoots(node);
    }
  }
});

// el.shadowRoot sees open roots only. chrome.dom sees closed ones too but costs
// about 50 times more per call, so scans ask it only about custom elements,
// which host nearly every closed root. The pointerover check covers the rest.
function scannedShadowRoot(el) {
  if (el.shadowRoot) return el.shadowRoot;
  if (el.localName.includes('-') && el instanceof HTMLElement && el !== overlay.host) {
    return chrome.dom.openOrClosedShadowRoot(el);
  }
  return null;
}

function findShadowRoots(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (el.nodeType === Node.ELEMENT_NODE) adoptShadowRoot(scannedShadowRoot(el));
  }
}

function adoptShadowRoot(root) {
  if (!root) return;
  // Checked every time: a component can replace its adoptedStyleSheets.
  if (!root.adoptedStyleSheets.includes(shadowSheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, shadowSheet];
  }
  if (shadowRoots.has(root)) return;
  shadowRoots.add(root);
  shadowObserver.observe(root, { childList: true, subtree: true });
  findShadowRoots(root);
}

function watchShadowRoots() {
  if (watchingShadowRoots) return;
  watchingShadowRoots = true;
  shadowObserver.observe(document, { childList: true, subtree: true });
  findShadowRoots(document);
  // A custom element defined after the parser created it attaches its shadow
  // root without a DOM mutation, so look again once parsing is done.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => findShadowRoots(document), { once: true });
  }
}

// ---------------------------------------------------------------- the overlay (top frame)

const overlay = {
  host: null,
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  dpr: 1,
  images: new Map(), // style id -> Promise<ImageBitmap>
  image: null, // the current style's ImageBitmap, once loaded
  cursor: null, // { x, y } in this window's CSS px, or null when hidden
  gripX: null,
  held: false,
  press: 0,
  lastFrame: 0,
  frame: 0,
  hideTimer: 0,
  filter: '',
  slap: null, // { start } while the slap animation runs
  impact: null, // { x, y, start } for the burst where the slap lands
};

function createOverlay() {
  // A custom element with a closed shadow root keeps page styles off the
  // canvas. As a manual popover it sits in the top layer, above dialogs and
  // fullscreen elements, and pointer-events: none lets every click through.
  const host = document.createElement('tinyhand-overlay');
  host.setAttribute('popover', 'manual');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'all: initial', 'position: fixed', 'inset: 0', 'width: 100%', 'height: 100%',
    'margin: 0', 'padding: 0', 'border: 0', 'background: transparent', 'overflow: visible',
    'pointer-events: none', 'z-index: 2147483647', 'display: block', 'contain: strict',
  ].map((rule) => `${rule} !important`).join(';');
  const root = host.attachShadow({ mode: 'closed' });
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none';
  root.append(canvas);
  overlay.host = host;
  overlay.canvas = canvas;
  overlay.ctx = canvas.getContext('2d');
}

function mountOverlay() {
  if (!overlay.host) createOverlay();
  const host = overlay.host;
  if (!host.isConnected) {
    (document.documentElement || document).append(host);
    raiseOverlay();
    resizeOverlay();
  }
}

// Shows the popover again so it moves to the top of the top layer, above a
// dialog, popover or fullscreen element that opened after it.
function raiseOverlay() {
  const host = overlay.host;
  if (!host?.isConnected) return;
  try {
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch {
    // Some documents (XML, sandboxed) have no popover support; fixed
    // positioning with the top z-index still covers most pages.
  }
}

function resizeOverlay() {
  const { host, canvas } = overlay;
  if (!host?.isConnected) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const width = host.clientWidth || window.innerWidth;
  const height = host.clientHeight || window.innerHeight;
  if (width === overlay.width && height === overlay.height && dpr === overlay.dpr) return;
  overlay.width = width;
  overlay.height = height;
  overlay.dpr = dpr;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  schedule();
}

function unmountOverlay() {
  cancelAnimationFrame(overlay.frame);
  overlay.frame = 0;
  overlay.cursor = null;
  overlay.gripX = null;
  overlay.host?.remove();
}

function loadImage(id) {
  if (!overlay.images.has(id)) {
    overlay.images.set(id, fetch(chrome.runtime.getURL(`hands/${id}.png`))
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
  return window.screen?.height || overlay.height;
}

function draw(now) {
  overlay.frame = 0;
  const dt = overlay.lastFrame ? Math.min(64, now - overlay.lastFrame) : 16;
  overlay.lastFrame = now;
  const { ctx, width: W, height: H, dpr } = overlay;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!settings || !overlay.cursor) {
    overlay.lastFrame = 0;
    return;
  }

  let moving = false;
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
  if (drawImpact(now)) moving = true;
  if (moving) schedule();
  else overlay.lastFrame = 0;
}

// TinyHand's ArmView.aim(cursor:): the stick is held below the bottom edge,
// to the right of the pointer, and the hand turns so its fingertip lands on
// the pointer. The grip trails the pointer, so the stick swings as you move.
function drawHand(dt, slap) {
  const hand = catalog?.HANDS.find((h) => h.id === settings.style);
  const image = overlay.image;
  if (!hand || !image) return false;
  const { ctx, width: W, height: H, cursor } = overlay;
  const screenH = screenHeight();

  const sizeFrac = (catalog.SIZES.find((s) => s.id === settings.size) || catalog.SIZES[1]).frac;
  const [tx, ty] = hand.tip;
  const [wx, wy] = hand.wrist;
  const press = Math.max(overlay.press, slap.press);
  const handLength = sizeFrac * screenH * (1 - PRESS_SCALE * press) * slap.scale;
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

  // The stick, shaded across its width so it reads as round.
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
  // The slap turns the whole stick about the grip.
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

// TinyHand's laser: a red dot with a glow and a pale core.
function drawLaser() {
  const { ctx, cursor } = overlay;
  const sizeFrac = (catalog?.SIZES.find((s) => s.id === settings.size) || { frac: 0.13 }).frac;
  const r = Math.max(4, screenHeight() * 0.0038 * (sizeFrac / 0.13)) * (1 + 0.2 * overlay.press);
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

const easeOut = (k) => 1 - (1 - k) ** 3;
const easeIn = (k) => k * k * k;

// Where the slap is at `now`: the swing about the grip, the hand's scale (it
// lifts toward you on the wind-up) and how pressed it is.
function slapPose(now) {
  const rest = { swing: 0, scale: 1, press: 0, active: false };
  if (!overlay.slap) return rest;
  const t = now - overlay.slap.start;
  if (t >= SLAP_END_MS) {
    overlay.slap = null;
    return rest;
  }
  if (t < SLAP_WIND_MS) {
    const k = easeOut(t / SLAP_WIND_MS);
    return { swing: SLAP_WIND * k, scale: 1 + 0.12 * k, press: 0, active: true };
  }
  if (t < SLAP_HIT_MS) {
    const k = easeIn((t - SLAP_WIND_MS) / (SLAP_HIT_MS - SLAP_WIND_MS));
    return { swing: SLAP_WIND - (SLAP_WIND + SLAP_FOLLOW) * k, scale: 1.12 - 0.2 * k, press: k, active: true };
  }
  const back = 1 - easeOut((t - SLAP_HIT_MS) / (SLAP_END_MS - SLAP_HIT_MS));
  return { swing: -SLAP_FOLLOW * back, scale: 1 - 0.08 * back, press: back, active: true };
}

// A ring and a few speed lines where the slap lands.
function drawImpact(now) {
  const impact = overlay.impact;
  if (!impact) return false;
  const t = now - impact.start;
  if (t < 0) return true;
  if (t >= IMPACT_MS) {
    overlay.impact = null;
    return false;
  }
  const k = easeOut(t / IMPACT_MS);
  const { ctx } = overlay;
  const r = 10 + 46 * k;
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = '#8754f2';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4 * (1 - k) + 1;
  ctx.beginPath();
  ctx.arc(impact.x, impact.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 1.1;
    ctx.beginPath();
    ctx.moveTo(impact.x + Math.cos(a) * (r + 6), impact.y + Math.sin(a) * (r + 6));
    ctx.lineTo(impact.x + Math.cos(a) * (r + 18 + 10 * k), impact.y + Math.sin(a) * (r + 18 + 10 * k));
    ctx.stroke();
  }
  ctx.restore();
  return true;
}

// TinyHand's shadow falls down and to the right and tucks in on a tap. A CSS
// drop-shadow on the whole overlay keeps the stick and hand one shape.
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

// ---------------------------------------------------------------- pointer input

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

function startSlap(x, y) {
  pointAt(x, y);
  const now = performance.now();
  overlay.slap = { start: now };
  overlay.impact = { x, y, start: now + SLAP_IMPACT_MS };
  schedule();
}

function releaseHand() {
  if (!overlay.held) return;
  overlay.held = false;
  schedule();
}

// Leaving this document can mean entering an iframe, whose first move arrives
// a moment later, so wait before hiding the hand.
function leaveSoon() {
  clearTimeout(overlay.hideTimer);
  overlay.hideTimer = setTimeout(() => {
    overlay.cursor = null;
    overlay.held = false;
    schedule();
  }, 120);
}

// Each frame passes pointer events to its parent in its own coordinates; the
// parent adds the iframe's position and passes them on, up to the top frame.
function route(type, x, y, buttons) {
  if (IS_TOP) {
    if (type === 'down') pressAt(x, y);
    else if (type === 'up') { pointAt(x, y); releaseHand(); }
    else if (type === 'leave') leaveSoon();
    else if (type === 'release') releaseHand();
    else if (type === 'slap') startSlap(x, y);
    else {
      pointAt(x, y);
      if (!(buttons & 1)) releaseHand();
    }
  } else {
    window.parent.postMessage({ [MESSAGE_KEY]: type, x, y, buttons }, '*');
  }
}

function frameElementFor(source) {
  for (const frame of document.querySelectorAll('iframe, frame')) {
    if (frame.contentWindow === source) return frame;
  }
  return null;
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!settings || !data || typeof data[MESSAGE_KEY] !== 'string' || !event.source) return;
  const frame = frameElementFor(event.source);
  if (!frame) return;
  const rect = frame.getBoundingClientRect();
  const style = getComputedStyle(frame);
  const x = data.x + rect.left + frame.clientLeft + (parseFloat(style.paddingLeft) || 0);
  const y = data.y + rect.top + frame.clientTop + (parseFloat(style.paddingTop) || 0);
  route(data[MESSAGE_KEY], x, y, data.buttons);
});

function counts(event) {
  return settings && event.pointerType !== 'touch';
}

window.addEventListener('pointermove', (event) => {
  if (!counts(event)) return;
  lastPointer = { x: event.clientX, y: event.clientY };
  if (settings.slap && event.altKey) highlight(slapTarget(event.clientX, event.clientY));
  else unhighlight();
  route('move', event.clientX, event.clientY, event.buttons);
}, true);

window.addEventListener('pointerdown', (event) => {
  if (!counts(event)) return;
  if (event.button === 0 && event.altKey && settings.slap) {
    swallow(event);
    slapClick = true;
    clearTimeout(slapClickTimer);
    slapClickTimer = setTimeout(() => { slapClick = false; }, 800);
    slapAt(event.clientX, event.clientY);
    return;
  }
  if (event.button === 0) {
    route('down', event.clientX, event.clientY, event.buttons);
    if (settings.sound) playTap(settings.sound);
  } else {
    route('move', event.clientX, event.clientY, event.buttons);
  }
}, true);

window.addEventListener('pointerup', (event) => {
  if (slapClick) {
    swallow(event);
    return;
  }
  if (!counts(event)) return;
  route('up', event.clientX, event.clientY, event.buttons);
}, true);

window.addEventListener('pointercancel', () => settings && route('release', 0, 0, 0), true);
window.addEventListener('blur', () => IS_TOP && releaseHand());

document.addEventListener('pointerout', (event) => {
  if (!settings || event.relatedTarget) return;
  route('leave', event.clientX, event.clientY, 0);
}, true);

// Catches a shadow root attached late, when the pointer first enters it.
window.addEventListener('pointerover', (event) => {
  if (!watchingShadowRoots) return;
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node !== overlay.host) adoptShadowRoot(chrome.dom.openOrClosedShadowRoot(node));
  }
}, true);

if (IS_TOP) {
  window.addEventListener('resize', resizeOverlay);
  // A dialog, popover or fullscreen element opened after the overlay would sit
  // above it in the top layer.
  document.addEventListener('toggle', (event) => {
    if (event.target !== overlay.host && event.newState === 'open') raiseOverlay();
  }, true);
  document.addEventListener('fullscreenchange', () => raiseOverlay());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseHand();
  });
}

// ---------------------------------------------------------------- slap to remove
//
// Hold Option (Alt) to outline the element under the hand; Option-click slaps
// it off the page, like VisBug's delete. Option-Z puts the last one back. The
// element is hidden with display: none, not removed, so the page's own scripts
// still find it, and a reload brings everything back.

let lastPointer = null;
let highlighted = null; // { el, outline, offset } with the inline values to restore
const slapped = []; // { el, display } for Option-Z, newest last
let slapClick = false; // swallow this click's remaining events
let slapClickTimer = 0;

function swallow(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// The page sees none of a slap's events, so an Option-click on a link
// doesn't download it and a button doesn't fire.
for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick']) {
  window.addEventListener(type, (event) => {
    if (!slapClick) return;
    swallow(event);
    if (type === 'click') slapClick = false;
  }, true);
}

function deepElementFromPoint(x, y) {
  let el = document.elementFromPoint(x, y);
  for (let depth = 0; el && depth < 32; depth++) {
    const root = el.shadowRoot || (el.localName.includes('-') && el instanceof HTMLElement ? chrome.dom.openOrClosedShadowRoot(el) : null);
    const inner = root?.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

// The innermost box under the pointer that's worth slapping: not inline, not
// tiny, and not the whole document.
function slapTarget(x, y) {
  let el = deepElementFromPoint(x, y);
  while (el && el !== document.documentElement && el !== document.body) {
    if (el.style && el !== overlay.host) {
      const display = getComputedStyle(el).display;
      const rect = el.getBoundingClientRect();
      if (display !== 'inline' && display !== 'contents' && rect.width >= 24 && rect.height >= 16) return el;
    }
    el = el.parentElement || el.getRootNode()?.host || null;
  }
  return null;
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
  if (el) setTimeout(() => knockOff(el), SLAP_IMPACT_MS);
}

// Knocked away to the left, the way the swing goes, then hidden.
function knockOff(el) {
  slapped.push({ el, display: saveProp(el, 'display') });
  const rect = el.getBoundingClientRect();
  const dx = -(rect.right + 120);
  const animation = el.animate([
    { transform: 'none', opacity: 1 },
    { transform: `translate(${dx * 0.35}px, -30px) rotate(-10deg)`, opacity: 1, offset: 0.25 },
    { transform: `translate(${dx}px, -90px) rotate(-32deg) scale(0.6)`, opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'forwards' });
  const hide = () => {
    el.style.setProperty('display', 'none', 'important');
    animation.cancel();
  };
  animation.finished.then(hide, hide);
}

function unslap() {
  const last = slapped.pop();
  if (!last) return false;
  restoreProp(last.el, 'display', last.display);
  last.el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
  return true;
}

function isEditable(target) {
  return target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '');
}

window.addEventListener('keydown', (event) => {
  if (!settings?.slap) return;
  if (event.key === 'Alt' && lastPointer) highlight(slapTarget(lastPointer.x, lastPointer.y));
  if (event.altKey && event.code === 'KeyZ' && !isEditable(event.target) && unslap()) swallow(event);
}, true);

window.addEventListener('keyup', (event) => {
  if (event.key === 'Alt') unhighlight();
}, true);

window.addEventListener('blur', unhighlight);

// ---------------------------------------------------------------- settings

// The hand is off on a site when the top frame's host is on the list. Frames
// read the top host from ancestorOrigins, since they can't read top.location.
function topHostname() {
  if (IS_TOP) return location.hostname;
  const origins = location.ancestorOrigins;
  if (origins?.length) {
    try {
      return new URL(origins[origins.length - 1]).hostname;
    } catch {}
  }
  return location.hostname;
}

async function apply() {
  const stored = await chrome.storage.local.get(['enabled', 'disabledSites', 'style', 'size', 'shadow', 'sound', 'handSound', 'laserSound', 'slap']);
  const style = stored.style || 'glove';
  const off = stored.enabled === false || (stored.disabledSites || []).includes(topHostname());
  if (off) {
    settings = null;
    unhighlight();
    setStyles(null);
    shadowSheet.replaceSync('');
    if (IS_TOP) unmountOverlay();
    return;
  }

  const handSound = stored.handSound !== false;
  const laserSound = stored.laserSound === true;
  const sound = !handSound || (style === 'laser' && !laserSound) ? null : (stored.sound || 'click');
  const previousStyle = settings?.style;
  settings = { style, size: stored.size || 'medium', shadow: stored.shadow !== false, sound, slap: stored.slap !== false };
  if (!settings.slap) unhighlight();

  setStyles(HIDE_CSS);
  shadowSheet.replaceSync('* { cursor: none !important; }');
  watchShadowRoots();

  if (IS_TOP) {
    catalog ??= await import(chrome.runtime.getURL('shared/catalog.js'));
    if (style !== previousStyle || !overlay.image) useStyle(style);
    if (overlay.host?.isConnected) schedule();
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') apply();
});

apply();
