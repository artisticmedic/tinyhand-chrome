import { DEFAULTS, PINNED, SIZES } from '../shared/catalog.js';
import { renderCursors } from '../shared/render.js';

const params = new URLSearchParams(location.search);
const styles = (params.get('styles') || '').split(',').filter(Boolean);
const list = styles.length ? styles : PINNED;
const out = document.getElementById('out');
const info = [];

function parse(css) {
  const re = /url\("([^"]+)"\) 2x\) (\d+) (\d+)/g;
  return [...css.matchAll(re)].map((m) => ({ url: m[1], hotX: +m[2], hotY: +m[3] }));
}

async function cell(entry, theme) {
  const img = new Image();
  img.src = entry.url;
  await img.decode();
  const w = img.naturalWidth / 2;
  const h = img.naturalHeight / 2;
  img.width = w;
  img.height = h;
  const div = document.createElement('div');
  div.className = 'cell';
  const frame = document.createElement('div');
  frame.className = `frame ${theme}`;
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  const hot = document.createElement('div');
  hot.className = 'hot';
  hot.style.left = `${entry.hotX}px`;
  hot.style.top = `${entry.hotY}px`;
  frame.append(img, hot);
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `${w}×${h} hot ${entry.hotX},${entry.hotY}`;
  div.append(frame, label);
  return { div, w, h };
}

async function section(title, settings) {
  const cursors = await renderCursors(settings);
  const h2 = document.createElement('h2');
  h2.textContent = `${title} (hand length ${cursors.length ?? '-'}px, sound ${cursors.sound})`;
  out.append(h2);
  const row = document.createElement('div');
  row.className = 'row';
  out.append(row);
  const record = { title, length: cursors.length, cssBytes: cursors.idle.length + cursors.pressed.length, images: [] };
  for (const [state, css] of [['idle', cursors.idle], ['pressed', cursors.pressed]]) {
    for (const entry of parse(css)) {
      const theme = state === 'idle' ? 'light' : 'dark';
      const c = await cell(entry, theme);
      row.append(c.div);
      record.images.push(`${state} ${c.w}x${c.h} @${entry.hotX},${entry.hotY}`);
    }
  }
  info.push(record);
}

for (const style of list) {
  await section(style, { ...DEFAULTS, style });
}
if (!styles.length) {
  for (const size of SIZES) await section(`glove ${size.id}`, { ...DEFAULTS, size: size.id });
  await section('glove, no shadow', { ...DEFAULTS, shadow: false });
}
window.sheetInfo = info;
window.sheetDone = true;
