// Draws the cursor images for the current settings and returns them as CSS
// `cursor` values. Runs in the service worker and in extension pages.
//
// Chrome's limits, from ui/base/cursor/cursor.cc and
// third_party/blink/renderer/core/input/event_handler.cc:
// - an image over 128 CSS px on either side is ignored. The size counts in
//   CSS px, so a 256px image listed as `image-set(... 2x)` is allowed and
//   stays sharp on a Retina screen.
// - an image whose rect, placed by its hotspot, is not fully inside the
//   viewport is skipped for the next value in the list. Each value therefore
//   lists the same hand at full, 60% and 36% size before `auto`, so near the
//   right and bottom edges the hand shrinks before it gives way to the arrow.

import { HANDS, SIZES } from './catalog.js';

export const RENDER_VERSION = 1;

const MAX_CSS_PX = 128;
const DENSITY = 2;
const FALLBACK_SCALES = [1, 0.6, 0.36];

// TinyHand holds the stick from below the screen and to the right of the
// pointer, so the hand leans left. 24° is its lean with the pointer in the
// upper middle of a 16:10 screen.
const LEAN = (24 * Math.PI) / 180;
// Stick stub below the wrist, as a fraction of the hand length. It fades out.
const STICK = 0.42;
// TinyHand shrinks the hand 6% while pressed.
const PRESS_SCALE = 0.94;
// Shadow lift as a fraction of the hand length. TinyHand's is 0.46, which
// would need a cursor twice Chrome's limit; this keeps the same direction,
// down and to the right, at about a third of the distance.
const LIFT = 0.16;

const images = new Map();

function loadHand(id) {
  if (!images.has(id)) {
    const url = chrome.runtime.getURL(`hands/${id}.png`);
    images.set(id, fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b)));
  }
  return images.get(id);
}

async function toDataUrl(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function rotate([x, y], angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

// Where everything lands, in CSS px with the fingertip at 0,0.
function layout(hand, length, pressed, shadow) {
  const [tx, ty] = hand.tip;
  const [wx, wy] = hand.wrist;
  const scale = (length / Math.hypot(wx - tx, wy - ty)) * (pressed ? PRESS_SCALE : 1);
  const handLength = Math.hypot(wx - tx, wy - ty) * scale;
  // Turn the image so the line from fingertip to wrist points down and right.
  const axis = Math.PI / 2 - LEAN;
  const rotation = axis - Math.atan2(wy - ty, wx - tx);

  const toCss = ([x, y]) => rotate([(x - tx) * scale, (y - ty) * scale], rotation);
  const wrist = toCss([wx, wy]);
  const stickLength = STICK * length;
  const stickEnd = [wrist[0] + Math.cos(axis) * stickLength, wrist[1] + Math.sin(axis) * stickLength];
  const stickWidth = Math.max(2.5, 0.07 * hand.h * scale);

  const points = [[0, 0], [hand.w, 0], [0, hand.h], [hand.w, hand.h]].map(toCss);
  const half = stickWidth / 2;
  points.push([stickEnd[0] - half, stickEnd[1] - half], [stickEnd[0] + half, stickEnd[1] + half]);

  let lift = 0;
  let blur = 0;
  let alpha = 0;
  if (shadow) {
    lift = LIFT * length * (pressed ? 0.2 : 1);
    blur = Math.max(1, lift * 0.45) + (pressed ? 0.04 * length : 0);
    alpha = pressed ? 0.28 : 0.26;
  }
  const offset = [lift * 0.6, lift];

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  let minX = Math.min(...xs);
  let minY = Math.min(...ys);
  let maxX = Math.max(...xs);
  let maxY = Math.max(...ys);
  if (shadow) {
    // A canvas shadow blur reaches about its own value past the edge.
    const reach = blur * 1.1;
    minX = Math.min(minX, minX + offset[0] - reach);
    minY = Math.min(minY, minY + offset[1] - reach);
    maxX = Math.max(maxX, maxX + offset[0] + reach);
    maxY = Math.max(maxY, maxY + offset[1] + reach);
  }
  const hotX = Math.ceil(-minX);
  const hotY = Math.ceil(-minY);
  return {
    scale, rotation, axis, wrist, stickEnd, stickWidth, handLength,
    offset, blur, alpha,
    hotX, hotY,
    width: Math.ceil(hotX + maxX) + 1,
    height: Math.ceil(hotY + maxY) + 1,
  };
}

// The largest hand length up to `wanted` whose idle image fits the limit.
function fitLength(hand, wanted, shadow) {
  let length = wanted;
  for (let i = 0; i < 4; i++) {
    const { width, height } = layout(hand, length, false, shadow);
    const over = Math.max(width, height) / MAX_CSS_PX;
    if (over <= 1) return length;
    length = Math.floor((length / over) * 0.99);
  }
  return length;
}

async function drawHand(hand, length, pressed, shadow) {
  const image = await loadHand(hand.id);
  const L = layout(hand, length, pressed, shadow);
  const w = L.width * DENSITY;
  const h = L.height * DENSITY;

  // Stick and hand together, without the shadow.
  const sprite = new OffscreenCanvas(w, h);
  const s = sprite.getContext('2d');
  s.scale(DENSITY, DENSITY);
  s.translate(L.hotX, L.hotY);

  const stick = new OffscreenCanvas(w, h);
  const k = stick.getContext('2d');
  k.scale(DENSITY, DENSITY);
  k.translate(L.hotX, L.hotY);
  const [ax, ay] = L.wrist;
  const [bx, by] = L.stickEnd;
  // Shade across the stick so it reads as round, as TinyHand's site does.
  const nx = Math.cos(L.axis + Math.PI / 2) * (L.stickWidth / 2);
  const ny = Math.sin(L.axis + Math.PI / 2) * (L.stickWidth / 2);
  const shade = k.createLinearGradient((ax + bx) / 2 - nx, (ay + by) / 2 - ny, (ax + bx) / 2 + nx, (ay + by) / 2 + ny);
  shade.addColorStop(0, hand.stick[2]);
  shade.addColorStop(0.35, hand.stick[1]);
  shade.addColorStop(0.55, hand.stick[0]);
  shade.addColorStop(1, hand.stick[2]);
  k.strokeStyle = shade;
  k.lineWidth = L.stickWidth;
  k.lineCap = 'butt';
  k.beginPath();
  // Start inside the cuff so no gap shows at the wrist.
  k.moveTo(ax - Math.cos(L.axis) * L.stickWidth, ay - Math.sin(L.axis) * L.stickWidth);
  k.lineTo(bx, by);
  k.stroke();
  // Fade the stub out along its length.
  k.globalCompositeOperation = 'destination-in';
  const fade = k.createLinearGradient(ax, ay, bx, by);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.35, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  k.fillStyle = fade;
  k.fillRect(-L.hotX, -L.hotY, L.width, L.height);

  s.save();
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.drawImage(stick, 0, 0);
  s.restore();
  s.imageSmoothingQuality = 'high';
  s.rotate(L.rotation);
  s.scale(L.scale, L.scale);
  s.drawImage(image, -hand.tip[0], -hand.tip[1]);

  const out = new OffscreenCanvas(w, h);
  const o = out.getContext('2d');
  if (shadow) {
    // Shadow offsets and blur are in canvas pixels, not transformed.
    o.shadowColor = `rgba(0,0,0,${L.alpha})`;
    o.shadowOffsetX = L.offset[0] * DENSITY;
    o.shadowOffsetY = L.offset[1] * DENSITY;
    o.shadowBlur = L.blur * DENSITY;
  }
  o.drawImage(sprite, 0, 0);
  return { url: await toDataUrl(out), hotX: L.hotX, hotY: L.hotY, width: L.width, height: L.height };
}

// TinyHand's laser: a red dot with a glow and a pale core, a little bigger
// and brighter while pressed.
async function drawLaser(scale, pressed) {
  const r = 5 * scale * (pressed ? 1.2 : 1);
  const glow = r * (pressed ? 3.2 : 2.2);
  const half = Math.ceil(r + glow * 1.1);
  const size = half * 2;
  const canvas = new OffscreenCanvas(size * DENSITY, size * DENSITY);
  const c = canvas.getContext('2d');
  c.scale(DENSITY, DENSITY);
  c.translate(half, half);
  c.shadowColor = '#ff2a1f';
  c.shadowBlur = glow * DENSITY;
  c.fillStyle = '#ff2a1f';
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
  c.fillStyle = 'rgba(255, 220, 213, 0.95)';
  c.beginPath();
  c.arc(0, 0, r * 0.45, 0, Math.PI * 2);
  c.fill();
  return { url: await toDataUrl(canvas), hotX: half, hotY: half, width: size, height: size };
}

function cssValue(images) {
  const parts = images.map((i) => `image-set(url("${i.url}") ${DENSITY}x) ${i.hotX} ${i.hotY}`);
  return [...parts, 'auto'].join(', ');
}

// Returns { idle, pressed } CSS cursor values plus what the content script
// needs to play the tap sound, and the chosen sizes for the popup to show.
export async function renderCursors(settings) {
  const sound = tapSound(settings);
  if (settings.style === 'laser') {
    const idle = await Promise.all([1, 0.7].map((s) => drawLaser(s, false)));
    const pressed = await Promise.all([1, 0.7].map((s) => drawLaser(s, true)));
    return { version: RENDER_VERSION, idle: cssValue(idle), pressed: cssValue(pressed), sound, preview: idle[0] };
  }
  const hand = HANDS.find((h) => h.id === settings.style) || HANDS.find((h) => h.id === 'glove');
  const wanted = (SIZES.find((s) => s.id === settings.size) || SIZES[SIZES.length - 1]).length;
  const length = fitLength(hand, wanted, settings.shadow);
  const lengths = FALLBACK_SCALES.map((f) => Math.max(10, Math.round(length * f)));
  const idle = await Promise.all(lengths.map((l) => drawHand(hand, l, false, settings.shadow)));
  const pressed = await Promise.all(lengths.map((l) => drawHand(hand, l, true, settings.shadow)));
  return { version: RENDER_VERSION, idle: cssValue(idle), pressed: cssValue(pressed), sound, length, preview: idle[0] };
}

// TinyHand's rules: "Off" mutes every pointer; the laser taps only when its
// own switch is on as well.
export function tapSound(settings) {
  if (!settings.handSound) return null;
  if (settings.style === 'laser' && !settings.laserSound) return null;
  return settings.sound;
}
