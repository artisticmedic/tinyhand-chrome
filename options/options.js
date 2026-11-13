import { el, fadePicker, inkPicker, readSettings, save, sizePicker, soundPicker, styleGrid, switchRow } from '../shared/controls.js';

const settings = await readSettings();

document.getElementById('reset-practice').addEventListener('click', () => location.reload());

const enabled = switchRow('Show the hand', 'enabled', settings, 'Replaces the cursor on every site.');
document.getElementById('general').append(enabled.row);

const grid = styleGrid(settings);
document.getElementById('styles').append(grid.grid);

const size = sizePicker(settings);
const shadow = switchRow('Shadow under the hand', 'shadow', settings);
document.getElementById('appearance').append(size.row, shadow.row);

const draw = switchRow('Shift-drag draws', 'draw', settings, 'Hold ⌘ as well to finish with an arrow. Esc clears the drawing.');
const ink = inkPicker(settings);
const fade = fadePicker(settings);
document.getElementById('draw').append(draw.row, ink.row, fade.row);

const slap = switchRow('Slap things off the page', 'slap', settings, 'Hold ⌥ to outline what the hand is over, ⌥-click to slap it away. ⌥Z puts the last one back; reloading brings everything back.');
document.getElementById('slap').append(slap.row);

const sound = soundPicker(settings);
const laser = switchRow('Laser dot taps too', 'laserSound', settings, 'Off by default, for quiet pointing.');
document.getElementById('sound').append(sound.row, laser.row);

const shortcuts = document.getElementById('shortcuts');
const commands = await chrome.commands.getAll();
for (const command of commands.filter((c) => c.name !== '_execute_action')) {
  const keys = command.shortcut ? el('kbd', { textContent: command.shortcut }) : el('span', { class: 'muted', textContent: 'Not set' });
  shortcuts.append(el('div', { class: 'row' }, [el('span', { class: 'row-label', textContent: command.description }), keys]));
}
shortcuts.append(el('div', { class: 'row' }, [
  el('span', { class: 'row-detail', textContent: 'Chrome lets you change these on its own shortcuts page.' }),
  el('button', { type: 'button', class: 'link', textContent: 'Change…', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }),
]));

const sites = document.getElementById('sites');
function renderSites(list) {
  sites.replaceChildren();
  if (!list.length) {
    sites.append(el('div', { class: 'row' }, [el('span', { class: 'muted', textContent: 'No sites. Turn the hand off for a site from the toolbar popup.' })]));
    return;
  }
  sites.append(el('ul', { class: 'sites' }, list.map((host) => el('li', {}, [
    el('span', { textContent: host }),
    el('button', { type: 'button', class: 'link', textContent: 'Turn back on', onclick: () => save({ disabledSites: list.filter((h) => h !== host) }) }),
  ]))));
}

function render(s) {
  enabled.input.checked = s.enabled;
  document.body.classList.toggle('off', !s.enabled);
  grid.sync(s.style);
  size.sync(s.size);
  shadow.input.checked = s.shadow;
  slap.input.checked = s.slap;
  draw.input.checked = s.draw;
  ink.sync(s);
  fade.sync(s);
  sound.sync(s);
  laser.input.checked = s.laserSound;
  laser.input.disabled = !s.handSound;
  renderSites(s.disabledSites);
}

async function refresh() {
  render(await readSettings());
}
refresh();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') refresh();
});
