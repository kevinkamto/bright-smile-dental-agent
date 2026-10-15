// One ffmpeg screen capture of the whole desktop, with the real cursor drawn.
// Shared by run.mjs (the demo videos) and presentation.mjs (the walkthrough).

import { spawn } from "node:child_process";

import { pause } from "./human.mjs";

// gdigrab grabs the whole desktop at whatever size it is; the result is scaled
// to fit 1920x1080 and padded, so a 16:10 screen is never stretched.
const OUTPUT = { width: 1920, height: 1080 };
const SCALE_TO_OUTPUT =
  `scale=${OUTPUT.width}:${OUTPUT.height}:force_original_aspect_ratio=decrease,` +
  `pad=${OUTPUT.width}:${OUTPUT.height}:(ow-iw)/2:(oh-ih)/2:color=black`;

export class ScreenRecorder {
  constructor(outputPath) {
    this.outputPath = outputPath;
    this.proc = null;
    this.stderr = "";
  }

  async start() {
    this.proc = spawn(
      "ffmpeg",
      ["-y", "-f", "gdigrab", "-framerate", "30", "-draw_mouse", "1", "-i", "desktop", "-vf", SCALE_TO_OUTPUT,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", this.outputPath],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    this.proc.stderr.setEncoding("utf-8");
    this.proc.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-4000);
    });
    this.exited = new Promise((resolve) => this.proc.on("exit", resolve));
    // Let the encoder settle so the first beat is not clipped.
    await pause(1200);
  }

  async stop() {
    if (!this.proc) return;
    // 'q' finalizes the MP4. Killing ffmpeg instead leaves a file with no moov box.
    this.proc.stdin.write("q");
    const code = await this.exited;
    this.proc = null;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}:\n${this.stderr.slice(-1500)}`);
  }
}
