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
- Classes are 4-6 absolute beginners, ages 9-12, one laptop + projector. Lesson 1 asks "did a sound happen?", not "was it the right note".
- Traffic light, everywhere it appears: red = stop/instrument down, yellow = get ready and breathe, green = play. Manual, teacher-controlled. Never flash it, never faster than one change per 250 ms, and never let colour be the only channel (position, shape, fill-vs-outline, size, word).
- The microphone may only ever add a glow. Silence is a waiting state, never failure; nothing turns red; no individual score reaches the projector; the counter counts attempts and only rises.
- New pages are Hebrew (`lang="he" dir="rtl"`), near-wordless, and use Rubik. Keep music notation `direction: ltr` or the clef mirrors. Keyboard shortcuts read `e.code`, never `e.key` (a Hebrew layout turns F into כ).
- Trumpet, trombone and horn classes have different teachers: on-screen tips stay universal (posture, breath, steady air, rest), no instrument-specific technique.

## Map
- `index.html` — home screen, tool tiles, service worker registration.
- `balloon-breath.html` — breathing: ready → in/out rounds (no breath hold) → rest. Balloon eases full on the in-breath, empties linearly (steady air).
- `buzz-along.html` — mouthpiece buzzing in whole 4/4 bars: count-in → listen → breathing bar (rest + breathe 2 or 1) → buzz → lips rest. `INSTRUMENTS` = model start note (concert: trumpet F4, horn C4, trombone F3); `LEVELS` = long tones, rhythms, sirens a step/3rd/4th/5th.
- `note-names.html` — note reading: `INSTRUMENTS` holds clef, transposition and first notes in teaching order (trumpet/horn written C4→C5, trombone B♭2→B♭3); level n = first n+1 notes. Clefs/notes drawn with the Bravura font (SMuFL code points).
- `ramzor.html` — the traffic light: three lamps (octagon/triangle/circle), teacher-controlled, optional hold bar, works from a presentation clicker. No microphone, no network: this is the fallback if anything else fails.
- `sound-game.html` — microphone games. Level 1 any sound fills a balloon (no pitch), level 2 the bird mirrors pitch (no target), level 3 one target note with a band, hold ring and balloon. `detect()` is McLeod-style on a signal decimated to ~8 kHz, searched only within ±7 semitones of the target. `?test=1` injects a tone so detection can be checked without a microphone (`&cents=100`, `?test=harm` for a missing fundamental).
- `clap-along.html` — rhythm game. Sections: rhythm model (`LEVELS`, `STARTS`, generator, quiz distractors) → SVG notation → Web Audio (`Sound`) → game state and wiring.
- `fonts/Bravura.woff2` — music symbol font (SIL OFL), needed offline for Note Names.
- `sw.js` — network-first with 3 s timeout, cache fallback.
- `manifest.json`, `icons/` — iPad home-screen install.
