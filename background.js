// TinyHand for Chrome - service worker
// Owns the settings defaults, inserts each frame's cursor stylesheet, and
// handles the keyboard shortcuts.

import { DEFAULTS, SETTING_KEYS } from './shared/catalog.js';

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  const stored = await chrome.storage.local.get(SETTING_KEYS);
  // 0.1.0 drew the hand as a cursor image, where Large was the biggest that
  // fit. Sizes are now TinyHand's screen fractions, and Medium is its default.
  if (reason === 'update' && previousVersion === '0.1.0') delete stored.size;
  await chrome.storage.local.set({ ...DEFAULTS, ...stored });
  await chrome.storage.local.remove('cursors');
  // The Settings page shows the hand and has a place to try drawing and slapping.
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) showBadge(changes.enabled.newValue);
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
