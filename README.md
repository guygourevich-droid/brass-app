# Brass App

Simple tools for brass and rhythm lessons. Plain HTML — no build step, no server, works offline.

**Open:** https://guygourevich-droid.github.io/brass-app/

## Tools
- **Balloon Breath** (`balloon-breath.html`) — paced breathing, then warm air through the mouthpiece. 5 levels.
- **Buzz-Along** (`buzz-along.html`) — hear a model note, breathe, buzz it back on the mouthpiece. Long notes up to mini sirens; trumpet, trombone, horn.
- **Clap-Along** (`clap-along.html`) — hear a rhythm and clap it back, or pick which of three rhythms you heard. 9 levels, crotchets to semiquavers.

## Use offline on iPad
Open the link in Safari once while online → Share → **Add to Home Screen**.

## Add a tool
1. Add `your-tool.html` at the top level. Copy the `<head>` of `clap-along.html` for fonts, icon and offline support.
2. Add a tile for it in `index.html`.
3. Add the file to `FILES` in `sw.js` and bump `CACHE` (e.g. `brass-app-v2`), otherwise iPads keep the old offline copy.

Fonts: Lexend and Atkinson Hyperlegible, SIL Open Font License (`fonts/OFL-*.txt`).
