import { KEYS, handName, readSettings, save, sizePicker, soundPicker, styleGrid, switchRow } from '../shared/controls.js';

const settings = await readSettings();

const enabled = document.getElementById('enabled');
const current = document.getElementById('current');
enabled.checked = settings.enabled;
enabled.addEventListener('change', () => save({ enabled: enabled.checked }));

const grid = styleGrid(settings);
document.getElementById('styles').append(grid.grid);

const sound = soundPicker(settings);
const size = sizePicker(settings);
const shadow = switchRow('Shadow', 'shadow', settings);
const draw = switchRow('Shift-drag draws', 'draw', settings, `Hold ${KEYS.arrow} for an arrow, Esc clears`);
const slap = switchRow(`${KEYS.alt}-click slaps things off`, 'slap', settings, `${KEYS.altZ} puts the last one back`);
document.getElementById('options').append(sound.row, size.row, shadow.row, draw.row, slap.row);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const url = URL.parse(tab?.url ?? '');
const host = url && /^https?:$/.test(url.protocol) ? url.hostname : '';
const siteCard = document.getElementById('site');
if (host) {
  const siteSettings = { siteOff: settings.disabledSites.includes(host) };
  const site = switchRow(`Off on ${host}`, 'siteOff', siteSettings, null, async (off) => {
    const { disabledSites } = await chrome.storage.local.get({ disabledSites: [] });
    const next = off ? [...new Set([...disabledSites, host])] : disabledSites.filter((h) => h !== host);
    save({ disabledSites: next });
  });
  siteCard.append(site.row);
} else {
  siteCard.remove();
}

function render(s) {
  enabled.checked = s.enabled;
  document.body.classList.toggle('off', !s.enabled);
  current.textContent = s.enabled ? handName(s.style) : 'Off';
  grid.sync(s.style);
  sound.sync(s);
  size.sync(s.size);
  shadow.input.checked = s.shadow;
  draw.input.checked = s.draw;
  slap.input.checked = s.slap;
}
render(settings);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local') render(await readSettings());
});

const commands = await chrome.commands.getAll();
const toggle = commands.find((c) => c.name === 'toggle-hand')?.shortcut;
document.getElementById('shortcut').textContent = toggle ? `${toggle} turns the hand on or off` : '';

document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
