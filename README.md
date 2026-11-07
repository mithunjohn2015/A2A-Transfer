# LocalDrop

Offline file transfer between Android and iPhone, in both directions, as an installable web app (PWA).
No internet, no cables, no account, no server in the middle.

The two phones connect directly over a shared Wi-Fi network or a phone hotspot. The connection is set up
inside the app by scanning QR codes, then files flow phone to phone.

## Using it

1. Put both phones on the same network: turn on a hotspot on either phone and join it with the other,
   or use any Wi-Fi. The network does not need internet access.
2. **Android:** open LocalDrop, tap **Send** and allow the camera. A QR code appears.
3. **iPhone**, either way works:
   - **Camera app (most reliable):** tap **Receive**, leave the app, open the normal Camera app, point it at
     the code and tap the link. Safari opens LocalDrop; tap **Connect** and allow the camera.
   - **In-app scanner:** tap **Receive**, then "Try the in-app scanner instead", and scan the code.
   - If scanning struggles, use **Scan from photo instead**, or on the Android tap
     "Switch to compact code" (bigger squares, no link) and keep the screen brightness around 60–70%.
4. The iPhone now shows its own QR code. On the Android tap **Next** and scan it.
5. Both phones show **Connected**. Either phone can tap **Send files**. On the receiving phone tap **Save**
   (or **Share**, then Save to Files / Photos on iPhone).

Roles only matter for connecting: the phone that taps **Send** first just creates the connection. Files go
both ways afterwards. Between two phones of the same kind the same steps work with the in-app scanner.

The first file sent on a connection runs a short speed test that picks the best number of parallel channels
automatically (1 to 8). The result appears in the file list.

## Installing (one time, needs internet once)

The app must be served over **HTTPS** (browsers only allow the camera and offline use on secure origins).
Any static host works, for example GitHub Pages: upload the contents of `app/` as-is (flat, no subfolders).
Then open the URL on each phone with internet once:

- **Android (Chrome):** menu, then *Install app* / *Add to Home screen*.
- **iPhone (Safari):** the `≡` menu at the left of the address bar, then Share, then *Add to Home Screen*
  (under *View More* if you don't see it). It must be Safari, in a normal (not Private) tab.

After that the app works fully offline.

## Updating

- Upload the changed files to the host. Bump `CACHE` in `app/sw.js` and `APP_VERSION` in `app/app.js`
  (keep them in step) so phones notice.
- Since version 12 the app loads fresh files first and uses its saved copy only when the network does not
  answer within about 2.5 s, so phones update themselves the next time they open the app **with internet**.
  GitHub Pages may need a few minutes to deploy, and a phone may need one or two reloads.
- The version is shown at the bottom of the home screen. **Both phones should show the same version.**
  When connected, each phone tells the other its version and shows a red warning if they differ.
- A phone stuck on an old version (before 12) cannot update itself: delete the Home Screen icon, clear the
  site's data (Chrome: Site settings, Clear & reset; iPhone: Settings, Safari, Advanced, Website Data),
  then reopen the page online and install again.

## How it works

- **Connection:** WebRTC data channels with no STUN/TURN servers, using only local-network addresses.
  Instead of a signaling server the phones exchange the handshake as QR codes (`app/signal.js` packs it
  into about 100 characters, IPv4 and LAN addresses only). The host's code is a link
  (`…/#LD2…`) so the iPhone Camera app can open it; the other phone's reply is a bare code.
  Camera permission is requested before the connection is created because browsers only reveal real LAN
  addresses once it is granted.
- **Transfer:** one control channel (JSON) plus up to 8 data channels. Files are cut into 1 MB blocks; each
  block travels on one channel as 64 KB frames tagged with the block index, so blocks can arrive in any
  order. The receiver acknowledges each file. If extra channels are unavailable it uses the control channel
  alone.
- **Receiving large files:** data is streamed to the browser's private on-disk storage (OPFS) instead of RAM
  when supported, with an in-memory fallback.
- **Dropped connections:** a short network blip (for example the file picker backgrounding the app) gets 10 s
  to recover. Real disconnects say why on the home screen.
- **Files (`app/`):** `index.html` (UI), `app.js` (connection and transfer), `signal.js` (handshake
  packing), `sw.js` (service worker, network first with offline fallback), `qrcode.js` and `jsQR.js`
  (vendored QR libraries), manifest and icons.

## Status and limitations

- Verified on a real Android and iPhone: connecting by Camera app, in-app scan and photo scan, and sending a
  file. Automated checks run in headless Chromium (two browser contexts on one machine): QR round trips,
  transfers up to 600 MB with matching SHA-256, single-channel and no-disk fallbacks.
- Not yet verified on real phones: very large files on iPhone, and sustained speed on a real hotspot.
- Some hotspots/routers isolate clients from each other ("AP isolation"); the phones then cannot connect.
- If iOS Safari misbehaves with 64 KB frames, lower `CHUNK` in `app/app.js` to `16 * 1024`.
- Keep the screen on during a transfer (the app requests a wake lock where supported).
