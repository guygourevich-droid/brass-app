# Brass App

Music teacher's toolkit for brass and rhythm lessons: kids 9–12, projected in class, and installed on an iPad for offline use. Hosted on GitHub Pages from `main` (repo root). Brass-specific tools (trumpet first) are planned but not yet designed.

## Constraints
- Plain HTML/CSS/JS only. No build step, frameworks, CDNs or backend — every page must work offline.
- One tool = one self-contained HTML file at repo root + a tile in `index.html`.
- New or renamed file → add it to `FILES` in `sw.js` and bump `CACHE`, or installed iPads keep serving the old copy.
- Fonts are self-hosted in `fonts/`; never link Google Fonts.
- British note names (crotchet, quaver…). Note names on screen default to fixed do-re-mi (Do Re Mi Fa Sol La Si), with a C D E option.
- Big, clear type — read from a projector. Clap-Along is clean white; the breathing, buzzing and note tools share a playful sky look.
- Transposition matters: students always see their WRITTEN note (trumpet in B♭ and horn in F in treble clef, trombone in bass clef); sounds play at CONCERT pitch (trumpet −2, horn −7 semitones, trombone 0).
- Discuss and agree what a new tool does with the teacher before building it.
- Trumpet, trombone and horn classes have different teachers: on-screen tips stay universal (posture, breath, steady air, rest), no instrument-specific technique.

## Map
- `index.html` — home screen, tool tiles, service worker registration.
- `balloon-breath.html` — breathing: ready → in/out rounds (no breath hold) → rest. Balloon eases full on the in-breath, empties linearly (steady air).
- `buzz-along.html` — mouthpiece buzzing in whole 4/4 bars: count-in → listen → breathing bar (rest + breathe 2 or 1) → buzz → lips rest. `INSTRUMENTS` = model start note (concert: trumpet F4, horn C4, trombone F3); `LEVELS` = long tones, rhythms, sirens a step/3rd/4th/5th.
- `note-names.html` — note reading: `INSTRUMENTS` holds clef, transposition and first notes in teaching order (trumpet/horn written C4→C5, trombone B♭2→B♭3); level n = first n+1 notes. Clefs/notes drawn with the Bravura font (SMuFL code points).
- `clap-along.html` — rhythm game. Sections: rhythm model (`LEVELS`, `STARTS`, generator, quiz distractors) → SVG notation → Web Audio (`Sound`) → game state and wiring.
- `fonts/Bravura.woff2` — music symbol font (SIL OFL), needed offline for Note Names.
- `sw.js` — network-first with 3 s timeout, cache fallback.
- `manifest.json`, `icons/` — iPad home-screen install.
