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

let parentFrames = {};
let slapHistory = {};
const restored = chrome.storage.session.get({ parentFrames: {}, slapHistory: {} }).then((saved) => {
  parentFrames = saved.parentFrames;
  slapHistory = saved.slapHistory;
});
const persist = () => chrome.storage.session.set({ parentFrames, slapHistory });

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await restored;
  for (const key of Object.keys(parentFrames)) {
    if (key.startsWith(`${tabId}:`)) delete parentFrames[key];
  }
  delete slapHistory[tabId];
  persist();
});

function handle(message, sender) {
  const tabId = sender.tab.id;
  const key = `${tabId}:${message.id}`;
  if (message.action === 'setCursorCss') {
    setCursorCss(message, sender);
  } else if (message.action === 'claimFrame') {
    if (!(key in parentFrames)) {
      parentFrames[key] = sender.frameId;
      persist();
    }
  } else if (message.action === 'toParent') {
    if (!(key in parentFrames)) return { unknown: true };
    chrome.tabs.sendMessage(tabId, { action: 'fromChild', id: message.id, packet: message.packet }, { frameId: parentFrames[key] })
      .catch(() => {});
  } else if (message.action === 'slapped') {
    (slapHistory[tabId] ??= []).push(sender.frameId);
    persist();
  } else if (message.action === 'unslap') {
    const frameId = slapHistory[tabId]?.pop();
    if (frameId === undefined) return {};
    persist();
    chrome.tabs.sendMessage(tabId, { action: 'unslap' }, { frameId }).catch(() => {});
  }
  return {};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return false;
  restored.then(() => sendResponse(handle(message, sender)));
  return true;
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
