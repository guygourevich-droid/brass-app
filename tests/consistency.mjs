// Consistency suite: checks that every page follows the shared rules in app/CLAUDE.md.
// Static checks read the source (sw.js, the shared blocks, i18n keys, analytics events, keyboard, the mic block,
// the home tiles, copy rules); runtime checks load every page in headless Chrome (both languages, every viewport,
// first visit and returning, every instrument) and look for errors, sideways scroll, broken words and hidden buttons.
//
//   node tests/consistency.mjs              all checks (run from app/)
//   node tests/consistency.mjs --static     source checks only (no Chrome, ~1 s)
//   node tests/consistency.mjs --runtime    Chrome checks only
//   node tests/consistency.mjs --shots      also save a screenshot per page/language/viewport to tests/out/
//   --only=ninja,songs  limit the runtime pages · --jobs=N  parallel tabs (default 6) · -v  every detail line
//
// Exit code 1 if anything FAILs. WARN = worth a look, does not fail the run. Whole run ≈ 2 min.
// Guarded run: (node tests/consistency.mjs & P=$!; sleep 300; kill $P; pkill -f tonebee-consistency)
// Our Chrome profile is tagged "tonebee-consistency" (CHROME_TAG), so other runs' `pkill -f tonebee-chrome` miss it.
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ROOT, PAGES, MIC_PAGES, VIEWPORTS, serve, launch, sleep } from "./lib.mjs";

const ARGS = process.argv.slice(2);
const flag = name => ARGS.includes("--" + name);
const opt = name => (ARGS.find(a => a.startsWith("--" + name + "=")) || "").split("=")[1];
const VERBOSE = ARGS.includes("-v");
const DO_STATIC = !flag("runtime") || flag("static");
const DO_RUNTIME = !flag("static") || flag("runtime");
const SHOTS = flag("shots");
const JOBS = +opt("jobs") || 6;
const ONLY = opt("only") ? opt("only").split(",").map(p => p.endsWith(".html") ? p : p + ".html") : null;
const OUT = join(ROOT, "tests/out");
const T0 = Date.now();
process.env.CHROME_TAG ||= "tonebee-consistency";
// TB_DEBUG=1 prints progress to stderr (which section, which page), to find a hang.
const dbg = (...a) => { if (process.env.TB_DEBUG) console.error(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a); };

/* ---------- Reporting ---------- */

const results = [];
function report(name, fails = [], warns = []) {
  const status = fails.length ? "FAIL" : warns.length ? "WARN" : "PASS";
  results.push({ name, status, fails, warns });
  const max = VERBOSE ? Infinity : 30;
  console.log(`${status} ${name}`);
  const lines = [...fails.map(f => "  ✗ " + f), ...warns.map(w => "  · " + w)];
  lines.slice(0, max).forEach(l => console.log(l.replace(/\n/g, "\n      ")));
  if (lines.length > max) console.log(`  … ${lines.length - max} more (-v shows all)`);
}

/* ---------- Reading the source ---------- */

const GAMES = PAGES.filter(p => p !== "index.html");
const src = {};
for (const p of PAGES) src[p] = readFileSync(join(ROOT, p), "utf8");
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

// A small JS scanner: skips strings, templates, comments and regex literals so brackets can be matched.
function skipJs(s, i, prev) {
  const c = s[i], n = s[i + 1];
  if (c === '"' || c === "'") { for (let j = i + 1; j < s.length; j++) { if (s[j] === "\\") j++; else if (s[j] === c || s[j] === "\n") return j + 1; } return s.length; }
  if (c === "`") {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === "\\") j++;
      else if (s[j] === "`") return j + 1;
      else if (s[j] === "$" && s[j + 1] === "{") j = matchClose(s, j + 1);
    }
    return s.length;
  }
  if (c === "/" && n === "/") { const e = s.indexOf("\n", i); return e < 0 ? s.length : e; }
  if (c === "/" && n === "*") { const e = s.indexOf("*/", i + 2); return e < 0 ? s.length : e + 2; }
  if (c === "/" && /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prev)) {
    let cls = false;
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === "\\") j++;
      else if (s[j] === "[") cls = true;
      else if (s[j] === "]") cls = false;
      else if (s[j] === "/" && !cls) { let k = j + 1; while (/[a-z]/i.test(s[k] || "")) k++; return k; }
      else if (s[j] === "\n") return -1;
    }
  }
  return -1;
}
const KEYWORD_BEFORE = /\b(return|typeof|case|in|of|delete|void|throw|new|else|do)$/;
// Walks code tokens from `from`; calls fn(i, char, depth) on each code character; stops when fn returns true.
function walk(s, from, fn) {
  let depth = 0, prev = "";
  for (let i = from; i < s.length; i++) {
    const k = skipJs(s, i, prev);
    if (k >= 0) { if (s[i] === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) { i = k - 1; continue; } i = k - 1; prev = "a"; continue; }
    const c = s[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    if (fn(i, c, depth)) return i;
    if (c === "}" || c === ")" || c === "]") depth--;
    if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? (KEYWORD_BEFORE.test(s.slice(Math.max(0, i - 8), i + 1)) ? "(" : "a") : c;
  }
  return -1;
}
// Index of the bracket that closes the one at `open`.
function matchClose(s, open) { return walk(s, open, (i, c, d) => (c === "}" || c === ")" || c === "]") && d === 1); }
// One statement starting at `from`: up to its `;` (or the `}` closing a block statement).
function statementAt(s, from) {
  const end = walk(s, from, (i, c, d) => (c === ";" && d === 0) || (c === "}" && d === 1 && !/^\s*[.,)(;?:]/.test(s.slice(i + 1, i + 3)) && /^\s*(if|for|while|function|async|try)\b/.test(s.slice(from, from + 12))));
  return end < 0 ? null : s.slice(from, end + 1);
}
// Source without comments, one statement per line, whitespace collapsed (so a one-line and a multi-line copy of the
// same code compare equal, and a diff shows only the statements that differ).
function normalize(code) {
  let out = "", prev = "";
  for (let i = 0; i < code.length; i++) {
    const k = skipJs(code, i, prev);
    if (k >= 0) {
      const isComment = code[i] === "/" && (code[i + 1] === "/" || code[i + 1] === "*");
      if (!isComment) out += code.slice(i, k).replace(/\n/g, " ");   // keep strings on one line
      i = k - 1; prev = "a"; continue;
    }
    const c = code[i];
    out += c === "{" || c === ";" ? c + "\n" : c === "}" ? "\n}\n" : /\s/.test(c) ? " " : c;
    if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? "a" : c;
  }
  return out.split("\n").map(l => l.trim().replace(/\s+/g, " ")).filter(Boolean).join("\n")
    .replace(/\n\}\n(?=[),;.]|else\b|catch\b|finally\b)/g, "\n} ");   // "} else", "})", "});" stay with their brace
}

// The page's main <script> (the one that starts with "use strict"), with its offset in the file.
function mainScript(page) {
  const html = src[page], re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) if (/^\s*"use strict";/.test(m[1])) return { code: m[1], at: m.index + "<script>".length };
  return null;
}
const MAIN = Object.fromEntries(PAGES.map(p => [p, mainScript(p)]));
const where = (page, idxInMain) => `${page}:${lineOf(src[page], MAIN[page].at + idxInMain)}`;

// `const NAME = <value>;` → { text, at } (value source and its index), or null.
function constDecl(code, name) {
  const m = new RegExp(`(^|\\n)\\s*(?:const|let) ${name}\\s*=\\s*`).exec(code);
  if (!m) return null;
  const at = m.index + m[0].length;
  const stmt = statementAt(code, at);
  return stmt && { text: stmt.replace(/;$/, ""), at, start: m.index + m[1].length };
}
// `function NAME(...) {...}` (or async) → { text, at }.
function funcDecl(code, name) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(code);
  if (!m) return null;
  const paren = m.index + m[0].length - 1;
  const close = matchClose(code, paren);
  const brace = code.indexOf("{", close);
  const end = matchClose(code, brace);
  return { text: code.slice(m.index, end + 1), at: m.index };
}
// A statement that starts with `startsWith` (literal text).
function stmtStarting(code, startsWith, { not } = {}) {
  let i = -1;
  while ((i = code.indexOf(startsWith, i + 1)) >= 0) {
    const stmt = statementAt(code, i);
    if (stmt && !(not && not.test(stmt))) return { text: stmt, at: i };
  }
  return null;
}
const evalExpr = (code, ctx = {}) => vm.runInNewContext("(" + code + ")", ctx, { timeout: 1000 });

// The page's TEXT and COMMON, evaluated for real (the object literals run in a sandbox).
const LANGS = {};
for (const p of PAGES) {
  const m = MAIN[p];
  const out = (LANGS[p] = { TEXT: null, COMMON: null, errors: [] });
  if (!m) { out.errors.push("no main <script> starting with \"use strict\""); continue; }
  for (const name of ["TEXT", "COMMON"]) {
    const d = constDecl(m.code, name);
    if (!d) { out.errors.push(`no const ${name}`); continue; }
    try { out[name] = evalExpr(d.text); out[name + "_at"] = d.at; out[name + "_src"] = d.text; }
    catch (e) { out.errors.push(`${name} does not evaluate: ${e.message}`); }
  }
}
// Where `key:` sits inside TEXT/COMMON for a language (for file:line in reports).
function keyLine(page, obj, lang, key) {
  const L = LANGS[page], s = L[obj + "_src"], at = L[obj + "_at"];
  if (!s) return page;
  const enAt = s.search(/\ben\s*:\s*\{/);
  const from = lang === "en" && enAt >= 0 ? enAt : 0;
  const re = new RegExp(`(?:^|[\\s,{])${key.replace(/[$]/g, "\\$")}\\s*:`, "g");
  re.lastIndex = from;
  const m = re.exec(s);
  return m ? where(page, at + m.index + 1) : page;
}

/* ---------- Static checks ---------- */

function staticChecks() {
  console.log("STATIC");

  // --- sw.js ---
  const swSrc = readFileSync(join(ROOT, "sw.js"), "utf8");
  let CACHE = null, FILES = [];
  try {
    ({ CACHE, FILES } = vm.runInNewContext(swSrc + "\n;({ CACHE, FILES })",
      { self: { addEventListener() {}, skipWaiting() {} }, caches: {}, location: {}, fetch() {}, setTimeout, clearTimeout, Promise, Request: class {} }));
  } catch (e) { report("sw.js evaluates", ["sw.js: " + e.message]); }
  report("sw.js: CACHE version string present", typeof CACHE === "string" && /^tonebee-v\d+$/.test(CACHE) ? [] : [`sw.js: CACHE = ${JSON.stringify(CACHE)}`]);
  const filesSet = new Set(FILES.map(f => (f === "./" ? "index.html" : f.replace(/^\.\//, ""))));
  const dupes = FILES.filter((f, i) => FILES.indexOf(f) !== i);
  report(`sw.js: every FILES entry exists on disk (${FILES.length})`,
    FILES.filter(f => f !== "./" && !existsSync(join(ROOT, f))).map(f => `sw.js:${lineOf(swSrc, swSrc.indexOf(`"${f}"`))} ${f} missing on disk`),
    dupes.map(f => `sw.js: ${f} listed twice`));
  {
    // Files the deploy leaves out (.assetsignore) 404 in production, and the cache install skips them silently.
    const ignore = existsSync(join(ROOT, ".assetsignore")) ? readFileSync(join(ROOT, ".assetsignore"), "utf8").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")) : [];
    const ignored = f => ignore.some(g => { const rx = new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\/$/, "") + "(/|$)"); return rx.test(f); });
    report("sw.js: no FILES entry or page is excluded from the deploy by .assetsignore",
      [...FILES.filter(f => f !== "./" && ignored(f)).map(f => `sw.js lists ${f}, which .assetsignore keeps off the server`),
       ...PAGES.filter(ignored).map(p => `${p} is a live page but .assetsignore keeps it off the server`)]);
  }
  report("sw.js: every page is in FILES", PAGES.filter(p => !filesSet.has(p)).map(p => `${p} not in FILES (offline: falls back to the home page)`));

  // Every asset a page needs: HTML src/href, CSS url(), string literals under icons/ sounds/ fonts/, manifest icons.
  // A literal with ${…} or a bare "dir/" prefix (joined in code) stands for every file on disk it can match.
  const diskFiles = [];
  (function list(dir) { for (const f of readdirSync(join(ROOT, dir))) { const rel = dir ? dir + "/" + f : f; if (statSync(join(ROOT, rel)).isDirectory()) list(rel); else diskFiles.push(rel); } })("icons");
  for (const d of ["sounds", "fonts"]) (function list(dir) { for (const f of readdirSync(join(ROOT, dir))) { const rel = dir + "/" + f; if (statSync(join(ROOT, rel)).isDirectory()) list(rel); else diskFiles.push(rel); } })(d);
  const refs = [];   // { file, line, path?, pattern? }
  const addRefs = (file, text) => {
    const at = i => lineOf(text, i);
    for (const m of text.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)) {
      const u = m[1];
      if (/^(https?:|mailto:|tel:|data:|#|\/\/|javascript:)/.test(u) || u.includes("${") || u.includes("\" +")) continue;
      refs.push({ file, line: at(m.index), path: u.split(/[?#]/)[0] });
    }
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) if (!/^(data:|https?:|#)/.test(m[1])) refs.push({ file, line: at(m.index), path: m[1] });
    for (const m of text.matchAll(/(["'`])((?:icons|sounds|fonts)\/[^"'`\n]*)\1/g)) {
      const lit = m[2];
      if (/\s/.test(lit) && !lit.includes("${")) continue;     // prose in a comment-like string
      if (lit.includes("${") || lit.endsWith("/")) {
        const rx = new RegExp("^" + lit.split(/\$\{[^}]*\}/).map(x => x.replace(/[.*+?^()|[\]\\]/g, "\\$&")).join("[^]*") + (lit.endsWith("/") ? "" : "$"));
        refs.push({ file, line: at(m.index), pattern: lit, rx });
      } else refs.push({ file, line: at(m.index), path: lit });
    }
  };
  for (const p of PAGES) addRefs(p, src[p].replace(/<!--[\s\S]*?-->/g, s => s.replace(/[^\n]/g, " ")));
  addRefs("fonts/fonts.css", readFileSync(join(ROOT, "fonts/fonts.css"), "utf8").replace(/url\(/g, "url(").replace(/url\(\s*["']?(?!\/|https?:)/g, "url(fonts/"));
  try {
    const man = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
    for (const i of man.icons || []) refs.push({ file: "manifest.json", line: 0, path: i.src });
    if (man.start_url) refs.push({ file: "manifest.json", line: 0, path: man.start_url.replace(/^\.\//, "") });
  } catch (e) { report("manifest.json parses", ["manifest.json: " + e.message]); }
  const broken = [], offline = [], seen = new Set();
  for (const r of refs) {
    const paths = r.path ? [r.path.replace(/^\.\//, "")] : diskFiles.filter(f => r.rx.test(f));
    if (r.path && !existsSync(join(ROOT, paths[0])) && !seen.has("b" + paths[0])) {
      seen.add("b" + paths[0]);
      broken.push(`${r.file}:${r.line} ${paths[0]} does not exist`);
    }
    for (const f of paths) {
      if (!existsSync(join(ROOT, f)) || filesSet.has(f) || seen.has("o" + f)) continue;
      seen.add("o" + f);
      offline.push(`${r.file}:${r.line} ${f}${r.pattern ? ` (via "${r.pattern}")` : ""} not in sw.js FILES → missing offline`);
    }
  }
  report("assets: every local src/href/url() a page or fonts.css names exists", broken);
  report("sw.js: every asset the pages reference is cached (offline)", offline);

  // --- Shared blocks ---
  const groupBy = (items, keyFn) => { const g = new Map(); for (const it of items) { const k = keyFn(it); if (!g.has(k)) g.set(k, []); g.get(k).push(it); } return [...g.entries()].sort((a, b) => b[1].length - a[1].length); };
  // Reports pages whose copy of a block differs from the most common copy, with a line diff.
  function sameEverywhere(name, getBlock, { pages = PAGES, norm = x => x } = {}) {
    const fails = [], blocks = [];
    for (const p of pages) {
      const b = getBlock(p);
      if (!b) { fails.push(`${p}: missing`); continue; }
      blocks.push({ p, ...b, n: norm(b.text) });
    }
    const groups = groupBy(blocks, b => b.n);
    if (groups.length > 1) {
      const ref = groups[0][1];
      for (const [, list] of groups.slice(1)) {
        fails.push(`${list.map(b => b.where).join(", ")} differs from ${ref.map(b => b.p.replace(".html", "")).join(", ")}:\n` + diff(ref[0].n, list[0].n));
      }
    }
    report(name, fails);
  }
  const scriptWith = (p, marker) => {
    const re = /<script>([\s\S]*?)<\/script>/g; let m;
    while ((m = re.exec(src[p]))) if (m[1].includes(marker)) return { text: m[1], where: `${p}:${lineOf(src[p], m.index)}`, idx: m.index, end: m.index + m[0].length };
    return null;
  };
  sameEverywhere("shared: Analytics <script> identical on every page", p => scriptWith(p, "// Analytics (PostHog)"));
  report("shared: Analytics <script> is the last thing in <head>", PAGES.filter(p => {
    const s = scriptWith(p, "// Analytics (PostHog)"); return s && !/^\s*<\/head>/.test(src[p].slice(s.end));
  }).map(p => `${p}: something follows the Analytics script before </head>`));
  sameEverywhere("shared: <head> first-paint script (move-house + dir=ltr) identical", p => {
    const s = scriptWith(p, "document.documentElement.dir = \"ltr\"");
    return s && s.idx < src[p].indexOf("</head>") ? s : null;
  });
  const head = p => src[p].slice(0, src[p].indexOf("</head>"));
  const tagChecks = [
    ["<html lang=\"he\" dir=\"rtl\">", p => /<html lang="he" dir="rtl">/.test(src[p])],
    ["<meta charset=\"utf-8\">", p => /<meta charset="utf-8">/.test(head(p))],
    ["viewport meta (width=device-width, initial-scale=1)", p => /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(head(p))],
    ["manifest link", p => /<link rel="manifest" href="manifest.json">/.test(head(p))],
    ["apple-touch-icon link", p => /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png">/.test(head(p))],
    ["favicon links", p => /<link rel="icon" href="icons\/favicon-32.png"/.test(head(p))],
    ["fonts/fonts.css link (self-hosted)", p => /<link rel="stylesheet" href="fonts\/fonts.css">/.test(head(p))],
    ["no Google Fonts / CDN", p => !/fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr/.test(src[p])],
    ["apple-mobile-web-app-title Tonebee", p => /<meta name="apple-mobile-web-app-title" content="Tonebee">/.test(head(p))]
  ];
  for (const [what, ok] of tagChecks) report(`shared: ${what} on every page`, PAGES.filter(p => !ok(p)).map(p => `${p}: missing or different`));
  // The viewport line itself, in case one page adds viewport-fit or similar.
  sameEverywhere("shared: viewport meta identical", p => { const m = head(p).match(/<meta name="viewport"[^>]*>/); return m && { text: m[0], where: `${p}:${lineOf(src[p], m.index)}` }; });
  report("shared: main <script> starts with \"use strict\"", PAGES.filter(p => !MAIN[p]).map(p => `${p}: no <script> beginning with "use strict"`));
  // Language block: LANG, COMMON, T, applyText right after "use strict", in that order, identical code.
  report("shared: Language block follows \"use strict\" (LANG, COMMON, T, applyText, TEXT)", PAGES.flatMap(p => {
    const m = MAIN[p]; if (!m) return [];
    const at = n => { const r = new RegExp(`\\n(?:const ${n}\\b|function ${n}\\b)`).exec(m.code); return r ? r.index : -1; };
    const pos = ["LANG", "COMMON", "T", "applyText"].map(at), out = [];
    if (pos.some(x => x < 0)) out.push(`${p}: missing ${["LANG", "COMMON", "T", "applyText"].filter((_, i) => pos[i] < 0).join(", ")}`);
    else if (pos.some((x, i) => i && x < pos[i - 1])) out.push(`${where(p, pos[0])}: LANG/COMMON/T/applyText out of order`);
    const firstCode = normalize(m.code).split("\n")[1] || "";
    if (!/^const LANG = /.test(firstCode)) out.push(`${p}: first statement after "use strict" is not const LANG (${firstCode.slice(0, 50)})`);
    if (at("TEXT") < 0) out.push(`${p}: no const TEXT`);
    return out;
  }));
  report("shared: TEXT and COMMON are { he, en } on every page", PAGES.flatMap(p => ["TEXT", "COMMON"].map(o => {
    const v = LANGS[p][o]; const k = v ? Object.keys(v).sort().join(",") : "missing";
    return k === "en,he" ? null : `${p}: ${o} has ${k}`;
  }).filter(Boolean)));
  for (const name of ["LANG", "T"]) sameEverywhere(`shared: Language block \`${name}\` identical`, p => { const d = MAIN[p] && constDecl(MAIN[p].code, name); return d && { text: d.text, where: where(p, d.start) }; }, { norm: normalize });
  sameEverywhere("shared: Language block `applyText` identical", p => { const d = MAIN[p] && funcDecl(MAIN[p].code, "applyText"); return d && { text: d.text, where: where(p, d.at) }; }, { norm: normalize });
  // COMMON: same keys and same words on every page.
  {
    const fails = [], all = {};
    for (const p of PAGES) for (const l of ["he", "en"]) for (const [k, v] of Object.entries(LANGS[p].COMMON?.[l] || {})) ((all[l] ??= {})[k] ??= []).push({ p, v: String(v) });
    for (const p of PAGES) if (!LANGS[p].COMMON) fails.push(`${p}: COMMON missing or does not evaluate`);
    const present = PAGES.filter(p => LANGS[p].COMMON);
    for (const l of ["he", "en"]) for (const [k, list] of Object.entries(all[l] || {})) {
      const missing = present.filter(p => !list.some(x => x.p === p));
      if (missing.length) fails.push(`COMMON.${l}.${k} only on ${list.length}/${present.length} pages; missing on ${missing.map(p => p.replace(".html", "")).join(", ")}`);
      const groups = groupBy(list, x => x.v);
      if (groups.length > 1) fails.push(`COMMON.${l}.${k} differs: ` + groups.map(([v, ps]) => `${JSON.stringify(v)} (${ps.map(x => keyLine(x.p, "COMMON", l, k)).join(", ")})`).join(" vs "));
    }
    report("shared: COMMON identical on every page (keys and words)", fails);
  }
  sameEverywhere("shared: service-worker registration line identical", p => {
    const i = src[p].indexOf("navigator.serviceWorker.register(");
    if (i < 0) return null;
    const ls = src[p].lastIndexOf("\n", i) + 1, le = src[p].indexOf("\n", i);
    return { text: src[p].slice(ls, le).trim(), where: `${p}:${lineOf(src[p], i)}` };
  });

  // --- i18n ---
  {
    const fails = [], warns = [];
    let dynamic = 0;
    for (const p of PAGES) {
      const L = LANGS[p];
      L.errors.forEach(e => fails.push(`${p}: ${e}`));
      if (!L.TEXT || !L.COMMON) continue;
      const has = (l, k) => (L.TEXT[l] && k in L.TEXT[l]) || (L.COMMON[l] && k in L.COMMON[l]);
      const html = src[p];
      const used = [];   // { key, line, kind }
      for (const m of html.matchAll(/\bdata-t(-html|-title|-aria)?="([^"$]+)"/g)) used.push({ key: m[2], line: lineOf(html, m.index), kind: "data-t" + (m[1] || "") });
      for (const m of html.matchAll(/\.dataset\.t(?:Html|Title|Aria)?\s*=\s*["'`]([^"'`$]+)["'`]/g)) used.push({ key: m[1], line: lineOf(html, m.index), kind: "dataset" });
      for (const m of html.matchAll(/setAttribute\(\s*["']data-t(?:-html|-title|-aria)?["']\s*,\s*["'`]([^"'`$]+)["'`]/g)) used.push({ key: m[1], line: lineOf(html, m.index), kind: "setAttribute" });
      // T("key") with a literal key. applyText's own guarded T("pageTitle") is not a use (it runs only if the key exists).
      const ap = funcDecl(MAIN[p].code, "applyText"), apFrom = MAIN[p].at + (ap ? ap.at : 0), apTo = apFrom + (ap ? ap.text.length : 0);
      for (const m of html.matchAll(/(?<![\w$.])T\(\s*(["'`])([^"'`$]*)\1\s*[,)]/g)) if (!(m.index >= apFrom && m.index < apTo)) used.push({ key: m[2], line: lineOf(html, m.index), kind: "T()" });
      // T("prefix" + x) and T(`prefix${x}`): at least one key with that prefix must exist in both languages.
      for (const m of html.matchAll(/(?<![\w$.])T\(\s*(?:(["'])(\w+)\1\s*\+|`(\w*)\$\{)/g)) {
        const pre = m[2] ?? m[3];
        for (const l of ["he", "en"]) if (!Object.keys({ ...L.TEXT[l], ...L.COMMON[l] }).some(k => k.startsWith(pre)))
          fails.push(`${p}:${lineOf(html, m.index)} T("${pre}"…) — no ${l} key starts with "${pre}"`);
        dynamic++;
      }
      for (const m of html.matchAll(/(?<![\w$.])T\(\s*(?!["'`)])/g)) if (!/^T\(\s*(n\.dataset|key\b)/.test(html.slice(m.index, m.index + 20))) dynamic++;
      for (const u of used) {
        const he = has("he", u.key), en = has("en", u.key);
        if (!he && !en) fails.push(`${p}:${u.line} ${u.kind} "${u.key}" is in neither TEXT nor COMMON → the raw key shows on screen`);
        else if (!en) fails.push(`${p}:${u.line} ${u.kind} "${u.key}" has no English → Hebrew shows on the English page`);
        else if (!he) fails.push(`${p}:${u.line} ${u.kind} "${u.key}" has no Hebrew → falls back to the key`);
      }
      // he and en carry the same keys, with the same kind of value.
      for (const obj of ["TEXT", "COMMON"]) {
        const he = L[obj].he || {}, en = L[obj].en || {};
        for (const k of Object.keys(he)) if (!(k in en)) fails.push(`${keyLine(p, obj, "he", k)} ${obj}.he.${k} has no ${obj}.en.${k}`);
        for (const k of Object.keys(en)) if (!(k in he)) fails.push(`${keyLine(p, obj, "en", k)} ${obj}.en.${k} has no ${obj}.he.${k}`);
        const kind = v => Array.isArray(v) ? `array[${v.length}]` : typeof v;
        for (const k of Object.keys(he)) if (k in en && kind(he[k]) !== kind(en[k]))
          fails.push(`${keyLine(p, obj, "en", k)} ${obj}.${k}: he is ${kind(he[k])}, en is ${kind(en[k])}`);
        // English never shows Hebrew letters.
        for (const [k, v] of Object.entries(en)) {
          const text = typeof v === "function" ? v.toString() : Array.isArray(v) ? v.join(" ") : String(v);
          if (/[֐-׿]/.test(text)) fails.push(`${keyLine(p, obj, "en", k)} ${obj}.en.${k} contains Hebrew: ${JSON.stringify(text.slice(0, 80))}`);
        }
      }
    }
    if (dynamic) warns.push(`${dynamic} T() calls with a computed key are not checked statically (the runtime raw-key scan covers what renders)`);
    report("i18n: every data-t* / T(\"key\") resolves in he and en; he/en key sets match", fails, warns);
  }

  // --- Analytics events ---
  {
    // CLAUDE.md "Analytics" constraint: the events and their documented props.
    const EVENTS = {
      instrument_interest: ["instrument"], notify_click: ["what"], game_time: ["seconds", "seconds_listening"], game_start: [],
      mic_error: ["reason"], audio_recover: ["why"], howto: ["how"], long_note: ["seconds", "level", "reached"],
      success: ["step", "target", "note", "bananas", "seconds", "world"], round_end: ["notes", "sliced", "level"],
      song_end: ["song", "mode", "got", "total"], answer: ["correct", "level"]
    };
    const spec = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
    const fails = [], warns = [];
    for (const e of Object.keys(EVENTS)) if (!spec.includes("`" + e + "`")) warns.push(`CLAUDE.md no longer names \`${e}\`: update EVENTS in this test`);
    const textInputs = [];
    for (const p of PAGES) {
      const html = src[p];
      for (const m of html.matchAll(/<input\b[^>]*>|<textarea\b|contenteditable|prompt\(/g)) {
        if (/^<input/.test(m[0]) && /type="(range|checkbox|radio|button|submit|hidden)"/.test(m[0])) continue;
        textInputs.push(`${p}:${lineOf(html, m.index)} ${m[0].slice(0, 60)}`);
      }
      for (const m of html.matchAll(/\btbTrack\(\s*/g)) {
        const paren = html.indexOf("(", m.index);
        const before = html.slice(html.lastIndexOf("\n", m.index) + 1, m.index);
        if (before.includes("//") || /window\.tbTrack = function/.test(html.slice(m.index - 20, m.index + 30))) continue;   // a comment, or the definition
        const close = matchClose(html, paren);
        const args = html.slice(paren + 1, close);
        const line = `${p}:${lineOf(html, m.index)}`;
        const ev = args.match(/^\s*(["'])(\w+)\1/);
        if (!ev) { if (!/^\s*event\b/.test(args)) fails.push(`${line} tbTrack with a computed event name: ${args.slice(0, 60)}`); continue; }
        if (!EVENTS[ev[2]]) { fails.push(`${line} event "${ev[2]}" is not in CLAUDE.md's list`); continue; }
        const brace = args.indexOf("{");
        if (brace < 0) continue;
        const propsSrc = args.slice(brace, matchClose(args, brace) + 1);
        const keys = [...propsSrc.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g)].map(k => k[1]);
        for (const k of keys) if (!EVENTS[ev[2]].includes(k)) warns.push(`${line} ${ev[2]} carries "${k}", not among CLAUDE.md's props for it (${EVENTS[ev[2]].join(", ") || "none"})`);
        if (/\.value\b|textContent|innerText|innerHTML|prompt\(|\.message\b|location\.|URLSearchParams|localStorage/.test(propsSrc))
          fails.push(`${line} ${ev[2]} props may carry text: ${propsSrc.replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
    if (textInputs.length) fails.push(...textInputs.map(t => `${t} — a text field: anything typed must never reach tbTrack`));
    report("analytics: tbTrack events = CLAUDE.md list; no prop can carry typed text", fails, warns);
  }

  // --- Keyboard: e.code, never e.key ---
  {
    const fails = [], warns = [];
    for (const p of PAGES) {
      const html = src[p];
      const aliases = new Set([...html.matchAll(/\b(?:const|let|var)\s+[^;]*?\b(\w+)\s*=\s*(?:e|ev|evt|event)\.key\b(?!Code)/g)].map(m => m[1]));
      for (const m of html.matchAll(/\b(e|ev|evt|event)\.(key|keyCode|which|charCode)\b(?!\s*\()/g)) {
        let line = html.slice(html.lastIndexOf("\n", m.index) + 1, html.indexOf("\n", m.index));
        // `const k = e.key;` → the comparisons of k follow in the next lines of the same handler.
        if (/\b(?:const|let|var)\b[^;]*=\s*(?:e|ev|evt|event)\.key\b/.test(line)) line = html.slice(m.index, m.index + 1500).split("\n").slice(0, 14).join("\n");
        const lits = [...new Set([...line.matchAll(new RegExp(`(?:\\b(?:e|ev|evt|event)\\.key|\\b(?:${[...aliases].join("|") || "\\$none"}))\\s*[!=]==?\\s*(["'])(.*?)\\1`, "g"))].map(x => x[2]))];
        const at = `${p}:${lineOf(html, m.index)}`;
        if (m[2] !== "key") { fails.push(`${at} reads e.${m[2]}`); continue; }
        const printable = lits.filter(l => l.length === 1 && l !== " ");
        if (printable.length) fails.push(`${at} e.key === ${printable.map(x => JSON.stringify(x)).join(", ")}: a Hebrew layout sends another character`);
        else warns.push(`${at} uses e.key (${lits.map(x => JSON.stringify(x)).join(", ") || "aliased"}): named keys, layout-independent, but CLAUDE.md says e.code only`);
      }
    }
    // Dedupe identical-line warnings (an alias line counts once).
    report("keyboard: shortcuts read e.code, never e.key", [...new Set(fails)], [...new Set(warns)]);
  }

  // --- Mic block drift (the 7 mic pages) ---
  {
    const pieces = {
      "getFloatTimeDomainData shim": c => stmtStarting(c, "if (window.AnalyserNode && !AnalyserNode.prototype.getFloatTimeDomainData)"),
      "tap resumes the engine": c => stmtStarting(c, "[\"touchend\", \"click\"].forEach("),
      "mic status opens the check panel": c => stmtStarting(c, "document.getElementById(\"micText\").parentElement.addEventListener("),
      "IS_IOS": c => wrapDecl(c, "IS_IOS"),
      "VOICE_PARAM": c => wrapDecl(c, "VOICE_PARAM"),
      "MIC_OPTIONS": c => wrapDecl(c, "MIC_OPTIONS"),
      "audioLine (check panel)": c => wrapDecl(c, "audioLine"),
      "ensureCtx": c => funcDecl(c, "ensureCtx"),
      "getUserMedia + error mapping": c => {
        const i = c.indexOf("micStream = await navigator.mediaDevices.getUserMedia(");
        if (i < 0) return null;
        const t = c.lastIndexOf("try {", i), k = c.indexOf("catch", i), b = c.indexOf("{", k), e = matchClose(c, b);
        return { text: c.slice(t, e + 1), at: t };
      },
      "sample-rate check": c => { const i = c.indexOf("const track = micStream.getAudioTracks()[0];"); if (i < 0) return null; const j = c.indexOf("\n", c.indexOf("ctx.sampleRate !== micRate", i)); return { text: c.slice(i, j), at: i }; },
      "analyser pulled to destination": c => { const i = c.indexOf("const pull = ctx.createGain();"); if (i < 0) return null; const j = c.indexOf("pull.connect(ctx.destination);", i); return j < 0 ? null : { text: c.slice(i, j + 31), at: i }; },
      "fail": c => funcDecl(c, "fail"),
      "stopMic": c => funcDecl(c, "stopMic"),
      "keepAwake": c => funcDecl(c, "keepAwake"),
      "needFresh": c => funcDecl(c, "needFresh"),
      "background → needFresh": c => stmtStarting(c, "document.addEventListener(\"visibilitychange\"", { not: /\bsend\(\)/ }),
      "interrupted 1.5 s → needFresh": c => stmtStarting(c, "document.addEventListener(\"pointerup\""),
      "3 s of zeros": c => { const i = c.indexOf("if (state.rms === 0 && micStream) {"); if (i < 0) return null; const b = c.indexOf("{", i); let e = matchClose(c, b); const tail = c.slice(e + 1).match(/^\s*else[^{]*\{/); if (tail) e = matchClose(c, e + 1 + tail[0].length - 1); return { text: c.slice(i, e + 1), at: i }; },
      "startMic reloads once fresh": c => { const i = c.indexOf("if (fresh) return location.reload();"); return i < 0 ? null : { text: "if (fresh) return location.reload();", at: i }; },
      "micError (mic_error + message)": c => funcDecl(c, "micError")
    };
    function wrapDecl(c, name) { const d = constDecl(c, name); return d && { text: c.slice(d.start, d.at) + d.text, at: d.start }; }
    // Pieces CLAUDE.md describes as one shared behaviour: a different copy is a FAIL. The rest (ensureCtx, fail, stopMic,
    // audioLine, the error path, the sample-rate check that also resets page state) touch page-specific things: WARN + diff.
    const STRICT = new Set(["getFloatTimeDomainData shim", "tap resumes the engine", "mic status opens the check panel", "IS_IOS", "VOICE_PARAM",
      "MIC_OPTIONS", "analyser pulled to destination", "keepAwake", "needFresh", "background → needFresh",
      "interrupted 1.5 s → needFresh", "3 s of zeros", "startMic reloads once fresh"]);
    // CLAUDE.md: "Recovery (six mic games, not Breathing whose mic is optional)": Breathing has no needFresh path and asks
    // for the mic quietly (refused is fine). Its copies of these pieces may differ or be absent; shown as WARN, never FAIL.
    const BREATH_EXEMPT = new Set(["needFresh", "background → needFresh", "interrupted 1.5 s → needFresh", "getUserMedia + error mapping",
      "fail", "startMic reloads once fresh", "keepAwake", "3 s of zeros", "micError (mic_error + message)", "ensureCtx", "stopMic"]);
    const exempt = (p, name) => p === "balloon-breath.html" && BREATH_EXEMPT.has(name);
    const fails = [], warns = [];
    for (const [name, get] of Object.entries(pieces)) {
      const got = [];
      for (const p of MIC_PAGES) {
        const b = MAIN[p] && get(MAIN[p].code);
        if (!b) { (exempt(p, name) ? warns : STRICT.has(name) || name.startsWith("micError") ? fails : warns).push(`${name}: missing on ${p}${exempt(p, name) ? " (Breathing: optional mic, documented)" : ""}`); continue; }
        got.push({ p, n: normalize(b.text), where: where(p, b.at) });
      }
      const groups = groupBy(got.filter(g => !exempt(g.p, name)), g => g.n);
      const ref = groups[0] && groups[0][1];
      if (!ref) continue;
      for (const [, list] of groups.slice(1))
        (STRICT.has(name) ? fails : warns).push(`${name}: ${list.map(g => g.where).join(", ")} vs ${ref.map(g => g.where).join(", ")}\n` + diff(ref[0].n, list[0].n));
      for (const g of got.filter(g => exempt(g.p, name) && g.n !== ref[0].n))
        warns.push(`${name}: ${g.where} (Breathing, optional mic) vs ${ref[0].where}\n` + diff(ref[0].n, g.n, 6));
    }
    report("mic block: shared code identical on the 7 mic pages (comments/whitespace ignored)", fails, warns);
  }

  // --- Home tiles ---
  {
    const fails = [], html = src["index.html"];
    const tiles = [...html.matchAll(/<a class="tool" href="([^"]+)"[^>]*>\s*<img src="([^"]+)"/g)].map(m => ({ href: m[1], img: m[2], line: lineOf(html, m.index) }));
    for (const t of tiles) {
      if (!existsSync(join(ROOT, t.href))) fails.push(`index.html:${t.line} tile → ${t.href} does not exist`);
      if (!existsSync(join(ROOT, t.img))) fails.push(`index.html:${t.line} tile picture ${t.img} does not exist`);
    }
    for (const g of GAMES) if (!tiles.some(t => t.href === g)) fails.push(`${g} has no tile on index.html`);
    const d = constDecl(MAIN["index.html"].code, "TILES");
    let TILES = {};
    try { TILES = evalExpr(d.text); } catch (e) { fails.push("index.html TILES does not evaluate: " + e.message); }
    for (const t of tiles) {
      if (!TILES[t.href]) { fails.push(`index.html:${t.line} ${t.href} not in TILES → its name is T("t_undefined")`); continue; }
      for (const l of ["he", "en"]) if (!LANGS["index.html"].TEXT?.[l]?.["t_" + TILES[t.href]]) fails.push(`index.html: TEXT.${l}.t_${TILES[t.href]} missing (tile ${t.href})`);
    }
    for (const k of Object.keys(TILES)) if (!tiles.some(t => t.href === k)) fails.push(`index.html TILES names ${k}, which has no tile`);
    report(`home: ${tiles.length} tiles link to existing pages; every game has a tile and a name`, fails);
  }

  // --- Game furniture (CLAUDE.md "Pause", "How to play", "One top bar everywhere") ---
  {
    const fails = [];
    const SEEN_KEY = { "balloon-breath.html": "breath", "buzz-along.html": "buzz", "sound-game.html": "long", "right-note.html": "right", "horn-ladder.html": "ladder",
      "ninja.html": "ninja", "songs.html": "songs", "note-names.html": "names", "clap-along.html": "clap" };
    for (const g of GAMES) {
      const html = src[g];
      if (!/href="index\.html"/.test(html)) fails.push(`${g}: no way home (href="index.html")`);
      if (g !== "ramzor.html") {
        if (!/<header class="console"/.test(html)) fails.push(`${g}: no <header class="console"> top bar`);
        if (!/id="demo"/.test(html)) fails.push(`${g}: no #demo how-to animation`);
        if (!html.includes(`"tonebee-seen-${SEEN_KEY[g]}"`)) fails.push(`${g}: how-to is not remembered as tonebee-seen-${SEEN_KEY[g]}`);
        if (!/id="helpBtn"/.test(html)) fails.push(`${g}: no ? (helpBtn) to replay the how-to`);
      }
      const pauseExpected = !["ramzor.html", "note-names.html"].includes(g);    // "Not in Note Names (no clock) or the traffic light"
      if (pauseExpected !== /id="pauseBtn"/.test(html)) fails.push(`${g}: ${pauseExpected ? "no ⏸ (pauseBtn)" : "has ⏸ though CLAUDE.md says it has none"}`);
      if (!/id="fullscreen"/.test(html)) fails.push(`${g}: no ⛶ (fullscreen)`);
    }
    report("games: way home, top bar, ⏸ (not Note Names/traffic light), ⛶, ? and #demo how-to on every game", fails);
  }

  // --- Copy: no emoji in TEXT/COMMON strings ---
  {
    // Allowed because CLAUDE.md itself puts them on screen as controls or agreed marks, not decoration:
    const OK = {
      "▶": "start/resume/play (\"▶ ממשיכים\", \"Songs' ▶\")", "◀": "the same arrow pointing forward in Hebrew (\"הבא ◀\")", "⏸": "top-bar icon (⚙ ? ⏸ ⛶)", "⚙": "top-bar icon; Songs \"⚙ לבחור צלילים\"",
      "⭐": "Ninja's perfect round \"מושלם! ⭐\" (agreed exception)", "🔒": "Songs' locked list (\"faded and 🔒\")",
      "🥁": "Songs' band toggle", "🎧": "Songs' Listen", "🎺": "Songs' \"עם המנגינה\" toggle", "🔥": "Ninja's streak"
    };
    const rx = /(?:\p{Extended_Pictographic}|[#*0-9]️?⃣)️?/gu;
    const fails = [], warns = [];
    for (const p of PAGES) for (const obj of ["TEXT", "COMMON"]) for (const l of ["he", "en"]) {
      if (obj === "COMMON" && p !== "index.html") continue;     // COMMON is compared above; report it once
      for (const [k, v] of Object.entries(LANGS[p][obj]?.[l] || {})) {
        const text = typeof v === "function" ? v.toString() : Array.isArray(v) ? v.join(" ") : String(v);
        const found = [...new Set((text.match(rx) || []).map(e => e.replace(/️/g, "")))];
        const bad = found.filter(e => !OK[e]);
        if (bad.length) fails.push(`${keyLine(p, obj, l, k)} ${obj}.${l}.${k} has ${bad.join(" ")}: ${JSON.stringify(text.slice(0, 70))}`);
      }
    }
    report("copy: no emoji in TEXT strings (allowlist: " + Object.keys(OK).join(" ") + ")", fails, warns);
  }
  return { FILES: filesSet };
}

// Compact line diff (LCS): "- " lines only in a, "+ " lines only in b.
function diff(a, b, max = 14) {
  const A = a.split("\n"), B = b.split("\n"), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) out.push("+ " + B[j++]);
    else out.push("- " + A[i++]);
  }
  const cut = s => s.length > 150 ? s.slice(0, 147) + "…" : s;
  return out.slice(0, max).map(cut).join("\n") + (out.length > max ? `\n… ${out.length - max} more lines` : "");
}

/* ---------- Runtime checks (headless Chrome) ---------- */

const SEEN = ["breath", "buzz", "long", "right", "ladder", "ninja", "songs", "names", "clap"];
// The main control a child or teacher needs first. A visible #coverCard (first visit) means its ▶ instead.
const MAIN_CONTROL = {
  "index.html": ["#setup:not([hidden]) #stepLang:not([hidden]) #langHe", "#setup:not([hidden]) #stepInst:not([hidden]) .inst", ".tool"],
  "ramzor.html": [".lamps"],
  "balloon-breath.html": ["#stage"],                      // "tap the picture": the whole stage is the button
  "buzz-along.html": ["#startBtn"], "sound-game.html": ["#startBtn"], "right-note.html": ["#startBtn"],
  "horn-ladder.html": ["#startBtn"], "ninja.html": ["#startBtn"],
  "songs.html": ["#cards .song-card:not(.locked)", "#emptyBtn"],
  "note-names.html": ["#primaryBtn"], "clap-along.html": ["#nextBtn"]
};
const AREA = new Set(["ramzor.html", "balloon-breath.html"]);   // a picture, not a button: no "covered" check
// Expected 404s: Buzzing tries a teacher recording that may not exist (CLAUDE.md: "unless sounds/buzz/<instrument>.m4a exists").
const OPTIONAL = /\/sounds\/buzz\/\w+\.m4a$/;

// Runs inside the page: everything a screen check needs, in one round trip.
function inspectPage(cfg) {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const vis = el => {
    if (!el || !el.checkVisibility || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const desc = el => !el ? "?" : el.id ? "#" + el.id : el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "");
  const res = { vw, vh, scrollW: de.scrollWidth, title: document.title, lang: de.lang, dir: de.dir, bad: [], hebrew: [], latin: [], raw: [] };
  if (res.scrollW > vw + 1) {
    const sticking = [...document.body.querySelectorAll("*")].filter(e => { if (!vis(e)) return false; const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; });
    res.wide = sticking.filter(e => !sticking.includes(e.parentElement)).slice(0, 4).map(e => { const r = e.getBoundingClientRect(); return `${desc(e)} [${Math.round(r.left)}…${Math.round(r.right)}]`; });
  }
  let keys = new Set(), values = new Set();
  try { for (const o of [TEXT.he, TEXT.en, COMMON.he, COMMON.en]) for (const [k, v] of Object.entries(o || {})) { keys.add(k); if (typeof v === "string") values.add(v.trim()); } } catch (_) {}
  const lang = (() => { try { return LANG; } catch (_) { return de.lang; } })();
  const check = (text, el, how) => {
    const t = text.trim();
    if (!t) return;
    const ctxLang = (el.closest("[lang]") || de).getAttribute("lang");
    const tag = `${desc(el)}${how}: ${JSON.stringify(t.slice(0, 60))}`;
    if (/\b(undefined|NaN|null)\b|\[object |function \(|=>/.test(t)) res.bad.push(tag);
    if (keys.has(t) && !values.has(t) && !/^[A-G]$/.test(t)) res.raw.push(tag);
    if (lang === "en" && ctxLang !== "he" && /[֐-׿]/.test(t)) res.hebrew.push(tag);
    if (lang === "he" && ctxLang !== "en" && !el.closest("kbd, .keys, .pause-keys, .diag") && /[A-Za-z]{3,}/.test(t.replace(/\b(Space|Esc|Enter|tonebee\.app|Bravura)\b/g, ""))) res.latin.push(tag);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const el = n.parentElement;
    if (!el || el.closest("script, style, defs") || !vis(el)) continue;
    check(n.nodeValue, el, "");
  }
  for (const el of document.querySelectorAll("[title], [aria-label], [placeholder], [alt]")) {
    if (!vis(el)) continue;
    for (const a of ["title", "aria-label", "placeholder", "alt"]) if (el.hasAttribute(a)) check(el.getAttribute(a), el, `@${a}`);
  }
  { const t = document.title; if (/\b(undefined|NaN|null)\b/.test(t)) res.bad.push(`<title>: ${JSON.stringify(t)}`); if (keys.has(t) && !values.has(t)) res.raw.push(`<title>: ${JSON.stringify(t)}`);
    if (lang === "en" && /[\u0590-\u05FF]/.test(t)) res.hebrew.push(`<title>: ${JSON.stringify(t)}`); }
  // Keyboard hints on a touch screen.
  res.touch = matchMedia("(hover: none) and (pointer: coarse)").matches;
  res.keys = [...document.querySelectorAll(".keys")].filter(vis).map(desc);
  // The main control.
  let main = null;
  const cover = document.getElementById("coverCard");
  if (cover && vis(cover)) main = document.getElementById("coverPlay");
  else for (const s of cfg.main) { const e = document.querySelector(s); if (e && vis(e)) { main = e; break; } }
  if (!main) res.main = { missing: cover && vis(cover) ? "#coverPlay" : cfg.main.join(" | ") };
  else {
    const r = main.getBoundingClientRect();
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    res.main = {
      sel: desc(main), rect: [r.left, r.top, r.right, r.bottom].map(Math.round),
      inView: r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1,
      onTop: cfg.area || !!hit && (hit === main || main.contains(hit)), hit: desc(hit)
    };
  }
  // The top bar on an upright phone: the way home and the icons on one line, the choices (.seg) allowed a line of their own
  // below (2026-10-30); nothing sticking out sideways anywhere.
  const bar = document.querySelector("header.console, header.masthead");
  if (bar && vis(bar)) {
    const kids = [...bar.children].filter(vis), rects = kids.map(k => k.getBoundingClientRect());
    const line = (ks, rs) => !rs.length || Math.max(...rs.map(r => r.top)) < Math.min(...rs.map(r => r.bottom));
    const isSeg = k => k.classList.contains("seg");
    res.bar = {
      oneLine: line(kids.filter(k => !isSeg(k)), rects.filter((r, i) => !isSeg(kids[i]))) && line(kids.filter(isSeg), rects.filter((r, i) => isSeg(kids[i]))),
      out: kids.filter((k, i) => rects[i].left < -1 || rects[i].right > vw + 1).map(desc),
      rows: rects.slice().sort((a, b) => a.top - b.top).reduce((rows, r) => { const last = rows[rows.length - 1]; if (last && r.top < last.bottom - 2) last.bottom = Math.max(last.bottom, r.bottom); else rows.push({ bottom: r.bottom }); return rows; }, []).length,
      h: Math.round(bar.getBoundingClientRect().height)
    };
  }
  return res;
}

async function runtimeChecks(FILES) {
  console.log("RUNTIME");
  const pages = ONLY ? PAGES.filter(p => ONLY.includes(p)) : PAGES;
  if (SHOTS) mkdirSync(OUT, { recursive: true });
  const servers = await Promise.all(Array.from({ length: JOBS }, () => serve()));
  const chrome = await launch();
  const kill = setTimeout(() => { console.log("FAIL runtime: suite took over 8 minutes, giving up"); process.exit(1); }, 8 * 60 * 1000);
  const fetched = new Map();   // path → first page that asked for it (for the offline check)
  try {
    const workers = await Promise.all(servers.map(async s => {
      const page = await chrome.newPage(VIEWPORTS.laptop);
      await wire(page, false);
      return { page, origin: s.url };
    }));
    // Every request, failure and HTTP error, per load.
    async function wire(page, useSW) {
      page.net = { failed: [], urls: [] };
      const ids = new Map();
      page.on("Network.requestWillBeSent", p => { ids.set(p.requestId, p.request.url); page.net.urls.push(p.request.url); });
      page.on("Network.responseReceived", p => { if (p.response.status >= 400 && !/\/favicon\.ico$/.test(p.response.url)) page.net.failed.push(`${p.response.status} ${p.response.url}`); });
      page.on("Network.loadingFailed", p => { if (!p.canceled && !/ERR_ABORTED/.test(p.errorText)) page.net.failed.push(`${p.errorText} ${ids.get(p.requestId) || "?"}`); });
      await page.send("Network.enable");
      // Background tabs are "hidden" in headless Chrome (no requestAnimationFrame, visibilitychange fires): pretend focus.
      await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      if (!useSW) await page.send("Network.setBypassServiceWorker", { bypass: true });
    }
    const reset = page => { page.errors.length = 0; page.logs.length = 0; page.net.failed.length = 0; page.net.urls.length = 0; };
    const storageFor = (state, lang, inst = "trumpet") => state === "first" ? {} :
      { "brass-lang": lang, "brass-inst": inst, ...Object.fromEntries(SEEN.map(g => ["tonebee-seen-" + g, "1"])) };
    async function open(w, page, { query = "", storage = {}, vp }) {
      const P = w.page;
      await P.setViewport(vp);
      await P.goto(w.origin + "manifest.json", { wait: 0 });
      await P.eval(`localStorage.clear(); sessionStorage.clear(); ${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(" ")} 1`);
      reset(P);
      await P.goto(w.origin + page + query, { wait: 350 });
      await P.eval("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
    }
    const problems = P => {
      for (const u of P.net.urls) { const path = new URL(u).pathname.replace(/^\//, "") || "index.html"; if (u.startsWith("http://localhost") && !fetched.has(path)) fetched.set(path, P.current); }
      return [...P.errors.filter(e => !OPTIONAL.test(e.split(" ").pop()) && !/sounds\/buzz\/\w+\.m4a/.test(e)), ...P.net.failed.filter(f => !OPTIONAL.test(f.split(" ").pop()))];
    };
    async function pool(jobs, fn) {
      let next = 0;
      await Promise.all(workers.map(async w => {
        while (next < jobs.length) {
          const job = jobs[next++];
          dbg("job", next, "/", jobs.length, job.page || "", job.lang || "", job.vp || "", job.state || job.inst || "");
          let timer;
          try { await Promise.race([fn(w, job), new Promise((_, no) => { timer = setTimeout(() => no(new Error("timed out after 30 s")), 30000); })]); }
          catch (e) {
            job.crash = e.message.split("\n")[0];
            const alive = await Promise.race([chrome.browser.send("Browser.getVersion").then(() => true, () => false), sleep(5000).then(() => false)]);
            if (!alive) throw new Error("Chrome stopped answering mid-run (killed from outside? another run's pkill?)");
            // A stuck tab is replaced, so the job still running on it cannot disturb the next one.
            const old = w.page;
            w.page = await chrome.newPage(VIEWPORTS.laptop);
            await wire(w.page, false);
            chrome.browser.send("Target.closeTarget", { targetId: old.targetId }).catch(() => {});
          } finally { clearTimeout(timer); }
        }
      }));
    }
    const qs = (page, lang, test = MIC_PAGES.includes(page)) => `?lang=${lang}${test ? "&test=1" : ""}`;

    dbg("matrix");
    // 1. Every page × language × viewport × first visit / returning.
    const matrix = [];
    for (const page of pages) for (const lang of ["he", "en"]) for (const vp of Object.keys(VIEWPORTS)) for (const state of ["first", "returning"]) matrix.push({ page, lang, vp, state });
    let optionalSeen = 0;
    await pool(matrix, async (w, job) => {
      const P = w.page;
      P.current = job.page;
      await open(w, job.page, { query: qs(job.page, job.lang), storage: storageFor(job.state, job.lang), vp: VIEWPORTS[job.vp] });
      const shown = await P.eval("location.pathname.split('/').pop() + location.search");
      if (!shown.startsWith(job.page)) job.redirect = shown;
      const at = shown.split("?")[0];
      job.info = await P.eval(`(${inspectPage})(${JSON.stringify({ main: MAIN_CONTROL[at] || MAIN_CONTROL[job.page], area: AREA.has(at) })})`);
      if (P.net.failed.some(f => OPTIONAL.test(f.split(" ").pop()))) optionalSeen++;
      job.errors = problems(P);
      if (SHOTS) await P.screenshot(join(OUT, `${job.page.replace(".html", "")}-${job.lang}-${job.vp}-${job.state}.png`));
    });
    const tag = j => `${j.page} ${j.lang} ${j.vp} ${j.state}`;
    // A game opened on a new device (no brass-inst, no ?test) goes home for setup first: index.html?next=<game>.
    {
      const redirects = matrix.filter(j => j.redirect), fails = [], warns = [];
      for (const j of redirects) {
        const want = "index.html?next=" + encodeURIComponent(j.page + qs(j.page, j.lang));
        if (j.state !== "first" || j.redirect !== want) fails.push(`${tag(j)}: landed on ${j.redirect} (want ${j.state === "first" ? want : j.page})`);
      }
      const sent = [...new Set(redirects.map(j => j.page.replace(".html", "")))];
      report(`runtime: redirects only to first-run setup (?next=)${sent.length ? "; first visit to " + sent.join(", ") + " checked the setup instead" : ""}`, dedupe(fails), warns);
    }
    const collect = (name, fn, warnFn) => {
      const fails = [], warns = [];
      for (const j of matrix) {
        if (j.crash) continue;
        const f = fn(j); if (f) (Array.isArray(f) ? f : [f]).forEach(x => fails.push(`${tag(j)}: ${x}`));
        const w = warnFn && warnFn(j); if (w) warns.push(`${tag(j)}: ${w}`);
      }
      report(name, dedupe(fails), dedupe(warns));
    };
    // Same message on many viewports → one line listing them.
    function dedupe(lines) {
      const by = new Map();
      for (const l of lines) {
        const m = l.match(/^(\S+) (\S+) (\S+) (\S+): ([\s\S]*)$/);
        if (!m) { by.set(l, null); continue; }
        const k = `${m[1]}|${m[5]}`;
        if (!by.has(k)) by.set(k, { page: m[1], msg: m[5], where: new Set() });
        by.get(k).where.add(`${m[2]}/${m[3]}/${m[4]}`);
      }
      return [...by.entries()].map(([k, v]) => !v ? k : `${v.page} [${v.where.size === matrix.filter(j => j.page === v.page).length ? "every lang/viewport/state" : [...v.where].join(" ")}]: ${v.msg}`);
    }
    report(`runtime: ${matrix.length} loads finished`, matrix.filter(j => j.crash).map(j => `${tag(j)}: ${j.crash}`));
    collect("runtime: no JS errors, console errors or failed requests on load", j => j.errors.length ? j.errors.map(e => e.slice(0, 200)) : null);
    if (optionalSeen) report("runtime: optional recordings", [], [`buzz-along requests sounds/buzz/<instrument>.m4a for all 3 instruments on every load; none exist → 3 × 404 per load (${optionalSeen} loads), harmless by design`]);
    collect("runtime: no sideways scroll (scrollWidth ≤ innerWidth + 1)", j => j.info.scrollW > j.info.vw + 1 ? `scrollWidth ${j.info.scrollW} > ${j.info.vw}${j.info.wide ? " — " + j.info.wide.join(", ") : ""}` : null);
    collect("runtime: no visible \"undefined\"/\"NaN\"/\"null\" or raw TEXT key", j => [...j.info.bad.map(b => "shows " + b), ...j.info.raw.map(b => "raw key " + b)]);
    const dirWrong = j => j.info.lang !== j.lang || j.info.dir !== (j.lang === "he" ? "rtl" : "ltr");
    collect("runtime: English pages show no Hebrew; html lang/dir follow ?lang", j => [
      ...(j.lang === "en" ? j.info.hebrew.map(h => "Hebrew on English page " + h) : []),
      ...(!j.redirect && dirWrong(j) ? [`<html lang=${j.info.lang} dir=${j.info.dir}>`] : [])
    ], j => j.redirect && dirWrong(j) ? `?lang=${j.lang} is not passed on to the first-run setup: it opens as <html lang=${j.info.lang} dir=${j.info.dir}> (the language step is bilingual)` : null);
    collect("runtime: Hebrew pages show no English words (outside kbd hints)", () => null, j => j.lang === "he" && j.info.latin.length ? j.info.latin.join("; ") : null);
    collect("runtime: main control visible, inside the viewport, not covered", j => {
      const m = j.info.main;
      if (!m || m.missing) return `no visible main control (${m && m.missing})`;
      if (!m.inView) return `${m.sel} outside the ${j.info.vw}×${j.info.vh} viewport at [${m.rect}]`;
      if (!m.onTop) return `${m.sel} covered by ${m.hit}`;
      return null;
    });
    collect("runtime: top bar: icons on one line, choices on one line below at most; nothing sticks out sideways", j => {
      const b = j.info.bar;
      if (!b) return null;
      const out = [];
      if (j.vp === "phone" && !b.oneLine) out.push(`top bar wraps to ${b.rows} rows (${b.h}px tall)`);
      if (b.out.length) out.push(`top bar items outside the viewport: ${b.out.join(", ")}`);
      return out;
    }, j => j.info.bar && j.vp !== "phone" && !j.info.bar.oneLine ? `top bar wraps to ${j.info.bar.rows} rows (${j.info.bar.h}px tall)` : null);
    collect("runtime: touch screens show no keyboard hints (.keys)", j => j.info.touch && j.info.keys.length ? `visible keyboard hints: ${j.info.keys.join(", ")}` : null);
    if (!matrix.some(j => j.info && j.info.touch)) report("runtime: touch emulation", [], ["(hover: none) and (pointer: coarse) never matched: the .keys check did not run"]);

    // Self-test: the detectors above must notice planted faults (else a PASS would mean nothing).
    {
      const w = workers[0], P = w.page, fails = [];
      P.current = "sound-game.html";
      await open(w, "sound-game.html", { query: "?lang=en&test=1", storage: storageFor("returning", "en"), vp: VIEWPORTS.phone });
      await P.eval(`(() => {
        const add = (t, css = "") => { const d = document.createElement("p"); d.textContent = t; d.style.cssText = "position:relative;z-index:99;" + css; document.querySelector(".app").prepend(d); };
        add("undefined"); add("howTo"); add("שלום"); add("wide", "width:2000px");
        const b = document.getElementById("startBtn"); b.style.setProperty("position", "fixed", "important"); b.style.setProperty("top", "3000px", "important");
        setTimeout(() => { throw new Error("self-test exception"); }); console.error("self-test console.error");
        fetch("self-test-missing.png");
      })()`);
      await sleep(400);
      const info = await P.eval(`(${inspectPage})(${JSON.stringify({ main: MAIN_CONTROL["sound-game.html"] })})`);
      const errs = problems(P);
      if (!info.bad.length) fails.push("planted \"undefined\" not seen");
      if (!info.raw.length) fails.push("planted raw key \"howTo\" not seen");
      if (!info.hebrew.length) fails.push("planted Hebrew on an English page not seen");
      if (!(info.scrollW > info.vw + 1)) fails.push(`planted 2000px-wide element not seen (scrollWidth ${info.scrollW}, body overflow ${await P.eval("getComputedStyle(document.body).overflowX")})`);
      if (info.main && info.main.inView) fails.push("start button moved off screen not seen");
      if (!errs.some(e => /self-test exception/.test(e))) fails.push("uncaught exception not seen");
      if (!errs.some(e => /self-test console.error/.test(e))) fails.push("console.error not seen");
      if (!errs.some(e => /404 .*self-test-missing/.test(e))) fails.push("404 not seen");
      report("runtime: detectors self-test (planted faults are caught)", fails);
    }

    dbg("home first run");
    // 2. Home, first run: language → instrument → tiles.
    {
      const fails = [];
      const runs = [{ lang: "he", vp: "phone", inst: 0 }, { lang: "en", vp: "phone", inst: 1 }, { lang: "he", vp: "laptop", inst: 2 }, { lang: "en", vp: "projector", inst: 0 }];
      await pool(runs, async (w, run) => {
        const P = w.page, where = `${run.lang} ${run.vp}`;
        P.current = "index.html";
        await open(w, "index.html", { vp: VIEWPORTS[run.vp] });
        const st = () => P.eval(`({ setup: !document.getElementById("setup").hidden, lang: !document.getElementById("stepLang").hidden, inst: !document.getElementById("stepInst").hidden,
          insts: document.querySelectorAll(".inst").length, ready: document.querySelectorAll(".inst:not(.later)").length, title: document.getElementById("instTitle").textContent,
          tiles: [...document.querySelectorAll(".tool")].filter(t => t.checkVisibility()).length, names: [...document.querySelectorAll(".tool .name")].map(n => n.textContent),
          me: document.getElementById("meInst").textContent, html: document.documentElement.lang + "/" + document.documentElement.dir,
          ls: { lang: localStorage.getItem("brass-lang"), inst: localStorage.getItem("brass-inst") } })`);
        let s = await st();
        if (!s.setup || !s.lang || s.inst) { fails.push(`${where}: empty storage did not open the language step (${JSON.stringify(s)})`); return; }
        if (run.lang === "en") { const loaded = P.once("Page.loadEventFired", 15000); await P.click("#langEn"); await loaded; await sleep(400); }
        else { await P.click("#langHe"); await sleep(200); }
        s = await st();
        if (!s.setup || !s.inst) { fails.push(`${where}: after the language, the instrument step did not show (${JSON.stringify(s)})`); return; }
        if (s.insts !== 7 || s.ready !== 3) fails.push(`${where}: ${s.insts} instruments, ${s.ready} ready (want 7, 3)`);
        const wantTitle = run.lang === "en" ? /^What do you play\?$/ : /[֐-׿]/;
        if (!wantTitle.test(s.title)) fails.push(`${where}: instrument title ${JSON.stringify(s.title)}`);
        // A "coming soon" instrument only shows the note; the setup stays.
        await P.eval(`document.querySelector(".inst.later").scrollIntoView({ block: "center" })`);
        await P.click(".inst.later");
        await sleep(150);
        const soon = await P.eval(`({ note: !document.getElementById("soonNote").hidden, setup: !document.getElementById("setup").hidden, text: document.getElementById("soonText").textContent })`);
        if (!soon.note || !soon.setup || !soon.text) fails.push(`${where}: tapping a coming-soon instrument → ${JSON.stringify(soon)}`);
        const id = ["trumpet", "trombone", "horn"][run.inst];
        await P.eval(`document.querySelector(".inst:nth-child(${run.inst + 1})").scrollIntoView({ block: "center" })`);
        await P.click(`.inst:nth-child(${run.inst + 1})`);
        await sleep(300);
        s = await st();
        if (s.setup) fails.push(`${where}: setup still open after choosing ${id}`);
        if (s.tiles !== 10) fails.push(`${where}: ${s.tiles} tiles visible (want 10)`);
        if (s.ls.lang !== run.lang || s.ls.inst !== id) fails.push(`${where}: saved ${JSON.stringify(s.ls)} (want ${run.lang}/${id})`);
        if (s.html !== (run.lang === "en" ? "en/ltr" : "he/rtl")) fails.push(`${where}: <html> ${s.html}`);
        const script = run.lang === "en" ? /^[A-Za-z' -]+$/ : /[֐-׿]/;
        const badNames = s.names.filter(n => !n || !script.test(n));
        if (badNames.length) fails.push(`${where}: tile names in the wrong language or empty: ${JSON.stringify(badNames)}`);
        if (!script.test(s.me)) fails.push(`${where}: masthead instrument ${JSON.stringify(s.me)}`);
        // Reload: the choice sticks, no setup.
        await P.goto(w.origin + "index.html", { wait: 300 });
        s = await st();
        if (s.setup) fails.push(`${where}: setup opens again on the next visit`);
        const errs = problems(P);
        if (errs.length) fails.push(`${where}: ${errs.join("; ")}`);
      });
      runs.filter(r => r.crash).forEach(r => fails.push(`${r.lang} ${r.vp}: ${r.crash}`));
      report("home first run: language → instrument → tiles (he/en, phone/laptop/projector)", fails);
    }

    // 2b. A link straight to a game on a new device: home for setup, then back to the game with the choice saved.
    {
      const fails = [];
      const runs = [{ page: "ninja.html", query: "?lang=en", pick: "en", inst: 2 }, { page: "note-names.html", query: "", pick: "he", inst: 1 },
        { page: "songs.html", query: "?lang=en", pick: "he", inst: 0 }]
        .filter(r => pages.includes(r.page));
      await pool(runs, async (w, run) => {
        const P = w.page, where = run.page + run.query;
        P.current = run.page;
        await open(w, run.page, { query: run.query, vp: VIEWPORTS.phone });
        const loc = () => P.eval("location.pathname.split('/').pop() + location.search");
        let at = await loc();
        if (!at.startsWith("index.html?next=")) { run.skip = `${where} opened ${at} directly (no first-run redirect)`; return; }
        if (run.pick === "en") { const loaded = P.once("Page.loadEventFired", 15000); await P.click("#langEn"); await loaded; await sleep(300); }
        else { await P.click("#langHe"); await sleep(200); }
        const id = ["trumpet", "trombone", "horn"][run.inst];
        await P.eval(`document.querySelector(".inst:nth-child(${run.inst + 1})").scrollIntoView({ block: "center" })`);
        const back = P.once("Page.loadEventFired", 15000);
        await P.click(`.inst:nth-child(${run.inst + 1})`);
        await back.catch(() => fails.push(`${where}: choosing ${id} did not leave the setup`));
        await sleep(400);
        at = await loc();
        const ls = await P.eval(`({ lang: localStorage.getItem("brass-lang"), inst: localStorage.getItem("brass-inst"), html: document.documentElement.lang })`);
        // Back on the game, with the link's other settings; its ?lang gives way to the language just chosen.
        const want = run.page + run.query.replace(/([?&])lang=[a-z]+&?/, "$1").replace(/[?&]$/, "");
        if (at !== want) fails.push(`${where}: after setup landed on ${at}, not ${want}`);
        if (ls.lang !== run.pick || ls.inst !== id) fails.push(`${where}: saved ${JSON.stringify(ls)}`);
        if (ls.html !== run.pick) fails.push(`${where}: chose ${run.pick}, the game opens as <html lang=${ls.html}>`);
        const errs = problems(P);
        if (errs.length) fails.push(`${where}: ${errs.join("; ")}`);
      });
      runs.filter(r => r.crash).forEach(r => fails.push(`${r.page}: ${r.crash}`));
      if (runs.length) report("first run from a game link: setup at home, then back to the game (?next=)", fails, runs.filter(r => r.skip).map(r => r.skip));
    }

    dbg("instruments");
    // 3. Every instrument × every game × both languages: load, press the main control, play a moment.
    {
      const sweep = [];
      for (const inst of ["trumpet", "trombone", "horn"]) for (const page of pages.filter(p => p !== "index.html")) for (const lang of ["he", "en"]) sweep.push({ inst, page, lang });
      await pool(sweep, async (w, job) => {
        const P = w.page;
        P.current = job.page;
        await open(w, job.page, { query: qs(job.page, job.lang), storage: storageFor("returning", job.lang, job.inst), vp: VIEWPORTS.laptop });
        const before = problems(P);
        job.inst_shown = await P.eval(`[...document.querySelectorAll("image[href*='icons/inst/'], img[src*='icons/inst/']")].map(e => (e.getAttribute("href") || e.getAttribute("src")).match(/inst\\/(\\w+)/)[1])`);
        const act = {
          "balloon-breath.html": ["#stage"], "songs.html": ["#cards .song-card:not(.locked)", "#playBtn"],
          "note-names.html": ["#primaryBtn"], "clap-along.html": ["#nextBtn"], "ramzor.html": []
        }[job.page] || ["#startBtn"];
        for (const sel of act) { await P.click(sel); await sleep(250); }
        await sleep(1500);
        job.after = await P.eval(`({ overlay: document.getElementById("overlay") ? !document.getElementById("overlay").hidden : null, mic: (document.getElementById("micText") || {}).textContent || "" })`);
        job.errors = [...before, ...problems(P)];
      });
      const fails = [], warns = [];
      for (const j of sweep) {
        const t = `${j.page} ${j.inst} ${j.lang}`;
        if (j.crash) { fails.push(`${t}: ${j.crash}`); continue; }
        j.errors.forEach(e => fails.push(`${t}: ${e.slice(0, 200)}`));
        if (MIC_PAGES.includes(j.page) && j.page !== "balloon-breath.html" && j.after.overlay) fails.push(`${t}: start overlay still showing after ▶ with ?test=1 (mic text ${JSON.stringify(j.after.mic)})`);
        const wrong = (j.inst_shown || []).filter(x => x !== j.inst && ["trumpet", "trombone", "horn"].includes(x));
        if (wrong.length) warns.push(`${t}: shows the ${[...new Set(wrong)].join("/")} picture`);
      }
      report(`instruments: trumpet/trombone/horn × ${pages.length - (pages.includes("index.html") ? 1 : 0)} games × he/en load and start (?test=1) without errors`, [...new Set(fails)], [...new Set(warns)]);
    }

    dbg("offline");
    // 4. Offline: install the service worker, stop the server, open every page and start it.
    if (!ONLY) {
      const fails = [];
      const srv = await serve();
      const P = await chrome.newPage(VIEWPORTS.laptop);
      await wire(P, true);
      await P.goto(srv.url + "manifest.json", { wait: 0 });
      await P.eval(`${Object.entries(storageFor("returning", "he")).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(" ")} 1`);
      await P.goto(srv.url + "index.html?lang=he", { wait: 300 });
      const cached = await P.eval(`navigator.serviceWorker.ready.then(async () => {
        for (let i = 0; i < 100; i++) { const ks = await caches.keys(); if (ks.length) { const n = (await (await caches.open(ks[0])).keys()).length; if (n >= ${FILES.size - 1}) return n; } await new Promise(r => setTimeout(r, 200)); }
        const ks = await caches.keys(); return ks.length ? (await (await caches.open(ks[0])).keys()).length : 0; })`);
      if (cached < FILES.size) fails.push(`only ${cached} of ${FILES.size} FILES cached after install`);
      await Promise.race([srv.close(), sleep(1500)]);
      // The static server keeps idle keep-alive sockets; Chrome must not reuse them.
      await P.send("Network.clearBrowserCache").catch(() => {});
      await P.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
      // Canary: a file that exists on disk but is not in FILES must now fail, or this whole check proves nothing.
      const canary = await P.eval(`fetch("icons/og.png").then(r => r.ok ? "loaded" : "status " + r.status, e => "failed")`);
      if (canary === "loaded") fails.push("icons/og.png (not in FILES) still loads: the server is not really down, offline results are void");
      for (const page of PAGES) {
        dbg("offline", page);
        P.errors.length = 0; P.net.failed.length = 0;
        try {
          await P.goto(srv.url + page + qs(page, "he"), { wait: 500 });
          const t = await P.eval("document.title");
          const want = LANGS[page].TEXT?.he?.pageTitle;
          if (want && t !== want) fails.push(`${page}: offline it opened "${t}" (want "${want}") — the page itself is not cached`);
          const act = { "balloon-breath.html": ["#stage"], "songs.html": ["#cards .song-card:not(.locked)", "#playBtn"], "note-names.html": ["#primaryBtn"], "clap-along.html": ["#nextBtn"], "ramzor.html": [], "index.html": [] }[page] || ["#startBtn"];
          for (const sel of act) { await P.click(sel).catch(() => {}); await sleep(250); }
          await sleep(1200);
          const bad = [...P.net.failed, ...P.errors.filter(e => /^network:/.test(e))].filter(f => !OPTIONAL.test(f.split(" ").pop()) && !/sounds\/buzz\//.test(f));
          const errs = P.errors.filter(e => !/^network:/.test(e) && !/sounds\/buzz\//.test(e));
          [...new Set(bad)].forEach(b => fails.push(`${page} offline: ${b.slice(0, 160)}`));
          errs.forEach(e => fails.push(`${page} offline error: ${e.slice(0, 160)}`));
        } catch (e) { fails.push(`${page} offline: ${e.message.split("\n")[0]}`); }
      }
      report(`offline: service worker caches ${FILES.size} files; every page opens and starts with the server down`, fails);
    }

    // 5. What the browser actually fetched must be in FILES (offline gap seen at runtime).
    {
      const fails = [];
      for (const [path, page] of fetched) {
        if (path === "sw.js" || OPTIONAL.test("/" + path) || path === "manifest.json" && FILES.has(path)) continue;
        if (!FILES.has(path) && existsSync(join(ROOT, path))) fails.push(`${page} fetched ${path}, which sw.js FILES does not list → missing offline`);
      }
      report(`runtime: every same-origin file the pages fetched (${fetched.size}) is in sw.js FILES`, fails);
    }
  } finally {
    clearTimeout(kill);
    await Promise.race([chrome.close(), sleep(3000)]);
    await Promise.race([Promise.all(servers.map(s => s.close())), sleep(1500)]);
  }
}

/* ---------- Run ---------- */

let files = null;
if (DO_STATIC) files = staticChecks().FILES;
else {
  const swSrc = readFileSync(join(ROOT, "sw.js"), "utf8");
  const { FILES } = vm.runInNewContext(swSrc + "\n;({ FILES })", { self: { addEventListener() {} } });
  files = new Set(FILES.map(f => (f === "./" ? "index.html" : f)));
}
if (DO_RUNTIME) {
  try { await runtimeChecks(files); }
  catch (e) { report("runtime: Chrome run", [e.stack.split("\n").slice(0, 3).join(" ")]); }
}
const n = s => results.filter(r => r.status === s).length;
console.log(`\n${n("PASS")} pass, ${n("WARN")} warn, ${n("FAIL")} fail · ${((Date.now() - T0) / 1000).toFixed(0)} s`);
process.exit(n("FAIL") ? 1 : 0);
