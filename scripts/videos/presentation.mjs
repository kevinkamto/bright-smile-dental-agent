// Records the project presentation: a walkthrough of the project report in a
// maximized VS Code window, navigating the project files it describes, made to
// look like an ordinary manual screen recording with subtitles.
//
// Not part of the product. Like run.mjs, input is real (cursor, buttons, keys,
// wheel) and the recording is a screen capture with the real cursor drawn. VS
// Code is a separate instance with a throwaway profile (lib/vscode.mjs), so the
// user's own editor is never on camera or typed into. It takes over the mouse
// and keyboard while it runs: leave the machine alone until it prints "Done".
//
// Needs no backend, database or API key: it only reads the repository.
//
//   node presentation.mjs            dry run, nothing written
//   node presentation.mjs --record   writes reports/videos/presentation-project-walkthrough.mp4

import { mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { playBeats } from "./lib/beats.mjs";
import { calibrate, pause, useInput } from "./lib/human.mjs";
import { OsInput } from "./lib/os-input.mjs";
import { installOverlayIn, setCaption } from "./lib/overlay.mjs";
import { ScreenRecorder } from "./lib/screen-recorder.mjs";
import {
  closeVsCode,
  launchVsCode,
  maximize,
  TITLE_MARKER,
  useVsCodeInput,
} from "./lib/vscode.mjs";
import allBeats from "./scenarios/presentation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(HERE, "../../reports/videos/presentation-project-walkthrough.mp4");
// Recorded outside the repository and moved in at the end: the walkthrough
// opens reports/videos on camera, and a half-written file would be in the tree.
const SCRATCH_OUTPUT = path.join(os.tmpdir(), "bright-smile-presentation.mp4");

const RECORD = process.argv.includes("--record");
// --until=<n>: a dry run of the first n beats only, to rehearse one stretch.
const UNTIL = Number(process.argv.find((arg) => arg.startsWith("--until="))?.split("=")[1]) || Infinity;
const beats = allBeats.slice(0, UNTIL);

// The only thing drawn on screen is the caption, styled as a subtitle over
// the editor area (clear of the explorer and the status bar). The click ring
// the demo videos use is hidden: this one should look like a plain recording.
const VSCODE_CAPTION_CSS = `
  #__rec_caption__ {
    left: calc(50% + 150px); bottom: 40px; transform: translateX(-50%);
    width: max-content; max-width: min(1200px, calc(100vw - 420px));
    background: rgba(0, 0, 0, 0.78); color: #ffffff; text-align: center;
    font-size: 24px; line-height: 1.4; padding: 10px 20px; border-radius: 6px; box-shadow: none;
  }
  #__rec_ring__ { display: none !important; }
`;

async function main() {
  const input = new OsInput();
  await input.start();
  useInput(input);
  useVsCodeInput(input);

  console.log("Starting VS Code...");
  const vscode = await launchVsCode();
  const { page } = vscode;
  let recorder = null;
  let finished = false;

  try {
    await maximize(page);
    // Real input goes to the foreground window, so VS Code has to own it
    // before anything is calibrated, clicked or typed.
    await input.focusTitle(TITLE_MARKER);
    // The maximize animation can still be moving the page under the first
    // calibration sample; settle, and measure again if the two disagree.
    await pause(1500);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await calibrate(page);
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        await pause(1000);
      }
    }
    await installOverlayIn(page, VSCODE_CAPTION_CSS);

    // Off camera: nothing open yet. The report is opened on camera.
    await pause(1500);

    if (RECORD) {
      await mkdir(path.dirname(OUTPUT), { recursive: true });
      recorder = new ScreenRecorder(SCRATCH_OUTPUT);
      await recorder.start();
    }
    await playBeats(page, beats, {});
    await pause(1400);
    finished = true;
  } finally {
    await setCaption(page, "").catch(() => {});
    if (recorder) await recorder.stop().catch((err) => console.error(err));
    await closeVsCode(vscode);
    await input.stop();
    if (recorder) {
      // A failed take is deleted: half a video is easy to mistake for a finished one.
      if (finished) {
        await rm(OUTPUT, { force: true });
        await rename(SCRATCH_OUTPUT, OUTPUT).catch(async () => {
          // Across drives rename fails; fall back to copy and delete.
          const { copyFile } = await import("node:fs/promises");
          await copyFile(SCRATCH_OUTPUT, OUTPUT);
          await rm(SCRATCH_OUTPUT, { force: true });
        });
      } else {
        await rm(SCRATCH_OUTPUT, { force: true });
      }
    }
  }

  console.log("\nDone.", RECORD ? `Video written to ${OUTPUT}` : "(dry run, nothing recorded)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
