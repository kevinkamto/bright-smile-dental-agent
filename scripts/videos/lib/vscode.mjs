// Driving a real VS Code window for the presentation video.
//
// VS Code runs as its own instance (a throwaway profile, no extensions), so the
// recording never shows or types into the user's own editor. It is started with
// Chromium's remote debugging port, and Playwright attaches to the workbench
// over CDP. That gives the recorder what it has in the browser: where things
// are on screen (explorer rows, quick-open results, report headings inside the
// Markdown preview's webview) and a page to draw captions into. Every action on
// camera is still real input from lib/os-input.mjs: the cursor travels, the
// button clicks, keys and chords are pressed, the wheel scrolls.

import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { humanClick, hover, moveTo, pause } from "./human.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../..");

/** Always in the window title (see SETTINGS), so FOCUSTITLE finds this window
 * and never the user's own VS Code. */
export const TITLE_MARKER = "Bright Smile Dental: project presentation";

const DEFAULT_EXE = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe");
const PROFILE_DIR = path.join(os.tmpdir(), "bright-smile-presentation-vscode");

// A clean, readable editor for 1080p: larger text, nothing that pops up on its
// own, and Markdown files opened straight into the rendered preview.
const SETTINGS = {
  "workbench.startupEditor": "none",
  "security.workspace.trust.enabled": false,
  "window.title": `\${activeEditorShort}\${separator}\${rootName}\${separator}${TITLE_MARKER}`,
  "window.newWindowDimensions": "maximized",
  "window.restoreWindows": "none",
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.editor.enablePreview": false,
  "workbench.editorAssociations": { "*.md": "vscode.markdown.preview.editor" },
  "workbench.layoutControl.enabled": false,
  "workbench.tips.enabled": false,
  "editor.fontSize": 16,
  "editor.lineHeight": 24,
  "editor.minimap.enabled": false,
  "editor.stickyScroll.enabled": false,
  "editor.hover.enabled": "off",
  "editor.occurrencesHighlight": "off",
  "explorer.compactFolders": false,
  // Sticky folder headers are copies of tree rows; with them on, a row can be
  // "rendered" twice and the explorer search scrolls the wrong way.
  "workbench.tree.enableStickyScroll": false,
  // Quick open must not expand the tree: the explorer is opened by hand on camera.
  "explorer.autoReveal": false,
  "markdown.preview.fontSize": 16,
  "chat.disableAIFeatures": true,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.ignoreRecommendations": true,
  "git.openRepositoryInParentFolders": "never",
  // Generated and local-only folders, hidden the way most developers hide
  // them, so the tree on camera is the project's own files.
  "files.exclude": {
    "**/.ruff_cache": true,
    "**/.mypy_cache": true,
    "**/.pytest_cache": true,
    "**/__pycache__": true,
    "**/.venv": true,
    "**/node_modules": true,
    "**/.next": true,
    "**/.env": true,
  },
};

let input = null;

export function useVsCodeInput(osInput) {
  input = osInput;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 150, what = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await pause(intervalMs);
  }
}

// ---------------------------------------------------------------- lifecycle

/** Start a fresh VS Code instance on the repo and attach to its workbench. */
export async function launchVsCode({ exe = process.env.VSCODE_EXE || DEFAULT_EXE, port = 9333 } = {}) {
  await rm(PROFILE_DIR, { recursive: true, force: true });
  await mkdir(path.join(PROFILE_DIR, "user", "User"), { recursive: true });
  await mkdir(path.join(PROFILE_DIR, "extensions"), { recursive: true });
  await writeFile(path.join(PROFILE_DIR, "user", "User", "settings.json"), JSON.stringify(SETTINGS, null, 2));

  // Run from a VS Code terminal, these variables make Code.exe hand the folder
  // to the editor that owns the terminal instead of starting its own instance.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(VSCODE_|ELECTRON_)/i.test(key)),
  );
  const proc = spawn(
    exe,
    [
      "--user-data-dir", path.join(PROFILE_DIR, "user"),
      "--extensions-dir", path.join(PROFILE_DIR, "extensions"),
      `--remote-debugging-port=${port}`,
      "--new-window",
      REPO,
    ],
    { env, stdio: "ignore", windowsHide: false },
  );
  proc.on("error", (err) => console.error(`VS Code failed to start: ${err.message}`));

  // A pending VS Code update makes a new instance wait up to 30 s for the
  // installer, so this is generous.
  const endpoint = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${endpoint}/json/version`)).ok, { timeoutMs: 60000, what: "VS Code's debugging port" });
  const browser = await chromium.connectOverCDP(endpoint);
  const page = await waitFor(
    async () => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("workbench.html")),
    { timeoutMs: 60000, what: "the VS Code workbench" },
  );
  await page.locator(".explorer-folders-view .monaco-list-row").first().waitFor({ timeout: 60000 });
  return { proc, browser, page };
}

/** Maximized, not fullscreen: the title bar, menu and taskbar stay in frame.
 * Done through Windows itself: Electron's CDP has no Browser.setWindowBounds. */
export async function maximize(page) {
  await input.maximizeTitle(TITLE_MARKER);
  await waitFor(
    () => page.evaluate(() => window.innerWidth >= screen.availWidth - 20 && window.innerHeight >= screen.availHeight - 60),
    { timeoutMs: 8000, what: "a maximized VS Code window" },
  );
  await pause(800);
}

export async function closeVsCode({ proc, browser }) {
  await browser.close().catch(() => {});
  // Code.exe spawns renderers and helpers; take the whole tree down.
  if (proc?.pid) spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
}

// ---------------------------------------------------------------- keyboard

export async function chord(keys, { after = rand(160, 260) } = {}) {
  await input.chord(keys);
  await pause(after);
}

async function typeText(text) {
  await input.type(text);
  await pause(rand(250, 400));
}

// ---------------------------------------------------------------- editors

export async function activeTabLabel(page) {
  return page
    .locator(".editor-group-container.active .tab.active")
    .first()
    .getAttribute("aria-label")
    .catch(() => null);
}

async function waitForActiveTab(page, fileName) {
  await waitFor(async () => (await activeTabLabel(page))?.includes(fileName), { what: `the ${fileName} tab` });
  await pause(500);
}

/** Ctrl+P, type, wait for the file to head the list, Enter. `folder` tells
 * apart files that share a name (domain/leads.py, services/leads.py). */
export async function quickOpen(page, query, { fileName = path.basename(query), folder = "" } = {}) {
  await chord("CTRL+P");
  await page.locator(".quick-input-widget").waitFor({ state: "visible" });
  await typeText(query);
  // File search is asynchronous; Enter before the list settles opens whatever
  // was first a moment ago.
  await waitFor(
    async () => {
      const first = await page.locator(".quick-input-list .monaco-list-row").first().getAttribute("aria-label");
      return first?.startsWith(fileName) && first.includes(folder);
    },
    { what: `${fileName} in quick open` },
  );
  await pause(600);
  await input.key("ENTER");
  await waitForActiveTab(page, fileName);
}

/** Close the active editor with Ctrl+W. */
export async function closeEditor() {
  await chord("CTRL+W", { after: 500 });
}

/** The first line number rendered in the active editor. */
async function topVisibleLine(page) {
  return page.evaluate(() => {
    const editor = document.querySelector(".editor-group-container.active .monaco-editor");
    let top = null;
    for (const el of editor?.querySelectorAll(".margin-view-overlays .line-numbers") ?? []) {
      const y = parseFloat(el.parentElement.style.top || "0");
      const line = parseInt(el.textContent, 10);
      if (!Number.isNaN(line) && (top === null || y < top.y)) top = { y, line };
    }
    return top?.line ?? null;
  });
}

/** Go to `start` with Ctrl+G, scroll it near the top with Ctrl+Up/Down, then
 * select through `end` with Shift+Down, so the lines being described are
 * highlighted the way a presenter would. */
export async function showLines(page, start, end) {
  await chord("CTRL+G");
  await typeText(String(start));
  await input.key("ENTER");
  await pause(600);
  const wantTop = Math.max(1, start - 3);
  for (let i = 0; i < 60; i += 1) {
    const top = await topVisibleLine(page);
    if (top === null || top === wantTop) break;
    const before = top;
    await chord(top < wantTop ? "CTRL+DOWN" : "CTRL+UP", { after: rand(25, 45) });
    // At the end of a short file the editor cannot scroll further.
    if ((await topVisibleLine(page)) === before) break;
  }
  await pause(500);
  for (let line = start; line <= end; line += 1) {
    await chord("SHIFT+DOWN", { after: rand(30, 60) });
  }
  await pause(300);
}

/** The 1-based line of the first line in `file` (repo-relative) matching
 * `pattern`, at or after line `from`. */
export async function lineOf(file, pattern, from = 1) {
  const { readFile } = await import("node:fs/promises");
  const lines = (await readFile(path.join(REPO, file), "utf-8")).split(/\r?\n/);
  const index = lines.findIndex((line, i) => i >= from - 1 && pattern.test(line));
  if (index < 0) throw new Error(`${pattern} not found in ${file}`);
  return index + 1;
}

// ---------------------------------------------------------------- explorer

const EXPLORER_LIST = ".explorer-folders-view .monaco-list";

/** The explorer row for `name` at `level`, below the row at `afterIndex`. */
async function explorerRowIndex(page, name, level, afterIndex) {
  return page.evaluate(
    ([name, level, afterIndex]) => {
      const rows = [...document.querySelectorAll(".explorer-folders-view .monaco-list-rows > .monaco-list-row")]
        .filter((r) => r.getAttribute("aria-label") === name && r.getAttribute("aria-level") === String(level))
        .map((r) => Number(r.dataset.index))
        .filter((i) => i > afterIndex)
        .sort((a, b) => a - b);
      return rows.length ? rows[0] : null;
    },
    [name, level, afterIndex],
  );
}

/** The explorer renders only the rows near its viewport, so a row scrolled
 * far out of view is not in the DOM. Wheel toward it: up while every rendered
 * row is past where it must be (just below `afterIndex`), down otherwise. */
async function findExplorerRow(page, name, level, afterIndex, label) {
  let index = await explorerRowIndex(page, name, level, afterIndex);
  if (index !== null) return index;
  await hover(page, page.locator(EXPLORER_LIST).first());
  for (let n = 0; n < 60 && index === null; n += 1) {
    const firstRendered = await page.evaluate(() =>
      Math.min(...[...document.querySelectorAll(".explorer-folders-view .monaco-list-rows > .monaco-list-row")].map((r) => Number(r.dataset.index))),
    );
    await input.wheel(firstRendered > afterIndex + 1 ? -100 : 100);
    await pause(150);
    index = await explorerRowIndex(page, name, level, afterIndex);
  }
  if (index === null) {
    const rendered = await page.evaluate(() =>
      [...document.querySelectorAll(".explorer-folders-view .monaco-list-rows > .monaco-list-row")]
        .map((r) => `${r.dataset.index}:${r.getAttribute("aria-level")}:${r.getAttribute("aria-label")}:${r.getAttribute("aria-expanded")}`)
        .join(" "),
    );
    throw new Error(`No explorer row for ${label} (after row ${afterIndex}). Rendered: ${rendered}`);
  }
  return index;
}

/** Wheel the explorer until `row` sits inside it. */
async function wheelExplorerTo(page, row) {
  const list = page.locator(EXPLORER_LIST).first();
  const area = await list.boundingBox();
  for (let i = 0; i < 30; i += 1) {
    const box = await row.boundingBox();
    if (box && box.y > area.y + 10 && box.y + box.height < area.y + area.height - 40) return;
    if (i === 0) await hover(page, list);
    await input.wheel(!box || box.y > area.y ? 100 : -100);
    await pause(rand(120, 180));
  }
}

/** Open `relPath` by clicking down the explorer tree, folder by folder. */
export async function explorerOpen(page, relPath) {
  const segments = relPath.split("/");
  let afterIndex = -1;
  for (let i = 0; i < segments.length; i += 1) {
    const name = segments[i];
    const index = await findExplorerRow(page, name, i + 1, afterIndex, segments.slice(0, i + 1).join("/"));
    const row = page.locator(`.explorer-folders-view .monaco-list-rows > .monaco-list-row[data-index="${index}"]`);
    const isFile = i === segments.length - 1;
    if (!isFile && (await row.getAttribute("aria-expanded")) === "true") {
      afterIndex = index;
      continue;
    }
    await wheelExplorerTo(page, row);
    await humanClick(page, row.locator(".monaco-icon-label").first());
    await pause(isFile ? 200 : rand(250, 400));
    afterIndex = index;
  }
  await waitForActiveTab(page, segments.at(-1));
}

/** Expand folders without opening anything (to show what is inside). */
export async function explorerExpand(page, relPath) {
  const segments = relPath.split("/");
  let afterIndex = -1;
  for (let i = 0; i < segments.length; i += 1) {
    const index = await findExplorerRow(page, segments[i], i + 1, afterIndex, segments.slice(0, i + 1).join("/"));
    const row = page.locator(`.explorer-folders-view .monaco-list-rows > .monaco-list-row[data-index="${index}"]`);
    if ((await row.getAttribute("aria-expanded")) !== "true") {
      await wheelExplorerTo(page, row);
      await humanClick(page, row.locator(".monaco-icon-label").first());
      await pause(rand(250, 400));
    }
    afterIndex = index;
  }
}

/** Point at an explorer row (a file worth naming) without opening it. */
export function explorerRow(page, name) {
  return page.locator(`.explorer-folders-view .monaco-list-rows > .monaco-list-row[aria-label="${name}"] .monaco-icon-label`).first();
}

/** The explorer's own "Collapse Folders" action, so the tree is tidy again. */
export async function collapseExplorer(page) {
  await hover(page, page.locator(".explorer-folders-view").first());
  await humanClick(page, page.locator('.pane-header [aria-label^="Collapse Folders"]').first());
}

// ---------------------------------------------------------------- Markdown preview

/** The rendered document inside a Markdown preview, found by its title. The
 * webview is recreated when its tab is hidden and shown again, so this is
 * looked up fresh every time rather than kept. */
export async function previewFrame(page, h1Text) {
  return waitFor(
    async () => {
      for (const frame of page.frames()) {
        if (!frame.url().includes("fake.html")) continue;
        const h1 = await frame.locator("h1").first().textContent({ timeout: 500 }).catch(() => null);
        if (!h1?.includes(h1Text)) continue;
        const box = await (await frame.frameElement()).boundingBox();
        if (box && box.width > 100) return frame;
      }
      return null;
    },
    { what: `the preview of "${h1Text}"` },
  );
}

/** Wheel the preview, with the real wheel, until `locator` is `offset` pixels
 * below the preview's top edge. Feedback-driven: measure, wheel, measure. */
export async function scrollPreviewTo(page, frame, locator, { offset = 90 } = {}) {
  const area = await (await frame.frameElement()).boundingBox();
  await moveTo(area.x + area.width * rand(0.55, 0.7), area.y + area.height * rand(0.45, 0.6));
  await pause(200);
  const target = area.y + offset;
  for (let i = 0; i < 80; i += 1) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`No box for ${locator}`);
    const delta = box.y - target;
    if (Math.abs(delta) < 70) break;
    const notches = Math.max(1, Math.min(6, Math.round(Math.abs(delta) / 100)));
    for (let n = 0; n < notches; n += 1) {
      await input.wheel(Math.sign(delta) * 100);
      await pause(rand(35, 60));
    }
    // Chromium animates wheel scrolling; measure after it lands.
    await pause(320);
  }
  await pause(400);
}

/** A heading in the preview, by its text. */
export function previewHeading(frame, text) {
  return frame.locator("h1, h2, h3, h4").filter({ hasText: text }).first();
}

// The lowest the cursor rests in the preview: above the caption, and far
// enough from the taskbar that a bowed path never brushes it and opens a
// window thumbnail on camera.
const POINT_CLEARANCE_BOTTOM = 230;

/** Rest the cursor on an element without scrolling anything: the middle of
 * what is visible of it, kept inside the preview and clear of the caption. */
export async function pointAt(page, frame, locator) {
  const area = await (await frame.frameElement()).boundingBox();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No box for ${locator}`);
  const lowest = area.y + area.height - POINT_CLEARANCE_BOTTOM;
  const top = Math.max(box.y, area.y + 20);
  const bottom = Math.min(box.y + box.height, lowest);
  const y = top < bottom ? (top + bottom) / 2 : Math.min(top, lowest);
  const x = Math.min(box.x + Math.min(box.width * 0.5, 260), area.x + area.width - 40);
  await moveTo(x + rand(-12, 12), y + rand(-6, 6));
  await pause(250);
}
