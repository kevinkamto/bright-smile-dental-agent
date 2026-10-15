// Records the demo videos for the report, against a local instance of the app.
//
// Not part of the product. Input is real: the Windows cursor travels, the real
// mouse button clicks, the real keyboard types and the real wheel scrolls (see
// lib/os-input.mjs). So the recording is a real screen capture too (ffmpeg
// gdigrab with the cursor drawn), not Playwright's renderer capture, which
// never shows the pointer. It takes over the mouse and keyboard while it runs:
// leave the machine alone until it prints "Done".
//
// One maximized browser window for the whole run, so no new window flashes
// on camera. Between videos, off camera, the session is reset: cookies cleared
// (the dashboard starts signed out) and sessionStorage cleared (the chat starts
// a new conversation).
//
// Videos play IN ORDER against one backend: Video 4 (the dashboard) opens the
// requests that Videos 2 and 3 captured through the chat and the form.
//
//   node run.mjs                 dry run, nothing written, every check still runs
//   node run.mjs --record        writes reports/videos/video-<n>-<slug>.mp4
//   node run.mjs --only=1,4      a subset (Video 4 expects Video 3 first)

import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FRONTEND_ORIGIN } from "./lib/app.mjs";
import { playBeats, TakeFailed } from "./lib/beats.mjs";
import { calibrate, pause, useInput } from "./lib/human.mjs";
import { OsInput } from "./lib/os-input.mjs";
import { installOverlay, setCaption } from "./lib/overlay.mjs";
import { ScreenRecorder } from "./lib/screen-recorder.mjs";

import video1 from "./scenarios/video1.mjs";
import video2 from "./scenarios/video2.mjs";
import video3 from "./scenarios/video3.mjs";
import video4 from "./scenarios/video4.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(HERE, "../../reports/videos");

const VIDEOS = [
  { number: 1, slug: "answers-from-the-knowledge-base", beats: video1 },
  { number: 2, slug: "safety-first", beats: video2 },
  { number: 3, slug: "a-request-captured-in-the-chat", beats: video3 },
  { number: 4, slug: "the-front-desk-dashboard", beats: video4 },
];

const RECORD = process.argv.includes("--record");
const ONLY = (() => {
  const flag = process.argv.find((arg) => arg.startsWith("--only="));
  return flag ? new Set(flag.split("=")[1].split(",").map(Number)) : null;
})();

const STAFF_PASSWORD = process.env.RECORDING_STAFF_PASSWORD;
if (!STAFF_PASSWORD) {
  console.error("Set RECORDING_STAFF_PASSWORD to the password the backend's STAFF_PASSWORD_HASH was made from.");
  process.exit(1);
}

/** Off camera: a signed-out browser with no chat in progress. */
async function resetSession(context, page) {
  await context.clearCookies();
  await page.goto(`${FRONTEND_ORIGIN}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${FRONTEND_ORIGIN}/`, { waitUntil: "networkidle" });
}

async function main() {
  if (RECORD) await mkdir(OUTPUT_DIR, { recursive: true });

  const input = new OsInput();
  await input.start();
  useInput(input);

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized", "--window-position=0,0", "--disable-infobars", "--hide-crash-restore-bubble"],
  });
  const context = await browser.newContext({
    viewport: null,
    colorScheme: "light",
    timezoneId: "America/New_York",
  });
  context.setDefaultTimeout(30000);
  await installOverlay(context);
  const page = await context.newPage();

  // Maximized, not fullscreen: the address bar and the Windows taskbar stay in
  // frame, so the video reads as an ordinary browser on an ordinary desktop.
  // calibrate() measures where the page sits inside the window frame.
  // --start-maximized alone does not stick once Playwright applies its own
  // window bounds, so the state is set again over CDP.
  const session = await context.newCDPSession(page);
  const { windowId } = await session.send("Browser.getWindowForTarget");
  await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "maximized" } });
  await pause(1200);

  console.log("Warming up...");
  for (const route of ["/", "/dashboard/login"]) {
    await page.goto(`${FRONTEND_ORIGIN}${route}`, { waitUntil: "networkidle" });
  }
  const health = await page.request.get(`${FRONTEND_ORIGIN}/api/health`);
  if (!health.ok()) throw new Error(`Backend is not healthy through the proxy: ${health.status()}`);

  // Real input goes to the foreground window, so the browser has to own it
  // before anything is calibrated or clicked.
  await input.focus();
  await calibrate(page);

  const state = { staffPassword: STAFF_PASSWORD };

  try {
    for (const video of VIDEOS) {
      if (ONLY && !ONLY.has(video.number)) continue;
      console.log(`\n=== Video ${video.number}: ${video.slug} ===`);

      await resetSession(context, page);
      // Again per video: a notification or an installer can take the
      // foreground between takes, and the next click would land in it.
      await input.focus();

      const output = path.join(OUTPUT_DIR, `video-${video.number}-${video.slug}.mp4`);
      const recorder = RECORD ? new ScreenRecorder(output) : null;
      if (recorder) await recorder.start();

      let finished = false;
      try {
        await playBeats(page, video.beats, state);
        // Hold the last caption so the video does not cut on it.
        await pause(1400);
        finished = true;
      } catch (err) {
        console.error(`\n  FAILED in video ${video.number}${err instanceof TakeFailed ? " (a check failed)" : ""}`);
        console.error(`  url: ${page.url()}`);
        const body = await page.locator("body").innerText().catch(() => "(unreadable)");
        console.error(`  screen (last 800): ${body.slice(-800).replace(/\s+/g, " ")}`);
        throw err;
      } finally {
        await setCaption(page, "");
        if (recorder) await recorder.stop();
        // A failed take is deleted: half a video in reports/videos is easy to
        // mistake for a finished one.
        if (recorder && !finished) await rm(output, { force: true });
      }
      if (recorder) console.log(`  wrote ${output}`);
    }
  } finally {
    await browser.close();
    await input.stop();
  }

  // Every assistant reply the captions describe was read off the screen during
  // the take. This is the record of what the videos actually showed.
  console.log("\nRead off the screen during the run:");
  for (const [key, value] of Object.entries(state)) {
    if (key !== "staffPassword" && typeof value === "string") console.log(`  ${key}: ${value}`);
  }
  console.log("\nDone.", RECORD ? `Videos written to ${OUTPUT_DIR}` : "(dry run, nothing recorded)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
