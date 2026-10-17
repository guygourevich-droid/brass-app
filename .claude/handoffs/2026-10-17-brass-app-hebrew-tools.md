# Brass App — traffic light + microphone games for beginner brass classes
All work is committed and live (`01ab246`, cache `brass-app-v8`). Nothing in progress.

## Goal
Guy teaches three separate beginner classes — trumpet, trombone, horn in F — **4–6 children each, ages 9–12, hyperactive, absolute beginners who can barely make a sound**. 45-minute lessons; he teaches rules, assembly and holding himself, so the app covers only the interactive part: a traffic light he controls, and microphone games. One laptop + projector. **Hebrew, near-wordless.** Live at https://guygourevich-droid.github.io/brass-app/ — repo github.com/guygourevich-droid/brass-app.

## Decisions made
- **Lesson-1 ladder is "did a sound happen?" → mirror pitch → one target note.** A first tone is airy with no stable pitch. *Rejected:* starting with pitch matching (≈3 weeks early), and 8-count holds (first-day tone is 2–4 s).
- **Nothing on the projector judges a child.** No red, no cross, silence is a waiting state, the counter counts *attempts* and only rises. Reason: beginner-brass attrition peaks in weeks 1–3 over "I can't make a sound".
- **Traffic light is manual only** (Guy's call, auto-cycle rejected). Red = stop/instrument down, yellow = ready+breathe, green = play. Colour is never the only channel: position, shape (octagon/triangle/circle), fill-vs-outline, size, word, sound. Rate-limited to one change per 250 ms, presses **queued not dropped**; red never flashes (photosensitivity).
- **Unlit lamps are bright rings, not dim grey** — a projector's black is grey; dim-on-dark measures ~1.2:1 in a lit room, a bright ring ~5–8:1.
- **Duplicated snippets per page, no `common.js`.** Every page is a classic `<script>`; a shared file would redeclare `$`, `SVGNS`, `Sound`, `state`, `INSTRUMENTS` and blank the tool. *Rejected:* extracting shared CSS/JS until pages become modules.
- **`right-note.html` searches the instrument's whole range** so a wrong partial is *shown*; `sound-game.html` level 3 used a ±7-semitone window instead. Fixed per-instrument ranges were rejected: they excluded the first notes of trumpet and horn outright.
- **Hold time runs on `performance.now()`, not accumulated frame deltas** — a throttled window stretched 3 s into ~30 s.
- **Flats everywhere** (`spell()` prefers flats): trombone reads סי♭ / מי♭, never לה♯.
- **Hebrew:** Rubik self-hosted, `unicode-range` added to the Latin subsets, `font-synthesis: none`; keyboard shortcuts read `e.code` (a Hebrew layout turns F into כ).
- **Sound game level 3 was replaced by a link to `right-note.html`** rather than keeping two staff implementations.

## State
**Done:** `ramzor.html` (traffic light), `sound-game.html` (level 1 balloon from any sound, level 2 mirror bird), `right-note.html` (target + played note on one staff, note picker, settings, star + sparkle), Hebrew font, `index.html` reordered into lesson order with Hebrew names, `sw.js` hardened (per-file caching, late responses kept, captive-portal pages rejected), docs.
**Also fixed in the older tools:** balloon-breath's pinwheel was a ~5.7 Hz full-screen flash (now slow, one hue, reduced-motion gated); `e.key`→`e.code` in all four; clicker's blank button no longer answers "B" in Clap-Along; element ids no longer built from English labels.
**Not started:** Hebrew for the four older tools; instrument chosen once on the home screen (only `right-note`/`sound-game` remember it); real recorded instrument samples (University of Iowa, unrestricted); remaining accessibility items (focus ring invisible on primary buttons, `aria-live` wrapping the per-beat count, 32 px touch targets, child-facing text capped ~3vh).

## Key locations
- `right-note.html:155` `INSTRUMENTS` (clef, `toWritten`, note list, `open` = no-valve notes, `def`), `:164` `TOL`, `:177` `spell()` (flat preference), `:325` `analyse()`, `:350` `detect()` (McLeod on ~8 kHz decimated), `:394` `buildStaff()`, `:433` `placeTarget()`, `:463` `draw()` (hold/arrow logic), `:516` `succeed()`, `:527` `nextNote()`, `:563` `buildSheet()` (settings panel).
- `ramzor.html:114` Hebrew words, `:117` `MIN_GAP_MS`, `:145` `setLight()`, `:174` `startHold()`.
- `sound-game.html:129` `INSTRUMENTS`, `:214` `startTestTone()`, `:275` `analyse()`, `:443` `draw()`.
- `sw.js:3` `CACHE`, `:29` install, `:53` `keep()`.
- Teacher-facing rules live in `CLAUDE.md`.

## Gotchas found the hard way
- **Mic test without an instrument:** `?test=1` injects a tone (`&cents=100` detunes, `sound-game.html?test=harm` removes the fundamental). Verified: 0 cents on target, +100 on a semitone, and horn's missing-fundamental case reads correctly.
- **A stale page that looks like a bug:** when the local server is down, the service worker serves the cached copy — twice this looked like "my edit didn't apply". Check `curl localhost:…` vs disk md5 before debugging code.
- **The preview tab throttles rAF** when hidden; anything timed by frame deltas will crawl.
- **`git` needs `DEVELOPER_DIR=/Library/Developer/CommandLineTools`** on this Mac (Xcode licence not accepted); `gh` is logged in as `guygourevich-droid`.
- **Microphone needs https or localhost** — the downloaded file has none, and the pages say so in Hebrew.
- **The reference tone and listening must never overlap**, or the app scores its own loudspeaker.
- **The working copy lives in a temporary scratch workspace.** GitHub is the only durable copy; re-clone rather than trusting the local path.

## Open questions for Guy
1. Horn's book notes: written דו–רה–מי (C4–E4) sounds concert F3–A3, which is low for beginners. Keep that octave, or move the horn set up an octave?
2. Translate the four older tools (Balloon Breath, Buzz-Along, Note Names, Clap-Along) into Hebrew next, or leave them English?
3. Did the microphone actually register a real beginner's sound in the room (press **D**, play from where the children sit)?

## Next action
Translate the on-screen strings of `buzz-along.html` and `balloon-breath.html` into Hebrew (their text lives in `LISTEN_HINT`/`BUZZ_HINT`/`TIPS` and `STAGES`/`TIPS` arrays near the top of each script), keeping music notation `direction: ltr`; then bump `CACHE` in `sw.js:3` and push.
