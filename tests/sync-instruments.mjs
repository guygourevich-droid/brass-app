// Copies the instrument list (INSTRUMENT_DATA, between the "instruments" markers in index.html) to every page.
// The list is edited in index.html only; tests/consistency.mjs fails if a page's copy differs.
//
//   node tests/sync-instruments.mjs        (run from app/)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, PAGES } from "./lib.mjs";

const START = "<!-- instruments:", END = "<!-- /instruments -->";
const blockOf = (text, file) => {
  const a = text.indexOf(START), b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error(`${file}: no instruments block (${START} … ${END})`);
  return [a, b + END.length];
};

const master = readFileSync(join(ROOT, "index.html"), "utf8");
const [a, b] = blockOf(master, "index.html");
const block = master.slice(a, b);
let changed = 0;
for (const p of PAGES.filter(p => p !== "index.html")) {
  const text = readFileSync(join(ROOT, p), "utf8");
  let out;
  if (text.includes(START)) { const [x, y] = blockOf(text, p); out = text.slice(0, x) + block + text.slice(y); }
  else {
    // First time: right after the <head> first-paint script, like index.html.
    const at = text.indexOf("</script>", text.indexOf("document.documentElement.dir = \"ltr\""));
    if (at < 0 || at > text.indexOf("</head>")) throw new Error(`${p}: no first-paint script in <head>`);
    out = text.slice(0, at + 9) + "\n" + block + text.slice(at + 9);
  }
  if (out !== text) { writeFileSync(join(ROOT, p), out); changed++; console.log("updated " + p); }
}
console.log(changed ? `${changed} page(s) updated` : "every page already has this list");
