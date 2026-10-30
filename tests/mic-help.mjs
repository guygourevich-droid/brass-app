// The microphone's first run on a phone: the "tap Allow" hint, and what each refusal shows.
// node tests/mic-help.mjs   (exit 1 on failure)
import { serve, launch, sleep, VIEWPORTS } from "./lib.mjs";

const GAMES = ["sound-game", "buzz-along", "ninja", "right-note", "songs", "horn-ladder"];
const UA = {
  android: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  instagram: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0",
  desktop: undefined
};
const fails = [];
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) fails.push(what); };

const s = await serve();
const b = await launch();
const origin = s.url.slice(0, -1);
const read = p => p.eval(`(() => { const h = document.getElementById('micHelp');
  return { title: document.getElementById('overlayText').textContent, help: !h.hidden, steps: [...document.querySelectorAll('#micSteps li')].map(l => l.textContent),
    ask: !document.getElementById('micAsk').hidden, btn: document.getElementById('startBtn').textContent,
    over: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
// A device that has chosen its instrument (otherwise the games send it home to set up first).
const prep = async p => { await p.goto(s.url + "index.html"); await p.eval(`localStorage.setItem('brass-lang','he'); localStorage.setItem('brass-inst','trumpet')`); };

try {
  for (const game of GAMES) for (const lang of ["he", "en"]) {
    const p = await b.newPage({ ...VIEWPORTS.phone, ua: UA.android });
    await prep(p);
    await b.browser.send("Browser.resetPermissions", {});
    await p.goto(`${s.url}${game}.html?lang=${lang}`);
    check((await read(p)).ask, `${game} ${lang}: hint shown before the first question`);
    await b.denyMic(origin);
    await p.eval("startMic()");
    await sleep(500);
    const r = await read(p);
    check(r.help && r.steps.length >= 2 && !r.ask && !r.over, `${game} ${lang}: blocked → steps (${r.steps.length}), hint gone, no sideways scroll`);
    check(/סמל|icon/.test(r.steps[0]), `${game} ${lang}: Android steps start at the address icon`);
    check(p.errors.filter(e => !/404/.test(e)).length === 0, `${game} ${lang}: no script errors ${p.errors.join(" ")}`);
    p.close();
  }
  for (const [who, re] of [["samsung", /☰/], ["instagram", /⋯/], ["desktop", /סמל|icon/]]) {
    const p = await b.newPage(who === "desktop" ? VIEWPORTS.laptop : { ...VIEWPORTS.phone, ua: UA[who] });
    await prep(p);
    await b.denyMic(origin);
    await p.goto(`${s.url}sound-game.html`);
    await p.eval("startMic()");
    await sleep(500);
    const r = await read(p);
    check(r.help && re.test(r.steps[0]), `${who}: its own steps (${r.steps[0]})`);
    p.close();
  }
  // The installed app (no address bar): open the site in Chrome first, then come back.
  {
    const p = await b.newPage({ ...VIEWPORTS.phone, ua: UA.android });
    await prep(p);
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(navigator, 'standalone', { get: () => true })" });
    await b.denyMic(origin);
    await p.goto(`${s.url}songs.html`);
    await p.eval("startMic()");
    await sleep(500);
    const r = await read(p);
    check(r.steps.length === 4 && /tonebee\.app/.test(r.steps[0]), `installed Android app → open in Chrome first (${r.steps[0]})`);
    p.close();
  }
  // The site is allowed but the phone won't let Chrome use the mic: the phone's own settings.
  {
    const p = await b.newPage({ ...VIEWPORTS.phone, ua: UA.android });
    await prep(p);
    await b.grantMic(origin);
    await p.goto(`${s.url}ninja.html`);
    await p.eval(`navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"))`);
    await p.eval("startMic()");
    await sleep(500);
    const r = await read(p);
    check(/אפליקציות/.test(r.steps[0]), `site allowed, Chrome not → phone settings (${r.steps[0]})`);
    p.close();
  }
  // A retry after a refusal is a fresh page (iOS can stay stuck until reloaded).
  {
    const p = await b.newPage({ ...VIEWPORTS.phone, ua: UA.android });
    await prep(p);
    await b.denyMic(origin);
    await p.goto(`${s.url}ninja.html`);
    await p.eval("startMic()");
    await sleep(400);
    await p.eval("window.__stay = 1");
    const loaded = p.once("Page.loadEventFired", 5000).then(() => true, () => false);
    await p.click("#startBtn");
    check(await loaded && !(await p.eval("window.__stay")), "try again reloads the page");
    p.close();
  }
  // Android's own microphone switch off: exact silence, no error → where the switch is.
  {
    const p = await b.newPage({ ...VIEWPORTS.phone, ua: UA.android });
    await prep(p);
    await b.grantMic(origin);
    await p.goto(`${s.url}sound-game.html`);
    await p.eval(`navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(); const d = c.createMediaStreamDestination(); return d.stream; }`);
    await p.eval("startMic()");
    await sleep(3800);
    const r = await read(p);
    check(r.help && /גישה למיקרופון/.test(r.steps.join(" ")), `silent mic on Android → quick-settings steps (${r.title})`);
    p.close();
  }
  // A link straight to a game on a new device goes through setup, then back to the game.
  {
    const p = await b.newPage({ ...VIEWPORTS.phone, ua: UA.android });
    await p.goto(s.url + "index.html");
    await p.eval("localStorage.clear()");
    await p.goto(`${s.url}ninja.html?lang=en`, { wait: 800 });
    check(/index\.html\?next=ninja\.html/.test(await p.eval("location.href")), "fresh device: game link → setup");
    p.close();
  }
} finally {
  await b.close();
  await s.close();
}
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
