// What the recording draws on top of the app: a caption card, and a ring that
// pulses where each real click lands so a viewer can tell a click from a hover.
//
// There is no drawn pointer: the recording is a real screen capture, and the
// pointer in it is the real Windows cursor driven by lib/os-input.mjs.
//
// The caption is a card in the bottom-left corner rather than a full-width bar:
// the chat panel opens bottom-right and the lead sheet slides in from the right,
// so a full-width bar would cover the composer and the sheet's controls.
//
// The caption ignores the pointer, so a real click on something under it
// still reaches the page.
//
// Injected with addInitScript so both survive navigation, and the caption text
// is kept in sessionStorage so a page load mid-beat does not blank it.

const PAGE_SCRIPT = `
(() => {
  const CSS = \`
    #__rec_caption__ {
      position: fixed; left: 28px; bottom: 28px; z-index: 2147483646;
      max-width: min(980px, calc(100vw - 520px)); box-sizing: border-box;
      background: rgba(18, 22, 20, 0.88); color: #f6f5f1;
      font-family: "Segoe UI", -apple-system, Helvetica, Arial, sans-serif;
      font-size: 22px; line-height: 1.45; padding: 16px 22px; border-radius: 14px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25); pointer-events: none; white-space: pre-wrap;
    }
    #__rec_caption__.title {
      left: 50%; bottom: 50%; transform: translate(-50%, 50%); max-width: 1100px;
      font-size: 36px; font-weight: 600; text-align: center; padding: 36px 48px;
    }
    #__rec_caption__:empty { display: none; }
    #__rec_ring__ {
      position: fixed; z-index: 2147483646; width: 36px; height: 36px; margin: -18px 0 0 -18px;
      border-radius: 50%; border: 3px solid rgba(232, 168, 56, 0.95); pointer-events: none;
      opacity: 0; transform: scale(0.4);
    }
    #__rec_ring__.pulse { animation: __rec_pulse__ 450ms ease-out; }
    @keyframes __rec_pulse__ {
      from { opacity: 1; transform: scale(0.4); }
      to { opacity: 0; transform: scale(1.4); }
    }
  \`;

  function build() {
    if (!document.documentElement) return;
    if (!document.getElementById("__rec_style__")) {
      const style = document.createElement("style");
      style.id = "__rec_style__";
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    }
    if (!document.getElementById("__rec_caption__")) {
      const caption = document.createElement("div");
      caption.id = "__rec_caption__";
      caption.setAttribute("aria-hidden", "true");
      let stored = { text: "", title: false };
      try {
        stored = JSON.parse(sessionStorage.getItem("__rec_caption__") || "{}");
      } catch {}
      caption.textContent = stored.text || "";
      if (stored.title) caption.classList.add("title");
      document.documentElement.appendChild(caption);
    }
    if (!document.getElementById("__rec_ring__")) {
      const ring = document.createElement("div");
      ring.id = "__rec_ring__";
      document.documentElement.appendChild(ring);
    }
  }

  window.addEventListener("mousedown", (event) => {
    build();
    const ring = document.getElementById("__rec_ring__");
    if (!ring) return;
    ring.style.left = event.clientX + "px";
    ring.style.top = event.clientY + "px";
    ring.classList.remove("pulse");
    void ring.offsetWidth;
    ring.classList.add("pulse");
  }, true);

  window.__rec_build__ = build;
  window.__rec_setCaption__ = (text, title) => {
    build();
    try {
      sessionStorage.setItem("__rec_caption__", JSON.stringify({ text, title }));
    } catch {}
    const el = document.getElementById("__rec_caption__");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("title", Boolean(title));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
`;

/** Register on a context so every page and navigation gets the caption and pointer. */
export async function installOverlay(context) {
  await context.addInitScript(PAGE_SCRIPT);
}

async function ensure(page) {
  const present = await page.evaluate(() => typeof window.__rec_build__ === "function").catch(() => false);
  if (!present) await page.evaluate(PAGE_SCRIPT).catch(() => {});
}

export async function setCaption(page, text, { title = false } = {}) {
  await ensure(page);
  await page.evaluate(([text, title]) => window.__rec_setCaption__(text, title), [text, title]).catch(() => {});
}

/** Draw the overlay into a page that is already open and never navigates (the
 * VS Code workbench), restyled by `css` for that window's layout. */
export async function installOverlayIn(page, css = "") {
  await ensure(page);
  await page.evaluate((css) => {
    let style = document.getElementById("__rec_style_extra__");
    if (!style) {
      style = document.createElement("style");
      style.id = "__rec_style_extra__";
      document.documentElement.appendChild(style);
    }
    style.textContent = css;
  }, css);
}
