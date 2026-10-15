// Node side of input-server.ps1: the real Windows cursor, buttons, wheel and
// keyboard.
//
// One long-lived PowerShell process rather than one per action: a click is
// about twenty cursor moves, and a process start per move would make the
// motion stutter on camera.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "input-server.ps1");

export class OsInput {
  constructor() {
    this.proc = null;
    this.queue = [];
    this.buffer = "";
  }

  async start() {
    this.proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.setEncoding("utf-8");
    this.proc.stdout.on("data", (chunk) => this._onData(chunk));
    this.proc.stderr.setEncoding("utf-8");
    this.proc.stderr.on("data", (chunk) => process.stderr.write(`[input-server] ${chunk}`));
    this.proc.on("exit", (code) => {
      const err = new Error(`input server exited with code ${code}`);
      while (this.queue.length) this.queue.shift().reject(err);
    });
    // Add-Type compiles the P/Invoke shim on first use; absorb that here,
    // not in the first click on camera.
    await this.send("PING");
  }

  _onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line === "") continue;
      const pending = this.queue.shift();
      if (!pending) continue;
      if (line.startsWith("ERR")) pending.reject(new Error(`input server: ${line}`));
      else pending.resolve(line);
    }
  }

  send(command) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.proc.stdin.write(`${command}\n`);
    });
  }

  moveTo(x, y) {
    return this.send(`MOVE ${Math.round(x)} ${Math.round(y)}`);
  }

  /** Real input goes to whichever window is foreground, not to the one
   * Playwright has a handle on. Call this before any beat that types or clicks. */
  focus() {
    return this.send("FOCUS");
  }

  async click() {
    await this.send("DOWN");
    await new Promise((r) => setTimeout(r, 45 + Math.random() * 55));
    await this.send("UP");
  }

  wheel(downPixels) {
    return this.send(`WHEEL ${Math.round(downPixels)}`);
  }

  type(text) {
    return this.send(`TYPE ${Buffer.from(text, "utf-8").toString("base64")}`);
  }

  key(name) {
    return this.send(`KEY ${name}`);
  }

  /** A key with modifiers, written as it reads: "CTRL+SHIFT+V", "SHIFT+DOWN". */
  chord(keys) {
    return this.send(`CHORD ${keys}`);
  }

  /** Maximize the window whose title contains `marker`. */
  maximizeTitle(marker) {
    return this.send(`MAXTITLE ${Buffer.from(marker, "utf-8").toString("base64")}`);
  }

  /** Bring the window whose title contains `marker` to the foreground. */
  focusTitle(marker) {
    return this.send(`FOCUSTITLE ${Buffer.from(marker, "utf-8").toString("base64")}`);
  }

  async stop() {
    if (!this.proc) return;
    this.proc.stdin.end();
    await new Promise((resolve) => this.proc.on("exit", resolve));
    this.proc = null;
  }
}
