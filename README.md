# TinyHand for Chrome

TinyHand's tiny hand on a stick, reaching up from the bottom of the window to
your pointer in Chrome and other Chromium browsers, with its tap sounds. A port of the cursor part of
[TinyHand](https://github.com/nilbuild/tinyhand), the Mac app by Kamran Ahmed.

- 36 hands and the laser dot. Cursor glove is the default.
- A tap on every click: the hand dips and its shadow tucks in, and the tap
  sound plays. 15 sounds, or off.
- Size (TinyHand's 10%, 13% or 17% of the screen height), shadow, and per-site
  off switches in the popup and on the Settings page.
- Slap things off the page, like VisBug's delete: hold ⌥ to outline what the
  hand is over, ⌥-click to slap it away. ⌥Z puts the last one back; a reload
  brings everything back. The page never sees the click.
- Shortcuts: ⌥⇧H turns the hand on or off, ⌥⇧T turns the tap sound on or off.

## Load it

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click "Load unpacked" and choose this folder.

There is no build step.

## How it works

The content script hides the real cursor in every frame with a user-origin
stylesheet (`cursor: none`), so a site's own `cursor` rules can't win, and
adopts the same rule into shadow roots. In the top frame it draws the hand on
a full-window canvas: the stick is held below the bottom edge and to the right
of the pointer, trails it as it moves, and the hand turns so its fingertip lands
on the pointer. These are the numbers from TinyHand's `ArmView.swift`. Frames
pass the pointer up to their parent with `postMessage`, so the hand follows it
into iframes.

The canvas sits in a closed shadow root on a manual popover, so it stays in the
top layer above dialogs and fullscreen elements, with `pointer-events: none` so
clicks reach the page.

## Differences from the Mac app

- Clicks still click. In TinyHand a click is only a tap.
- Slap to remove is new; TinyHand has nothing like it.
- No drawing, no toolbar, no custom hands.
- The hand only shows inside web pages, not over the browser's own UI or on
  pages extensions can't run on (`chrome://` pages, the Web Store).

## Test

`test/` has a calendar-like fixture with shadow roots, iframes and a head
rewrite (from Purrsor). `tools/smoke.mjs` loads the extension headlessly,
checks that every fixture case hides the cursor, and screenshots the hand to
`out/`:

```sh
python3 -m http.server 8741 --bind 127.0.0.1 -d test &
python3 -m http.server 8742 --bind 127.0.0.1 -d test &
node tools/smoke.mjs
```

## License

MIT. The hands and sounds are TinyHand's, MIT, © 2026 Kamran Ahmed. See
[LICENSE](LICENSE).
