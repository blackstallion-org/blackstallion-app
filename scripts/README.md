# Web-render screenshot tools

`web-shots.py` captures app screens as **web renders**: react-native-web in headless Chromium, through `npx expo start --web`. They are **not iOS/Android device or simulator evidence**, and every PNG carries a band that says so. Use them for composition review and contact sheets. Native claims need a dev build on named hardware.

Requirements: the Python `playwright` package with its preinstalled Chromium (`PLAYWRIGHT_BROWSERS_PATH`; do not run `playwright install`), Pillow, and `mobile/node_modules`. Run the commands from `mobile/`.

## Capture

```bash
python3 scripts/web-shots.py --persona syn-guardian-a --theme dark --size 390x844 --port 8101 --out /tmp/shots \
  --route /family/progress=fa02-progress --route /family/spark=fa06-spark
```

| Option | Meaning |
|---|---|
| `--persona` | A development preview persona, given as a subject id (`syn-guardian-a`, `syn-guardian-b`, `syn-instructor`, `syn-groom`, `syn-dual`, `syn-guardian-err`) or a persona id (`guardian`, `instructor`, `unknownAccount`, …). The list is read from `src/dev/personas.ts`. Sign-in goes through the persona panel on `/sign-in`. |
| `--theme dark\|light\|system` | The stored appearance preference, set before the app boots. The default is `dark`, the espresso theme that is the app default. |
| `--size WxH` | Viewport size; repeatable. The default is `390x844`. Captures use deviceScaleFactor 2. |
| `--route PATH=NAME` | Repeatable; routes are visited in order. Navigation is client-side (`history.pushState` + `popstate`) because a reload would sign the in-memory persona out. If `PATH` is already the current path, the screen is captured as is. |
| `--action ROUTE_OR_NAME=TESTID` | Presses that `testID` before the capture, e.g. to open a sheet or dialog or press Play. Repeatable and applied in order. The key can be the route path or the shot name. |
| `--wait-for ROUTE_OR_NAME=TESTID` | Waits until that `testID` is visible before the capture. |
| `--port N` | The Metro web port (default 8081). If something already answers on it, that server is **reused** and left running. Otherwise the script starts `npx expo start --web --port N` and **stops it** at the end. Give each agent a different port so runs can go in parallel. |
| `--settle MS` | Extra wait after the network goes idle, for images and fades. Default 1200. |
| `--full` | Grows the viewport to the content height, for long screens and galleries. |
| `--no-band` | Leaves the label band off. Not for evidence. |

Each run waits for network idle: no in-flight request for 800 ms. Metro's sockets are ignored, and a request open longer than 15 s (a dev-server long-poll) stops counting and is logged. It writes `NAME-THEME-WxH.png` and merges its entries into `OUT/manifest.json`, which records route, persona, theme, size and any page errors. When a capture fails, the script saves a `…-FAILED.png` of what was on screen and exits non-zero after trying the rest.

Examples with real testIDs: press Play before the shot; capture two sizes in the light theme; and a full-height gallery capture with Reduce Transparency switched on (`--full` applies to every route in that run):

```bash
python3 scripts/web-shots.py --persona syn-guardian-a --size 390x844 --port 8101 --out /tmp/shots \
  --route /family/spark=fa06-spark --route /family/spark=fa06-spark-playing --action fa06-spark-playing=spark-primary
python3 scripts/web-shots.py --persona syn-instructor --theme light --size 390x844 --size 320x568 --port 8102 --out /tmp/shots \
  --route /field=fo01-today --route /field/session/scan=fo02-scan
python3 scripts/web-shots.py --persona syn-instructor --port 8103 --out /tmp/shots --full \
  --route /settings/gallery=gallery-rt --action gallery-rt=gallery-rt
```

## Contact sheet

```bash
python3 scripts/contact-sheet.py /tmp/shots /tmp/shots/contact-sheet.png --title "FA screens" [--cols 8]
```

It reads labels from `manifest.json` when present; otherwise it parses `NAME-THEME-WxH.png` file names. Long captures from `--full` are shown by their first screens. The sheet header carries the "web render — not native" label.

## Notes

- The routes must exist and be reachable for that persona: route guards redirect, e.g. Field routes for a guardian. A redirect makes the shot fail with a timeout on the path check.
- Development builds only: the persona panel and fixtures exist only in `__DEV__`, and only when no backend is configured (`EXPO_PUBLIC_SUPABASE_URL` unset).
- Do not use `npx expo export --platform web --dev` for this. With async routes, its route chunks collide (the same hash for every `index`), and the exported app fails with "Requiring unknown module".
- The server log for a started server goes to `$TMPDIR/web-shots-expo-PORT.log`.
