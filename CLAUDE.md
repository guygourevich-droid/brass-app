# Brass App

Music teacher's toolkit for brass and rhythm lessons: kids 9–12, projected in class, and installed on an iPad for offline use. Hosted on GitHub Pages from `main` (repo root). Brass-specific tools (trumpet first) are planned but not yet designed.

## Constraints
- Plain HTML/CSS/JS only. No build step, frameworks, CDNs or backend — every page must work offline.
- One tool = one self-contained HTML file at repo root + a tile in `index.html`.
- New or renamed file → add it to `FILES` in `sw.js` and bump `CACHE`, or installed iPads keep serving the old copy.
- Fonts are self-hosted in `fonts/`; never link Google Fonts.
- British note names (crotchet, quaver…). Clean white look, big type — it is read from a projector.
- Discuss and agree what a new tool does with the teacher before building it.
- Trumpet, trombone and horn classes have different teachers: on-screen tips stay universal (posture, breath, steady air, rest), no instrument-specific technique.

## Map
- `index.html` — home screen, tool tiles, service worker registration.
- `balloon-breath.html` — breathing: ready → in/out rounds (no breath hold) → rest. Balloon eases full on the in-breath, empties linearly (steady air).
- `buzz-along.html` — mouthpiece buzzing: listen → breathe → buzz → lips rest. `INSTRUMENTS` = model pitches (concert: trumpet F4/B♭4, horn C4/F4, trombone F3/B♭3); `LEVELS` = curated patterns.
- `clap-along.html` — rhythm game. Sections: rhythm model (`LEVELS`, `STARTS`, generator, quiz distractors) → SVG notation → Web Audio (`Sound`) → game state and wiring.
- `sw.js` — network-first with 3 s timeout, cache fallback.
- `manifest.json`, `icons/` — iPad home-screen install.
