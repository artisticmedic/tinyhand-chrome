// TinyHand for Chrome - content script
// Asks the service worker to insert the cursor styles into this document,
// shows the pressed hand while the left button is down, and plays the tap.
// The stylesheet, shadow-root and button-tracking approach follows Purrsor
// (github.com/lihbr/purrsor, MIT, © Lucie Haberer).

// Set on <html> while the primary mouse button is held.
const PRESSED_ATTR = 'data-tinyhand-pressed';
// A quick click still shows the tap for at least this long. TinyHand eases
// the press back out over about the same time.
const MIN_PRESS_MS = 110;

let enabled = false;
let insertedCss = null;
let sound = null; // tap sound id, or null for silent
let audioContext;
const buffers = new Map(); // sound id -> Promise<AudioBuffer>
let pressedAt = 0;
let releaseTimer = 0;

function generateCSS(idle, pressed) {
  // Every element gets the cursor directly rather than inheriting it, because
  // a site's own `cursor: pointer` on an element beats an inherited value.
  return `
/* TinyHand */
:root, :root * { cursor: ${idle} !important; }
:root[${PRESSED_ATTR}], :root[${PRESSED_ATTR}] * { cursor: ${pressed} !important; }
`;
}

// The same rules for inside shadow roots, which the document's stylesheet
// doesn't reach. :host-context() sees the pressed attribute on <html>.
function generateShadowCSS(idle, pressed) {
  return `
* { cursor: ${idle} !important; }
:host-context([${PRESSED_ATTR}]) * { cursor: ${pressed} !important; }
`;
}

function press(event) {
  if (!hold(event)) return;
  pressedAt = performance.now();
  if (sound) playTap(sound);
}

// Shows the pressed hand without the sound. Returns false when this press doesn't count.
function hold(event) {
  if (!enabled || event.pointerType === 'touch') return false;
  clearTimeout(releaseTimer);
  const root = document.documentElement;
  // Called on every move during a drag; leave pages' attribute observers quiet.
  if (!root.hasAttribute(PRESSED_ATTR)) root.setAttribute(PRESSED_ATTR, '');
  return true;
}

function release() {
  const root = document.documentElement;
  if (!root?.hasAttribute(PRESSED_ATTR)) return;
  clearTimeout(releaseTimer);
  const left = MIN_PRESS_MS - (performance.now() - pressedAt);
  if (left > 0) {
    releaseTimer = setTimeout(() => root.removeAttribute(PRESSED_ATTR), left);
  } else {
    root.removeAttribute(PRESSED_ATTR);
  }
}

function releaseNow() {
  clearTimeout(releaseTimer);
  document.documentElement?.removeAttribute(PRESSED_ATTR);
}

// The AudioContext is created inside the pointerdown handler, which carries
// user activation, so autoplay policy lets it start.
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

// While another button is held, a left press or release fires pointermove
// with button 0 instead of pointerdown or pointerup. A press or release in
// another frame never reaches this one, so any other move takes the left
// button's state from `buttons`: held means pressed, without the sound.
function track(event) {
  if (event.button === 0) {
    if (event.buttons & 1) press(event);
    else release();
  } else if (event.buttons & 1) {
    hold(event);
  } else {
    release();
  }
}

window.addEventListener('pointerdown', (event) => {
  if (event.button === 0) press(event);
}, true);
window.addEventListener('pointermove', track, true);
window.addEventListener('pointerup', release, true);
window.addEventListener('pointercancel', releaseNow, true);
window.addEventListener('dragend', releaseNow, true);
window.addEventListener('blur', releaseNow);

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
  if (el.localName.includes('-') && el instanceof HTMLElement) {
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

// Catches a shadow root attached later still, when the pointer first enters it.
window.addEventListener('pointerover', (event) => {
  if (!watchingShadowRoots) return;
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement) adoptShadowRoot(chrome.dom.openOrClosedShadowRoot(node));
  }
}, true);

async function applyCursors() {
  const { enabled: on, disabledSites, cursors } = await chrome.storage.local.get(['enabled', 'disabledSites', 'cursors']);
  const siteOff = (disabledSites || []).includes(location.hostname);

  if (on === false || siteOff || !cursors?.idle) {
    enabled = false;
    releaseNow();
    setStyles(null);
    shadowSheet.replaceSync('');
    return;
  }

  enabled = true;
  sound = cursors.sound || null;
  setStyles(generateCSS(cursors.idle, cursors.pressed));
  shadowSheet.replaceSync(generateShadowCSS(cursors.idle, cursors.pressed));
  watchShadowRoots();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.cursors || changes.enabled || changes.disabledSites)) {
    applyCursors();
  }
});

applyCursors();
