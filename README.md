# Tonebee (טונבי)

Playful practice tools for beginner brass and rhythm: trumpet, trombone and horn in F, ages 9–12. Projected in class, or on a phone or iPad at home. Hebrew and English. Plain HTML — no build step, no server, works offline.

**Open:** https://tonebee.app · **Contact:** hello@tonebee.app

## Tools
- **רמזור / Traffic Light** (`ramzor.html`) — teacher-controlled red/yellow/green for starting, stopping and breathing together. No microphone.
- **נשימה / Breathing** (`balloon-breath.html`) — breathe in, blow out slowly: a soap bubble grows or the wind takes the dandelion seeds.
- **זמזום / Buzzing** (`buzz-along.html`) — mouthpiece buzzing with a bee: any buzz, match a flower's note, hold it, then sirens.
- **צליל ארוך / Long Note** (`sound-game.html`) — one steady note flies a rocket into space.
- **צליל נכון / Right Note** (`right-note.html`) — the note you want and the note you play, on one staff.
- **סולם / Ladder** (`horn-ladder.html`) — a monkey climbs to the note you play; catch the banana.
- **נינג'ה / Note Ninja** (`ninja.html`) — play each note before time runs out and the ninja slices it.
- **שירים / Songs** (`songs.html`) — whole songs, note by note or in time with a band.
- **תווים / Note Names** (`note-names.html`) — meet the first notes in your instrument's clef.
- **קצב / Clap-Along** (`clap-along.html`) — hear a rhythm and clap it back, or pick which one you heard.

The microphone tools need the web link (https); a downloaded file has no microphone.

## Install on a phone or iPad
Open https://tonebee.app once while online → Share → **Add to Home Screen**. It then works offline.

## Before a lesson
Open the link on the classroom laptop, allow the microphone, and play a note from where the children will sit to check it registers.

## Add a tool
1. Add `your-tool.html` at the top level. Copy the `<head>` of an existing page for fonts, icon, language and offline support.
2. Add a tile for it in `index.html`, with its words in both `he` and `en`.
3. Add the file to `FILES` in `sw.js` and bump `CACHE`, otherwise installed devices keep the old offline copy.

## Deploy
Cloudflare Workers static assets: `npx wrangler deploy` from this folder (`wrangler.jsonc`).

Fonts: Lexend, Atkinson Hyperlegible, Rubik (Hebrew) and Bravura (music symbols), all SIL Open Font License (`fonts/OFL-*.txt`). Horn, trumpet and trombone recordings: University of Iowa Musical Instrument Samples.
