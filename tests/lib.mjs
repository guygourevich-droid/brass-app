// Test helpers with no dependencies: a static server for app/ and headless Chrome driven over the DevTools protocol.
// Node 22+ (global WebSocket). Chrome: the macOS app, or CHROME=/path/to/chrome.
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css",
  ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".m4a": "audio/mp4", ".txt": "text/plain" };

// Serves app/ on a free localhost port (a secure context, so the microphone API exists).
export async function serve(root = ROOT) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(normalize(root))) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = `http://localhost:${server.address().port}/`;
  return { url, close: () => new Promise(r => server.close(r)) };
}

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Starts headless Chrome. Audio plays without a click; fake mic flags are off unless asked for.
export async function launch({ headless = true, fakeMic = false, args = [] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), (process.env.CHROME_TAG || "tonebee-chrome") + "-"))   // CHROME_TAG: runs that another run's pkill must not hit;
  const flags = [`--user-data-dir=${dir}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--mute-audio", ...args];
  if (headless) flags.push("--headless=new");
  if (fakeMic) flags.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream");
  const proc = spawn(CHROME, [...flags, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("Chrome did not start: " + buf.slice(-500))), 20000);
    proc.stderr.on("data", d => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on("exit", c => { clearTimeout(t); reject(new Error("Chrome exited " + c + ": " + buf.slice(-500))); });
  });
  const http = wsUrl.replace(/^ws/, "http").replace(/\/devtools\/browser\/.*/, "");
  const browser = await connect(wsUrl);

  async function newPage({ width = 1280, height = 800, mobile = false, scale = 1, ua, touch = mobile } = {}) {
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const list = await (await fetch(http + "/json/list")).json();
    const page = await connect(list.find(t => t.id === targetId).webSocketDebuggerUrl);
    page.targetId = targetId;
    page.errors = [];
    page.logs = [];
    page.on("Runtime.exceptionThrown", p => page.errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    page.on("Runtime.consoleAPICalled", p => {
      const text = p.args.map(a => a.value ?? a.description ?? "").join(" ");
      page.logs.push(`${p.type}: ${text}`);
      if (p.type === "error") page.errors.push("console.error: " + text);
    });
    page.on("Log.entryAdded", p => { if (p.entry.level === "error" && !/favicon/.test(p.entry.url || "")) page.errors.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url || ""}`); });
    await page.send("Runtime.enable");
    await page.send("Log.enable");
    await page.send("Page.enable");
    await page.setViewport({ width, height, mobile, scale, touch });
    if (ua) await page.send("Emulation.setUserAgentOverride", { userAgent: ua });
    return page;
  }

  async function grantMic(origin) {
    await browser.send("Browser.grantPermissions", { origin, permissions: ["audioCapture"] });
  }
  async function denyMic(origin) {
    await browser.send("Browser.setPermission", { origin, permission: { name: "microphone" }, setting: "denied" });
  }

  async function close() {
    try { await browser.send("Browser.close"); } catch {}
    proc.kill();
    await new Promise(r => setTimeout(r, 200));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return { browser, newPage, grantMic, denyMic, close };
}

// One DevTools websocket: send(method, params) → result; on(event, fn).
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map(), handlers = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject, method } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
    } else if (msg.method) (handlers.get(msg.method) || []).forEach(fn => fn(msg.params));
  };
  const c = {
    send(method, params = {}) {
      return new Promise((resolve, reject) => { const i = ++id; waiting.set(i, { resolve, reject, method }); ws.send(JSON.stringify({ id: i, method, params })); });
    },
    on(method, fn) { handlers.set(method, [...(handlers.get(method) || []), fn]); },
    once(method, timeout = 15000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout waiting for " + method)), timeout);
        const fn = p => { clearTimeout(t); handlers.set(method, handlers.get(method).filter(f => f !== fn)); resolve(p); };
        c.on(method, fn);
      });
    },
    // Page helpers (only meaningful on a page socket).
    async goto(url, { wait = 300 } = {}) {
      const loaded = c.once("Page.loadEventFired", 20000);
      await c.send("Page.navigate", { url });
      await loaded;
      if (wait) await sleep(wait);
    },
    async eval(expression) {
      const r = await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async setViewport({ width, height, mobile = false, scale = 1, touch = mobile }) {
      await c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
      await c.send("Emulation.setTouchEmulationEnabled", touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      c.touch = touch;
    },
    async click(selector) {
      const box = await c.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
        const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error("no element " + selector);
      // Not awaited one by one: a handler that opens the mic can hold the input reply until it settles.
      if (c.touch) {
        c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] });
        c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else for (const type of ["mousePressed", "mouseReleased"])
        c.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
      await sleep(50);
    },
    async key(code, key = code) {
      for (const type of ["keyDown", "keyUp"]) await c.send("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: code === "Space" ? 32 : code === "Escape" ? 27 : 0 });
    },
    async screenshot(path) {
      const { data } = await c.send("Page.captureScreenshot", { format: "png" });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, Buffer.from(data, "base64"));
    },
    close() { ws.close(); }
  };
  return c;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// The pages, and which open the microphone.
export const PAGES = ["index.html", "ramzor.html", "balloon-breath.html", "buzz-along.html", "sound-game.html", "right-note.html",
  "horn-ladder.html", "ninja.html", "songs.html", "note-names.html", "clap-along.html"];
export const MIC_PAGES = ["balloon-breath.html", "buzz-along.html", "sound-game.html", "right-note.html", "horn-ladder.html", "ninja.html", "songs.html"];
export const VIEWPORTS = {
  phone: { width: 360, height: 640, mobile: true, scale: 2 },
  phoneSide: { width: 844, height: 390, mobile: true, scale: 3 },
  tablet: { width: 820, height: 1180, mobile: true, scale: 2 },
  tabletSide: { width: 1180, height: 820, mobile: true, scale: 2 },
  laptop: { width: 1366, height: 768 },
  projector: { width: 1920, height: 1080 }
};
