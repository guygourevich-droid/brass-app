# Brass App

Simple tools for brass and rhythm lessons. Plain HTML — no build step, no server, works offline.

**Open:** https://guygourevich-droid.github.io/brass-app/

## Tools
- **רמזור / Traffic light** (`ramzor.html`) — teacher-controlled red/yellow/green for starting, stopping and holding notes together.
- **צליל / Sound game** (`sound-game.html`) — microphone games: make a sound, see your pitch, then hold one note and pop a balloon. Needs the web link (a downloaded file has no microphone).
- **צליל נכון / Right note** (`right-note.html`) — target note and played note on one staff; choose which notes to practise, hold the right one for a star.
- **Balloon Breath** (`balloon-breath.html`) — paced breathing, then warm air through the mouthpiece. 5 levels.
- **Buzz-Along** (`buzz-along.html`) — hear a model note, breathe in time, buzz it back on the mouthpiece. Long tones, simple rhythms, sirens from a step to a 5th; trumpet, trombone, horn.
- **Note Names** (`note-names.html`) — meet the notes and name them: trumpet and horn read written notes in treble clef, trombone in bass clef; the sound is concert pitch. Do Re Mi or C D E.
- **Clap-Along** (`clap-along.html`) — hear a rhythm and clap it back, or pick which of three rhythms you heard. 9 levels, crotchets to semiquavers.

## Use offline on iPad
Open the link in Safari once while online → Share → **Add to Home Screen**.

## Add a tool
1. Add `your-tool.html` at the top level. Copy the `<head>` of `clap-along.html` for fonts, icon and offline support.
2. Add a tile for it in `index.html`.
3. Add the file to `FILES` in `sw.js` and bump `CACHE` (e.g. `brass-app-v2`), otherwise iPads keep the old offline copy.

Fonts: Lexend, Atkinson Hyperlegible, Rubik (Hebrew) and Bravura (music symbols), all SIL Open Font License (`fonts/OFL-*.txt`).

## Before a lesson
Open the link once on the classroom laptop, allow the microphone, press **D** in the sound game to see the level meter, and play a note from where the children will sit to check it registers.
