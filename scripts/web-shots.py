#!/usr/bin/env python3
"""
Web-render screenshots of the BSAH app (react-native-web via `npx expo start --web`).

Signs in through the DEVELOPMENT preview persona panel, sets the appearance,
visits each route by client-side navigation (a reload would sign the persona
out: the dev adapter keeps it in memory), waits for the network to go idle and
captures at deviceScaleFactor 2 with a "web render — not native" label band.

These are web renders only. They are NOT iOS/Android device or simulator
evidence; every PNG says so. See scripts/README.md.

Requires: Python Playwright with its preinstalled Chromium, Pillow, and the
app's node_modules. Run from mobile/:  python3 scripts/web-shots.py --help
"""
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.request
from datetime import date

MOBILE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABEL = 'web render (react-native-web, Chromium) — not native iOS/Android'
APPEARANCE_KEY = 'bsah.pref.appearance.v1'
BAND = 150  # label band height in device pixels (2x); contact-sheet.py crops it


def log(msg: str) -> None:
    print(f'[web-shots] {msg}', flush=True)


# ---------------------------------------------------------------- server ----

def server_up(port: int) -> bool:
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def start_server(port: int, timeout_s: int) -> subprocess.Popen:
    """Starts Metro for web in its own process group (so it can be stopped as a whole)."""
    env = dict(os.environ, EXPO_OFFLINE='1', BROWSER='none')
    env.pop('CI', None)  # CI=1 disables Metro's file watching; keep reloads working
    log_path = os.path.join(os.environ.get('TMPDIR', '/tmp'), f'web-shots-expo-{port}.log')
    log(f'starting `npx expo start --web --port {port}` (log: {log_path})')
    proc = subprocess.Popen(
        ['npx', 'expo', 'start', '--web', '--port', str(port)],
        cwd=MOBILE_DIR, env=env, stdin=subprocess.DEVNULL,
        stdout=open(log_path, 'w'), stderr=subprocess.STDOUT, start_new_session=True,
    )
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise SystemExit(f'expo exited early (code {proc.returncode}); see {log_path}')
        if server_up(port):
            return proc
        time.sleep(1)
    stop_server(proc)
    raise SystemExit(f'expo did not answer on port {port} within {timeout_s}s; see {log_path}')


def stop_server(proc: subprocess.Popen | None) -> None:
    if not proc or proc.poll() is not None:
        return
    log('stopping the server this run started')
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=15)
    except Exception:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except Exception:
            pass


# -------------------------------------------------------------- personas ----

def persona_ids() -> dict[str, str]:
    """Maps subject ids (syn-guardian-a) and persona ids (guardian) to the panel's persona id."""
    src = open(os.path.join(MOBILE_DIR, 'src/dev/personas.ts'), encoding='utf-8').read()
    out: dict[str, str] = {}
    for m in re.finditer(r"\{\s*id:\s*'(\w+)'.*?snapshot:\s*(?:authorized\('([^']+)'|)", src, re.S):
        pid, subject = m.group(1), m.group(2)
        out[pid] = pid
        if subject:
            out[subject] = pid
    return out


# ---------------------------------------------------------------- browser ---

class NetIdle:
    """Network idle = no in-flight request for `quiet_ms`. Metro's sockets are ignored, and a
    request open longer than LONG_LIVED_S (a dev-server long-poll, not page content) stops
    counting and is reported once, so it can never stall a run."""

    LONG_LIVED_S = 15

    def __init__(self, page):
        self.inflight: dict = {}
        self.reported: set = set()
        self.last = time.time()
        page.on('request', self._start)
        page.on('requestfinished', self._end)
        page.on('requestfailed', self._end)

    def _start(self, req):
        if req.resource_type in ('websocket', 'eventsource'):
            return
        self.inflight[req] = time.time()
        self.last = time.time()

    def _end(self, req):
        if self.inflight.pop(req, None) is not None:
            self.last = time.time()

    def _active(self) -> list:
        now = time.time()
        active = []
        for req, t0 in list(self.inflight.items()):
            if now - t0 < self.LONG_LIVED_S:
                active.append(req)
            elif req.url not in self.reported:
                self.reported.add(req.url)
                log(f'note: ignoring long-lived request {req.url[:120]}')
        return active

    def wait(self, quiet_ms: int, timeout_s: float = 60) -> None:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if not self._active() and (time.time() - self.last) * 1000 >= quiet_ms:
                return
            time.sleep(0.1)
        urls = ', '.join(sorted({r.url[:120] for r in self._active()}))
        log(f'warning: network not idle after {timeout_s}s (in flight: {urls})')


def navigate(page, path: str) -> None:
    """Client-side navigation: expo-router (React Navigation linking) follows popstate."""
    page.evaluate(
        "(p) => { window.history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate', { state: null })); }",
        path,
    )


def expand_to_content(page) -> None:
    """--full: grow the viewport to the tallest scroll container so long screens fit in one PNG."""
    h = page.evaluate(
        "() => { let best = document.documentElement.scrollHeight; document.querySelectorAll('div').forEach(d => {"
        " if (d.scrollHeight > d.clientHeight + 4) best = Math.max(best, d.scrollHeight); }); return Math.ceil(best + 140); }"
    )
    page.set_viewport_size({'width': page.viewport_size['width'], 'height': min(int(h), 16000)})


def label_png(path: str, title: str, meta: str, origin: str) -> None:
    from PIL import Image, ImageDraw, ImageFont

    def font(size: int, bold: bool):
        try:
            f = subprocess.run(['fc-match', '-f', '%{file}', 'Inter:semibold' if bold else 'Inter'], capture_output=True, text=True).stdout
            if f and os.path.exists(f):
                return ImageFont.truetype(f, size)
        except Exception:
            pass
        return ImageFont.load_default()

    im = Image.open(path).convert('RGB')
    canvas = Image.new('RGB', (im.width, im.height + BAND), (18, 9, 4))
    canvas.paste(im, (0, 0))
    d = ImageDraw.Draw(canvas)
    d.text((20, im.height + 14), f'{title} · {meta}', fill=(255, 246, 236), font=font(24, True))
    d.text((20, im.height + 56), LABEL, fill=(255, 217, 163), font=font(17, False))
    d.text((20, im.height + 90), f'{origin} · {date.today().isoformat()}', fill=(226, 205, 186), font=font(17, False))
    canvas.save(path, optimize=True)


# ------------------------------------------------------------------- main ---

def parse_pairs(values: list[str], what: str) -> list[tuple[str, str]]:
    out = []
    for v in values or []:
        if '=' not in v:
            raise SystemExit(f'--{what} expects KEY=VALUE, got {v!r}')
        k, val = v.split('=', 1)
        out.append((k.strip(), val.strip()))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--persona', required=True, help='dev persona: subject id (syn-guardian-a) or persona id (guardian)')
    ap.add_argument('--theme', default='dark', choices=['dark', 'light', 'system'], help='stored appearance preference (default dark)')
    ap.add_argument('--size', action='append', help='viewport WxH, repeatable (default 390x844)')
    ap.add_argument('--route', action='append', required=True, help='PATH=NAME, repeatable; captured in order, e.g. /family/spark=fa06-spark')
    ap.add_argument('--action', action='append', help='ROUTE_OR_NAME=TESTID: press this testID before capturing (repeatable, applied in order)')
    ap.add_argument('--wait-for', action='append', help='ROUTE_OR_NAME=TESTID: wait until this testID is visible before capturing')
    ap.add_argument('--out', required=True, help='output directory (created)')
    ap.add_argument('--port', type=int, default=8081, help='Metro web port; a running server on it is reused (default 8081)')
    ap.add_argument('--settle', type=int, default=1200, help='extra ms after network idle (images, fades); default 1200')
    ap.add_argument('--full', action='store_true', help='grow the viewport to the content height (long screens, galleries)')
    ap.add_argument('--no-band', action='store_true', help='skip the label band (not for evidence)')
    ap.add_argument('--server-timeout', type=int, default=240)
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    personas = persona_ids()
    persona = personas.get(args.persona)
    if not persona:
        raise SystemExit(f'unknown persona {args.persona!r}; known: {", ".join(sorted(personas))}')
    sizes = [tuple(int(x) for x in s.lower().split('x')) for s in (args.size or ['390x844'])]
    routes = parse_pairs(args.route, 'route')
    actions = parse_pairs(args.action, 'action')
    waits = parse_pairs(args.wait_for, 'wait-for')
    os.makedirs(args.out, exist_ok=True)

    started = None
    if server_up(args.port):
        log(f'reusing the server already running on port {args.port}')
    else:
        started = start_server(args.port, args.server_timeout)
    base = f'http://127.0.0.1:{args.port}'
    manifest_path = os.path.join(args.out, 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else []
    failures = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for (w, h) in sizes:
                ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
                ctx.add_init_script(f"try {{ localStorage.setItem('{APPEARANCE_KEY}', '{args.theme}'); }} catch (e) {{}}")
                page = ctx.new_page()
                errors: list[str] = []
                page.on('pageerror', lambda e: errors.append(str(e)[:300]))
                net = NetIdle(page)
                log(f'{w}x{h}: signing in as persona "{persona}" ({args.theme})')
                page.goto(base + '/')
                page.wait_for_selector('[data-testid="sign-in"]', timeout=180000)
                page.click(f'[data-testid="persona-{persona}"]')
                page.wait_for_function("() => !location.pathname.startsWith('/sign-in')", timeout=120000)
                net.wait(800)
                for path, name in routes:
                    try:
                        if page.evaluate('() => location.pathname') != path:
                            navigate(page, path)
                            page.wait_for_function('(p) => location.pathname === p', arg=path, timeout=30000)
                        net.wait(800)
                        for key, tid in waits:
                            if key in (path, name):
                                page.wait_for_selector(f'[data-testid="{tid}"]', timeout=60000)
                        for key, tid in actions:
                            if key in (path, name):
                                page.click(f'[data-testid="{tid}"]', timeout=30000)
                                net.wait(500)
                                time.sleep(0.4)
                        time.sleep(args.settle / 1000)
                        if args.full:
                            expand_to_content(page)
                            time.sleep(1.0)
                        fname = f'{name}-{args.theme}-{w}x{h}.png'
                        fpath = os.path.join(args.out, fname)
                        page.screenshot(path=fpath)
                        if args.full:
                            page.set_viewport_size({'width': w, 'height': h})
                        if not args.no_band:
                            label_png(fpath, name, f'{args.theme} · {w}×{h} @2x', f'persona {args.persona} · {path}')
                        manifest = [m for m in manifest if m['file'] != fname] + [
                            {'file': fname, 'name': name, 'route': path, 'persona': args.persona, 'theme': args.theme, 'size': f'{w}x{h}', 'pageErrors': errors[:]}
                        ]
                        log(f'saved {fpath}' + (f'  (page errors: {len(errors)})' if errors else ''))
                    except Exception as e:  # keep going; report at the end
                        failures += 1
                        fail = os.path.join(args.out, f'{name}-{args.theme}-{w}x{h}-FAILED.png')
                        page.screenshot(path=fail)
                        log(f'FAILED {name} at {path}: {str(e).splitlines()[0][:200]} (see {fail})')
                ctx.close()
            browser.close()
    finally:
        json.dump(manifest, open(manifest_path, 'w'), indent=1)
        stop_server(started)
    if failures:
        raise SystemExit(f'{failures} capture(s) failed')


if __name__ == '__main__':
    main()
