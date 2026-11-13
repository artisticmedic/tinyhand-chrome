// The hands, sounds and defaults. Hand art, fingertip and wrist points and
// stick colours come from TinyHand's site pointer (docs/pointer.js in
// github.com/nilbuild/tinyhand, MIT, © 2026 Kamran Ahmed). Points are in the
// pixels of each 380px-tall image in hands/.

export const HANDS = [
  { id: 'lavender', name: 'Lavender toy', w: 257, h: 380, tip: [95.3, 12.0], wrist: [127.8, 368.6], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'glove', name: 'Cursor glove', w: 254, h: 380, tip: [93.9, 12.3], wrist: [128.3, 368.3], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'coral', name: 'Coral vinyl', w: 317, h: 380, tip: [100.6, 11.4], wrist: [153.9, 369.2], stick: ['#ffffff', '#e7e3df', '#c9c3bd'] },
  { id: 'plush', name: 'Plush', w: 303, h: 380, tip: [106.4, 11.0], wrist: [142.3, 369.6], stick: ['#f1dcb6', '#d6b383', '#a9824f'] },
  { id: 'robot', name: 'Robot', w: 345, h: 380, tip: [116.1, 11.8], wrist: [181.3, 368.8], stick: ['#e2e5e8', '#b6bbc1', '#7d838a'] },
  { id: 'pink', name: 'Bubblegum', w: 245, h: 380, tip: [87.8, 12.4], wrist: [122.5, 368.2], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'blue', name: 'Sky', w: 251, h: 380, tip: [90.4, 12.4], wrist: [125.7, 368.2], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'mint', name: 'Mint', w: 255, h: 380, tip: [94.5, 12.3], wrist: [128.6, 368.3], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'lemon', name: 'Lemon', w: 251, h: 380, tip: [92.1, 12.3], wrist: [125.5, 368.3], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'black', name: 'Midnight', w: 244, h: 380, tip: [81.1, 12.3], wrist: [121.9, 368.3], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'chrome', name: 'Chrome', w: 251, h: 380, tip: [87.2, 12.3], wrist: [124.1, 368.4], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'holo', name: 'Holo', w: 239, h: 380, tip: [85.5, 12.6], wrist: [116.4, 368.1], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'fuzzy', name: 'Fuzzy', w: 255, h: 380, tip: [93.9, 12.3], wrist: [128.7, 368.4], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'wood', name: 'Wood', w: 250, h: 380, tip: [92.7, 12.2], wrist: [127.2, 368.4], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'marble', name: 'Marble', w: 253, h: 380, tip: [89.8, 12.4], wrist: [127.4, 368.2], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'terrazzo', name: 'Terrazzo', w: 254, h: 380, tip: [89.1, 12.5], wrist: [123.4, 368.1], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'glass', name: 'Glass', w: 251, h: 380, tip: [88.3, 12.8], wrist: [128.6, 367.9], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'jelly', name: 'Jelly', w: 247, h: 380, tip: [88.4, 12.8], wrist: [121.1, 367.9], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'pastel', name: 'Pastel', w: 252, h: 380, tip: [91.9, 12.3], wrist: [127.9, 368.3], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'pixel', name: 'Pixel', w: 261, h: 380, tip: [105.7, 11.6], wrist: [131.0, 369.0], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'lowpoly', name: 'Low poly', w: 251, h: 380, tip: [89.3, 12.3], wrist: [125.3, 368.3], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'knit', name: 'Knit', w: 243, h: 380, tip: [89.0, 12.6], wrist: [117.2, 368.1], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'skeleton', name: 'Skeleton', w: 241, h: 380, tip: [84.8, 13.6], wrist: [123.1, 367.1], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'astro', name: 'Astronaut', w: 241, h: 380, tip: [88.9, 12.0], wrist: [121.3, 368.7], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'space', name: 'Space', w: 246, h: 380, tip: [86.8, 12.3], wrist: [122.6, 368.4], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'monster', name: 'Monster', w: 255, h: 380, tip: [96.5, 11.5], wrist: [122.8, 369.1], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'water', name: 'Water', w: 251, h: 380, tip: [89.3, 12.7], wrist: [128.5, 368.0], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'lava', name: 'Lava', w: 249, h: 380, tip: [86.0, 12.7], wrist: [122.7, 368.0], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'grass', name: 'Grass', w: 247, h: 380, tip: [88.9, 11.9], wrist: [123.0, 368.7], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'cactus', name: 'Cactus', w: 225, h: 380, tip: [89.4, 12.6], wrist: [119.6, 368.0], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'choco', name: 'Chocolate', w: 243, h: 380, tip: [86.7, 12.4], wrist: [119.7, 368.2], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'cloud', name: 'Cloud', w: 255, h: 380, tip: [90.6, 12.3], wrist: [127.3, 368.3], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'mech', name: 'Mech', w: 260, h: 380, tip: [70.2, 5.3], wrist: [140.1, 372.1], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'neon', name: 'Neon', w: 249, h: 380, tip: [79.9, 5.3], wrist: [129.8, 372.1], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'leaf', name: 'Leaf', w: 242, h: 380, tip: [66.3, 5.3], wrist: [129.0, 372.1], stick: ['#3a3a3e', '#121214', '#000000'] },
  { id: 'cookie', name: 'Gingerbread', w: 249, h: 380, tip: [70.6, 5.3], wrist: [128.3, 372.1], stick: ['#3a3a3e', '#121214', '#000000'] },
];

export const LASER = { id: 'laser', name: 'Laser dot' };

export const STYLES = [...HANDS, LASER];

// TinyHand's own toolbar defaults. The popup lists these first.
export const PINNED = ['glove', 'lavender', 'coral', 'plush', 'robot', 'laser'];

export const SOUNDS = [
  { id: 'thock', name: 'Thock' },
  { id: 'click', name: 'Click' },
  { id: 'tock', name: 'Tock' },
  { id: 'clack', name: 'Clack' },
  { id: 'typewriter', name: 'Typewriter' },
  { id: 'snap', name: 'Snap' },
  { id: 'wood', name: 'Wood block' },
  { id: 'pop', name: 'Pop' },
  { id: 'boop', name: 'Boop' },
  { id: 'blip', name: 'Blip' },
  { id: 'coin', name: 'Coin' },
  { id: 'pew', name: 'Pew' },
  { id: 'squeak', name: 'Squeak' },
  { id: 'quack', name: 'Quack' },
  { id: 'chirp', name: 'Chirp' },
];

// Hand length, fingertip to wrist, as a fraction of the screen height, like
// TinyHand's size slider (0.08 to 0.20, default 0.13).
export const SIZES = [
  { id: 'small', name: 'Small', frac: 0.10 },
  { id: 'medium', name: 'Medium', frac: 0.13 },
  { id: 'large', name: 'Large', frac: 0.17 },
];

// Tim's TinyHand settings: glove, click, shadow on, hand taps on, laser quiet.
export const DEFAULTS = {
  enabled: true,
  style: 'glove',
  size: 'medium',
  shadow: true,
  sound: 'click',
  handSound: true,
  laserSound: false,
  disabledSites: [],
};

export const SETTING_KEYS = Object.keys(DEFAULTS);
