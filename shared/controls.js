import { DEFAULTS, FADES, INKS, PINNED, SIZES, SOUNDS, STYLES } from './catalog.js';

const IS_MAC = /Mac/.test(navigator.platform);
export const KEYS = IS_MAC
  ? { alt: '⌥', arrow: '⌘', altZ: '⌥Z' }
  : { alt: 'Alt', arrow: 'Ctrl', altZ: 'Alt+Z' };

export function readSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

export function save(values) {
  return chrome.storage.local.set(values);
}

let previewAudio;
export function previewSound(id) {
  previewAudio?.pause();
  previewAudio = new Audio(`/sounds/tap_${id}.wav`);
  previewAudio.play().catch(() => {});
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export function switchRow(label, key, settings, detail, onChange) {
  const input = el('input', {
    type: 'checkbox', role: 'switch', checked: !!settings[key],
    onchange: () => (onChange ? onChange(input.checked) : save({ [key]: input.checked })),
  });
  const text = el('span', { class: 'row-text' }, [el('span', { class: 'row-label', textContent: label })]);
  if (detail) text.append(el('span', { class: 'row-detail', textContent: detail }));
  return { row: el('label', { class: 'row' }, [text, input]), input };
}

function orderedStyles() {
  const pinned = PINNED.map((id) => STYLES.find((s) => s.id === id));
  return [...pinned, ...STYLES.filter((s) => !PINNED.includes(s.id))];
}

export function styleGrid(settings) {
  const grid = el('div', { class: 'styles', role: 'radiogroup', 'aria-label': 'Pointer' });
  const buttons = orderedStyles().map((style) => {
    const art = style.id === 'laser'
      ? el('span', { class: 'laser-dot' })
      : el('img', { src: `/hands/${style.id}.png`, alt: '', loading: 'lazy' });
    const button = el('button', {
      type: 'button', class: 'style', title: style.name, role: 'radio',
      'aria-label': style.name, dataset: { style: style.id },
      onclick: () => save({ style: style.id }),
    }, [art]);
    if (PINNED.includes(style.id)) button.classList.add('pinned');
    return button;
  });
  grid.append(...buttons);
  const sync = (id) => {
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.style === id));
  };
  sync(settings.style);
  return { grid, sync };
}

export function soundPicker(settings) {
  const select = el('select', { 'aria-label': 'Tap sound' }, [
    el('option', { value: 'off', textContent: 'Off' }),
    ...SOUNDS.map((s) => el('option', { value: s.id, textContent: s.name })),
  ]);
  let current = settings;
  const sync = (s) => {
    current = s;
    select.value = s.handSound ? s.sound : 'off';
  };
  sync(settings);
  select.addEventListener('change', () => {
    if (select.value === 'off') {
      save({ handSound: false });
    } else {
      save({ sound: select.value, handSound: true });
      previewSound(select.value);
    }
  });
  const play = el('button', {
    type: 'button', class: 'icon-button', title: 'Play', 'aria-label': 'Play the tap sound',
    onclick: () => previewSound(current.sound),
  });
  play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const row = el('div', { class: 'row' }, [
    el('span', { class: 'row-text' }, [el('span', { class: 'row-label', textContent: 'Tap sound' })]),
    el('span', { class: 'row-controls' }, [play, select]),
  ]);
  return { row, sync };
}

export function sizePicker(settings) {
  const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Size' });
  const buttons = SIZES.map((size) => el('button', {
    type: 'button', role: 'radio', textContent: size.name, dataset: { size: size.id },
    onclick: () => save({ size: size.id }),
  }));
  group.append(...buttons);
  const sync = (id) => {
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.size === id));
  };
  sync(settings.size);
  const row = el('div', { class: 'row' }, [
    el('span', { class: 'row-text' }, [el('span', { class: 'row-label', textContent: 'Size' })]),
    group,
  ]);
  return { row, sync };
}

export function inkPicker(settings) {
  const group = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Ink colour' });
  const buttons = INKS.map((ink) => {
    const button = el('button', {
      type: 'button', role: 'radio', class: 'swatch', title: ink.name, 'aria-label': ink.name,
      dataset: { ink: ink.id }, onclick: () => save({ ink: ink.id }),
    });
    if (ink.color) button.style.setProperty('--swatch', ink.color);
    else button.classList.add('match');
    return button;
  });
  group.append(...buttons);
  const sync = (s) => {
    group.style.setProperty('--match', STYLES.find((style) => style.id === s.style).ink);
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.ink === s.ink));
  };
  sync(settings);
  const row = el('div', { class: 'row' }, [
    el('span', { class: 'row-text' }, [el('span', { class: 'row-label', textContent: 'Ink colour' })]),
    group,
  ]);
  return { row, sync };
}

export function fadePicker(settings) {
  const select = el('select', { 'aria-label': 'Lines fade', onchange: () => save({ fade: Number(select.value) }) },
    FADES.map((f) => el('option', { value: String(f.value), textContent: f.name })));
  const sync = (s) => { select.value = String(s.fade); };
  sync(settings);
  const row = el('div', { class: 'row' }, [
    el('span', { class: 'row-text' }, [el('span', { class: 'row-label', textContent: 'Lines fade' })]),
    select,
  ]);
  return { row, sync };
}

export function handName(id) {
  return STYLES.find((s) => s.id === id).name;
}

export { el };
