# Pose with a Flyer

Prototype of the Dayton Flyers arena photo-op kiosk. A guest scans a participant QR code (or taps to start), picks up to two athletes, and poses while those athletes walk in from the edges of the live camera. The app composites the shot, lets them drag and scale the athletes, then either hands a JPEG to a local uploader or throws the photo away.

This is a **prototype**. Rosters, headshots, athlete clips, the frame, and the “D” mark are synthetic placeholders. Do not ship it to the arena with these files.

## Run it

The Windows build is a Tauri v2 app (WebView2). On a dev machine:

```bash
npm install
npm test
npm run dev          # browser only, http://localhost:1420
npm run tauri dev    # desktop shell
```

Rust 1.90 or newer is required (`rustup default stable`). Linux desktop builds also need the WebKitGTK 4.1 development packages.

The installed app opens **windowed** at 1600×900 so it can be tried on a normal PC. Set `window.fullscreen` to `true` in the config for the kiosk display.

### Keyboard shortcuts

These are on whenever `debug.allowKeyboard` is true (the prototype default).

| Key | Action |
| --- | --- |
| `S` | On the attract screen, simulate a QR scan (or touch-to-start when `start.mode` is `touch`) |
| `Enter` | Primary button: Let's Go, All Done, or Send |
| `1`–`9` | Toggle that headshot on the pick screen |
| `Esc` | Reset to the attract loop and clear the session |
| `Backspace` | Go back |
| `N` | Skip the countdown and capture immediately. This works even when the camera or athlete clips are not ready |
| Arrow keys | Nudge the selected athlete (Shift moves further) |
| `[` / `]` | Scale the selected athlete down / up |
| `Tab` | Select the other athlete on the adjust screen |
| `F` | Toggle fullscreen |
| `F2` | Show or hide the debug overlay |

The debug overlay can also simulate a scan, force the VP9-alpha clip, and show the plus/minus buttons. A one-line hint sits on the attract screen while `debug.showHints` is true.

`?screen=attract|pick|countdown|adjust|preview|thanks` jumps to that screen for layout checks. Add `&team=womens` or `&select=1`. `?mode=touch` or `?mode=qr` overrides `start.mode` for that launch, which is how you try touch-to-start without editing the config.

## What a guest does

1. **Attract.** The loop plays under the “Pose with a Flyer” panel. In `qr` mode the side-camera well scans for an `http` or `https` URL and stores it as the participant URL. In `touch` mode the QR card is replaced by a full-screen **TOUCH TO START** control. A missing side camera blanks that well and shows `CAM-QR-01`.
2. **Pick players.** Up to two athletes. Men's roster is the default. **SWAP TEAM** switches to women's and clears the selection, so the two teams are not mixed. **LET'S GO!** enables after one pick.
3. **Countdown.** 10 down to 1. “LOCK IN THAT POSE” reveals one word per second. At 6 the selected clips start. One athlete uses `athletes.singleSelectionSide` (`left`, `right`, or `random`). Two athletes put the first pick on the left and the second on the right. The last frame is held for `timing.freezeBeforeCaptureMs` (2 seconds) before the flash.
4. **Adjust.** Tap an athlete (Chapel Blue outline), drag to move, pinch to scale. Plus and minus buttons follow `features.plusMinusButtons` (on in this prototype so a mouse can resize; turn them off on the real touchscreen). **TRY AGAIN** reshoots. **ALL DONE!** continues. **RESET** returns to attract.
5. **Preview.** Branded frame over the composite. **TRY AGAIN**, **SEND!**, or **START OVER**. A fire clip is loaded on this screen and kept hidden, matching the approved layout.
6. **Thank you.** Returns to attract after `idle.thankYouAutoReturnSeconds` (8). The “your photo will be emailed” lines are hidden in touch mode.

Idle timeouts do not run during the countdown, flash, or attract loop. Pick resets after 60 seconds. Adjust and preview reset after 90. Idle and Start Over clear the stored QR URL.

There is no webcam? The photo step shows `CAM-PHOTO-01` and a stand-in guest so the rest of the flow still runs. With one webcam, that camera is the photo camera and the QR well reports the side camera as missing — use `S` to simulate the scan.

## Configure

`config/kiosk.json` is the bundled file. Comments are allowed. The app uses the first file that exists:

1. `C:\DaytonKiosk\kiosk.json`
2. `kiosk.json` next to the executable
3. `config\kiosk.json` next to the executable (this is the file the NSIS installer ships)
4. `resources\config\kiosk.json` next to the executable
5. `%APPDATA%\com.daytonflyers.posewithaflyer\kiosk.json`
6. the same paths under the Tauri resource directory (on Windows that directory is the exe folder, so this repeats 2 and 3)

Empty `assets.root` uses the first folder that exists: bundled `assets` beside the exe, `resources\assets` beside the exe, then `C:\DaytonKiosk\assets`. Set `assets.root` to an absolute folder when an operator is swapping files without reinstalling. Restart the app after editing.

## Where things live on Windows

The NSIS installer is per-user (`installMode: currentUser`). Tauri v2 puts that install in the product-name folder under Local AppData, and on Windows `resource_dir()` is the folder that contains the exe, so the bundled files sit beside `pose-with-a-flyer.exe` rather than in a nested `resources` directory.

| What | Path |
| --- | --- |
| Install directory | `%LOCALAPPDATA%\Pose with a Flyer\` |
| Executable | `%LOCALAPPDATA%\Pose with a Flyer\pose-with-a-flyer.exe` |
| Bundled assets | `%LOCALAPPDATA%\Pose with a Flyer\assets\` |
| Bundled config | `%LOCALAPPDATA%\Pose with a Flyer\config\kiosk.json` |
| Per-user config override | `%APPDATA%\com.daytonflyers.posewithaflyer\kiosk.json` |
| Machine override | `C:\DaytonKiosk\kiosk.json` and, for assets, `C:\DaytonKiosk\assets\` |
| Log file | `%LOCALAPPDATA%\com.daytonflyers.posewithaflyer\logs\kiosk.log` |

`%LOCALAPPDATA%` is `C:\Users\<you>\AppData\Local`. `%APPDATA%` is `C:\Users\<you>\AppData\Roaming`. F2 prints the config path and asset root the running process actually resolved, plus the log path. A red strip at the top of the window shows the latest error even when the debug panel is closed. The countdown clock does not wait on those files: athlete clips are fetched into memory (so a missing range request on `http://asset.localhost` cannot stall the timer) and fall back to the PNG still after a timeout.

Camera pins accept `serial`, `usbPort`, `label`, or `deviceId`. Leave them blank and the photo role uses the first real webcam. `cameras.onMissing` is `fallback` in this prototype so a single webcam still runs. On the arena PC, put each Brio's USB serial in config and set `onMissing` to `error` so a missing camera is never replaced by a guess. `list_cameras` (Windows only) returns each camera's friendly name, symbolic link, USB vendor/product, serial, and port. The browser can only see the Windows friendly name, so a one-time setup still needs to rename the two Brios (for example “Kiosk Brio Photo” and “Kiosk Brio QR”) if you pin by serial. Infrared / Windows Hello devices are flagged and ignored.

`mirrorPreview` mirrors the live view and the captured photo the same way, so the print matches what the guest saw.

## Swap assets

Everything the screens read lives under `assets/` (or whatever `assets.root` points at):

| Path | Role |
| --- | --- |
| `roster.json` | Both teams. Names, jersey numbers, headshot paths, clip paths |
| `headshots/<id>.png` | Circular portraits |
| `athletes/<id>_left.mp4` and `_right.mp4` | Stacked-alpha H.264. Color on top, alpha as brightness on the bottom, same width |
| `athletes/<id>_left.webm` | Optional VP9 with alpha. Used when the mp4 fails, or when the debug overlay prefers WebM |
| `attract/loop.mp4` | Silent loop behind the attract and pick screens |
| `frames/takeaway_v1.png` | Transparent PNG composited over the 2560×1440 JPEG |
| `fx/fire.mp4` | Hidden preview layer |
| `placeholders/guest.png` | Stand-in when the photo camera is missing |

`roster.json` `clipMeta` records `layout` (`stacked-alpha` or `vp9-alpha`) and the color-frame size. It can be omitted: a `.webm` is treated as VP9-with-alpha and any other clip as stacked-alpha, and the quad uses `videoWidth` / `videoHeight` (half the height for a stacked file). Clips in this repo are 360×640, 12 fps, 4 seconds, and are shared across the placeholder roster. Real clips should be one left and one right take per athlete, encoded at the crop size, with the last frame as the pose you want held.

Still images the compositor or the JPEG touches (the takeaway frame, posters, the guest stand-in, headshots) are fetched into memory before upload. `http://asset.localhost` is a different origin from the Tauri page, and an `<img>` pointed at it taints WebGL even when the file displays on screen.

Regenerate the placeholders with `python3 scripts/generate_assets.py` (Pillow and ffmpeg). The script draws original silhouettes. It does not copy Dayton, NCAA, or sponsor artwork.

### Fonts and marks

Headlines use [Saira Extra Condensed](https://fonts.google.com/specimen/Saira+Extra+Condensed) and body text uses Saira. The sponsor line uses Libre Baskerville. All three are SIL Open Font License; the license texts are in `licenses/`. Vitesse is not included.

The red “D”, the sponsor words, and the frame artwork are original placeholders. Drop licensed logo files in when you have them, and point the frame at the real `takeaway_v1.png`. Do not commit trademarked logos or athlete photographs to this repository while it is public.

## Uploader contract

On **Send** in QR mode the app composites the camera (or frozen frame), athlete layers, and takeaway frame into a 2560×1440 JPEG at quality 0.9 and POSTs it. Touch mode skips the request and discards the image. Network errors, timeouts, and non-2xx responses are logged and the thank-you screen still shows. The kiosk does not retry; the uploader owns the queue.

```
POST {uploader.baseUrl}{uploader.uploadPath}
Content-Type: multipart/form-data

image            photo_2560x1440.jpg   (image/jpeg)
participantUrl   the QR text, stored unchanged
sessionId        UUID minted when the session started
capturedAt       ISO 8601 timestamp
athletes         JSON array of athlete ids, e.g. ["m01","m02"]
roster           "mens" or "womens"

-> 202 Accepted
```

Any HTTP 2xx is treated as success. The default URL is `http://127.0.0.1:8765/uploads`. The URL has to be `http://` (the kiosk posts to a machine on the arena LAN). The installed app sends that POST from Rust, so the uploader does not need CORS headers. `npm run dev` uses `fetch` from the page, and the mock server below allows that.

Try it locally:

```bash
python3 scripts/mock_uploader.py --port 8765 --out ./uploads
```

Each accepted post writes `<sessionId>.jpg` and `<sessionId>.json`.

## Windows build

`.github/workflows/windows-release.yml` runs on tag pushes matching `v*` and on **Run workflow**. It tests, then builds NSIS and MSI installers with `tauri-apps/tauri-action` and attaches a portable zip of the release exe plus any resource folder. The release is a prerelease.

The NSIS installer is per-user (no admin prompt) and will offer the WebView2 bootstrapper if the runtime is missing. Windows 11 already has it.

Unsigned binaries trip SmartScreen. Choose **More info → Run anyway**. The camera permission is allowed inside the WebView; Windows may still ask the first time the app is allowed to use the camera. Say yes.

## Project layout

- `src/` — Vite + TypeScript UI, WebGL2 compositor, QR decode (zxing-wasm), session logic
- `src-tauri/` — config loading, asset paths, `list_cameras`
- `assets/`, `config/kiosk.json` — bundled content
- `src/logic.test.ts` — session, idle, camera matching, upload fields

The compositor draws at 2560×1440. DOM chrome is laid out on a 3840×2160 stage and scaled to the window. Stacked-alpha clips are recombined in a shader (color in the top half, luminance alpha in the bottom half, `UNPACK_FLIP_Y`). VP9-alpha clips are sampled as straight alpha. If WebGL2 is missing, a canvas 2D path does the same composite.

## Known gaps

- Placeholder roster, clips, headshots, frame, and attract loop. No licensed Dayton or sponsor art, and no Vitesse.
- `list_cameras` serial and port lookup is Windows-only (Media Foundation + CfgMgr32). Other platforms return an empty list and the web layer falls back to the first webcam.
- Friendly-name renaming of the two Brios is still a manual setup step. The app cannot hash a USB serial into a WebView `deviceId`.
- The uploader service does not exist yet. This repo only defines the POST above and keeps going when it is down.
- Touch-to-start has no approved Figma frame. The prototype uses a full-screen button over the attract art and hides the email lines on thank you.
- Plus/minus defaults to on so a desktop can resize. The approved kiosk config turns it off once pinch is confirmed.
- Fire video is present and hidden. It is not a real flame plate.
- No autostart, shell lockdown, or fixed-version WebView2 runtime. Those are kiosk-image steps.
- Athlete hit testing uses the clip rectangle, not the alpha silhouette.
- Output is always JPEG. `output.format` is stored for a later WebP switch.
- Coming Soon screens are not implemented.
