// Reports the cursor TinyHand leaves on every [data-case] element in this
// document, including inside the shadow roots the fixture creates. Loaded by
// every fixture page. Call tinyhandCheck() from DevTools, or press "Run checks".

// TinyHand hides the real cursor with a user-origin sheet, invisible to the
// page, so the check reads the computed cursor: every case should be `none`.
function tinyhandSignatures() {
  const idle = getComputedStyle(document.documentElement).cursor;
  return idle === 'none' ? { idle } : null;
}

function tinyhandClassify(cursor, sigs) {
  if (!sigs) return 'no tinyhand style';
  if (cursor === sigs.idle) return 'idle';
  return cursor;
}

function tinyhandCheck() {
  const sigs = tinyhandSignatures();
  const roots = [document, ...(window.fixtureShadowRoots || [])];
  const rows = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll('[data-case]')) {
      const cursor = getComputedStyle(el).cursor;
      rows.push({
        case: el.dataset.case,
        expect: el.dataset.expect || 'idle',
        got: tinyhandClassify(cursor, sigs),
      });
    }
  }
  for (const row of rows) row.pass = row.got === row.expect;
  return { frame: location.href, styleInjected: !!sigs, rows };
}

// Frames answer the parent's request with their own report.
window.addEventListener('message', (event) => {
  if (event.data === 'tinyhand-check') {
    event.source.postMessage({ tinyhandReport: tinyhandCheck() }, '*');
  }
});
