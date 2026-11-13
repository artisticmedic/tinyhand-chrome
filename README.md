# TinyHand for Chrome

TinyHand's tiny hand on a stick as your cursor in Chrome and other Chromium
browsers, with its tap sounds. A port of the cursor part of
[TinyHand](https://github.com/nilbuild/tinyhand), the Mac app by Kamran Ahmed.

- 36 hands and the laser dot. Cursor glove is the default.
- A tap on every click: the hand dips and its shadow tucks in, and the tap
  sound plays. 15 sounds, or off.
- Size, shadow, and per-site off switches in the popup and on the Settings page.
- Shortcuts: ⌥⇧H turns the hand on or off, ⌥⇧T turns the tap sound on or off.

## Load it

1. Open `chrome://extensions` (in Dia, `dia://extensions`).
2. Turn on Developer mode.
3. Click "Load unpacked" and choose this folder.

There is no build step.

## How it works

The service worker draws the cursor images with OffscreenCanvas whenever a
setting changes (`shared/render.js`) and stores them as CSS `cursor` values.
The content script asks the service worker to insert them as a user-origin
stylesheet, so a site's own `cursor` rules can't win, and adopts the same rules
into shadow roots.

Chrome's limits shape the images:

- A cursor image can be at most 128×128 CSS px. Images are drawn at 2x and
  listed with `image-set(... 2x)`, so they count as half their pixel size and
  stay sharp on Retina screens.
- Chrome skips a cursor image that would stick out of the viewport. Each cursor
  lists the hand at full, 60% and 36% size before `auto`, so near the right and
  bottom edges the hand shrinks, and right at the edge it becomes the arrow.

The Large hand is 72 px from fingertip to wrist, leaning 24° with a fading stub
of stick and a shadow; that comes to about 87×128 px, the limit. TinyHand's own
hand is 13% of the screen height, about 128 pt on a laptop, which can't fit once
the lean and shadow are added.

## Differences from the Mac app

- The stick is a short stub that fades out, not a full stick from the bottom of
  the screen, and the lean is fixed rather than following the pointer.
- Clicks still click. In TinyHand a click is only a tap.
- No drawing, no toolbar, no custom hands.

## Test

`test/` has a calendar-like fixture with shadow roots, iframes and a head
rewrite (from Purrsor). `tools/smoke.mjs` loads the extension headlessly,
checks every fixture case, and writes a contact sheet to `out/`:

```sh
python3 -m http.server 8741 --bind 127.0.0.1 -d test &
python3 -m http.server 8742 --bind 127.0.0.1 -d test &
node tools/smoke.mjs
```

## License

MIT. The hands and sounds are TinyHand's, MIT, © 2026 Kamran Ahmed. See
[LICENSE](LICENSE).
