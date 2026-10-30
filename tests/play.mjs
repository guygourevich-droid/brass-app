// Automated playthroughs of the Tonebee games (game-design QA): an ideal player, a realistic beginner, cheats and
// silence, counters, progression and dead ends, per instrument. Synthetic sound goes straight into each page's analyser
// (the page's own ?test=1 path opens the "mic", then a brass-like tone / voice / claps / noise are mixed in instead).
// Run from app/:  node tests/play.mjs [static long buzz ninja right ladder breath songs clap names pause real]
// Whole run ≈ 16 min (6 tabs at once). Guard: `(node tests/play.mjs & P=$!; sleep 1500; kill $P; pkill -f tonebee-play)`;
// set CHROME_TAG=<unique> when another run may `pkill -f tonebee-play`. Exit 1 on any FAIL; INFO lines are measurements.
// PLAY_JOBS=n tabs at once (default 6), PLAY_INST=horn (or a comma list) narrows the instruments.
import { serve, launch, sleep } from "./lib.mjs";
import { pathToFileURL } from "node:url";

const ALL = ["static", "long", "buzz", "ninja", "right", "ladder", "breath", "songs", "clap", "names", "pause", "real"];
const want = process.argv.slice(2).filter(a => ALL.includes(a));
const run = g => !want.length || want.includes(g);
const JOBS = +process.env.PLAY_JOBS || 6;
const INSTS = (process.env.PLAY_INST || "trumpet,trombone,horn").split(",");   // PLAY_INST=horn narrows a run
const SEEN = ["breath", "buzz", "clap", "ladder", "long", "names", "ninja", "right", "songs"];
const TO_WRITTEN = { trumpet: 2, trombone: 0, horn: 7 };
const FIRST = { trumpet: 60, trombone: 46, horn: 60 };                      // written first note
const hzW = (w, inst) => 440 * Math.pow(2, (w - TO_WRITTEN[inst] - 69) / 12); // written midi → concert Hz

/* ---------- Reporting ---------- */
const results = [];
function say(status, game, what, detail = "") {
  results.push({ status, game, what, detail });
  console.log(`${status} ${game.padEnd(6)} ${what}${detail ? " · " + detail : ""}`);
}
const check = (ok, g, w, d) => say(ok ? "PASS" : "FAIL", g, w, d);
const info = (g, w, d) => say("INFO", g, w, d);
const f1 = ms => ms < 0 ? "never" : (ms / 1000).toFixed(2) + "s";

/* ---------- In-page sound source + bots (serialised into the page) ---------- */
export function pageLib() {
  if (window.__inj) return;
  const rngOf = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const c = ctx;
  // Our own analyser replaces the page's test one (right-note's test tone is not switchable).
  const a = c.createAnalyser(); a.fftSize = analyser.fftSize; a.smoothingTimeConstant = 0;
  analyser = a; raw = new Float32Array(a.fftSize);
  const pull = c.createGain(); pull.gain.value = 0; a.connect(pull); pull.connect(c.destination);
  const mix = c.createGain(); mix.connect(a);
  // Brass-like tone: strong low harmonics rolling off (Web Audio normalises the peak to 1).
  const AMPS = [0, 1, .9, .75, .6, .45, .33, .24, .17, .12, .08, .055, .04, .028, .02, .014, .01];
  const osc = c.createOscillator();
  osc.setPeriodicWave(c.createPeriodicWave(new Float32Array(AMPS.length), Float32Array.from(AMPS)));
  osc.frequency.value = 220;
  const tg = c.createGain(); tg.gain.value = 0;
  const dg = c.createGain(); dg.gain.value = 1;                    // dropouts
  osc.connect(tg); tg.connect(dg); dg.connect(mix); osc.start();
  // Pitch wobble in cents on osc.detune: a bias, two slow drifts, a fast flutter.
  const bias = c.createConstantSource(); bias.offset.value = 0; bias.connect(osc.detune); bias.start();
  const lfo = (hz, delay) => { const o = c.createOscillator(); o.frequency.value = hz; const g = c.createGain(); g.gain.value = 0; o.connect(g); g.connect(osc.detune); o.start(c.currentTime + delay); return g; };
  const d1 = lfo(0.37, 0.4), d2 = lfo(0.83, 0.9), fl = lfo(4.6, 0);
  // Speech-like voice: a sawtooth through two formants, gliding syllables.
  const vo = c.createOscillator(); vo.type = "sawtooth"; vo.frequency.value = 230;
  const fa = c.createBiquadFilter(); fa.type = "bandpass"; fa.frequency.value = 700; fa.Q.value = 4;
  const fb = c.createBiquadFilter(); fb.type = "bandpass"; fb.frequency.value = 1800; fb.Q.value = 5;
  const vg = c.createGain(); vg.gain.value = 0;
  vo.connect(fa); vo.connect(fb); fa.connect(vg); fb.connect(vg); vg.connect(mix); vo.start();
  // Noise: broadband hiss/blowing, band-passed claps, and a quiet room.
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.start();
  const ng = c.createGain(); ng.gain.value = 0; ns.connect(ng); ng.connect(mix);
  const cb = c.createBiquadFilter(); cb.type = "bandpass"; cb.frequency.value = 1500; cb.Q.value = 0.6;
  const cg = c.createGain(); cg.gain.value = 0; ns.connect(cb); cb.connect(cg); cg.connect(mix);
  const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 800;
  const rg = c.createGain(); rg.gain.value = 0; ns.connect(lp); lp.connect(rg); rg.connect(mix);

  const P = window.__inj = { log: [], events: [], timers: [], rngOf };
  window.__rng = rngOf;
  P.t = (at = 0) => c.currentTime + at;
  P.tone = (hz, gain = 0.15, at = 0, scoop = 0) => {
    const t = P.t(at);
    osc.frequency.cancelScheduledValues(t);
    if (scoop) { osc.frequency.setValueAtTime(hz * Math.pow(2, -scoop / 1200), t); osc.frequency.exponentialRampToValueAtTime(hz, t + 0.15); }
    else osc.frequency.setValueAtTime(hz, t);
    tg.gain.cancelScheduledValues(t); tg.gain.setTargetAtTime(gain, t, 0.01);
  };
  P.retune = hz => { osc.frequency.cancelScheduledValues(c.currentTime); osc.frequency.setTargetAtTime(hz, c.currentTime, 0.02); };
  P.off = (at = 0) => { const t = P.t(at); tg.gain.cancelScheduledValues(t); tg.gain.setTargetAtTime(0, t, 0.01); };
  // A scheduled note (for whole performances): on at `at`, off after `dur` seconds.
  P.note = (hz, at, dur, gain = 0.15, scoop = 0) => {
    const t = P.t(at);
    if (scoop) { osc.frequency.setValueAtTime(hz * Math.pow(2, -scoop / 1200), t); osc.frequency.exponentialRampToValueAtTime(hz, t + 0.15); }
    else osc.frequency.setValueAtTime(hz, t);
    tg.gain.setTargetAtTime(gain, t, 0.008); tg.gain.setTargetAtTime(0, t + dur, 0.008);
  };
  P.dip = (at, ms) => { const t = P.t(at); dg.gain.setValueAtTime(1, t); dg.gain.linearRampToValueAtTime(0, t + 0.008); dg.gain.setValueAtTime(0, t + ms / 1000); dg.gain.linearRampToValueAtTime(1, t + ms / 1000 + 0.008); };
  // Random dropouts of `len` ms every `every` ms (ranges), while a tone sounds.
  P.dropTrain = ({ every = [900, 1500], len = [120, 250], seed = 11 } = {}) => {
    const r = rngOf(seed);
    const go = () => { const ms = len[0] + r() * (len[1] - len[0]); P.dip(0, ms); P.timers.push(setTimeout(go, every[0] + r() * (every[1] - every[0]))); };
    P.timers.push(setTimeout(go, every[0] + r() * (every[1] - every[0])));
  };
  P.wobble = ({ bias: b = 0, drift = 0, flutter = 0 } = {}) => {
    bias.offset.setValueAtTime(b, c.currentTime); d1.gain.value = drift * 0.6; d2.gain.value = drift * 0.4; fl.gain.value = flutter;
  };
  P.setBias = b => bias.offset.setValueAtTime(b, c.currentTime);
  P.noise = (gain, at = 0) => ng.gain.setTargetAtTime(gain, P.t(at), 0.01);
  P.room = gain => { rg.gain.value = gain; };
  P.clap = (at, gain = 0.9) => { const t = P.t(at); cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(gain, t + 0.002); cg.gain.exponentialRampToValueAtTime(0.0005, t + 0.09); cg.gain.setValueAtTime(0, t + 0.1); };
  P.claps = (n, gap = 0.35, gain = 0.9) => { for (let i = 0; i < n; i++) P.clap(0.05 + i * gap, gain); };
  // Child talking: syllables 120-260 ms, each gliding 150-400 cents, pitch jumping around a child's voice.
  P.speech = (dur, gain = 0.25, seed = 3, at = 0) => {
    const r = rngOf(seed); let t = P.t(at); const end = t + dur;
    while (t < end) {
      const len = 0.12 + r() * 0.14, gap = 0.03 + r() * 0.07;
      const f0 = 240 * Math.pow(2, (r() * 9 - 4) / 12), glide = (r() < 0.5 ? -1 : 1) * (150 + r() * 250);
      vo.frequency.setValueAtTime(f0, t); vo.frequency.linearRampToValueAtTime(f0 * Math.pow(2, glide / 1200), t + len);
      fa.frequency.setValueAtTime(400 + r() * 500, t); fb.frequency.setValueAtTime(1100 + r() * 1300, t);
      vg.gain.setTargetAtTime(gain, t, 0.012); vg.gain.setTargetAtTime(0, t + len, 0.02);
      t += len + gap;
    }
  };
  // A sung vowel: steady voice pitch (a child singing "laaa" instead of playing).
  P.sing = (hz, dur, gain = 0.25) => { const t = P.t(); vo.frequency.setValueAtTime(hz, t); vg.gain.setTargetAtTime(gain, t, 0.01); vg.gain.setTargetAtTime(0, t + dur, 0.02); };
  P.mon = (fn, ms = 50) => { const id = setInterval(() => { try { P.log.push(Object.assign({ t: Math.round(performance.now()) }, fn())); } catch (e) { P.log.push({ err: String(e) }); } }, ms); P.timers.push(id); return id; };
  P.take = () => { const l = P.log; P.log = []; return l; };
  P.takeEvents = () => { const l = P.events; P.events = []; return l; };
  P.reset = () => { P.timers.forEach(id => { clearInterval(id); clearTimeout(id); }); P.timers = []; P.off(); ng.gain.value = 0; vg.gain.cancelScheduledValues(0); vg.gain.value = 0; P.wobble({}); dg.gain.cancelScheduledValues(0); dg.gain.value = 1; };
  // A player who watches the screen: plays target() once ready() (after a reaction time), retunes when the target moves,
  // stops when key() changes (a new note) or score() rises. Records each key's outcome in P.events.
  P.follow = cfg => {
    const r = rngOf(cfg.seed || 7);
    let lastKey, startAt = null, playing = false, playAt = 0, coolUntil = 0, curHz = 0, plan = {}, lastScore = cfg.score ? cfg.score() : 0, scoredKey;
    const id = setInterval(() => {
      const now = performance.now();
      const sc = cfg.score ? cfg.score() : 0;
      if (sc > lastScore) {
        P.events.push({ key: lastKey, ok: true, dt: playing ? Math.round(now - playAt) : null });
        lastScore = sc; scoredKey = lastKey;
        if (playing) { P.off(); playing = false; }
        startAt = null; coolUntil = now + (cfg.cooldown || 0);
      }
      const key = cfg.key();
      if (key !== lastKey) {
        if (lastKey !== undefined && scoredKey !== lastKey && cfg.score) P.events.push({ key: lastKey, ok: false, dt: playing ? Math.round(now - playAt) : null });
        lastKey = key; startAt = null;
        if (playing) { P.off(); playing = false; }
        plan = { bias: cfg.biasSpread ? (r() * 2 - 1) * cfg.biasSpread : 0, delay: (cfg.reaction || 0) + r() * (cfg.jitter || 0) };
      }
      if (scoredKey === key && cfg.score) return;
      const hz = cfg.target();
      if (hz == null) { if (playing) { P.off(); playing = false; } startAt = null; return; }
      if (!playing) {
        if (now < coolUntil || (cfg.ready && !cfg.ready(now))) return;
        if (startAt === null) startAt = now + plan.delay;
        if (now < startAt) return;
        P.setBias((cfg.bias || 0) + plan.bias);
        P.tone(hz * Math.pow(2, (cfg.offset || 0) / 12), cfg.gain || 0.15, 0, cfg.scoop || 0);
        playing = true; playAt = now; curHz = hz;
      } else if (Math.abs(hz / curHz - 1) > 1e-4) { P.retune(hz * Math.pow(2, (cfg.offset || 0) / 12)); curHz = hz; }
    }, 20);
    P.timers.push(id);
    return id;
  };
}

/* ---------- Page helpers ---------- */
export async function open(b, _srv, file, { inst = "trumpet", ls = {}, query = "", start = "startMic()", viewport } = {}) {
  // Each tab gets its own server port = its own origin = its own localStorage: tabs running at the same time
  // (another instrument, another level) must not overwrite each other's settings.
  const srv = await serve();
  const page = await b.newPage(viewport || { width: 1280, height: 800 });
  page.srv = srv;
  page.closeTab = () => b.browser.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
  // Headless tabs behind the newest one are "hidden" and get no animation frames: keep every tab visible.
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(srv.url + file + "?test=1", { wait: 0 });
  const all = { "brass-inst": inst, "brass-lang": "he", ...Object.fromEntries(SEEN.map(k => ["tonebee-seen-" + k, "1"])), ...ls };
  await page.eval("localStorage.clear();" + Object.entries(all).map(([k, v]) =>
    `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === "string" ? v : JSON.stringify(v))});`).join(""));
  await page.goto(srv.url + file + "?test=1" + query, { wait: 300 });
  if (start) {
    await page.eval(start);
    await sleep(250);
    await page.eval(`(${pageLib})()`);
    // A real start sets the floor to 0.002 and a real room is never silent.
    await page.eval(`__inj.room(0.005); if (typeof state === "object" && "noiseFloor" in state) state.noiseFloor = 0.002;`);
    await sleep(500);
  }
  return page;
}
export async function waitFor(page, expr, ms, every = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.eval(expr)) return Date.now() - t0;
    await sleep(every);
  }
  return -1;
}
const rising = (log, k) => log.every((s, i) => i === 0 || s[k] === undefined || log[i - 1][k] === undefined || s[k] >= log[i - 1][k]);
// Anything red that is visible on the stage (the mic may only add a glow; nothing turns red).
const NO_RED = `(() => {
  const red = s => { const m = /rgba?\\((\\d+), (\\d+), (\\d+)/.exec(s || ""); return m && +m[1] > 170 && +m[2] < 100 && +m[3] < 100; };
  const vis = e => { for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0 || n.hasAttribute("hidden") || n.getAttribute("opacity") === "0") return false; } return true; };
  const out = [];
  document.querySelectorAll("#stage *").forEach(e => { const cs = getComputedStyle(e); for (const p of ["fill", "stroke", "color", "backgroundColor"]) if (red(cs[p]) && vis(e)) out.push(e.tagName + (e.id ? "#" + e.id : "") + " " + p + " " + cs[p]); });
  return out.slice(0, 4);
})()`;
async function pool(tasks, n) {
  const queue = tasks.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) {
      const t = queue.shift();
      try { await t.fn(); } catch (e) { say("FAIL", t.game, t.name + " crashed", String(e && e.message || e).slice(0, 200)); }
    }
  }));
}
async function done(page, game, label) {
  // The optional real buzz recording (sounds/buzz/<inst>.m4a) is looked for on every visit; its 404 is expected.
  const errs = page.errors.filter(e => !/posthog|favicon|sw\.js|ServiceWorker|sounds\/buzz\/\w+\.m4a/i.test(e));
  if (errs.length) say("FAIL", game, label + " page errors", errs.slice(0, 2).join(" | ").slice(0, 300));
  await page.closeTab();
  if (page.srv) page.srv.close();          // not awaited: Chrome may hold keep-alive sockets
}

/* ======================================================================================== */
/*  Static: every target note against the detectors, shared note lists, songs, level tables  */
/* ======================================================================================== */
async function staticChecks(b, srv) {
  const G = "static";
  const p = await b.newPage({ width: 1280, height: 800 });
  const grab = async (file, expr) => { await p.goto(srv.url + file + "?test=1", { wait: 100 }); return p.eval(expr); };
  const rn = await grab("right-note.html", "INSTRUMENTS");
  const nj = await grab("ninja.html", "({ I: INSTRUMENTS, TOL_CENTS, HIT_HOLD_MS, GRACE_MS, COUNTS, TIMES })");
  const sg = await grab("songs.html", "({ I: INSTRUMENTS, songs: SONGS.map(s => ({ id: s.id, bars: s.music.split('|').map(b => b.trim().split(/\\s+/).reduce((t, x) => t + +(x.split(':')[1] || 1), 0)), steps: [...new Set(s.events.map(e => e.step))] })), TEMPOS })");
  const hl = await grab("horn-ladder.html", "({ I: Object.fromEntries(Object.entries(INSTRUMENTS).map(([k, v]) => [k, { fund: v.fund, partials: v.partials.map(p => p.n), lo: v.lo, hi: v.hi, start: v.start }])), SCALE })");
  const bz = await grab("buzz-along.html", "({ I: INSTRUMENTS, TARGETS, IN_CENTS, OUT_CENTS, ONSET_MS, sirens: [2, 4, 7] })");
  const ln = await grab("sound-game.html", "({ F_LO, F_HI, LEVELS: LEVELS.map(String), ONSET_MS, ONSET_SPREAD, GAP_MS })");
  const br = await grab("balloon-breath.html", "({ LEVELS, IN_S })");
  const nn = await grab("note-names.html", "({ I: Object.fromEntries(Object.entries(INSTRUMENTS).map(([k, v]) => [k, { n: v.notes.length, t: v.transpose }])), LEVEL_COUNT })");
  await p.closeTab?.(); await b.browser.send("Target.closeTarget", { targetId: p.targetId }).catch(() => {});

  for (const inst of INSTS) {
    // Shared note lists must agree, or "the notes the class knows" means different notes per game.
    const same = k => JSON.stringify(rn[inst][k]) === JSON.stringify(nj.I[inst][k]) && JSON.stringify(rn[inst][k]) === JSON.stringify(sg.I[inst][k]) && JSON.stringify(rn[inst][k]) === JSON.stringify(hl.SCALE[inst][k]);
    check(same("notes") && same("def"), G, `${inst} shared note list identical in right-note/ninja/songs/ladder`);
    // Every pickable written note, in concert Hz, inside each pitch game's detector band and the 80-1000 Hz band.
    const bad = [];
    for (const [name, I] of [["right", rn[inst]], ["ninja", nj.I[inst]], ["songs", sg.I[inst]]])
      for (const w of I.notes) { const hz = hzW(w, inst); if (hz < I.lo || hz > I.hi || hz < 80 || hz > 1000) bad.push(`${name}:${w}=${hz.toFixed(0)}Hz`); }
    for (const w of rn[inst].notes) { const hz = hzW(w, inst); if (hz < ln.F_LO || hz > ln.F_HI) bad.push(`long:${w}`); }
    check(!bad.length, G, `${inst} every pickable note inside detector bands`, bad.length ? bad.join(" ") : `${hzW(rn[inst].notes[0], inst).toFixed(1)}–${hzW(rn[inst].notes.at(-1), inst).toFixed(1)} Hz vs [${rn[inst].lo}, ${rn[inst].hi}]`);
    // Ladder: open partials (all lo/hi choices) and scale notes.
    const L = hl.I[inst], f = L.fund, lo = Math.min(...L.lo), hi = Math.max(...L.hi);
    const open = L.partials.filter(n => n >= lo && n <= hi).map(n => n * f);
    const ladBad = open.filter(hz => hz < 80 || hz > 1000 || hz < open[0] * 0.75 || hz > Math.min(open.at(-1) * 1.3, 1000));
    check(!ladBad.length, G, `${inst} ladder open partials ${lo}–${hi} inside 80–1000 Hz`, open.map(h => h.toFixed(0)).join(" "));
    // Buzz: every flower and siren peak inside the bee's sky and the buzz detector.
    const B = bz.I[inst], dLo = B.base * Math.pow(2, (B.lo - 4) / 12), dHi = B.base * Math.pow(2, (B.hi + 4) / 12);
    const semis = [...bz.TARGETS, ...bz.sirens];
    const bb = semis.filter(s => s < B.lo || s > B.hi || B.base * Math.pow(2, s / 12) < Math.max(80, dLo) || B.base * Math.pow(2, s / 12) > Math.min(1000, dHi));
    check(!bb.length, G, `${inst} buzz flowers/sirens inside sky and detector`, `targets ${(B.base * Math.pow(2, Math.min(...semis) / 12)).toFixed(0)}–${(B.base * Math.pow(2, Math.max(...semis) / 12)).toFixed(0)} Hz, detector ${dLo.toFixed(0)}–${dHi.toFixed(0)} Hz`);
    // Songs: playable with the default notes (no dead end on day one).
    const notes = rn[inst].notes, def = rn[inst].def;
    const playable = sg.songs.filter(s => s.steps.every(st => notes[st - 1] !== undefined && def.includes(notes[st - 1])));
    check(playable.length >= 1, G, `${inst} songs playable with default notes`, `${playable.length}/${sg.songs.length}`);
  }
  const badBars = sg.songs.filter(s => s.bars.some(x => Math.abs(x - 4) > 1e-9)).map(s => s.id);
  check(!badBars.length, G, "every song bar sums to 4 beats", badBars.join(" ") || `${sg.songs.length} songs`);
  const unplayed = sg.songs.map(x => x.id).filter(id => !SONG_IDS.includes(id));
  check(!unplayed.length, G, "every song is in the follow-mode playthrough (SONG_IDS)", unplayed.join(" ") || `${SONG_IDS.length} songs`);
  const maxStep = Math.max(...sg.songs.flatMap(s => s.steps));
  check(maxStep <= 8, G, "song steps exist on every instrument's list", `highest step ${maxStep}`);
  const asc = a => a.every((x, i) => !i || x > a[i - 1]);
  check(asc(ln.LEVELS.slice(0, 4).map(Number)) && ln.LEVELS[4] === "Infinity", G, "Long Note levels rise 4→8→12→16→∞", ln.LEVELS.join(" "));
  check(asc(br.LEVELS), G, "Breathing levels rise", br.LEVELS.join(" "));
  check(asc(nj.COUNTS) && asc(nj.TIMES), G, "Ninja round sizes and times ordered", `${nj.COUNTS} / ${nj.TIMES}s`);
  for (const inst of INSTS) {
    const L = hl.I[inst];
    check(L.partials.includes(L.start.lo) && L.partials.includes(L.start.hi) && L.start.targets.every(n => n >= L.start.lo && n <= L.start.hi), G, `${inst} ladder first-visit ladder and bananas consistent`, `lo ${L.start.lo} hi ${L.start.hi} bananas ${L.start.targets}`);
  }
  info(G, "detector thresholds", `long: onset ${ln.ONSET_MS}ms spread≤${ln.ONSET_SPREAD}c gap ${ln.GAP_MS}ms | buzz: onset ${bz.ONSET_MS}ms ±${bz.IN_CENTS}/${bz.OUT_CENTS}c | ninja: ±${nj.TOL_CENTS}c hold ${nj.HIT_HOLD_MS}ms grace ${nj.GRACE_MS}ms`);
}

/* ======================================================================================== */
/*  Long Note (sound-game.html)                                                              */
/* ======================================================================================== */
const LONG_MON = `__inj.mon(() => ({ c: state.counter, ph: state.phase, a: +state.a.toFixed(2), on: state.soundOn, st: !!state.stale }), 50)`;
function longTasks(b, srv) {
  const G = "long", tasks = [];
  for (const inst of INSTS) {
    const hz = hzW(FIRST[inst], inst);
    tasks.push({ game: G, name: `${inst} ideal`, fn: async () => {
      const p = await open(b, srv, "sound-game.html", { inst });
      await p.eval(LONG_MON);
      for (const L of [1, 2, 3, 4]) {
        const goal = [4, 8, 12, 16][L - 1];
        await p.eval(`setLevel(${L})`);
        const c0 = await p.eval("state.counter");
        await p.eval(`__inj.tone(${hz}, 0.15)`);
        const won = await waitFor(p, `state.phase === "won"`, (goal + 3) * 1000);
        await sleep(500);
        await p.eval("__inj.off()");
        const home = await waitFor(p, `state.phase === "idle"`, 12000);
        const c1 = await p.eval("state.counter");
        check(won >= 0 && won <= (goal + 0.8) * 1000 && home >= 0 && c1 === c0 + 1, G, `${inst} L${L} ideal ${goal}s note wins`, `won at ${f1(won)}, back home ${home >= 0 ? "yes" : "NO"}, counter +${c1 - c0}`);
      }
      await p.eval("setLevel(5)");
      await p.eval(`__inj.tone(${hz}, 0.15)`); await sleep(10000); await p.eval("__inj.off()");
      await waitFor(p, `state.phase === "idle"`, 15000);
      const r1 = await p.eval("({ best: state.bestSeconds, text: scene.seconds.textContent })");
      await p.eval(`__inj.tone(${hz}, 0.15)`); await sleep(3000); await p.eval("__inj.off()");
      await waitFor(p, `state.phase === "idle"`, 8000);
      const r2 = await p.eval("({ best: state.bestSeconds, text: scene.seconds.textContent })");
      await p.eval("nextTurn()");
      const r3 = await p.eval("({ best: state.bestSeconds, turn: state.turn })");
      // A note that stops just after a place is passed: the place's chime mutes the detector, so the flight runs on.
      if (inst === "trumpet") {
        const over = [];
        for (const stopAt of [4.3, 8.3]) {
          await p.eval("nextTurn()");
          await p.eval(`__inj.note(${hz}, 0, ${stopAt}, 0.15)`); await sleep(stopAt * 1000 + 2500);
          await waitFor(p, `state.phase === "idle"`, 10000);
          over.push(`${stopAt}s note → ${(await p.eval("state.bestSeconds")).toFixed(2)}s shown as ${await p.eval("scene.seconds.textContent")}`);
        }
        info(G, "endless: a note ending right after a place", over.join(", "));
      }
      check(r1.best >= 9.3 && r1.best <= 10.6 && r2.best === r1.best && r3.best === 0 && r3.turn === 1, G, `${inst} L5 endless keeps the turn's longest note`, `10s note → ${r1.text}, after a 3s note ${r2.text}, next turn resets`);
      const log = await p.eval("__inj.take()");
      check(rising(log, "c"), G, `${inst} counter only rises (ideal run)`, `${log.length} samples, final ${log.at(-1).c}`);
      await done(p, G, inst);
    } });
    tasks.push({ game: G, name: `${inst} beginner`, fn: async () => {
      const p = await open(b, srv, "sound-game.html", { inst });
      await p.eval(LONG_MON);
      // Beginner: scooped onset, slow drift ±45c + flutter, 20c flat, short dropouts (<300 ms), a quiet tone.
      await p.eval("__inj.wobble({ bias: -20, drift: 45, flutter: 12 })");
      for (const [L, gain, dips] of [[1, 0.04, [[1.1, 180], [2.4, 260]]], [2, 0.06, [[1.2, 200], [2.6, 280], [4.1, 150], [5.6, 260], [7.0, 220]]]]) {
        const goal = L * 4;
        await p.eval(`setLevel(${L})`);
        const c0 = await p.eval("state.counter");
        await p.eval(`__inj.note(${hz}, 0, ${goal + 1.2}, ${gain}, 120); ${dips.map(([at, ms]) => `__inj.dip(${at}, ${ms});`).join("")}`);
        const won = await waitFor(p, `state.phase === "won"`, (goal + 3) * 1000);
        await waitFor(p, `state.phase === "idle"`, 12000);
        const c1 = await p.eval("state.counter");
        check(won >= 0 && c1 === c0 + 1, G, `${inst} L${L} beginner (wobble, ${dips.length} dropouts ≤280ms, quiet) wins`, `won at ${f1(won)}, counted as ${c1 - c0} attempt(s)`);
      }
      // Very quiet player (−46 dBFS peak) at level 1.
      await p.eval("setLevel(1)");
      await p.eval(`__inj.note(${hz}, 0, 5.2, 0.012, 0)`);
      const quiet = await waitFor(p, `state.phase === "won"`, 7000);
      await waitFor(p, `state.phase === "idle"`, 10000);
      info(G, `${inst} L1 very quiet note (peak 0.012)`, quiet >= 0 ? `won at ${f1(quiet)}` : "never started");
      // A breath in the middle: one breath, one flight; the note after the breath does not relaunch.
      await p.eval("__inj.wobble({}); setLevel(2)");
      await p.take?.();
      await p.eval("__inj.take()");
      await p.eval(`__inj.note(${hz}, 0, 3, 0.15); __inj.note(${hz}, 3.7, 4, 0.15)`);
      await sleep(8200);
      const seg = await p.eval("__inj.take()");
      const relaunched = seg.some((s, i) => i && s.ph === "play" && seg[i - 1].ph !== "play" && s.t - seg[0].t > 3500);
      const rested = seg.some(s => s.ph === "rest");
      await waitFor(p, `state.phase === "idle"`, 8000);
      await p.eval(`__inj.tone(${hz}, 0.15)`);
      const again = await waitFor(p, `state.phase === "won"`, 11000);
      await p.eval("__inj.off()");
      await waitFor(p, `state.phase === "idle"`, 12000);
      check(rested && !relaunched && again >= 0, G, `${inst} L2 breath mid-flight → parachute, no relaunch, next note wins`, `rest ${rested}, relaunched ${relaunched}, next flight won at ${f1(again)}`);
      const log = await p.eval("__inj.take()");
      check(rising(log, "c"), G, `${inst} counter only rises (beginner run)`);
      await done(p, G, inst);
    } });
    tasks.push({ game: G, name: `${inst} cheats`, fn: async () => {
      const p = await open(b, srv, "sound-game.html", { inst });
      await p.eval("setLevel(1)");
      await p.eval(LONG_MON);
      const scen = [
        ["silence 4s", "", 4000],
        ["broadband noise 3s", "__inj.noise(0.3); setTimeout(() => __inj.noise(0), 3000)", 4500],
        ["10 claps", "__inj.claps(10, 0.33)", 4500],
        ["child talking 5s", "__inj.speech(5, 0.25, 3)", 6000],
        ["talking + claps 4s", "__inj.speech(4, 0.2, 9); __inj.claps(8, 0.45)", 5000]
      ];
      for (const [name, js, ms] of scen) {
        const c0 = await p.eval("state.counter");
        await p.eval("__inj.take()");
        if (js) await p.eval(js);
        await sleep(ms);
        const log = await p.eval("__inj.take()");
        const c1 = await p.eval("state.counter");
        const flew = log.some(s => s.ph !== "idle"), on = log.filter(s => s.on).length;
        check(c1 === c0 && !flew, G, `${inst} ${name} does not count or fly`, `counter +${c1 - c0}, sound frames ${on}, phases ${[...new Set(log.map(s => s.ph))].join("/")}`);
        await waitFor(p, `state.phase === "idle"`, 8000);
      }
      const red = await p.eval(NO_RED);
      check(!red.length, G, `${inst} nothing red after silence/cheats`, red.join(", "));
      // How often does 5 s of chatter start a flight, and how far does it fly? (different synthetic voices)
      if (inst === "trumpet") {
        let started = 0, wonN = 0, far = [];
        for (let seed = 101; seed < 109; seed++) {
          await waitFor(p, `state.phase === "idle"`, 10000);
          await p.eval("__inj.take()");
          await p.eval(`__inj.speech(5, 0.25, ${seed})`); await sleep(5600);
          const lg = await p.eval("__inj.take()");
          if (lg.some(s => s.ph === "play")) started++;
          if (lg.some(s => s.ph === "won")) wonN++;
          far.push(Math.max(...lg.map(s => s.a)).toFixed(1));
        }
        check(started === 0, G, "8 × 5 s of different children talking start no flight", `${started}/8 started, ${wonN}/8 reached the 4 s goal, flown ${far.join(" ")}s`);
      }
      // A child singing "laaa" on a steady pitch: the detector cannot tell this from a note (expected limitation).
      const c0 = await p.eval("state.counter");
      await p.eval("__inj.sing(260, 2)"); await sleep(2600);
      info(G, `${inst} sung steady vowel 2s`, `counter +${(await p.eval("state.counter")) - c0} (a steady sung pitch counts as a note)`);
      await waitFor(p, `state.phase === "idle"`, 8000);
      // After all that noise, a real note still works (floor did not go deaf).
      await p.eval(`__inj.tone(${hz}, 0.05)`);
      const ok = await waitFor(p, `state.phase === "won"`, 7000);
      await p.eval("__inj.off()");
      check(ok >= 0, G, `${inst} detector still hears a moderate note after the noise`, `won at ${f1(ok)}`);
      await done(p, G, inst);
    } });
  }
  return tasks;
}

/* ======================================================================================== */
/*  Buzzing (buzz-along.html)                                                                */
/* ======================================================================================== */
const BUZZ_TARGET = `() => state.phase === "play" ? INSTRUMENTS[state.inst].base * Math.pow(2, TARGETS[state.ti] / 12) : null`;
function buzzTasks(b, srv) {
  const G = "buzz", tasks = [];
  for (const inst of INSTS) {
    tasks.push({ game: G, name: `${inst} step1`, fn: async () => {
      const p = await open(b, srv, "buzz-along.html", { inst, ls: { buzz: { step: 1, hold: 4, siren: 2 } } });
      await p.eval("__inj.mon(() => ({ c: state.counter, on: state.soundOn, s: Math.round(scene.scroll) }), 50)");
      const base = await p.eval("INSTRUMENTS[state.inst].base");
      await p.eval(`__inj.tone(${base}, 0.15)`); await sleep(3000); await p.eval("__inj.off()"); await sleep(400);
      const a = await p.eval("({ c: state.counter, s: scene.scroll })");
      await sleep(2000);
      const s2 = await p.eval("scene.scroll");
      check(a.c === 1 && a.s > 330 && a.s < 520 && s2 - a.s < 15, G, `${inst} step1 any buzz flies the bee, silence just waits`, `3s buzz → ${Math.round(a.s)}px, counter ${a.c}; 2s silence moves ${Math.round(s2 - a.s)}px`);
      // A low buzz and a high buzz (beginners buzz anywhere): still a buzz.
      for (const semi of [-7, 11]) {
        const c0 = await p.eval("state.counter");
        await p.eval(`__inj.tone(${base * Math.pow(2, semi / 12)}, 0.15)`); await sleep(1500); await p.eval("__inj.off()"); await sleep(600);
        info(G, `${inst} step1 buzz ${semi > 0 ? "+" : ""}${semi} semitones from the model`, `counted ${(await p.eval("state.counter")) - c0}`);
      }
      for (const [name, js, ms] of [["noise 3s", "__inj.noise(0.3); setTimeout(() => __inj.noise(0), 3000)", 4000], ["10 claps", "__inj.claps(10, 0.33)", 4500], ["child talking 5s", "__inj.speech(5, 0.25, 3)", 6000]]) {
        const c0 = await p.eval("state.counter"), s0 = await p.eval("scene.scroll");
        await p.eval(js); await sleep(ms);
        const c1 = await p.eval("state.counter"), s1 = await p.eval("scene.scroll");
        check(c1 === c0 && s1 - s0 < 20, G, `${inst} step1 ${name} does not fly the bee`, `counter +${c1 - c0}, bee flew ${Math.round(s1 - s0)}px`);
      }
      const log = await p.eval("__inj.take()");
      check(rising(log, "c"), G, `${inst} step1 counter only rises`);
      await done(p, G, inst + " step1");
    } });
    tasks.push({ game: G, name: `${inst} step2`, fn: async () => {
      const p = await open(b, srv, "buzz-along.html", { inst, ls: { buzz: { step: 2, hold: 4, siren: 2 } } });
      // Ideal: listens to the model, then buzzes each flower's pitch; Space for the next flower.
      await p.eval(`__inj.follow({ key: () => state.ti + ":" + state.phase.replace("grow", "play"), target: ${BUZZ_TARGET}, ready: now => now > state.muteUntil, reaction: 300, score: () => state.honey })`);
      await p.eval(`__inj.timers.push(setInterval(() => { if (state.phase === "won" && performance.now() - (window.__wonAt || (window.__wonAt = performance.now())) > 700) { window.__wonAt = 0; next(); } }, 50))`);
      const t = await waitFor(p, "state.honey >= 7", 70000);
      const ev = await p.eval("__inj.takeEvents()");
      const dts = ev.filter(e => e.ok).map(e => e.dt);
      check(t >= 0, G, `${inst} step2 ideal lands on all 7 flowers`, `honey ${await p.eval("state.honey")}, buzz→honey ${dts.map(d => (d / 1000).toFixed(1)).join(" ")}s`);
      await p.eval("__inj.reset()");
      // Beginner: 20-40 cents off per flower, drifting ±45c, dropouts, slow to react; first three flowers (0, +2, −2).
      await p.eval("state.ti = TARGETS.length - 1; next(); state.honey = 0; setJar()");
      await p.eval("__inj.wobble({ drift: 45, flutter: 12 }); __inj.dropTrain({ every: [1200, 2000], len: [120, 240] })");
      await p.eval(`__inj.follow({ key: () => state.ti + ":" + state.phase.replace("grow", "play"), target: ${BUZZ_TARGET}, ready: now => now > state.muteUntil, reaction: 900, jitter: 500, biasSpread: 40, seed: 5, score: () => state.honey })`);
      await p.eval(`__inj.timers.push(setInterval(() => { if (state.phase === "won" && performance.now() - (window.__wonAt || (window.__wonAt = performance.now())) > 900) { window.__wonAt = 0; next(); } }, 50))`);
      const tb = await waitFor(p, "state.honey >= 3", 40000);
      const evb = await p.eval("__inj.takeEvents()");
      check(tb >= 0, G, `${inst} step2 beginner gets the first 3 flowers (0, +2, −2)`, `honey ${await p.eval("state.honey")} in ${f1(tb)}, buzz→honey ${evb.filter(e => e.ok).map(e => (e.dt / 1000).toFixed(1)).join(" ")}s`);
      await p.eval("__inj.reset()");
      // Cheats on a flower: talking, noise, claps never land the bee.
      await p.eval("next()"); await waitFor(p, `state.phase === "play" && performance.now() > state.muteUntil`, 8000);
      const h0 = await p.eval("state.honey");
      await p.eval("__inj.speech(4, 0.25, 5); __inj.claps(8, 0.5)"); await sleep(4500);
      await p.eval("__inj.noise(0.3)"); await sleep(2000); await p.eval("__inj.noise(0)");
      check((await p.eval("state.honey")) === h0 && (await p.eval("state.approach")) < 0.5, G, `${inst} step2 talking/claps/noise do not land the bee`);
      await done(p, G, inst + " step2");
    } });
    tasks.push({ game: G, name: `${inst} step3`, fn: async () => {
      for (const hold of [4, 8]) {
        const p = await open(b, srv, "buzz-along.html", { inst, ls: { buzz: { step: 3, hold, siren: 2 } } });
        await p.eval(`__inj.follow({ key: () => state.ti + ":" + state.phase.replace("grow", "play"), target: ${BUZZ_TARGET}, ready: now => now > state.muteUntil, reaction: 300, score: () => state.honey })`);
        const t = await waitFor(p, "state.honey >= 1", (hold + 8) * 1000);
        check(t >= 0, G, `${inst} step3 hold ${hold}s ideal fills the honeycomb`, `${f1(t)} from the flower appearing`);
        await p.eval("__inj.reset(); next()");
        // Beginner: wanders out of the band now and then; the comb only pauses.
        await p.eval("__inj.wobble({ drift: 70, flutter: 15 }); __inj.dropTrain({ every: [1500, 2500], len: [120, 250] })");
        await p.eval(`__inj.follow({ key: () => state.ti + ":" + state.phase.replace("grow", "play"), target: ${BUZZ_TARGET}, ready: now => now > state.muteUntil, reaction: 900, biasSpread: 25, seed: 9, score: () => state.honey })`);
        await p.eval("__inj.mon(() => ({ f: +state.fill.toFixed(3) }), 50)");
        const tb = await waitFor(p, "state.honey >= 2", (hold * 3 + 10) * 1000);
        const log = await p.eval("__inj.take()");
        let drops = 0; for (let i = 1; i < log.length; i++) if (log[i].f < log[i - 1].f - 1e-6 && log[i].f !== 0) drops++;
        check(tb >= 0 && drops === 0, G, `${inst} step3 hold ${hold}s beginner (drift ±70c) fills it; wandering only pauses`, `${f1(tb)}, fill went down ${drops}×`);
        await done(p, G, `${inst} step3 hold${hold}`);
      }
    } });
    for (const siren of [2, 4, 7]) tasks.push({ game: G, name: `${inst} route ${siren}`, fn: async () => {
      const p = await open(b, srv, "buzz-along.html", { inst, ls: { buzz: { step: 4, hold: 4, siren } } });
      await p.eval("__inj.mon(() => ({ ph: state.phase, x: Math.round(scene.scroll), y: Math.round(scene.beeY) }), 50)");
      const route = lead => `() => state.phase === "play" ? INSTRUMENTS[state.inst].base * Math.pow(2, routeSemi(scene.scroll + ROUTE_BEE_X + ${lead}) / 12) : null`;
      await p.eval(`__inj.follow({ key: () => "r", target: ${route(25)}, ready: () => true, reaction: 0 })`);
      const t = await waitFor(p, `state.phase === "won"`, 40000);
      const log = await p.eval("__inj.take()");
      const bumps = log.filter((s, i) => s.ph === "bump" && (!i || log[i - 1].ph !== "bump")).length;
      const dots = await p.eval("scene.dots ? [scene.dots.filter(d => d.met).length, scene.dots.length] : [0, 0]");
      check(t >= 0 && bumps === 0, G, `${inst} route siren ${siren} ideal reaches the hive`, `${f1(t)}, bumps ${bumps}, dots ${dots[0]}/${dots[1]}`);
      const MON = "__inj.mon(() => ({ ph: state.phase, x: Math.round(scene.scroll), y: Math.round(scene.beeY) }), 50)";
      await p.eval("__inj.reset(); next()"); await p.eval(MON);
      if (siren === 2 || siren === 7) {
        // Beginner: 0.3 s late, wobbling, silent on the flat stretches (breathing).
        await p.eval("__inj.wobble({ bias: -15, drift: 40, flutter: 12 }); __inj.dropTrain({ every: [1500, 2500], len: [120, 220] })");
        await p.eval(`__inj.follow({ key: () => "r", target: () => state.phase === "play" && overArc(scene.scroll + ROUTE_BEE_X - 10) ? (${route(-45)})() : null, ready: () => true, reaction: 150 })`);
        const tb = await waitFor(p, `state.phase === "won"`, 40000);
        const lb = await p.eval("__inj.take()");
        const bb = lb.filter((s, i) => s.ph === "bump" && (!i || lb[i - 1].ph !== "bump")).length;
        const bumpAt = lb.filter((s, i) => s.ph === "bump" && (!i || lb[i - 1].ph !== "bump")).map(s => s.x + 420);
        (siren === 2 ? check : (ok, ...r) => info(...r))(tb >= 0 && bb === 0, G, `${inst} route siren ${siren} beginner (late 0.3s, ±40c, breathes on flats)`, `${f1(tb)}, bumps ${bb}${bb ? " at x=" + bumpAt.join(",") : ""}`);
        await p.eval("__inj.reset(); next()"); await p.eval(MON);
      }
      if (siren === 2) {
        // Silence on the route: the bump is the teacher's agreed exception; it must happen only over an obstacle and restart.
        await p.take?.();
        await p.eval("__inj.take()");
        const tbump = await waitFor(p, `state.phase === "bump"`, 15000);
        const where = await p.eval("({ x: scene.scroll + ROUTE_BEE_X, obs: scene.obstacles.map(o => o.cx) })");
        const near = where.obs.some(cx => Math.abs(where.x - cx) < 50);
        const restart = await waitFor(p, `state.phase === "ready"`, 4000);
        check(tbump >= 0 && near && restart >= 0, G, `${inst} route silence → bump only at an obstacle, then restarts (agreed exception)`, `bump at x=${Math.round(where.x)} (obstacles ${where.obs.join("/")}), restart ${restart >= 0}`);
      }
      await done(p, G, `${inst} route${siren}`);
    } });
  }
  return tasks;
}

/* ======================================================================================== */
/*  Note Ninja (ninja.html)                                                                  */
/* ======================================================================================== */
const NINJA_BOT = cfg => `__inj.follow(Object.assign({ key: () => state.roundId + ":" + state.index, target: () => state.phase === "note" ? concertHz(state.target) : null,
  ready: now => now > state.muteUntil && current && now - current.born > 420, score: () => state.hits }, ${JSON.stringify(cfg)}))`;
async function ninjaRound(p, ms) {
  await p.eval("startRound()");
  const t = await waitFor(p, `state.phase === "end"`, ms, 100);
  const r = await p.eval("({ hits: state.hits, n: state.round.length, results: state.results.slice(), banner: g.banner.textContent, round: state.round.slice() })");
  const ev = await p.eval("__inj.takeEvents()");
  return { ...r, t, ev };
}
function ninjaTasks(b, srv) {
  const G = "ninja", tasks = [];
  for (const inst of INSTS) {
    tasks.push({ game: G, name: `${inst} ideal`, fn: async () => {
      const all = (await (async () => { const I = { trumpet: [60, 62, 64, 65, 67, 69, 71, 72], trombone: [46, 48, 50, 51, 53, 55, 57, 58], horn: [60, 62, 64, 65, 67, 69, 71, 72, 76] }; return I[inst]; })());
      const p = await open(b, srv, "ninja.html", { inst, ls: { ["right-note-" + inst]: { chosen: all }, ["ninja-" + inst]: { count: 10, time: 4, show: "both", ref: true } } });
      await p.eval(NINJA_BOT({ reaction: 250 }));
      const r = await ninjaRound(p, 120000);
      check(r.hits === 10 && r.n === 10, G, `${inst} ideal slices 10/10 with 4s per note, every note on`, `${r.hits}/${r.n} "${r.banner}", hold→slice ${r.ev.filter(e => e.ok).map(e => e.dt).join(",")}ms`);
      await sleep(4500);
      check(await p.eval(`state.phase === "card"`), G, `${inst} after the round the next-ninja card returns (no dead end)`);
      await done(p, G, inst);
    } });
    for (const [label, wob, drop, seed] of [["pitch", { drift: 40, flutter: 12 }, null, 21], ["dropouts", { drift: 25, flutter: 10 }, { every: [700, 1200], len: [120, 250] }, 22]]) tasks.push({ game: G, name: `${inst} beginner ${label}`, fn: async () => {
      const p = await open(b, srv, "ninja.html", { inst });         // default settings: 5 notes, 8 s, first 5 notes, reference on
      await p.eval(`__inj.wobble(${JSON.stringify(wob)})`);
      if (drop) await p.eval(`__inj.dropTrain(${JSON.stringify(drop)})`);
      await p.eval(NINJA_BOT({ reaction: 900, jitter: 600, biasSpread: 30, seed, scoop: 100 }));
      const r = await ninjaRound(p, 120000);
      check(r.hits >= 4, G, `${inst} beginner (${label === "pitch" ? "±30c off, drift ±40c" : "small dropouts 120–250ms"}) slices ≥4/5 at default settings`, `${r.hits}/${r.n} "${r.banner}", times ${r.ev.map(e => e.ok ? e.dt : "✕").join(",")}`);
      await done(p, G, inst);
    } });
    tasks.push({ game: G, name: `${inst} cheats+silence`, fn: async () => {
      const p = await open(b, srv, "ninja.html", { inst, ls: { ["ninja-" + inst]: { count: 3, time: 4, show: "both", ref: false } } });
      // Note 1 talking, note 2 noise, note 3 claps.
      await p.eval(`__inj.timers.push(setInterval(() => { if (state.phase !== "note" || window.__cheated === state.index) return; window.__cheated = state.index;
        if (state.index === 0) __inj.speech(4.5, 0.25, 4); else if (state.index === 1) { __inj.noise(0.3); setTimeout(() => __inj.noise(0), 4500); } else __inj.claps(12, 0.35); }, 50))`);
      const r = await ninjaRound(p, 30000);
      check(r.hits === 0, G, `${inst} talking/noise/claps slice nothing`, `${r.hits}/${r.n}`);
      await p.eval("__inj.reset()"); await waitFor(p, `state.phase === "card"`, 6000);
      // Silence: notes drift away (misses are the agreed exception); nothing red; the round ends kindly.
      const s = await ninjaRound(p, 30000);
      const red = await p.eval(NO_RED);
      check(s.hits === 0 && s.results.every(x => x === false) && !red.length, G, `${inst} silence → grey misses, nothing red`, `banner "${s.banner}"${red.length ? ", red: " + red.join(";") : ""}`);
      // Wrong notes (a whole step off) never slice.
      await waitFor(p, `state.phase === "card"`, 6000);
      await p.eval(NINJA_BOT({ reaction: 200, offset: 2 }));
      const w = await ninjaRound(p, 30000);
      check(w.hits === 0, G, `${inst} a whole step off never slices`, `${w.hits}/${w.n}`);
      // Picker can never be emptied.
      await p.eval("__inj.reset()"); await waitFor(p, `state.phase === "card"`, 6000);
      await p.eval(`toggleSheet(true); for (let k = 0; k < 12; k++) [...document.querySelectorAll("#noteChips .note-chip[aria-pressed=true]")].forEach(b => b.click()); toggleSheet(false)`);
      check((await p.eval("state.chosen.length")) >= 1, G, `${inst} note picker cannot be emptied`, `left ${await p.eval("JSON.stringify(state.chosen)")}`);
      await done(p, G, inst);
    } });
  }
  // How realistic are ±50 cents for 500 ms? One instrument, rounds of 5 at default settings, reference off.
  for (const [bias, drift] of [[0, 30], [40, 30], [50, 30], [60, 30], [0, 90], [30, 60], [45, 60]]) tasks.push({ game: G, name: `sweep ${bias}/${drift}`, fn: async () => {
    const p = await open(b, srv, "ninja.html", { inst: "trumpet", ls: { "ninja-trumpet": { count: 5, time: 8, show: "both", ref: false } } });
    await p.eval(`__inj.wobble({ drift: ${drift}, flutter: 10 })`);
    await p.eval(NINJA_BOT({ reaction: 300, biasSpread: 0, bias, seed: bias + drift }));
    const r = await ninjaRound(p, 90000);
    const ok = r.ev.filter(e => e.ok).map(e => e.dt);
    info(G, `tolerance sweep: steady ${bias}c off, slow drift ±${drift}c`, `${r.hits}/5 sliced, mean ${ok.length ? Math.round(ok.reduce((a, x) => a + x, 0) / ok.length) : "—"}ms`);
    await done(p, G, "sweep");
  } });
  return tasks;
}

/* ======================================================================================== */
/*  Right Note (right-note.html)                                                             */
/* ======================================================================================== */
const RIGHT_BOT = cfg => `__inj.follow(Object.assign({ key: () => String(state.target), target: () => concertHz(state.target), ready: now => now > state.muteUntil, score: () => state.stars, cooldown: 1700 }, ${JSON.stringify(cfg)}))`;
const NOTES = { trumpet: [60, 62, 64, 65, 67, 69, 71, 72], trombone: [46, 48, 50, 51, 53, 55, 57, 58], horn: [60, 62, 64, 65, 67, 69, 71, 72, 76] };
const DEF = { trumpet: [60, 62, 64, 65, 67], trombone: [46, 48, 50, 51, 53], horn: [60, 62, 64, 65, 67] };
function rightTasks(b, srv) {
  const G = "right", tasks = [];
  for (const inst of INSTS) {
    tasks.push({ game: G, name: `${inst} ideal`, fn: async () => {
      const p = await open(b, srv, "right-note.html", { inst, ls: { ["right-note-" + inst]: { chosen: NOTES[inst], order: "sequence", hold: 2, tol: "tight", ref: true } } });
      await p.eval("__inj.mon(() => ({ s: state.stars, tg: state.target }), 100)");
      await p.eval(RIGHT_BOT({ reaction: 250 }));
      const n = NOTES[inst].length;
      const t = await waitFor(p, `state.stars >= ${n}`, n * 9000);
      const log = await p.eval("__inj.take()");
      const seen = [...new Set(log.map(s => s.tg))];
      const ev = await p.eval("__inj.takeEvents()");
      check(t >= 0 && NOTES[inst].every(w => seen.includes(w)), G, `${inst} ideal holds every note (tight ±30c, hold 2s)`, `${await p.eval("state.stars")}/${n} stars, play→star ${ev.filter(e => e.ok).map(e => (e.dt / 1000).toFixed(1)).join(" ")}s`);
      check(rising(log, "s"), G, `${inst} stars only rise`);
      await done(p, G, inst);
    } });
    tasks.push({ game: G, name: `${inst} beginner`, fn: async () => {
      for (const [tol, hold] of [["normal", 3], ["wide", 2]]) {
        const p = await open(b, srv, "right-note.html", { inst, ls: { ["right-note-" + inst]: { chosen: DEF[inst], order: "random", hold, tol, ref: true } } });
        await p.eval("__inj.wobble({ drift: 40, flutter: 12 }); __inj.dropTrain({ every: [1500, 2500], len: [120, 250] })");
        await p.eval(RIGHT_BOT({ reaction: 900, jitter: 600, biasSpread: 30, seed: 31, scoop: 100 }));
        await sleep(40000);
        const ev = await p.eval("__inj.takeEvents()");
        const stars = await p.eval("state.stars");
        check(stars >= 4, G, `${inst} beginner (±30c off, drift ±40c, dropouts) at ${tol}/${hold}s gets ≥4 notes in 40s`, `${stars} stars, play→star ${ev.filter(e => e.ok).map(e => (e.dt / 1000).toFixed(1)).join(" ")}s`);
        await done(p, G, inst);
      }
    } });
    tasks.push({ game: G, name: `${inst} cheats`, fn: async () => {
      const p = await open(b, srv, "right-note.html", { inst, ls: { ["right-note-" + inst]: { chosen: DEF[inst], order: "sequence", hold: 2, tol: "wide", ref: false } } });
      await p.eval("__inj.mon(() => ({ s: state.stars, h: state.holdProgress }), 50)");
      await p.eval("__inj.speech(5, 0.25, 6); __inj.claps(10, 0.45)"); await sleep(5500);
      await p.eval("__inj.noise(0.3)"); await sleep(3000); await p.eval("__inj.noise(0)"); await sleep(4000);
      const log = await p.eval("__inj.take()");
      const maxH = Math.max(...log.map(s => s.h));
      check(log.at(-1).s === 0 && maxH < 0.2, G, `${inst} talking/claps/noise/silence give no star`, `stars ${log.at(-1).s}, max hold ${maxH.toFixed(2)}`);
      const red = await p.eval(NO_RED);
      check(!red.length, G, `${inst} nothing red`, red.join(", "));
      // A child who searches for the note without stopping: 16 s a semitone off, then on the note.
      const s0 = await p.eval("state.stars");
      await p.eval("__inj.tone(concertHz(state.target) * Math.pow(2, 1 / 12), 0.15)"); await sleep(16000);
      const floor = await p.eval("({ f: state.noiseFloor, r: state.rms })");
      await p.eval("__inj.retune(concertHz(state.target))");
      const found = await waitFor(p, `state.stars > ${s0}`, 8000);
      await p.eval("__inj.off()");
      check(found >= 0, G, `${inst} after 16 s of searching without a breath, the right note still wins`, `${found >= 0 ? "star after " + f1(found) : "no star in 8 s"}; floor rose to ${(20 * Math.log10(floor.f / floor.r)).toFixed(1)} dB under the tone (gate is +12 dB)`);
      await p.eval(`toggleSheet(true); for (let k = 0; k < 12; k++) [...document.querySelectorAll("#noteChips .note-chip[aria-pressed=true]")].forEach(b => b.click()); toggleSheet(false)`);
      check((await p.eval("state.chosen.length")) >= 1, G, `${inst} note picker cannot be emptied`);
      await done(p, G, inst);
    } });
  }
  return tasks;
}

/* ======================================================================================== */
/*  Ladder (horn-ladder.html)                                                                */
/* ======================================================================================== */
const LADDER_BOT = cfg => `__inj.follow(Object.assign({ key: () => String(state.target), target: () => state.mode === "aim" ? hzOf(state.target) : null, ready: now => now > state.muteUntil && now > state.celebrateUntil, score: () => state.bananas, cooldown: 1900 }, ${JSON.stringify(cfg)}))`;
const LADDER = { horn: { lo: 2, hi: 12, open: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12] }, trumpet: { lo: 2, hi: 6, open: [2, 3, 4, 5, 6] }, trombone: { lo: 2, hi: 6, open: [2, 3, 4, 5, 6] } };
function ladderTasks(b, srv) {
  const G = "ladder", tasks = [];
  const key = inst => inst === "horn" ? "horn-ladder" : "horn-ladder-" + inst;
  for (const inst of INSTS) {
    for (const kind of ["open", "scale"]) tasks.push({ game: G, name: `${inst} ${kind} ideal`, fn: async () => {
      const L = LADDER[inst], targets = kind === "open" ? L.open : NOTES[inst];
      const p = await open(b, srv, "horn-ladder.html", { inst, ls: { [key(inst)]: { mode: "aim", kind, lo: L.lo, hi: L.hi, order: "sequence", [kind === "open" ? "targets" : "scaleTargets"]: targets, hold: 1, tol: "normal", ref: true }, ["right-note-" + inst]: { chosen: NOTES[inst] } } });
      const shown = await p.eval("shown()");
      await p.eval("__inj.mon(() => ({ b: state.bananas, tg: state.target }), 100)");
      await p.eval(LADDER_BOT({ reaction: 250 }));
      const t = await waitFor(p, `state.bananas >= ${shown.length}`, shown.length * 9000);
      const log = await p.eval("__inj.take()");
      const visited = [...new Set(log.map(s => s.tg))];
      check(t >= 0 && shown.every(n => visited.includes(n)), G, `${inst} ${kind} ideal gets a banana on every rung (${shown.length})`, `${await p.eval("state.bananas")} bananas in ${f1(t)}`);
      check(rising(log, "b"), G, `${inst} ${kind} bananas only rise`);
      // Explore: the monkey climbs to every rung played.
      await p.eval("__inj.reset(); setMode('explore')");
      await waitFor(p, "performance.now() > state.muteUntil + 100", 8000);     // the next banana's reference is still playing
      const wrong = [];
      for (const n of shown) {
        await p.eval(`__inj.tone(hzOf(${n}), 0.15)`); await sleep(900);
        if ((await p.eval("state.rung")) !== n) wrong.push(n);
      }
      await p.eval("__inj.off()"); await sleep(800);
      const after = await p.eval("state.rung");
      check(!wrong.length && after === shown.at(-1), G, `${inst} ${kind} explore: the monkey follows every rung, stays put in silence`, wrong.length ? `missed ${wrong}` : `${shown.length} rungs`);
      await done(p, G, `${inst} ${kind}`);
    } });
    tasks.push({ game: G, name: `${inst} beginner+cheats`, fn: async () => {
      // First visit defaults (open for horn, step-by-step for trumpet/trombone), banana mode.
      const p = await open(b, srv, "horn-ladder.html", { inst, ls: { [key(inst)]: { mode: "aim" } } });
      const st = await p.eval("({ kind: state.kind, targets: state.targets.slice(), shown: shown() })");
      await p.eval("__inj.mon(() => ({ b: state.bananas, r: state.rung }), 50)");
      await p.eval("__inj.speech(4, 0.25, 8); __inj.claps(10, 0.4)"); await sleep(4500);
      await p.eval("__inj.noise(0.3)"); await sleep(2500); await p.eval("__inj.noise(0)"); await sleep(1500);
      const lc = await p.eval("__inj.take()");
      const climbed = lc.filter(s => s.r !== null).length;
      check(lc.at(-1).b === 0, G, `${inst} talking/claps/noise give no banana`, `monkey on a rung in ${climbed} of ${lc.length} samples`);
      if (climbed) info(G, `${inst} talking moved the monkey`, `rungs ${[...new Set(lc.map(s => s.r))].join(",")}`);
      await p.eval("__inj.wobble({ drift: 40, flutter: 12 }); __inj.dropTrain({ every: [1500, 2500], len: [120, 250] })");
      await p.eval(LADDER_BOT({ reaction: 900, jitter: 600, biasSpread: 25, seed: 41, scoop: 100 }));
      await sleep(30000);
      const bananas = await p.eval("state.bananas");
      check(bananas >= 3, G, `${inst} beginner (${st.kind}, bananas ${st.targets.join("/")}, hold 2s ±50c) gets ≥3 bananas in 30s`, `${bananas}`);
      const red = await p.eval(NO_RED);
      check(!red.length, G, `${inst} nothing red`, red.join(", "));
      await done(p, G, inst);
    } });
  }
  return tasks;
}

/* ======================================================================================== */
/*  Breathing (balloon-breath.html)                                                          */
/* ======================================================================================== */
function breathTasks(b, srv) {
  const G = "breath", tasks = [];
  for (const world of ["bubble", "dandelion"]) tasks.push({ game: G, name: world, fn: async () => {
    const p = await open(b, srv, "balloon-breath.html", { query: "&world=" + world, ls: { breath: { level: 1, sound: true, world } }, start: "press()" });
    await waitFor(p, `state.phase === "idle"`, 12000);
    await p.eval("__inj.mon(() => ({ ph: state.phase, m: state.made, bl: state.blowing }), 50)");
    for (const L of [1, 2, 3, 4]) {
      await p.eval(`setLevel(${L})`);
      const m0 = await p.eval("state.made");
      await p.eval("press()");
      await sleep(300); await p.eval("press()");                          // a second tap mid-breath is ignored
      if (L === 1) { await sleep(4000); await p.eval("__inj.noise(0.15)"); }
      const t = await waitFor(p, "state.made > " + m0, (4 + L * 4 + 3) * 1000);
      await p.eval("__inj.noise(0)");
      await waitFor(p, `state.phase === "idle"`, 4000);
      const log = await p.eval("__inj.take()");
      const outMs = (() => { const a = log.find(s => s.ph === "out"), z = log.findLast(s => s.ph === "out"); return a && z ? z.t - a.t + 50 : 0; })();
      const blew = log.some(s => s.bl);
      check(t >= 0 && (await p.eval("state.made")) === m0 + 1 && Math.abs(outMs - L * 4000) < 300, G, `${world} level ${L}: ${L === 1 ? "blowing" : "silence"} still makes one ${world}`, `blow-out phase ${outMs}ms${L === 1 ? ", breeze golden " + blew : ""}`);
    }
    // Talking and claps also turn the breeze golden (any loud sound is "blowing"); only a glow, never a stop.
    await p.eval("setLevel(1); press()"); await sleep(4200);
    await p.eval("__inj.speech(2.5, 0.25, 2)"); await sleep(2600);
    const log = await p.eval("__inj.take()");
    info(G, `${world} talking during blow-out`, `breeze golden in ${log.filter(s => s.bl).length} of ${log.filter(s => s.ph === "out").length} samples`);
    await waitFor(p, `state.phase === "idle"`, 6000);
    const red = await p.eval(NO_RED);
    check(!red.length, G, `${world} nothing red`, red.join(", "));
    await done(p, G, world);
  } });
  return tasks;
}

/* ======================================================================================== */
/*  Songs (songs.html)                                                                       */
/* ======================================================================================== */
const SONG_IDS = ["steps", "hotcross", "auclair", "walk", "mary", "rhody", "echo", "yonatan", "ode", "jingle", "twinkle", "london",
  "oldman", "michael", "oldmac", "chanukah"];   // the static group fails if songs.html has one this list lacks
async function songsPage(b, srv, inst, extra = {}) {
  const p = await open(b, srv, "songs.html", { inst, ls: { ["right-note-" + inst]: { chosen: extra.chosen || NOTES[inst] }, songs: { mode: extra.mode || "follow", tempo: extra.tempo || 60, band: true, guide: false, repeat: "attack" } } });
  return p;
}
const FOLLOW_BOT = cfg => `__inj.follow(Object.assign({ key: () => state.phase + ":" + state.cursor, target: () => state.phase === "follow" ? concertHz(writtenOf(state.song.events[state.cursor].step)) : null, ready: () => true }, ${JSON.stringify(cfg)}))`;
// In time: the player reads ahead and plays each note on the beat (late/jitter ms), with a short gap before the next.
function timePlayer(cfg) {
  const P = __inj, r = P.rngOf(cfg.seed || 3);
  let run = null;                                   // one performance per start(): its t0, what is scheduled, each note's slop
  const id = setInterval(() => {
    if (state.phase !== "count" && state.phase !== "time") { run = null; return; }
    if (!run || run.t0 !== state.t0) run = { t0: state.t0, sched: new Set(), slop: {} };
    const now = performance.now(), bm = beatMs();
    sectionEvents().forEach(i => {
      if (run.sched.has(i)) return;
      if (!run.slop[i]) run.slop[i] = { j: (r() * 2 - 1) * (cfg.jitter || 0), b: cfg.biasSpread ? (r() * 2 - 1) * cfg.biasSpread : 0 };
      const e = state.song.events[i], on = state.t0 + e.start * bm + (cfg.late || 0) + run.slop[i].j;
      if (on - now > 300) return;
      run.sched.add(i);
      const off = state.t0 + (e.start + e.dur) * bm + (cfg.late || 0) - (cfg.gap || 70);
      P.note(concertHz(writtenOf(e.step)) * Math.pow(2, run.slop[i].b / 1200), Math.max(0, (on - now) / 1000), Math.max(0.05, (off - on) / 1000), cfg.gain || 0.15, cfg.scoop || 0);
    });
  }, 25);
  P.timers.push(id);
}
async function playSong(p, id, mode, ms) {
  await p.eval(`chooseSong(SONGS.find(s => s.id === ${JSON.stringify(id)})); start()`);
  const t = await waitFor(p, `state.phase === "end"`, ms, 100);
  const r = await p.eval("({ done: state.done.size, skipped: state.skipped.size, total: sectionEvents().length, banner: g.banner.textContent })");
  return { ...r, t };
}
function songsTasks(b, srv) {
  const G = "songs", tasks = [];
  for (const inst of INSTS) {
    // Follow mode, ideal: every song, every instrument.
    for (const part of [SONG_IDS.slice(0, 6), SONG_IDS.slice(6, 11), SONG_IDS.slice(11)]) tasks.push({ game: G, name: `${inst} follow ideal`, fn: async () => {
      const p = await songsPage(b, srv, inst);
      await p.eval(FOLLOW_BOT({ reaction: 80 }));
      for (const id of part) {
        const r = await playSong(p, id, "follow", 60000);
        check(r.t >= 0 && r.done === r.total && r.skipped === 0, G, `${inst} follow ideal "${id}"`, `${r.done}/${r.total} green, ${r.skipped} skipped, ${f1(r.t)}`);
        await waitFor(p, `state.phase === "ready"`, 5000);
      }
      await done(p, G, inst);
    } });
    tasks.push({ game: G, name: `${inst} follow beginner`, fn: async () => {
      const p = await songsPage(b, srv, inst, { chosen: DEF[inst] });
      await p.eval("__inj.wobble({ drift: 35, flutter: 12 }); __inj.dropTrain({ every: [1200, 2200], len: [100, 220] })");
      await p.eval(FOLLOW_BOT({ reaction: 450, jitter: 500, biasSpread: 25, seed: 51, scoop: 80 }));
      for (const id of ["steps", "hotcross", "mary"]) {
        const r = await playSong(p, id, "follow", 90000);
        check(r.t >= 0, G, `${inst} follow beginner finishes "${id}"`, `${r.done}/${r.total} green, ${r.skipped} light-green skips, ${f1(r.t)}`);
        await waitFor(p, `state.phase === "ready"`, 5000);
      }
      // Cheats: talking/claps/noise never move the cursor.
      await p.eval("__inj.reset()");
      await p.eval(`chooseSong(SONGS.find(s => s.id === "steps")); start()`);
      await p.eval("__inj.speech(4, 0.25, 7); __inj.claps(10, 0.4)"); await sleep(4500);
      await p.eval("__inj.noise(0.3)"); await sleep(2000); await p.eval("__inj.noise(0)"); await sleep(500);
      const c = await p.eval("({ cur: state.cursor, done: state.done.size })");
      check(c.cur === 0 && c.done === 0, G, `${inst} talking/claps/noise do not advance a song`, `cursor ${c.cur}`);
      // Dead ends: no playable song → the big "choose notes" button; default notes → some songs open.
      await p.eval(`stopPlaying(); state.chosen = [INSTRUMENTS[state.inst].notes.at(-1)]; showList()`);
      const empty = await p.eval(`({ empty: !$("empty").hidden, open: SONGS.filter(playable).length })`);
      await p.eval(`state.chosen = INSTRUMENTS[state.inst].def.slice(); showList()`);
      const def = await p.eval(`({ empty: !$("empty").hidden, open: SONGS.filter(playable).map(s => s.id) })`);
      check(empty.empty && empty.open === 0 && !def.empty && def.open.length > 0, G, `${inst} no playable song → choose-notes button; default notes open ${def.open.length} songs`, def.open.join(" "));
      await done(p, G, inst);
    } });
    // In time, ideal player at the fastest tempo (90): trumpet all songs, the others three songs.
    const timeSets = inst === "trumpet" ? [SONG_IDS.slice(0, 4), SONG_IDS.slice(4, 8), SONG_IDS.slice(8)] : [["hotcross", "ode", "jingle"]];
    for (const set of timeSets) tasks.push({ game: G, name: `${inst} time ideal`, fn: async () => {
      const p = await songsPage(b, srv, inst, { mode: "time", tempo: 90 });
      await p.eval(`(${timePlayer})({ gap: 60 })`);
      for (const id of set) {
        const r = await playSong(p, id, "time", 70000);
        check(r.done === r.total, G, `${inst} in time ♩=90 ideal "${id}" all notes green`, `${r.done}/${r.total} "${r.banner}"`);
        await waitFor(p, `state.phase === "ready"`, 5000);
      }
      await done(p, G, inst);
    } });
    tasks.push({ game: G, name: `${inst} time beginner`, fn: async () => {
      const p = await songsPage(b, srv, inst, { mode: "time", tempo: 60, chosen: DEF[inst] });
      await p.eval("__inj.wobble({ drift: 30, flutter: 10 })");
      await p.eval(`(${timePlayer})({ gap: 90, late: 120, jitter: 90, biasSpread: 20, scoop: 80, seed: 7 })`);
      for (const id of ["steps", "hotcross"]) {
        const r = await playSong(p, id, "time", 60000);
        check(r.done >= r.total * 0.5, G, `${inst} in time ♩=60 beginner (≈120ms late ±90, ±20c) "${id}" ≥ half green`, `${r.done}/${r.total} "${r.banner}"`);
        await waitFor(p, `state.phase === "ready"`, 5000);
      }
      // Silence in time: nothing green, the end is still kind.
      await p.eval("__inj.reset()");
      const s = await playSong(p, "steps", "time", 60000);
      check(s.done === 0 && s.t >= 0, G, `${inst} silence in time: song runs to the end, nothing marked`, `"${s.banner}"`);
      await done(p, G, inst);
    } });
  }
  // How late can a child be in time and still get the notes? Ode to Joy at ♩=90 (eighths) and ♩=60.
  if (INSTS.includes("trumpet")) for (const [tempo, late] of [[90, 150], [90, 250], [60, 250], [60, 400]]) tasks.push({ game: G, name: `late ${tempo}/${late}`, fn: async () => {
    const p = await songsPage(b, srv, "trumpet", { mode: "time", tempo });
    await p.eval(`(${timePlayer})({ gap: 60, late: ${late} })`);
    const r = await playSong(p, "ode", "time", 60000);
    info(G, `in time ♩=${tempo}, every note ${late} ms late ("ode")`, `${r.done}/${r.total} green "${r.banner}"`);
    await done(p, G, "late");
  } });
  return tasks;
}

/* ======================================================================================== */
/*  Clap-Along (clap-along.html): rhythm generator, quiz distractors, a live round           */
/* ======================================================================================== */
function clapProbe(N) {
  const rngOf = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const HELD = ["h", "hr", "dh", "w"];
  return LEVELS.map((L, li) => {
    const rng = rngOf(1000 + li), upb = L.beats * 4, bad = {}, sigs = new Set();
    const note = (k, ex) => { bad[k] = (bad[k] || 0) + 1; if (!bad[k + "Ex"]) bad[k + "Ex"] = ex; };
    let minIoi = 99, far = 0, maxIoiUnits = 0, onsetsPerBar = [];
    for (let n = 0; n < N; n++) {
      const p = generatePhrase(li, new Set(), rng);
      sigs.add(p.sig);
      if (p.bars.length !== L.bars) note("barCount", p.bars.length);
      p.bars.forEach(bar => {
        let pos = 0;
        for (const c of bar) { if (c.pos !== pos) note("gap", JSON.stringify(bar)); pos += CELLS[c.id].len; if (HELD.includes(c.id)) note("held", c.id); if (!(c.id in L.pool)) note("notInPool", c.id); }
        if (pos !== upb) note("barSum", pos);
        if (!barValid(L, bar)) note("invalid", JSON.stringify(bar));
        onsetsPerBar.push(bar.reduce((t, c) => t + CELLS[c.id].ev.filter(e => !e[1]).length, 0));
      });
      if (L.need.length && !hasAny(p.bars, L.need)) note("need", L.need);
      if (p.bars.length > 1 && sameBar(p.bars[0], p.bars[1])) note("sameBars", "");
      if (p.onsets.length < 2) note("fewOnsets", p.onsets.length);
      for (let i = 1; i < p.onsets.length; i++) minIoi = Math.min(minIoi, p.onsets[i] - p.onsets[i - 1]);
      const d = makeDistractors(p, rng);
      if (d.length !== 2) note("distractorCount", d.length);
      const all = [p.sig, ...d.map(x => x.sig)];
      if (new Set(all).size !== 3) note("distractorSame", all.join(" | "));
      d.forEach(x => {
        if (x.li !== li) note("distractorLevel", x.li);
        x.bars.forEach(bar => { if (!barValid(L, bar) || bar.reduce((t, c) => t + CELLS[c.id].len, 0) !== upb) note("distractorBar", JSON.stringify(bar)); if (bar.some(c => HELD.includes(c.id))) note("distractorHeld", ""); });
        if (onsetDiff(x, p) > 3) far++;
      });
    }
    const beat = 60000 / L.bpm;
    return { li, name: L.name, beats: L.beats, bars: L.bars, bpm: L.bpm, bad, distinct: sigs.size, minIoiMs: Math.round(minIoi * beat / 4), farDistractors: far,
      avgOnsetsPerBar: +(onsetsPerBar.reduce((a, x) => a + x, 0) / onsetsPerBar.length).toFixed(2), pool: Object.keys(L.pool).join(",") };
  });
}
function clapTasks(b, srv) {
  const G = "clap";
  return [{ game: G, name: "generator", fn: async () => {
    const p = await open(b, srv, "clap-along.html", { start: null });
    const N = 3000;
    const levels = await p.eval(`(${clapProbe})(${N})`);
    for (const L of levels) {
      const errs = Object.entries(L.bad).filter(([k]) => !k.endsWith("Ex"));
      check(!errs.length, G, `level ${L.li + 1} (${L.name}) ${N} phrases + distractors obey the rules`, errs.length ? errs.map(([k, v]) => `${k}×${v} e.g. ${L.bad[k + "Ex"]}`).join("; ").slice(0, 300) : `${L.beats}/4, ${L.bars} bar(s), ${L.distinct} distinct, ≈${L.avgOnsetsPerBar} claps/bar, fastest gap ${L.minIoiMs}ms at ♩=${L.bpm}, distractors >3 onsets away ${L.farDistractors}`);
    }
    const L4 = levels[3];
    check(L4.beats === 3 && !L4.bad.barSum, G, "level 4 is really 3/4 (12-unit bars)");
    info(G, "fastest clap gap per level (ms)", levels.map(L => `${L.li + 1}:${L.minIoiMs}`).join(" "));
    info(G, "pool per level", levels.map(L => `${L.li + 1}:{${L.pool}}`).join(" "));
    const hasDetect = await p.eval(`typeof navigator.mediaDevices !== "undefined" && document.documentElement.outerHTML.includes("getUserMedia")`);
    info(G, "clap timing windows", hasDetect ? "page listens to claps" : "no microphone: claps are never detected or judged (Echo always ends 👍)");
    // A live round, echo, every level: the schedule matches the level (count-in = one bar, echo doubles the phrase).
    await p.eval(`window.__s = []; const o = Sound.schedule; Sound.schedule = function (a) { const r = o.call(this, a); window.__s.push({ a: { beats: a.beats, bars: a.bars, bpm: a.bpm, withClap: a.withClap, n: a.onsets.length }, total: r.total }); return r; }`);
    const lv = [];
    for (const li of [0, 3, 8]) {
      await p.eval(`setLevel(${li}); primary()`);
      const t = await waitFor(p, `state.phase === "done"`, 30000);
      const s = await p.eval("window.__s.at(-1)");
      const cue = await p.eval(`$("cueGlyph").textContent`);
      const L = levels[li];
      const expect = (L.beats + 2 * L.beats * L.bars) * 60 / L.bpm;
      lv.push(`${li + 1}: ${s.a.beats}/4 ${f1(t)} cue ${cue}`);
      check(t >= 0 && s.a.withClap && Math.abs(s.total - expect) < 0.01 && cue === "👍", G, `level ${li + 1} echo round: count-in bar, phrase, echo, ends kindly`, `${s.total.toFixed(2)}s scheduled, ${s.a.n} claps`);
    }
    // Quiz: an answer before hearing is ignored; after, one right and one wrong path.
    await p.eval("setMode('quiz'); setLevel(1)");
    await p.eval("answer(0)");
    check(await p.eval("state.quiz.picked === null"), G, "quiz ignores an answer before the rhythm was heard");
    await p.eval("primary()"); await waitFor(p, `state.phase === "done"`, 30000);
    await p.eval("answer(state.quiz.answer)");
    const right = await p.eval(`({ cls: $("qrow" + state.quiz.answer).className, cue: $("cueGlyph").textContent })`);
    await p.eval("primary()"); await waitFor(p, `state.phase === "done"`, 30000);
    await p.eval("answer((state.quiz.answer + 1) % 3)");
    const wrong = await p.eval(`({ cls: $("qrow" + ((state.quiz.answer + 1) % 3)).className, ok: $("qrow" + state.quiz.answer).className, cue: $("cueGlyph").textContent, bg: getComputedStyle($("qrow" + ((state.quiz.answer + 1) % 3))).backgroundColor })`);
    check(/correct/.test(right.cls) && /correct/.test(wrong.ok) && /wrong/.test(wrong.cls), G, "quiz marks right and wrong answers, shows the right one", `wrong answer row background ${wrong.bg}, cue ${wrong.cue}`);
    await done(p, G, "clap");
  } }];
}

/* ======================================================================================== */
/*  Note Names (note-names.html): no microphone; quiz fairness                               */
/* ======================================================================================== */
function namesTasks(b, srv) {
  const G = "names";
  return [{ game: G, name: "quiz", fn: async () => {
    for (const inst of INSTS) {
      const p = await open(b, srv, "note-names.html", { inst, start: null, ls: { "brass-lang": "he" } });
      const r = await p.eval(`(() => {
        const out = [];
        for (let lv = 1; lv <= LEVEL_COUNT; lv++) {
          setLevel(lv); setMode("quiz");
          const names = [...new Set(levelNotes().map(nameOf))], seq = [];
          let miss = 0;
          for (let i = 0; i < 300; i++) { nextNote(); seq.push(state.last); const btn = [...document.querySelectorAll("#answers .answer")].map(b => b.dataset.name); if (!btn.includes(nameOf(state.current))) miss++; }
          let repeats = 0; for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) repeats++;
          // Can a child who never reads the staff guess? Best "not the last one" guessing: 1/(n-1).
          out.push({ lv, notes: levelNotes().length, buttons: names.length, miss, repeats, guess: +(1 / Math.max(1, levelNotes().length - 1)).toFixed(2) });
        }
        return out;
      })()`);
      check(r.every(x => x.miss === 0), G, `${inst} every quiz note has its answer button`, r.map(x => `${x.lv}:${x.notes}n/${x.buttons}b`).join(" "));
      check(r.every((x, i) => !i || x.notes === r[i - 1].notes + 1), G, `${inst} each level adds one note`);
      info(G, `${inst} quiz never repeats a note twice in a row → guessable by elimination`, r.map(x => `L${x.lv} ${Math.round(x.guess * 100)}%`).join(" "));
      await done(p, G, inst);
    }
  } }];
}

/* ======================================================================================== */
/*  Pause, across games: Esc pauses and freezes the game, Space/Esc resumes                  */
/* ======================================================================================== */
function pauseTasks(b, srv) {
  const G = "pause";
  const games = [
    ["sound-game.html", "startMic()", "setLevel(3); __inj.tone(233, 0.15)", "state.a", "__inj.off()", "state.phase", "play"],
    ["buzz-along.html", "startMic()", "setStep(1); __inj.tone(233, 0.15)", "scene.scroll", "__inj.off()"],
    ["balloon-breath.html", "press()", "setLevel(4); press()", "state.phaseT", ""],
    ["ninja.html", "startMic()", "startRound()", "state.elapsed", ""],
    ["right-note.html", "startMic()", "__inj.tone(concertHz(state.target), 0.15)", "state.holdProgress", "__inj.off()"],
    ["horn-ladder.html", "startMic()", "setMode('aim'); __inj.tone(hzOf(state.target), 0.15)", "state.holdProgress", "__inj.off()"],
    ["songs.html", "startMic()", "state.mode = 'time'; chooseSong(SONGS[0]); start()", "performance.now() - state.t0", ""],
    ["clap-along.html", null, "primary()", "Sound.now()", ""]
  ];
  return [{ game: G, name: "all", fn: async () => {
    const rows = [];
    for (const [file, start, go, probe, stop, after, expect] of games) {
      const p = await open(b, srv, file, { start, ls: { "ninja-trumpet": { count: 3, time: 12, show: "both", ref: false }, "right-note-trumpet": { chosen: [60, 62], hold: 5, ref: false } } });
      await p.eval(go); await sleep(2300);
      await p.key("Escape"); await sleep(150);
      const box = await p.eval(`!document.getElementById("pauseBox").hidden`);
      const v0 = await p.eval(probe); await sleep(1500); const v1 = await p.eval(probe);
      await p.key("Space"); await sleep(200);
      const resumed = await p.eval(`document.getElementById("pauseBox").hidden`);
      const v2 = await p.eval(probe); await sleep(600); const v3 = await p.eval(probe);
      if (after) { const got = await p.eval(after); check(got === expect, G, `${file} still playing through a pause: ${after} stays ${expect}`, `after resume ${after} = ${got}`); }
      if (stop) await p.eval(stop);
      const frozen = Math.abs(v1 - v0) < 1e-3 * Math.max(1, Math.abs(v0));
      const moves = v3 !== v2;
      rows.push(`${file.replace(".html", "")}: frozen ${frozen}, resumed ${resumed}`);
      check(box && frozen && resumed && moves, G, `${file} Esc pauses (game frozen), Space resumes`, `${probe} ${(+v0).toFixed(2)}→${(+v1).toFixed(2)} paused, then ${(+v2).toFixed(2)}→${(+v3).toFixed(2)}`);
      await done(p, G, file);
    }
  } }];
}

/* ======================================================================================== */
/*  Real brass: the app's own recordings (sounds/<inst>/, Univ. of Iowa) looped into the detectors */
/* ======================================================================================== */
// A recording, looped like the ladder's ?test=horn, straight into the (swapped) analyser.
function recLoop(buffer, rate, gain) {
  if (window.__recSrc) try { window.__recSrc.stop(); } catch (_) {}
  if (!buffer) return;
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = buffer; s.loop = true; s.loopStart = 0.4; s.loopEnd = Math.min(1.5, buffer.duration - 0.1); s.playbackRate.value = rate;
  g.gain.value = gain; s.connect(g); g.connect(analyser); s.start();
  window.__recSrc = s;
}
function realTasks(b, srv) {
  const G = "real", tasks = [];
  for (const inst of INSTS) tasks.push({ game: G, name: inst, fn: async () => {
    // Ninja (same detector settings as Right Note and Songs): every pickable note, played by the real instrument.
    const p = await open(b, srv, "ninja.html", { inst });
    await p.eval("loadSamples(state.inst)");
    const rows = [], bad = [];
    for (const w of NOTES[inst]) {
      await p.eval(`state.target = ${w}; (${recLoop})((sampleFor(${w}) || {}).buffer, (sampleFor(${w}) || {}).rate, 0.6)`);
      await sleep(500);
      const xs = [];
      for (let i = 0; i < 24; i++) { xs.push(await p.eval("state.heard ? +state.cents.toFixed(0) : null")); await sleep(50); }
      const heard = xs.filter(x => x !== null), med = heard.length ? heard.slice().sort((a, c) => a - c)[heard.length >> 1] : null;
      const inBand = heard.filter(x => Math.abs(x) < 50).length / xs.length;
      rows.push(`${w}:${med === null ? "—" : (med > 0 ? "+" : "") + med}c/${Math.round(inBand * 100)}%`);
      if (med === null || Math.abs(med) > 30 || inBand < 0.6) bad.push(w);
    }
    await p.eval(`(${recLoop})(null)`);
    check(!bad.length, G, `${inst} real recordings of every pickable note are heard in tune (ninja/right-note/songs detector)`, `median cents / time in ±50c: ${rows.join(" ")}`);
    // Notes the detector often misreads: how does Right Note (hold 3 s, ±50c, drains when off) feel on them?
    const weak = NOTES[inst].filter((w, i) => +rows[i].split("/")[1].replace("%", "") < 80);
    for (const w of weak) {
      const smp = await p.eval(`(w => { const concert = w - INSTRUMENTS[state.inst].toWritten; let best = null, dist = 99; for (const name in SAMPLES[state.inst]) { const pc = PC_NAME.indexOf(name.slice(0, -1)), midi = (+name.slice(-1) + 1) * 12 + pc; if (Math.abs(midi - concert) < dist) { best = { name, midi }; dist = Math.abs(midi - concert); } } return { name: best.name, rate: concertHz(w) / (440 * Math.pow(2, (best.midi - 69 + SAMPLES[state.inst][best.name] / 100) / 12)) }; })(${w})`);
      const rp = await open(b, srv, "right-note.html", { inst, ls: { ["right-note-" + inst]: { chosen: [w], order: "sequence", hold: 3, tol: "normal", ref: false } } });
      await rp.eval("__inj.mon(() => ({ w: state.clarity > 0.6 && state.soundOn ? Math.round(69 + 12 * Math.log2(state.freq / 440) + INSTRUMENTS[state.inst].toWritten) : null, h: +state.holdProgress.toFixed(2) }), 50)");
      await rp.eval(`fetch("sounds/${inst}/${smp.name}.m4a").then(r => r.arrayBuffer()).then(a => ctx.decodeAudioData(a)).then(buf => (${recLoop})(buf, ${smp.rate}, 0.6))`);
      const t = await waitFor(rp, "state.stars >= 1", 20000);
      await rp.eval(`(${recLoop})(null)`);
      const lg = await rp.eval("__inj.take()"), shown = lg.filter(x => x.w !== null);
      const octave = shown.filter(x => Math.abs(x.w - w) >= 6).length;
      check(t >= 0 && t < 6000, G, `${inst} Right Note on the real recording of written ${w} (hold 3 s) gives a star within 6 s`, `${t >= 0 ? "star after " + f1(t) : "no star in 20 s"}; the played note is drawn an octave away in ${Math.round(100 * octave / Math.max(1, shown.length))}% of frames`);
      await done(rp, G, inst + " right " + w);
    }
    // A whole Ninja round played on the real recordings: every note on, 10 notes, 8 s each, no reference.
    await p.eval(`state.chosen = ${JSON.stringify(NOTES[inst])}; state.count = 10; state.time = 8; state.ref = false;
      window.__rk = null; __inj.timers.push(setInterval(() => {
        const k = state.phase === "note" ? state.roundId + ":" + state.index : null;
        if (k !== window.__rk) { (${recLoop})(null); window.__rk = k; window.__rat = performance.now() + 300; window.__on = false; }
        if (k && !window.__on && performance.now() > window.__rat && current && performance.now() - current.born > 420) { const s = sampleFor(state.target); (${recLoop})(s.buffer, s.rate, 0.6); window.__on = true; }
      }, 20))`);
    const r = await ninjaRound(p, 150000);
    await p.eval(`(${recLoop})(null)`);
    const missed = r.round.filter((w, i) => r.results[i] === false);
    check(r.hits === r.n, G, `${inst} Ninja round on real recordings (10 notes, all notes on) slices every note`, `${r.hits}/${r.n}${missed.length ? ", missed written " + missed.join(",") : ""}`);
    await done(p, G, inst);
    // Songs, follow mode, played on the real recordings (with a short gap between notes): Twinkle uses step 6 (written A).
    const sp = await songsPage(b, srv, inst);
    await sp.eval("loadSamples(state.inst)");
    await sp.eval(`window.__rk = null; __inj.timers.push(setInterval(() => {
        const k = state.phase === "follow" ? state.cursor : null;
        if (k !== window.__rk) { (${recLoop})(null); window.__rk = k; window.__rat = performance.now() + 80; window.__on = false; }
        if (k !== null && !window.__on && performance.now() > window.__rat) { const s = sampleFor(writtenOf(state.song.events[k].step)); (${recLoop})(s.buffer, s.rate, 0.6); window.__on = true; }
      }, 20))`);
    for (const id of ["twinkle", "steps"]) {
      const r = await playSong(sp, id, "follow", 45000);
      check(r.t >= 0 && r.t < 30000 && r.skipped === 0, G, `${inst} Songs follow "${id}" on real recordings flows (no stalls, no skips)`, `${r.t >= 0 ? f1(r.t) : "not finished in 45 s"}, ${r.done}/${r.total} green, ${r.skipped} skipped`);
      await sp.eval(`(${recLoop})(null)`);
      await waitFor(sp, `state.phase === "ready"`, 5000);
    }
    await done(sp, G, inst + " songs");
    // Long Note: the instrument's first note, real recording, flies the rocket to level 1's goal.
    const q = await open(b, srv, "sound-game.html", { inst });
    await q.eval("setLevel(1)");
    const name = { trumpet: "Bb3", trombone: "Bb2", horn: "F3" }[inst];
    await q.eval(`fetch("sounds/${inst}/${name}.m4a").then(r => r.arrayBuffer()).then(a => ctx.decodeAudioData(a)).then(buf => (${recLoop})(buf, 1, 0.6))`);
    const won = await waitFor(q, `state.phase === "won"`, 7000);
    await q.eval(`(${recLoop})(null)`);
    check(won >= 0, G, `${inst} Long Note: a real ${name} recording flies to the 4 s goal`, `won at ${f1(won)}`);
    await done(q, G, inst);
  } });
  return tasks;
}

/* ---------- Main ---------- */
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
async function main() {
process.env.CHROME_TAG ||= "tonebee-play";      // our Chrome's profile name, so another run's `pkill -f tonebee-chrome` misses it
const srv = await serve();
const b = await launch();
let closing = false;
const quit = async (code, why) => { if (closing) return; closing = true; if (why) console.log(why); await Promise.race([b.close(), sleep(3000)]); process.exit(code); };
const watchdog = setTimeout(() => quit(2, "FAIL watchdog: run took over 25 minutes"), 25 * 60 * 1000);
process.on("SIGTERM", () => quit(2)); process.on("SIGINT", () => quit(2));
// If Chrome is killed from outside, stop at once instead of waiting on a dead socket.
const heart = setInterval(async () => {
  const ok = await Promise.race([b.browser.send("Browser.getVersion").then(() => true, () => false), sleep(8000).then(() => false)]);
  if (!ok && !closing) quit(3, "FAIL chrome: the browser stopped answering (killed from outside?)");
}, 5000);
heart.unref();
const t0 = Date.now();
try {
  if (run("static")) await staticChecks(b, srv);
  const tasks = [];
  if (run("long")) tasks.push(...longTasks(b, srv));
  if (run("buzz")) tasks.push(...buzzTasks(b, srv));
  if (run("ninja")) tasks.push(...ninjaTasks(b, srv));
  if (run("right")) tasks.push(...rightTasks(b, srv));
  if (run("ladder")) tasks.push(...ladderTasks(b, srv));
  if (run("breath")) tasks.push(...breathTasks(b, srv));
  if (run("songs")) tasks.push(...songsTasks(b, srv));
  if (run("clap")) tasks.push(...clapTasks(b, srv));
  if (run("names")) tasks.push(...namesTasks(b, srv));
  if (run("pause")) tasks.push(...pauseTasks(b, srv));
  if (run("real")) tasks.push(...realTasks(b, srv));
  await pool(tasks, JOBS);
} finally {
  closing = true; clearTimeout(watchdog); clearInterval(heart);
  await b.close(); await srv.close();
}
const by = {};
for (const r of results) { by[r.game] = by[r.game] || { PASS: 0, FAIL: 0, INFO: 0 }; by[r.game][r.status]++; }
console.log("\n" + Object.entries(by).map(([g, c]) => `${c.FAIL ? "FAIL" : "PASS"} ${g.padEnd(6)} ${c.PASS} pass, ${c.FAIL} fail`).join("\n") + `\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(results.some(r => r.status === "FAIL") ? 1 : 0);
}
