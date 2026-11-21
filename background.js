import { DEFAULTS, HANDS, INKS, SIZES, STYLES, normalize } from './shared/catalog.js';

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

const MAX_FRAMES_PER_TAB = 128;
const MAX_SLAPS_PER_TAB = 100;

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await restored;
  delete parentFrames[tabId];
  delete slapHistory[tabId];
  persist();
});

function claimFrame({ id, replaces }, tabId, frameId) {
  const frames = (parentFrames[tabId] ??= {});
  if (frames[replaces] === frameId) delete frames[replaces];
  if (!(id in frames)) {
    const ids = Object.keys(frames);
    if (ids.length >= MAX_FRAMES_PER_TAB) delete frames[ids[0]];
    frames[id] = frameId;
  }
  persist();
}

async function assetData(file) {
  if (!/^(hands\/[\w-]+\.png|sounds\/tap_[\w-]+\.wav)$/.test(file)) return null;
  const bytes = new Uint8Array(await (await fetch(file)).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function handle(message, sender) {
  const tabId = sender.tab.id;
  if (message.action === 'settings') {
    return { settings: normalize(await chrome.storage.local.get(DEFAULTS)), catalog: { HANDS, INKS, SIZES, STYLES } };
  } else if (message.action === 'asset') {
    return { data: await assetData(message.file) };
  } else if (message.action === 'setCursorCss') {
    setCursorCss(message, sender);
  } else if (message.action === 'claimFrame') {
    claimFrame(message, tabId, sender.frameId);
  } else if (message.action === 'toParent') {
    const frameId = parentFrames[tabId]?.[message.id];
    if (frameId === undefined) return { unknown: true };
    const reply = await chrome.tabs.sendMessage(tabId, { action: 'fromChild', id: message.id, packet: message.packet }, { frameId })
      .catch(() => null);
    return reply ?? {};
  } else if (message.action === 'slapped') {
    const history = (slapHistory[tabId] ??= []);
    history.push(sender.frameId);
    if (history.length > MAX_SLAPS_PER_TAB) history.shift();
    persist();
  } else if (message.action === 'unslap') {
    const frameId = slapHistory[tabId]?.pop() ?? sender.frameId;
    persist();
    chrome.tabs.sendMessage(tabId, { action: 'unslap' }, { frameId }).catch(() => {});
  }
  return {};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return false;
  restored.then(() => handle(message, sender)).then(sendResponse, () => sendResponse(null));
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
