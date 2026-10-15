# Demo video recorder

Not part of the product. Drives a local instance of the app with real Windows
mouse and keyboard input and records the screen, so the demo videos for
[`reports/bright-smile-report.md`](../../reports/bright-smile-report.md) can be
re-made from a script instead of by hand. What each video shows, and why, is in
[`video-script.md`](video-script.md).

```
scripts/videos/
  run.mjs            orchestrator: one maximized browser, real input, screen capture
  seed.py            off-camera setup: a week of requests, through the backend's own rules
  video-script.md    the recording script the scenarios follow
  lib/
    input-server.ps1 the real cursor, buttons, wheel and keyboard (SetCursorPos, SendInput)
    os-input.mjs     Node side of the input server
    human.mjs        calibration, eased cursor paths, clicks, typing, scrolling
    overlay.mjs      the caption card and the click ring, drawn into the page
    beats.mjs        caption, action, hold; `read` and `check` for what is on screen
    app.mjs          finding the chat widget and the dashboard by role and name
  scenarios/
    video1.mjs ... video4.mjs, checks.mjs
```

Output goes to `reports/videos/`, which is git-ignored for now.

## Why real input and a screen capture

Playwright's own mouse and keyboard dispatch events straight into the page, so
the Windows cursor never moves, and its video capture records the renderer, so
no pointer is ever in frame. Here the real cursor travels to each target on an
eased path, the real button clicks, the real keyboard types and the real wheel
scrolls, and `ffmpeg gdigrab` records the whole screen with the cursor drawn.
The browser is maximized, not fullscreen, so the address bar and the taskbar
are in the video like any ordinary desktop.

It takes over the machine while it runs. Leave the mouse and keyboard alone
until it prints `Done`. Windows display scaling must be 100% (the calibration
step stops with a clear message otherwise).

## Prerequisites

- Windows, Node 20+, `ffmpeg` on `PATH`, and the local MongoDB service.
- `backend/.env` with a real `OPENAI_API_KEY`. The assistant in the videos is
  the live model, so a full run costs a few cents.

```
cd scripts/videos
npm install
npm run install-browser
```

## Running

Point the backend at a scratch database, never the development one: the seed
empties it. Use a staff password made for the recording (12 characters or
more).

```bash
# 1. A hash for the recording password
printf 'recording-demo-pass\n' | uv run --directory backend python -m bright_smile.cli hash-password --stdin

# 2. Backend on the scratch database (from backend/)
MONGODB_DB=bright_smile_recording LOG_LEVEL=WARNING STAFF_PASSWORD_HASH='<hash>' \
  uv run fastapi run src/bright_smile/main.py --port 8000

# 3. Frontend, as a production build so no dev overlay is on camera (from frontend/)
pnpm build && pnpm start

# 4. Seed, then a dry run, then the take (from the repo root, then scripts/videos)
MONGODB_DB=bright_smile_recording uv run --directory backend python ../scripts/videos/seed.py
cd scripts/videos
RECORDING_STAFF_PASSWORD=recording-demo-pass node run.mjs            # dry run, nothing written
RECORDING_STAFF_PASSWORD=recording-demo-pass node run.mjs --record   # writes reports/videos
```

`--only=1,2` plays a subset. Video 4 opens the requests Video 3 captures, so
record 3 and 4 together.

### Before every take

- **Reseed.** The seed's times are relative to the moment it runs, and Video 4
  expects exactly the requests Video 3 adds.
- **Restart the backend after a few dry runs.** The lead form allows 5
  requests an hour per IP and the limiter lives in the backend's memory. Each
  run sends one form request. Video 3 checks the form was accepted, so a run
  over the limit stops instead of filming "Too many requests".

## The presentation walkthrough

`presentation.mjs` records the project presentation: the report walked through
in a maximized VS Code window, opening the files it describes by clicking down
the explorer tree, with subtitles as the only thing added to the screen. VS Code
runs as a separate instance with a throwaway profile (`lib/vscode.mjs`), so your
own editor is never on camera. It needs no backend, database or API key.

```bash
node presentation.mjs            # dry run
node presentation.mjs --record   # writes reports/videos/presentation-project-walkthrough.mp4
```

The beats are in `scenarios/presentation.mjs`.

## Checks

The assistant is a real model, so its wording changes from take to take. Every
caption that describes a reply is backed by a `check` on the reply as it
appears on screen (`scenarios/checks.mjs`): no Saturday time stated as fact,
ER guidance first, no dosage, the implant consult never called free, the
request captured, the form accepted. A failed check stops the run and deletes
that video, so a take that broke a rule never ends up in `reports/videos`.

Real keystrokes go wherever focus really is, so `sendMessage` also confirms the
composer had focus before Enter and that the message on screen is the one
typed.

At the end, the run prints every reply and figure it read off the screen: the
record of what the videos actually showed.
