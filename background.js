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
  // Tabs open before an install or update don't have the content script.
  injectIntoOpenTabs();
  // The Settings page shows the hand and has a place to try drawing and slapping.
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

async function injectIntoOpenTabs() {
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file://*/*'] })) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] })
      // Discarded tabs and pages that refuse injection keep going without it.
      .catch(() => {});
  }
}

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

// Which frame owns each child frame's id, per tab: "tabId:id" -> frameId.
// A frame passes its pointer events to its parent through here (see "frames"
// in content.js). After the worker restarts the map is empty; a frame whose id
// is unknown says hello again and its parent claims it again.
const parentFrames = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of parentFrames.keys()) {
    if (key.startsWith(`${tabId}:`)) parentFrames.delete(key);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return false;
  if (message.action === 'setCursorCss') {
    setCursorCss(message, sender);
  } else if (message.action === 'claimFrame') {
    parentFrames.set(`${sender.tab.id}:${message.id}`, sender.frameId);
    sendResponse({});
  } else if (message.action === 'toParent') {
    const frameId = parentFrames.get(`${sender.tab.id}:${message.id}`);
    if (frameId === undefined) {
      sendResponse({ unknown: true });
    } else {
      chrome.tabs.sendMessage(sender.tab.id, { action: 'fromChild', id: message.id, packet: message.packet }, { frameId })
        .catch(() => {});
      sendResponse({});
    }
  }
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
