import { DEFAULTS } from './shared/catalog.js';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.storage.local.set(await chrome.storage.local.get(DEFAULTS));
  injectIntoOpenTabs();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

async function injectIntoOpenTabs() {
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file://*/*'] })) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] })
      .catch(() => {});
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) showBadge(changes.enabled.newValue);
});

let cssQueue = Promise.resolve();

function setCursorCss({ css, previous }, sender) {
  const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
  cssQueue = cssQueue
    .then(async () => {
      if (previous) await chrome.scripting.removeCSS({ target, css: previous, origin: 'USER' });
      if (css) await chrome.scripting.insertCSS({ target, css, origin: 'USER' });
    })
    .catch(() => {});
}

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

let toggles = Promise.resolve();

function flip(key) {
  toggles = toggles.then(async () => {
    const stored = await chrome.storage.local.get({ [key]: DEFAULTS[key] });
    await chrome.storage.local.set({ [key]: !stored[key] });
  });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-hand') flip('enabled');
  if (command === 'toggle-sound') flip('handSound');
});

function showBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? '' : 'off' });
}

chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
chrome.storage.local.get({ enabled: DEFAULTS.enabled }).then(({ enabled }) => showBadge(enabled));
