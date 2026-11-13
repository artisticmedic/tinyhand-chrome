// TinyHand for Chrome - service worker
// Owns the settings defaults, draws the cursor images whenever a setting that
// shapes them changes, and inserts each frame's cursor stylesheet.

import { DEFAULTS, SETTING_KEYS } from './shared/catalog.js';
import { renderCursors, RENDER_VERSION } from './shared/render.js';

const RENDER_KEYS = ['style', 'size', 'shadow', 'sound', 'handSound', 'laserSound'];

async function readSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(SETTING_KEYS)) };
}

// Renders run one at a time. A change that arrives while one is waiting to
// start rides along with it instead of queueing another.
let renders = Promise.resolve();
let waiting = false;

function rerender() {
  if (waiting) return renders;
  waiting = true;
  renders = renders
    .then(async () => {
      waiting = false;
      const cursors = await renderCursors(await readSettings());
      await chrome.storage.local.set({ cursors });
    })
    .catch((error) => console.error('TinyHand: could not draw the cursor', error));
  return renders;
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(SETTING_KEYS);
  await chrome.storage.local.set({ ...DEFAULTS, ...stored });
  rerender();
});

// Covers a render that failed or an update that changed how cursors are drawn.
chrome.storage.local.get('cursors').then(({ cursors }) => {
  if (cursors?.version !== RENDER_VERSION) rerender();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (RENDER_KEYS.some((key) => key in changes)) rerender();
  if (changes.enabled) showBadge(changes.enabled.newValue);
});

// Insertions and removals run one at a time, in the order content scripts
// sent them, so a removal never overtakes the insertion it undoes.
let cssQueue = Promise.resolve();

function setCursorCss({ css, previous }, sender) {
  const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
  cssQueue = cssQueue
    .then(async () => {
      if (previous) await chrome.scripting.removeCSS({ target, css: previous, origin: 'USER' });
      if (css) await chrome.scripting.insertCSS({ target, css, origin: 'USER' });
    })
    // The document can be gone by now (navigation, closed tab). Nothing to style.
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'setCursorCss' && sender.tab) setCursorCss(message, sender);
  return false;
});

// Shortcut presses run one at a time, so two quick ones never read the same
// value and cancel out.
let toggles = Promise.resolve();

function flip(key) {
  toggles = toggles.then(async () => {
    const value = (await chrome.storage.local.get(key))[key] ?? DEFAULTS[key];
    await chrome.storage.local.set({ [key]: !value });
  });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-hand') flip('enabled');
  if (command === 'toggle-sound') flip('handSound');
});

function showBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled === false ? 'off' : '' });
}

chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
chrome.storage.local.get('enabled').then(({ enabled }) => showBadge(enabled));
