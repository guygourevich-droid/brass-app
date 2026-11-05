// Woodwind research harness (not part of the deploy suites): real single-note recordings of alto sax, B♭ clarinet, flute
// (Univ. of Iowa MIS, "freely available … without restrictions") and soprano recorder (VCSL, CC0) played into the pages'
// own detectors through ?test=1. The pages only know brass, so each tab gets a woodwind added to INSTRUMENTS at runtime
// (INJECT below); nothing in the page files changes. Brass (app/sounds) runs the same measurements as a control.
// Run from app/:  CHROME_TAG=ww node tests/woodwinds.mjs [spectrum notes long right songs ninja quiet breath synth ref proto]
// (no mode = all, ~25 min). Report: ../ops/research/woodwinds-detection.md. Measurements only: nothing here passes or fails.
// Samples: ../ops/research/woodwind-samples/<inst>/*.m4a (WW_SAMPLES=dir). Results: tables on stdout, JSON to WW_OUT=file.
// WW_INST=flute,recorder narrows (WW_BRASS= drops the brass controls); WW_SETUP='js' patches every pitch page after
// injection (e.g. WW_SETUP='detect = (b, r, lo, hi) => __ww.detectV(b, r, lo, hi, { k: 0.97 })'); WW_PATCH = proto's live patch.
import { createServer } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./lib.mjs";
import { open, waitFor } from "./play.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIR = process.env.WW_SAMPLES || join(HERE, "../../ops/research/woodwind-samples");
const APP_SOUNDS = join(HERE, "../sounds");
const MODES = ["spectrum", "notes", "long", "right", "songs", "ninja", "quiet", "breath", "synth", "ref", "proto"];
const want = process.argv.slice(2).filter(a => MODES.includes(a));
const run = m => !want.length || want.includes(m);
process.env.CHROME_TAG ||= "tonebee-ww";

/* ---------- What is injected into each page (the pages' own INSTRUMENTS have brass only) ----------
   written = concert + toWritten. lo/hi (concert Hz) follow the brass margins: ~4–6 semitones under the lowest
   recorded note, ~an octave+ over the top first-year note. Recorder: written C4 sounds C5 (toWritten −12).
   `altosax` is this file's name only; the app's instrument id (index.html) is `sax`. */
export const INJECT = {
  altosax:  { clef: "treble", toWritten: 9,   lo: 110, hi: 900 },
  clarinet: { clef: "treble", toWritten: 2,   lo: 110, hi: 1100 },
  flute:    { clef: "treble", toWritten: 0,   lo: 200, hi: 2400 },
  recorder: { clef: "treble", toWritten: -12, lo: 400, hi: 2400 }
};
// Brass controls: the pages' own entries (only toWritten needed here).
const BRASS = { trumpet: { toWritten: 2 }, trombone: { toWritten: 0 }, horn: { toWritten: 7 } };
// A diatonic do..do' per instrument (written), for Songs: the first-year key, all pitches recorded or ≤1 semitone away.
const SCALE = {
  altosax:  [60, 62, 64, 65, 67, 69, 71, 72],      // written C4–C5 = concert E♭3–E♭4
  clarinet: [60, 62, 64, 65, 67, 69, 71, 72],      // written C4–C5 = concert B♭3–B♭4 (B4, C5 over the break)
  flute:    [70, 72, 74, 75, 77, 79, 81, 82],      // concert B♭4–B♭5 (B♭ major, the band key)
  recorder: [60, 62, 64, 65, 67, 69, 71, 72],      // written C4–C5, sounding C5–C6
  trumpet:  [60, 62, 64, 65, 67, 69, 71, 72], trombone: [46, 48, 50, 51, 53, 55, 57, 58], horn: [60, 62, 64, 65, 67, 69, 71, 72]
};
const WINDS = (process.env.WW_INST || "altosax,clarinet,flute,recorder").split(",").filter(i => INJECT[i]);
const CONTROLS = (process.env.WW_BRASS ?? "trumpet,trombone,horn").split(",").filter(i => BRASS[i]);
const toW = inst => (INJECT[inst] || BRASS[inst]).toWritten;

/* ---------- Recordings ---------- */
const PC = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const PCS = { "C#": 1, "D#": 3, "F#": 6, "G#": 8, "A#": 10, Cs: 1, Ds: 3, Fs: 6, Gs: 8, As: 10 };
const midiOf = name => { const m = /^([A-G](?:b|s|#)?)(-?\d)$/.exec(name); if (!m) return null; const pc = PC.indexOf(m[1]) >= 0 ? PC.indexOf(m[1]) : PCS[m[1]]; return (+m[2] + 1) * 12 + pc; };
const nameOf = midi => PC[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);
// VCSL names its soprano recorder samples an octave under the sound (written pitch): checked in `spectrum`.
const NAME_SHIFT = { recorder: 12 };
async function recordings(inst) {
  const brass = !!BRASS[inst];
  const dir = brass ? join(APP_SOUNDS, inst) : join(DIR, inst);
  const out = [];
  for (const f of (await readdir(dir)).filter(f => extname(f) === ".m4a").sort()) {
    const base = f.slice(0, -4);
    // flute/C4, flute/vib-G4, recorder/vcsl-Sus-C4, recorder/vcsl-Stac-C4
    const m = /^(?:(vib)-|vcsl-(Sus|Stac)-)?(.+)$/.exec(base);
    const midi = midiOf(m[3]);
    if (midi === null) continue;
    const concert = midi + (NAME_SHIFT[inst] || 0);
    out.push({ inst, file: f, url: (brass ? "app/" : "ww/") + inst + "/" + encodeURIComponent(f), concert, written: concert + toW(inst),
      kind: m[1] ? "vib" : m[2] === "Stac" ? "staccato" : "sustain" });
  }
  return out.sort((a, b) => a.concert - b.concert || a.kind.localeCompare(b.kind));
}

// The samples (and the app's brass recordings) over HTTP with CORS, so any test tab's origin can fetch them.
async function serveSamples() {
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    const [root, ...rest] = p.split("/");
    const base = root === "ww" ? DIR : root === "app" ? APP_SOUNDS : null;
    const file = base && join(base, ...rest);
    if (!file || !file.startsWith(base) || rest.some(s => s === "..")) { res.writeHead(403); return res.end(); }
    try { const body = await readFile(file); res.writeHead(200, { "content-type": "audio/mp4", "access-control-allow-origin": "*" }); res.end(body); }
    catch { res.writeHead(404, { "access-control-allow-origin": "*" }); res.end(); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(r)) };
}

/* ---------- In-page tools (serialised into the page; uses the page's ctx and pageLib's analyser) ---------- */
function wwLib(base) {
  if (window.__ww) return;
  const W = window.__ww = { bufs: {}, info: {}, frames: [], src: null, base };
  W.load = async rel => {
    if (!W.bufs[rel]) { const a = await (await fetch(base + rel)).arrayBuffer(); W.bufs[rel] = await ctx.decodeAudioData(a); W.info[rel] = W.envelope(W.bufs[rel]); }
    return W.info[rel];
  };
  // 10 ms envelope: onset (first block over peak − 40 dB), end of sustain (last block over peak − 20 dB), steady RMS (middle half).
  W.envelope = b => {
    const d = b.getChannelData(0), sr = b.sampleRate, blk = Math.round(sr * 0.01), env = [];
    for (let i = 0; i + blk <= d.length; i += blk) { let s = 0; for (let j = 0; j < blk; j++) s += d[i + j] * d[i + j]; env.push(Math.sqrt(s / blk)); }
    const peak = Math.max(...env), on = Math.max(0, env.findIndex(e => e > peak * 0.01));
    let off = env.length - 1; while (off > on && env[off] < peak * 0.1) off--;
    const a = on + Math.round((off - on) * 0.25), z = Math.max(a + 1, on + Math.round((off - on) * 0.75));
    let s = 0; for (let i = a; i < z; i++) s += env[i] * env[i];
    const rms = Math.sqrt(s / (z - a)), up = env.findIndex((e, i) => i >= on && e >= rms * 0.5);     // attack: onset → −6 dB of steady
    return { sr, dur: b.duration, onset: on * 0.01, end: (off + 1) * 0.01, rms, rise: Math.round((up - on) * 10) };
  };
  // Reference pitch at the full sample rate: NSDF over 4096-sample frames of the steady middle, McLeod peak pick
  // (first peak ≥ 0.93 of the best, 70–3000 Hz), parabolic refine. Median and spread (cents, p10–p90) of the frames.
  // hint (Hz): search only ±150 cents around it (the file's name), so an octave flip in the file cannot move the reference.
  W.trueF0 = (rel, hint) => {
    const b = W.bufs[rel], d = b.getChannelData(0), sr = b.sampleRate, inf = W.info[rel], N = 4096;
    const a0 = Math.round((inf.onset + (inf.end - inf.onset) * 0.2) * sr), a1 = Math.round((inf.onset + (inf.end - inf.onset) * 0.8) * sr) - N;
    const fs = [], cl = [];
    const minLag = hint ? Math.floor(sr / (hint * Math.pow(2, 150 / 1200))) : Math.floor(sr / 3000), maxLag = hint ? Math.ceil(sr / (hint * Math.pow(2, -150 / 1200))) : Math.ceil(sr / 70);
    for (let s = a0; s <= a1; s += 2048) {
      const nsdf = new Float32Array(maxLag + 2); let best = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let ac = 0, m = 0; for (let i = 0; i < N - lag; i++) { const x = d[s + i], y = d[s + i + lag]; ac += x * y; m += x * x + y * y; }
        nsdf[lag] = m > 0 ? 2 * ac / m : 0; if (nsdf[lag] > best) best = nsdf[lag];
      }
      for (let lag = minLag + 1; lag < maxLag; lag++) if (nsdf[lag] >= best * 0.93 && nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) {
        const y1 = nsdf[lag - 1], y2 = nsdf[lag], y3 = nsdf[lag + 1], den = 2 * (2 * y2 - y1 - y3);
        fs.push(sr / (lag + (Math.abs(den) > 1e-9 ? (y3 - y1) / den : 0))); cl.push(y2); break;
      }
    }
    const srt = fs.slice().sort((x, y) => x - y), med = srt[srt.length >> 1];
    const c = fs.map(f => 1200 * Math.log2(f / med)).sort((x, y) => x - y);
    return { f0: med, spread: c.length ? c[Math.floor(c.length * 0.9)] - c[Math.floor(c.length * 0.1)] : null, clarity: cl.slice().sort((x, y) => x - y)[cl.length >> 1], n: fs.length };
  };
  // Harmonic amplitudes H1..H10 (dB re the strongest) from a Hann-windowed 16384-sample DFT at k·f0 (±1.5 %, best bin),
  // and how much of the window's energy lies within ±2 bins of a harmonic (×2: the DFT sums count positive frequencies only).
  W.harmonics = (rel, f0) => {
    const b = W.bufs[rel], d = b.getChannelData(0), sr = b.sampleRate, inf = W.info[rel], N = 16384;
    const mid = Math.round((inf.onset + inf.end) / 2 * sr), s0 = Math.max(0, Math.min(d.length - N, mid - N / 2));
    const x = new Float32Array(N); let tot = 0;
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); x[i] = d[s0 + i] * w; tot += x[i] * x[i]; }
    const amp = f => { let re = 0, im = 0; const w = 2 * Math.PI * f / sr; for (let i = 0; i < N; i++) { re += x[i] * Math.cos(w * i); im -= x[i] * Math.sin(w * i); } return Math.hypot(re, im); };
    const H = [];
    for (let k = 1; k <= 10 && k * f0 < sr / 2 - 200; k++) { let best = 0; for (let e = -1.5; e <= 1.5; e += 0.25) best = Math.max(best, amp(k * f0 * (1 + e / 100))); H.push(best); }
    // Energy in ±2 bins around each harmonic vs the whole window (Parseval: Σ|X|² = N·Σx²).
    let harm = 0; const bin = sr / N;
    for (let k = 1; k * f0 < sr / 2 - 200; k++) { for (let j = -2; j <= 2; j++) { const a = amp(k * f0 + j * bin); harm += a * a; } }
    const peak = Math.max(...H);
    return { H: H.map(a => +(20 * Math.log10(a / peak + 1e-9)).toFixed(1)), harmFrac: Math.min(1, 2 * harm / (N * tot)) };
  };
  // Log one row per page analyse() call (the page decides what that row holds).
  W.hook = row => { if (W.hooked) return; W.hooked = true; const orig = analyse; analyse = function () { orig(); W.frames.push(Object.assign({ t: performance.now() }, row())); }; };
  W.stop = () => { if (W.src) { try { W.src.stop(); } catch (_) {} W.src = null; } };
  // Play a recording into the analyser at a set steady RMS (level), from its onset. loop: [from, to] seconds of the file.
  W.play = (rel, { level = 0.1, rate = 1, loop = null, gain = null } = {}) => {
    W.stop();
    const b = W.bufs[rel], inf = W.info[rel], s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = b; s.playbackRate.value = rate;
    if (loop) { s.loop = true; s.loopStart = loop[0]; s.loopEnd = loop[1]; }
    g.gain.value = gain !== null ? gain : level / inf.rms;
    s.connect(g); g.connect(analyser); s.start(0, Math.max(0, inf.onset - 0.02));
    W.src = s;
    return performance.now();
  };
  // One note, start to end, logged frame by frame (times relative to the start). gap: silence first (ms).
  W.measure = async (rel, opts = {}) => {
    W.stop();
    await new Promise(r => setTimeout(r, opts.gap ?? 900));
    W.frames = [];
    const inf = W.info[rel], t0 = W.play(rel, opts);
    const ms = opts.ms ?? ((inf.end - inf.onset) / (opts.rate || 1) * 1000 + 60);
    await new Promise(r => setTimeout(r, ms));
    W.stop();
    return { ms, frames: W.frames.map(f => Object.assign({}, f, { t: Math.round(f.t - t0) })) };
  };
  // As a 2 s reference clip cut at the onset (like app/sounds): noise before the onset, the loop window Songs uses
  // (0.5–1.4 s after the cut: level range and seam step, pitch spread), and whether 2 s of sustain exist.
  W.clip = rel => {
    const b = W.bufs[rel], d = b.getChannelData(0), sr = b.sampleRate, inf = W.info[rel];
    const rmsAt = (t0, t1) => { const a = Math.max(0, Math.round(t0 * sr)), z = Math.min(d.length, Math.round(t1 * sr)); let s = 0; for (let i = a; i < z; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, z - a)); };
    const pre = inf.onset >= 0.08 ? rmsAt(0, inf.onset - 0.03) : null;
    const tail = rmsAt(Math.max(inf.end + 0.3, b.duration - 0.25), b.duration);
    const L = []; for (let t = inf.onset + 0.5; t < inf.onset + 1.4; t += 0.05) L.push(20 * Math.log10(rmsAt(t, t + 0.05) + 1e-9));
    const seam = 20 * Math.log10((rmsAt(inf.onset + 1.35, inf.onset + 1.4) + 1e-9) / (rmsAt(inf.onset + 0.5, inf.onset + 0.55) + 1e-9));
    // The steadiest 2 s anywhere in the sustain (for long takes like VCSL's): start, and level range over the 2 s.
    let best = null;
    for (let t = inf.onset; t + 2 <= inf.end; t += 0.1) {
      const M = []; for (let u = t + 0.1; u < t + 1.9; u += 0.05) M.push(20 * Math.log10(rmsAt(u, u + 0.05) + 1e-9));
      const r = Math.max(...M) - Math.min(...M); if (!best || r < best.range) best = { start: t, range: r };
    }
    return { onset: inf.onset, pre: pre === null ? null : 20 * Math.log10(pre + 1e-9), tail: 20 * Math.log10(tail + 1e-9), steady: 20 * Math.log10(inf.rms), sustain: inf.end - inf.onset,
      range: Math.max(...L) - Math.min(...L), seam, best };
  };
  // The pages' detect() with knobs: k (McLeod threshold, pages: 0.9), oct (octave check: if the NSDF peak near twice the
  // chosen lag beats the chosen one by more than `oct`, take the longer lag = the octave below), minClarity (pages: 0.6).
  W.detectV = (buf, sampleRate, fMin, fMax, v = {}) => {
    const n = buf.length, k = v.k ?? 0.9;
    const minLag = Math.max(2, Math.floor(sampleRate / fMax));
    const maxLag = Math.min(Math.floor(sampleRate / fMin), n - 2);
    if (maxLag <= minLag) return null;
    const nsdf = new Float32Array(maxLag + 2);
    let peak = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let ac = 0, m = 0;
      for (let i = 0, end = n - lag; i < end; i++) { const a = buf[i], b = buf[i + lag]; ac += a * b; m += a * a + b * b; }
      const val = m > 0 ? (2 * ac) / m : 0;
      nsdf[lag] = val;
      if (val > peak) peak = val;
    }
    if (peak < 0.4) return null;
    // vtx: judge peaks by their interpolated (parabola vertex) height, not the sampled one (a coarse lag grid at high
    // pitch samples the true peak low).
    const vh = lag => { const y1 = nsdf[lag - 1], y2 = nsdf[lag], y3 = nsdf[lag + 1], den = 2 * y2 - y1 - y3; return den > 1e-9 ? y2 + (y3 - y1) * (y3 - y1) / (8 * den) : y2; };
    if (v.vtx) { peak = 0; for (let lag = minLag + 1; lag < maxLag; lag++) if (nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) peak = Math.max(peak, vh(lag)); }
    const refine = lag => { const y1 = nsdf[lag - 1], y2 = nsdf[lag], y3 = nsdf[lag + 1], den = 2 * (2 * y2 - y1 - y3); return { freq: sampleRate / (lag + (Math.abs(den) > 1e-9 ? (y3 - y1) / den : 0)), clarity: y2 }; };
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if ((v.vtx ? nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && vh(lag) > peak * k : nsdf[lag] > peak * k) && nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) {
        if (v.octv !== undefined) {           // the same check on interpolated peak heights
          let best = -1, at = 0;
          for (let l2 = 2 * lag - 2; l2 <= 2 * lag + 2 && l2 < maxLag; l2++) if (nsdf[l2] >= nsdf[l2 - 1] && nsdf[l2] >= nsdf[l2 + 1] && vh(l2) > best) { best = vh(l2); at = l2; }
          if (at && best > vh(lag) + v.octv) return refine(at);
        }
        if (v.oct !== undefined) {
          let best = 0, at = 0;
          for (let l2 = 2 * lag - 2; l2 <= 2 * lag + 2 && l2 < maxLag; l2++) if (nsdf[l2] > best && nsdf[l2] >= nsdf[l2 - 1] && nsdf[l2] >= nsdf[l2 + 1]) { best = nsdf[l2]; at = l2; }
          if (at && best > nsdf[lag] + v.oct) return refine(at);
        }
        return refine(lag);
      }
    }
    return null;
  };
  // The analyse() pipeline offline over a recording: 8192-sample windows every ~67 ms (the pages' cadence), box
  // decimation to ~16 kHz (v.D overrides), detectV, clarity ≥ 0.6. Returns the frequency per frame (0 = nothing).
  W.offline = (rel, v = {}) => {
    const b = W.bufs[rel], d = b.getChannelData(0), sr = b.sampleRate, inf = W.info[rel], N = 8192, hop = Math.round(sr * 0.0667);
    const D = v.D ?? Math.max(1, Math.round(sr / 16000)), n = Math.floor(N / D), sr2 = sr / D, x = new Float32Array(n), out = [];
    // v.snr: white noise (full band, seeded) added at this SNR re the recording's steady RMS, before decimation.
    const nAmp = v.snr === undefined ? 0 : inf.rms * Math.pow(10, -v.snr / 20) * Math.sqrt(3);
    let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
    for (let s = Math.round((inf.onset + 0.4) * sr); s + N <= Math.round((inf.end - 0.1) * sr); s += hop) {
      for (let i = 0; i < n; i++) { let a = 0; for (let j = 0; j < D; j++) a += d[s + i * D + j] + (nAmp ? nAmp * rnd() : 0); x[i] = a / D; }
      const g = (v.page ? detect : (bb, r, lo, hi) => W.detectV(bb, r, lo, hi, v))(x, sr2, v.lo, v.hi);
      out.push(g && g.clarity >= (v.minClarity ?? 0.6) ? +g.freq.toFixed(2) : 0);
    }
    return out;
  };
}

/* ---------- Page setup ---------- */
// Adds the woodwind to the page's INSTRUMENTS (and an empty SAMPLES row, so a stray loadSamples() is harmless) and selects it.
function injectExpr(inst, page, extra = {}) {
  const I = INJECT[inst];
  if (page === "sound-game.html") return "";              // Long Note has no instrument: nothing to inject
  if (!I) return `state.inst = ${JSON.stringify(inst)};`;
  const notes = SCALE[inst];
  const entry = { clef: I.clef, toWritten: I.toWritten, lo: I.lo, hi: I.hi, notes, open: [], def: notes.slice(0, 5), key: [], ...extra };
  return `INSTRUMENTS[${JSON.stringify(inst)}] = ${JSON.stringify(entry)};` +
    (page !== "sound-game.html" ? `if (typeof SAMPLES === "object") SAMPLES[${JSON.stringify(inst)}] = {};` : "") +
    `state.inst = ${JSON.stringify(inst)};`;
}
// What each page counts as "heard" (the row logged after every analyse()).
const ROW = {
  "ninja.html": `() => ({ f: state.heard ? +state.freq.toFixed(2) : 0, c: +state.clarity.toFixed(3), r: +state.rms.toFixed(5), on: state.soundOn, nf: state.noiseFloor })`,
  "right-note.html": `() => ({ f: state.freq > 0 && state.clarity > 0.6 && state.soundOn ? +state.freq.toFixed(2) : 0, c: +state.clarity.toFixed(3), r: +state.rms.toFixed(5), on: state.soundOn })`,
  "songs.html": `() => ({ f: state.heard ? +state.freq.toFixed(2) : 0, c: +state.clarity.toFixed(3), r: +state.rms.toFixed(5), on: state.soundOn })`,
  "sound-game.html": `() => ({ f: +state.freq.toFixed(2), c: +state.clarity.toFixed(3), r: +state.rms.toFixed(5), on: state.soundOn, nf: state.noiseFloor })`
};
async function wwPage(b, page, inst, smp, { ls = {}, extra = {} } = {}) {
  const p = await open(b, null, page, { inst: BRASS[inst] ? inst : "trumpet", ls });
  await p.eval(injectExpr(inst, page, extra));
  await p.eval(`(${wwLib})(${JSON.stringify(smp.url)}); __ww.hook(${ROW[page]})`);
  // WW_SETUP: a runtime patch for every pitch page (not Long Note), e.g. a detect() variant, for before/after runs.
  if (process.env.WW_SETUP && page !== "sound-game.html") await p.eval(process.env.WW_SETUP);
  return p;
}
const close = async p => { await p.closeTab(); if (p.srv) p.srv.close(); };

/* ---------- Statistics ---------- */
const median = xs => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pct = (n, d) => d ? Math.round(100 * n / d) : 0;
// Per note: frames from 400 ms after the start to 250 ms before the end are "steady".
function noteStats(frames, ms, nominalHz, { holdMs = 500, graceMs = 150, tol = 50 } = {}) {
  const cents = f => 1200 * Math.log2(f / nominalHz);
  const steady = frames.filter(f => f.t >= 400 && f.t <= ms - 250);
  const heard = steady.filter(f => f.f > 0), cs = heard.map(f => cents(f.f));
  const inBand = cs.filter(c => Math.abs(c) < tol).length;
  const reg = cs.filter(c => Math.abs(c) >= 600);
  const wrong = cs.filter(c => Math.abs(c) >= tol && Math.abs(c) < 600);
  const first = frames.find(f => f.f > 0), firstIn = frames.find(f => f.f > 0 && Math.abs(cents(f.f)) < tol);
  // Ninja-style hold: in band for holdMs, gaps up to graceMs forgiven.
  let since = null, lastIn = null, slice = -1;
  for (const f of frames) {
    const ok = f.f > 0 && Math.abs(cents(f.f)) < tol;
    if (ok) { lastIn = f.t; if (since === null) since = f.t; if (f.t - since >= holdMs) { slice = f.t; break; } }
    else if (since !== null && f.t - lastIn > graceMs) since = null;
  }
  const semis = reg.map(c => Math.round(c / 100));
  const regKinds = {}; semis.forEach(s => regKinds[(s > 0 ? "+" : "") + s] = (regKinds[(s > 0 ? "+" : "") + s] || 0) + 1);
  return { n: steady.length, heardPct: pct(heard.length, steady.length), inBandPct: pct(inBand, steady.length), median: cs.length ? Math.round(median(cs.filter(c => Math.abs(c) < 600)) ?? NaN) : null,
    regPct: pct(reg.length, steady.length), regKinds, wrongPct: pct(wrong.length, steady.length),
    ttFirst: first ? first.t : -1, ttDetect: firstIn ? firstIn.t : -1, ttSlice: slice };
}

/* ---------- Output ---------- */
const results = {};
const out = (k, v) => { results[k] = v; };
function table(title, head, rows) {
  console.log(`\n### ${title}\n| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|`);
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
}
const sgn = x => x === null || x === undefined || Number.isNaN(x) ? "—" : (x > 0 ? "+" : "") + x;
const ms = x => x < 0 ? "never" : x + " ms";
async function pool(tasks, n) {
  const q = tasks.slice();
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) { const t = q.shift(); try { await t(); } catch (e) { console.log("ERROR", String(e && e.stack || e).slice(0, 400)); } } }));
}

const db = x => x > 0 ? +(20 * Math.log10(x)).toFixed(1) : -Infinity;
const centsOf = (f, ref) => 1200 * Math.log2(f / ref);
const label = r => `${nameOf(r.written)} (${nameOf(r.concert)})${r.kind === "sustain" ? "" : " " + r.kind}`;
// The reference pitch of every recording (full-rate NSDF), cached per run; also used to pitch-shift for neighbours.
const REF = {};
async function refs(p, inst, recs) {
  for (const r of recs) {
    const key = inst + "/" + r.file;
    const inf = await p.eval(`__ww.load(${JSON.stringify(r.url)})`);    // every page needs its own decoded copy
    if (REF[key]) continue;
    const t = await p.eval(`__ww.trueF0(${JSON.stringify(r.url)}, ${hz(r.concert)})`);
    const free = await p.eval(`__ww.trueF0(${JSON.stringify(r.url)})`);       // unconstrained: shows octave flips inside a file
    REF[key] = { ...inf, ...t, off: Math.round(centsOf(t.f0, hz(r.concert))), freeOff: Math.round(centsOf(free.f0, hz(r.concert))), freeSpread: free.spread === null ? null : Math.round(free.spread) };
  }
  return recs.map(r => REF[inst + "/" + r.file]);
}

/* ---------- Modes ---------- */
const MODE = {};

// Each recording: level, true pitch vs equal temperament, vibrato spread, harmonic make-up.
MODE.spectrum = async ({ b, smp, recs }) => {
  await pool([...WINDS, ...CONTROLS].map(inst => async () => {
    const p = await wwPage(b, "ninja.html", inst, smp);
    const rows = [], data = [];
    const R = await refs(p, inst, recs[inst]);
    for (const [i, r] of recs[inst].entries()) {
      const ref = R[i];
      const h = await p.eval(`__ww.harmonics(${JSON.stringify(r.url)}, ${ref.f0})`);
      const e = k => h.H[k - 1] === undefined ? -99 : h.H[k - 1];
      const pow = ks => ks.reduce((s, k) => s + Math.pow(10, e(k) / 10), 0);
      const evenOdd = db(Math.sqrt(pow([2, 4, 6, 8, 10]) / pow([3, 5, 7, 9])));
      data.push({ file: r.file, written: r.written, concert: r.concert, ...ref, H: h.H, harmFrac: h.harmFrac, evenOdd });
      rows.push([label(r), r.file, ref.dur.toFixed(1) + " s", db(ref.rms) + " dB", sgn(ref.off) + (Math.abs(ref.freeOff - ref.off) > 50 ? ` (free: ${sgn(ref.freeOff)}, p10–p90 ${ref.freeSpread})` : ""), ref.spread === null ? "—" : Math.round(ref.spread), ref.clarity?.toFixed(3),
        h.H.slice(0, 6).map(x => Math.round(x)).join(" / "), sgn(evenOdd), Math.round(100 * h.harmFrac) + "%"]);
    }
    out("spectrum." + inst, data);
    table(`spectrum: ${inst}`, ["written (concert)", "file", "length", "RMS", "off ET (c)", "p10–p90 (c)", "NSDF full-rate", "H1…H6 dB re max", "even−odd dB", "harmonic energy"], rows);
    await close(p);
  }), 4);
};

// Every recording once, start to end, into Ninja's detector (= Right Note's and Songs' detect(), 16 kHz, INSTRUMENTS lo/hi).
MODE.notes = async ({ b, smp, recs }, { page = "ninja.html", level = 0.1, tag = "notes", setup = "" } = {}) => {
  const all = {};
  await pool([...WINDS, ...CONTROLS].map(inst => async () => {
    const p = await wwPage(b, page, inst, smp);
    if (setup) await p.eval(setup);
    const R = await refs(p, inst, recs[inst]);
    const rows = [], data = [];
    for (const [i, r] of recs[inst].entries()) {
      if (r.kind === "staccato") continue;
      const m = await p.eval(`__ww.measure(${JSON.stringify(r.url)}, { level: ${level} })`);
      const st = noteStats(m.frames, m.ms, hz(r.concert));
      data.push({ written: r.written, concert: r.concert, kind: r.kind, off: R[i].off, rise: R[i].rise, ...st });
      rows.push([label(r), R[i].rise + " ms", sgn(R[i].off), sgn(st.median), st.median === null ? "—" : sgn(st.median - R[i].off), st.inBandPct + "%", st.heardPct + "%",
        st.regPct ? `${st.regPct}% (${Object.entries(st.regKinds).map(([k, v]) => k + "st×" + v).join(", ")})` : "0", st.wrongPct + "%", ms(st.ttFirst), ms(st.ttDetect), ms(st.ttSlice)]);
    }
    all[inst] = data;
    table(`${tag}: ${inst} (${page}, ${INJECT[inst] ? `injected lo ${INJECT[inst].lo} / hi ${INJECT[inst].hi} Hz` : "page's own entry"}, steady RMS ${db(level)} dBFS)`,
      ["written (concert)", "attack (to −6 dB)", "true off (c)", "median detected (c re ET)", "detector err (c)", "in ±50c", "pitched", "register err", "50–600c off", "1st pitch", "1st in tune", "500 ms hold"], rows);
    await close(p);
  }), 4);
  out(tag, all);
  // Summary per instrument.
  const sum = Object.entries(all).map(([inst, d]) => {
    const bad = d.filter(x => x.inBandPct < 80);
    return [inst, d.length, Math.round(median(d.map(x => x.inBandPct))) + "%", Math.min(...d.map(x => x.inBandPct)) + "%", d.filter(x => x.regPct > 0).length,
      Math.round(median(d.filter(x => x.ttDetect >= 0).map(x => x.ttDetect))) + " ms", Math.round(median(d.filter(x => x.ttSlice >= 0).map(x => x.ttSlice))) + " ms",
      bad.length ? bad.map(x => nameOf(x.written) + (x.kind === "vib" ? "~" : "") + ` ${x.inBandPct}%`).join(", ") : "none"];
  });
  table(`${tag}: summary`, ["instrument", "notes", "median in ±50c", "worst", "notes with register errors", "median 1st in tune", "median 500 ms hold", "notes under 80% in band"], sum);
  return all;
};

// Long Note (sound-game.html): its own 8 kHz detector, F_LO 80 / F_HI 1000, 12 dB onset, 250 ms steady, 300 ms gaps.
// Each sustained recording looped (its steady middle) for 6 s, level 1 (4 s goal) set before each.
MODE.long = async ({ b, smp, recs }, { level = 0.1, tag = "long", setup = "" } = {}) => {
  const all = {};
  await pool([...WINDS, ...CONTROLS].map(inst => async () => {
    const p = await wwPage(b, "sound-game.html", inst, smp);
    if (setup) await p.eval(setup);
    const R = await refs(p, inst, recs[inst]);
    const rows = [], data = [];
    for (const [i, r] of recs[inst].entries()) {
      if (r.kind !== "sustain") continue;
      const inf = R[i], a = inf.onset + 0.3, z = Math.max(a + 0.4, Math.min(inf.end - 0.25, inf.onset + 2.2));
      await p.eval(`__ww.stop(); setLevel(1)`);
      await sleep(900);
      await p.eval(`__ww.frames = []; window.__t0 = __ww.play(${JSON.stringify(r.url)}, { level: ${level}, loop: [${a}, ${z}] }); window.__won = -1;
        window.__wt = setInterval(() => { if (state.phase === "won" && __won < 0) __won = performance.now() - __t0; }, 20)`);
      await sleep(6000);
      const res = await p.eval(`__ww.stop(); clearInterval(__wt); ({ won: Math.round(__won), frames: __ww.frames.map(f => Object.assign({}, f, { t: Math.round(f.t - __t0) })) })`);
      // After the note starts and before the 4 s goal (the celebration mutes the detector).
      const fr = res.frames, onAt = fr.find(f => f.on), after = onAt ? fr.filter(f => f.t > onAt.t && (res.won < 0 || f.t < res.won)) : [];
      let drops = 0; for (let k = 1; k < after.length; k++) if (after[k - 1].on && !after[k].on) drops++;
      const pitched = after.filter(f => f.f > 0).length, sub = after.filter(f => f.f > 0 && Math.abs(centsOf(f.f, inf.f0)) > 600).length;
      data.push({ written: r.written, concert: r.concert, start: onAt ? onAt.t : -1, drops, pitchedPct: pct(pitched, after.length), otherOctPct: pct(sub, pitched), won: res.won });
      rows.push([label(r), ms(onAt ? onAt.t : -1), drops, pct(pitched, after.length) + "%", pct(sub, pitched) + "%", res.won >= 0 ? (res.won / 1000).toFixed(2) + " s" : "no"]);
    }
    all[inst] = data;
    table(`${tag}: ${inst} (sound-game.html, steady RMS ${db(level)} dBFS, loop of the steady middle)`, ["written (concert)", "note starts after", "drops in 6 s", "frames pitched (start → goal)", "pitch read ≥ 600 c from the true pitch", "4 s goal reached at"], rows);
    await close(p);
  }), 4);
  out(tag, all);
  table(`${tag}: summary`, ["instrument", "notes", "never started", "median start", "notes with drops", "4 s goal missed"], Object.entries(all).map(([inst, d]) =>
    [inst, d.length, d.filter(x => x.start < 0).map(x => nameOf(x.written)).join(", ") || "0", Math.round(median(d.filter(x => x.start >= 0).map(x => x.start))) + " ms",
      d.filter(x => x.drops).map(x => nameOf(x.written) + "×" + x.drops).join(", ") || "0", d.filter(x => x.won < 0).map(x => nameOf(x.written)).join(", ") || "0"]));
  return all;
};

// The recording nearest a written note, and the playback rate that puts it exactly on equal temperament.
function nearest(inst, recs, R, written) {
  const c = written - toW(inst);
  let best = null;
  recs.forEach((r, i) => { if (r.kind === "sustain" && (!best || Math.abs(r.concert - c) < Math.abs(best.r.concert - c))) best = { r, ref: R[i] }; });
  const a = best.ref.onset + 0.3, z = Math.max(a + 0.4, Math.min(best.ref.end - 0.25, best.ref.onset + 2.2));
  return { url: best.r.url, rate: hz(c) / best.ref.f0, loop: [a, z], from: nameOf(best.r.concert) };
}
const RIGHT_EXTRA = { altosax: [74], clarinet: [52, 55, 74], flute: [60, 65, 84, 86], recorder: [74], trumpet: [], trombone: [], horn: [] };

// Right Note: one chosen note, hold 3 s, ±50 c (+15 once in), reference off; the recording looped until the star.
MODE.right = async ({ b, smp, recs }, { level = 0.1, tag = "right", setup = "" } = {}) => {
  const all = {};
  await pool([...WINDS, ...CONTROLS].map(inst => async () => {
    const p = await wwPage(b, "right-note.html", inst, smp);
    if (setup) await p.eval(setup);
    const R = await refs(p, inst, recs[inst]);
    const rows = [], data = [];
    for (const w of [...new Set([...SCALE[inst], ...RIGHT_EXTRA[inst]])].sort((x, y) => x - y)) {
      const n = nearest(inst, recs[inst], R, w);
      await p.eval(`__ww.stop(); state.chosen = [${w}]; state.target = ${w}; state.hold = 3; state.tol = "normal"; state.ref = false; state.won = false; state.stars = 0;
        state.holdProgress = 0; state.drainFrom = 0; placeTarget()`);
      await sleep(900);
      await p.eval(`__ww.frames = []; window.__t0 = __ww.play(${JSON.stringify(n.url)}, { level: ${level}, rate: ${n.rate}, loop: ${JSON.stringify(n.loop)} })`);
      const t = await waitFor(p, "state.stars >= 1", 12000, 25);
      const fr = await p.eval(`__ww.stop(); __ww.frames.map(f => Object.assign({}, f, { t: Math.round(f.t - __t0) }))`);
      const shown = fr.filter(f => f.f > 0), far = shown.filter(f => Math.abs(centsOf(f.f, hz(w - toW(inst)))) >= 600).length;
      data.push({ written: w, from: n.from, star: t, farPct: pct(far, shown.length) });
      rows.push([nameOf(w) + ` (${nameOf(w - toW(inst))})`, n.from + (Math.abs(Math.log2(n.rate)) > 0.03 ? " shifted" : ""), t >= 0 ? (t / 1000).toFixed(2) + " s" : "no star in 12 s", pct(far, shown.length) + "%"]);
    }
    all[inst] = data;
    table(`${tag}: ${inst} (right-note.html, hold 3 s, normal ±50c)`, ["written (concert)", "recording", "star after", "frames drawn ≥ 6 semitones away"], rows);
    await close(p);
  }), 4);
  out(tag, all);
  return all;
};

// The in-page "player" for Songs/Ninja: plays the nearest recording for whatever note the game is waiting on.
const PLAYER = (keyExpr, writtenExpr, map, level, delay) => `window.__rk = undefined; window.__wtm = setInterval(() => { try {
  const k = ${keyExpr};
  if (k !== window.__rk) { __ww.stop(); window.__rk = k; window.__rat = performance.now() + ${delay}; window.__on = false; }
  if (k !== null && !window.__on && performance.now() > window.__rat) { const n = ${JSON.stringify(map)}[${writtenExpr}]; if (n) __ww.play(n.url, { level: ${level}, rate: n.rate, loop: n.loop }); window.__on = true; }
  } catch (e) { console.error("player: " + e); } }, 20)`;

// Songs, follow mode: the recording of each note in turn (80 ms gap), hold 250 ms per note.
MODE.songs = async ({ b, smp, recs }, { level = 0.1, tag = "songs", setup = "" } = {}) => {
  const all = {};
  await pool([...WINDS, ...CONTROLS].map(inst => async () => {
    const notes = SCALE[inst];
    const p = await wwPage(b, "songs.html", inst, smp, { ls: { ["right-note-" + inst]: { chosen: notes }, songs: { mode: "follow", tempo: 60, band: true, guide: false, repeat: "attack" } } });
    await p.eval(`state.chosen = ${JSON.stringify(notes)}; state.mode = "follow"`);
    if (setup) await p.eval(setup);
    const R = await refs(p, inst, recs[inst]);
    const map = Object.fromEntries(notes.map(w => [w, nearest(inst, recs[inst], R, w)]));
    await p.eval(PLAYER(`state.phase === "follow" ? state.cursor : null`, `writtenOf(state.song.events[k].step)`, map, level, 80));
    const rows = [], data = [];
    for (const id of ["steps", "twinkle", "chanukah"]) {
      await p.eval(`chooseSong(SONGS.find(s => s.id === ${JSON.stringify(id)})); start()`);
      const t = await waitFor(p, `state.phase === "end"`, 45000, 100);
      const r = await p.eval(`__ww.stop(); ({ done: state.done.size, skipped: state.skipped.size, total: sectionEvents().length, phase: state.phase, cursor: state.cursor, w: state.song ? writtenOf(state.song.events[state.cursor].step) : null })`);
      data.push({ id, t, ...r });
      rows.push([id, t >= 0 ? (t / 1000).toFixed(1) + " s" : "stuck (45 s)", `${r.done}/${r.total}`, r.skipped, t < 0 ? "stuck on written " + nameOf(r.w) : ""]);
      await sleep(4000);
      await p.eval(`if (state.phase !== "ready") resetPlay()`);
    }
    all[inst] = data;
    table(`${tag}: ${inst} (songs.html follow, the recordings note by note)`, ["song", "finished in", "green", "skipped", ""], rows);
    await close(p);
  }), 4);
  out(tag, all);
  return all;
};

// One Ninja round: 10 notes from the scale, 8 s each, reference off, the recording 300 ms after the note lands.
MODE.ninja = async ({ b, smp, recs }, { level = 0.1, tag = "ninja", setup = "" } = {}) => {
  const all = {};
  await pool([...WINDS, ...CONTROLS].map(inst => async () => {
    const notes = SCALE[inst];
    const p = await wwPage(b, "ninja.html", inst, smp);
    if (setup) await p.eval(setup);
    const R = await refs(p, inst, recs[inst]);
    const map = Object.fromEntries(notes.map(w => [w, nearest(inst, recs[inst], R, w)]));
    await p.eval(`state.chosen = ${JSON.stringify(notes)}; state.count = 10; state.time = 8; state.ref = false;`);
    await p.eval(PLAYER(`state.phase === "note" && current && performance.now() - current.born > 420 ? state.roundId + ":" + state.index : null`, `state.target`, map, level, 300));
    await p.eval("startRound()");
    const t = await waitFor(p, `state.phase === "end"`, 150000, 100);
    const r = await p.eval(`__ww.stop(); ({ hits: state.hits, n: state.round.length, results: state.results.slice(), round: state.round.slice() })`);
    all[inst] = r;
    console.log(`\nninja ${inst}: ${r.hits}/${r.n} sliced${t < 0 ? " (round did not end)" : ""}; missed: ${r.round.filter((w, i) => r.results[i] === false).map(nameOf).join(", ") || "none"}`);
    await close(p);
  }), 4);
  out(tag, all);
  return all;
};

// Quiet playing against a classroom: broadband noise at −50 dBFS (floor set to it), the note swept down in level.
const QUIET_NOTES = { altosax: [62, 74], clarinet: [52, 72], flute: [60, 77], recorder: [60, 74], trumpet: [60, 67], trombone: [46, 53], horn: [60, 67] };
const LEVELS_DB = [-20, -30, -34, -38, -42, -46, -50];
MODE.quiet = async ({ b, smp, recs }, { tag = "quiet", noiseDb = -50 } = {}) => {
  const all = {};
  await pool([...WINDS, ...CONTROLS].map(inst => async () => {
    const p = await wwPage(b, "ninja.html", inst, smp);
    const R = await refs(p, inst, recs[inst]);
    // White noise from pageLib (uniform ±1, RMS 0.577) scaled to noiseDb, then the floor set to what the page measures.
    await p.eval(`__inj.noise(${Math.pow(10, noiseDb / 20) / 0.577})`);
    await sleep(800);
    const nf = await p.eval(`state.noiseFloor = state.rms; state.rms`);
    const rows = [];
    for (const w of QUIET_NOTES[inst]) {
      const n = nearest(inst, recs[inst], R, w), cells = [];
      for (const L of LEVELS_DB) {
        await p.eval(`state.noiseFloor = ${nf}`);
        const m = await p.eval(`__ww.measure(${JSON.stringify(n.url)}, { level: ${Math.pow(10, L / 20)}, rate: ${n.rate}, ms: 2200 })`);
        const st = noteStats(m.frames, m.ms, hz(w - toW(inst)));
        cells.push(`${st.inBandPct}%` + (st.regPct ? ` (${st.regPct}% reg)` : ""));
      }
      rows.push([nameOf(w) + ` (${nameOf(w - toW(inst))})`, ...cells]);
    }
    all[inst] = { floorDb: db(nf), rows };
    table(`${tag}: ${inst} (ninja.html; white noise ${noiseDb} dBFS → page floor ${db(nf)} dBFS, gate = floor + 12 dB); % of steady frames in ±50c by note level (dBFS RMS)`, ["written (concert)", ...LEVELS_DB.map(String)], rows);
    await close(p);
  }), 4);
  out(tag, all);
  return all;
};

// The detector alone (the page's detect()), on synthetic tones: accuracy of the lag grid at high pitch.
MODE.synth = async ({ b, smp }) => {
  const p = await wwPage(b, "ninja.html", "trumpet", smp);
  const res = await p.eval(`(() => {
    const sr = ctx.sampleRate, N = 8192, out = {};
    const tone = (f, kind, seed) => { const x = new Float32Array(N); let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 * 2 - 1; };
      const H = kind === "sine" ? [1] : kind === "flute" ? [1, 0.35, 0.15, 0.06] : [1, 0.05, 0.6, 0.04, 0.35, 0.03, 0.2];   // clarinet-like: odd partials
      const ph = H.map((_, k) => rnd() * Math.PI);
      for (let i = 0; i < N; i++) { let v = 0; H.forEach((a, k) => { if ((k + 1) * f < sr / 2) v += a * Math.sin(2 * Math.PI * (k + 1) * f * i / sr + ph[k]); }); x[i] = 0.2 * v + (kind === "flute" ? 0.02 * rnd() : 0); }
      return x; };
    const deci = (x, D) => { const n = Math.floor(x.length / D), y = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < D; j++) s += x[i * D + j]; y[i] = s / D; } return y; };
    const sweep = (kind, D, lo, hi, f0, f1) => { const errs = []; let miss = 0, oct = 0;
      for (let c = 0; ; c += 10) { const f = f0 * Math.pow(2, c / 1200); if (f > f1) break;
        const g = detect(deci(tone(f, kind, 7 + c), D), sr / D, lo, hi);
        if (!g || g.clarity < 0.6) { miss++; continue; }
        const e = 1200 * Math.log2(g.freq / f); if (Math.abs(e) > 600) { oct++; continue; } errs.push(e); }
      errs.sort((a, b) => a - b);
      return { n: errs.length + miss + oct, miss, oct, maxAbs: Math.round(Math.max(...errs.map(Math.abs))), p95: Math.round(errs.map(Math.abs).sort((a, b) => a - b)[Math.floor(errs.length * 0.95)]), mean: +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) }; };
    out.sr = sr;
    const D16 = Math.max(1, Math.round(sr / 16000)), D8 = Math.max(1, Math.round(sr / 8000));
    for (const kind of ["sine", "flute", "clarinet"]) for (const [lo, hi, f0, f1, label] of [[110, 1100, 140, 530, "clarinet range"], [200, 2400, 250, 1200, "flute C4–D6"], [400, 2400, 500, 1200, "recorder C5–D6"], [400, 2400, 1200, 2200, "recorder D6–C7"]]) {
      out[kind + " · " + label + " · 16k"] = sweep(kind, D16, lo, hi, f0, f1);
      out[kind + " · " + label + " · full " + sr] = sweep(kind, 1, lo, hi, f0, f1);
    }
    out["sine · Long Note 8k (80–1000) · 500–1200 Hz"] = sweep("sine", D8, 80, 1000, 500, 1200);
    return out; })()`);
  const rows = Object.entries(res).filter(([k]) => k !== "sr").map(([k, v]) => [k, v.n, v.miss, v.oct, sgn(v.mean), v.p95, v.maxAbs]);
  table(`synth: page detect() on synthetic tones (10-cent steps; context ${res.sr} Hz)`, ["tone · range · rate", "tones", "no pitch", "register err", "mean err (c)", "p95 |err| (c)", "max |err| (c)"], rows);
  out("synth", res);
  await close(p);
};

// Breathy tone: white noise that starts and stops with the note, at a given SNR under it (the floor stays at the room's).
const SNRS = JSON.parse(process.env.WW_SNRS || "null") || [null, 12, 6, 0, -6, -10];
MODE.breath = async ({ b, smp, recs }, { level = 0.1, tag = "breath" } = {}) => {
  const all = {};
  const insts = [...WINDS, ...CONTROLS.slice(0, 1)];
  await pool(insts.flatMap(inst => ["ninja.html", "sound-game.html"].map(page => async () => {
    const p = await wwPage(b, page, inst, smp);
    const R = await refs(p, inst, recs[inst]);
    const rows = [];
    for (const w of QUIET_NOTES[inst]) {
      const n = nearest(inst, recs[inst], R, w), cells = [];
      for (const snr of SNRS) {
        const g = snr === null ? 0 : level * Math.pow(10, -snr / 20) / 0.577;
        await p.eval(`__ww.stop(); __inj.noise(0); ${page === "sound-game.html" ? "setLevel(1);" : ""}`);
        await sleep(900);
        await p.eval(`state.noiseFloor = 0.002; __ww.frames = []; window.__t0 = __ww.play(${JSON.stringify(n.url)}, { level: ${level}, rate: ${n.rate}, loop: ${JSON.stringify(n.loop)} }); __inj.noise(${g})`);
        await sleep(2600);
        const fr = await p.eval(`__ww.stop(); __inj.noise(0); __ww.frames.map(f => Object.assign({}, f, { t: Math.round(f.t - __t0) }))`);
        if (page === "ninja.html") { const st = noteStats(fr, 2600, hz(w - toW(inst))); cells.push(st.inBandPct + "%" + (st.regPct ? ` (${st.regPct}% reg)` : "")); }
        else { const on = fr.find(f => f.on); let drops = 0; fr.forEach((f, i) => { if (i && fr[i - 1].on && !f.on) drops++; }); cells.push(on ? `on ${on.t} ms` + (drops ? `, ${drops} drop${drops > 1 ? "s" : ""}` : "") : "never"); }
      }
      rows.push([nameOf(w) + ` (${nameOf(w - toW(inst))})`, ...cells]);
    }
    all[inst + " " + page] = rows;
    table(`${tag}: ${inst} on ${page} (note ${db(level)} dBFS + white noise with it)`, ["written (concert)", ...SNRS.map(x => x === null ? "clean" : "SNR " + x + " dB")], rows);
    await close(p);
  })), 4);
  out(tag, all);
};

// Reference tones: is each recording usable as a 2 s "hear the note" clip (sounds/<inst>/<concert>.m4a, Songs loops 0.5–1.4 s)?
MODE.ref = async ({ b, smp, recs }) => {
  const all = {};
  await pool([...WINDS, ...CONTROLS].map(inst => async () => {
    const p = await wwPage(b, "ninja.html", inst, smp);
    const R = await refs(p, inst, recs[inst]);
    const rows = [], data = [];
    for (const [i, r] of recs[inst].entries()) {
      if (r.kind === "staccato") continue;
      const c = await p.eval(`__ww.clip(${JSON.stringify(r.url)})`);
      const f = x => x === null ? "—" : x.toFixed(1);
      data.push({ file: r.file, concert: nameOf(r.concert), off: R[i].off, ...c });
      rows.push([label(r), r.file, c.onset.toFixed(2) + " s", c.pre === null ? "—" : f(c.pre - c.steady) + " dB", f(c.tail - c.steady) + " dB", c.sustain.toFixed(1) + " s", f(c.range) + " dB", sgn(+c.seam.toFixed(1)) + " dB",
        c.best ? `${c.best.start.toFixed(1)} s (${f(c.best.range)} dB)` : "—", Math.round(R[i].spread) + " c", sgn(R[i].off), db(R[i].rms) + " dB"]);
    }
    all[inst] = data;
    table(`ref: ${inst}`, ["written (concert)", "file", "onset in file", "noise before onset re note", "file end re note", "sustain", "level range 0.5–1.4 s after onset", "loop seam step", "steadiest 2 s starts (range)", "pitch p10–p90", "off ET (c)", "steady RMS"], rows);
    await close(p);
  }), 4);
  out("ref", all);
};

// Prototypes. 1) Offline: every recording through the analyse() pipeline with detect() variants. 2) Real time: the chosen
// variant monkey-patched over the page's detect() (Ninja, Songs), before/after.
const VARIANTS = JSON.parse(process.env.WW_VARIANTS || "null") || { page: { page: true }, "k 0.95": { k: 0.95 }, "k 0.97": { k: 0.97 }, "oct +0.02": { oct: 0.02 },
  "octv +0.03": { octv: 0.03 }, "octv +0.05": { octv: 0.05 }, "48k k 0.90": { D: 1 }, "48k k 0.97": { D: 1, k: 0.97 }, "48k octv +0.03": { D: 1, octv: 0.03 },
  "page SNR 6": { page: true, snr: 6 }, "k 0.97 SNR 6": { k: 0.97, snr: 6 }, "octv +0.03 SNR 6": { octv: 0.03, snr: 6 },
  "page SNR 0": { page: true, snr: 0 }, "k 0.97 SNR 0": { k: 0.97, snr: 0 }, "octv +0.03 SNR 0": { octv: 0.03, snr: 0 } };
// The live prototype (the offline sweep's best): after the usual pick, if the NSDF peak near twice the lag is higher by
// more than 0.03 (both judged by their interpolated heights), take it: the octave below. Every instrument.
export const PATCH = process.env.WW_PATCH || `detect = (b, r, lo, hi) => __ww.detectV(b, r, lo, hi, { octv: 0.03 })`;
MODE.proto = async (C) => {
  const { b, smp, recs } = C, tot = {};
  await pool([...WINDS, ...CONTROLS].map(inst => async () => {
    const p = await wwPage(b, "ninja.html", inst, smp);
    const R = await refs(p, inst, recs[inst]);
    const { lo, hi } = await p.eval(`({ lo: INSTRUMENTS[state.inst].lo, hi: INSTRUMENTS[state.inst].hi })`);
    tot[inst] = {};
    for (const [name, v] of Object.entries(VARIANTS)) {
      const t = tot[inst][name] = { frames: 0, inBand: 0, up: 0, down: 0, notesUp: [], notesDown: [] };
      for (const [i, r] of recs[inst].entries()) {
        if (r.kind === "staccato") continue;
        const fs = await p.eval(`__ww.offline(${JSON.stringify(r.url)}, ${JSON.stringify({ ...v, lo, hi })})`);
        const cs = fs.map(f => f > 0 ? centsOf(f, hz(r.concert)) : null);
        const up = cs.filter(c => c !== null && c >= 600).length, down = cs.filter(c => c !== null && c <= -600).length;
        t.frames += fs.length; t.inBand += cs.filter(c => c !== null && Math.abs(c) < 50).length; t.up += up; t.down += down;
        if (up) t.notesUp.push(`${nameOf(r.written)}${r.kind === "vib" ? "~" : ""} ${pct(up, fs.length)}%`);
        if (down) t.notesDown.push(`${nameOf(r.written)}${r.kind === "vib" ? "~" : ""} ${pct(down, fs.length)}%`);
      }
    }
    await close(p);
  }), 4);
  out("proto.offline", tot);
  for (const name of Object.keys(VARIANTS))
    table(`proto offline: ${name}`, ["instrument", "frames", "in ±50c", "octave+ frames", "octave− frames", "notes with octave+", "notes with octave−"],
      Object.entries(tot).map(([inst, v]) => [inst, v[name].frames, pct(v[name].inBand, v[name].frames) + "%", v[name].up, v[name].down, v[name].notesUp.join(", ") || "—", v[name].notesDown.join(", ") || "—"]));
  if (process.env.WW_PROTO_LIVE !== "0") {
    console.log(`\nproto live: patch = ${PATCH}`);
    await MODE.notes(C, { tag: "proto-notes", setup: PATCH });
    await MODE.songs(C, { tag: "proto-songs", setup: PATCH });
  }
};

export { wwLib, recordings, serveSamples, wwPage, noteStats, SCALE, MODE, REF, refs, nearest };

/* ---------- Main ---------- */
async function main() {
  const smp = await serveSamples();
  const b = await launch();
  let closing = false;
  const quit = async code => { if (closing) return; closing = true; await Promise.race([b.close(), sleep(3000)]); await smp.close(); process.exit(code); };
  const watchdog = setTimeout(() => { console.log("watchdog: 45 min"); quit(2); }, 45 * 60 * 1000);
  process.on("SIGINT", () => quit(2)); process.on("SIGTERM", () => quit(2));
  const recs = {};
  for (const inst of [...WINDS, ...CONTROLS]) recs[inst] = await recordings(inst);
  const C = { b, smp, recs };
  try {
    for (const m of MODES) if (run(m) && MODE[m]) { const t = Date.now(); await MODE[m](C); console.log(`\n(${m}: ${((Date.now() - t) / 1000).toFixed(0)} s)`); }
  } finally {
    clearTimeout(watchdog);
    if (process.env.WW_OUT) await writeFile(process.env.WW_OUT, JSON.stringify(results, null, 1));
    await quit(0);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
