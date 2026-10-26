# Tonebee: professional look, iPhone recovery, analytics, QA
Everything is live on tonebee.app (version `be418ca8`, cache `tonebee-v48`) and pushed (`app` main `8312825`). Nothing is pending deploy. Next up: stores (Guy is opening the Apple/Google accounts) and a real-device test.

## Goal
A classroom brass/rhythm app that a teacher projects and kids 9–12 play at home. It should look like a pro kids' app, not an AI build. Business plan and markets: see `2026-10-26-tonebee-launch.md`.

## Decisions made
- **Logo:** the bee drawn as an eighth note. Hebrew wordmark has niqqud: טוֹנְ in navy, בִּי in honey. Gemini leads every visual, and Claude rebuilds or cuts it out.
- **Look:**
  - Home is Gemini tile art with the game name only.
  - Game characters are Gemini sprites (`icons/sprites/`) in the same style as the tiles. Moving parts stay drawn in code.
  - No sentences, no emoji. Each game has a wordless 5 s how-to animation.
  - Rejected: mirrored demos for Hebrew (the games don't mirror) and AI-drawn notation (Gemini draws clefs wrong).
- **Analytics:** PostHog project 309997 in Guy's "Trumpet App" org. Tonebee has it to itself, as Guy wanted ("separate from any other app"). This replaces the "The Shed App" row in the launch handoff. Event list: `CLAUDE.md:15`. Dashboard 2261031. A teacher link isn't needed for now (Guy).
- **iPhone "dead mic":** one tap on `needFresh()` reloads the page. Rejected: trying to revive WebKit in place, which didn't work.
- **Clap-Along has no held notes** ("you can't hold a clap", Guy). It has 9 levels, each adding one idea, and Gemini reviewed the order. Gemini is fine to use for second opinions.
- **English uses US terms** (quarter note, measure), since the US is the main market.
- **Traffic light words:** עוֹצְרִים / מוּכָנִים / מְנַגְּנִים (plural present, the app's voice).
- **Process:** show Guy every change before deploy. Guy runs `npx wrangler deploy` himself, because the auto-mode classifier blocks Claude from running production deploys.

## State
- **Done and live:**
  - logo, tiles and sprites (rocket, chute, bee, monkey head, banana, ninja, plane, cloud, house, tree, flower-0..4)
  - how-to covers, honey buttons, one top bar with the ⚙ drawer
  - Hebrew and English wording pass
  - iPad gets a 3-column grid when upright
  - `needFresh` on 6 mic pages
  - analytics
  - Clap levels
  - www redirect (a Cloudflare Redirect Rule)
- **Play-through:** checked with the test tone on all 10 games. Songs follow mode: only 3 of 22 notes checked, because the hidden pane throttles the page. No real-microphone test yet: the Browser pane blocks the mic.
- **Uncommitted on purpose:**
  - `app/privacy.html`: also listed in `.assetsignore`, waiting for the operator's name and address.
  - `app/.claude/graph.json`: codegraph cache.
  - `ops/content/`: teacher quickstart and parent letter (`build.mjs`, `out/demo/`), made by another session and not reviewed here.
- **`ops/` is a local git repo with no remote** (last commit `c6f5fd3`, the raw sprites). It holds the business docs, brand build scripts and raw Gemini art, and it exists only on this Mac.
- **Not started:**
  - Capacitor and store builds; PostHog must be stripped from those builds.
  - Paywall.
  - Privacy page content.
  - Parent letter rebuilt with the niqqud logo.
- **Proposed session cards, never started:** store prep `task_05689c94`, marketing `task_b1944657`.

## Key locations
- `index.html:168` `tbTrack` · `:176` `posthog.init`
- `sw.js:3` CACHE, plus the `FILES` list. Bump both when a file is added or renamed.
- `needFresh`: `sound-game.html:524`, `buzz-along.html:506`, `ninja.html:611`, `right-note.html:575`, `songs.html:693`, `horn-ladder.html:737`
- `clap-along.html:513` LEVELS
- `ramzor.html:233` `words3`
- `sound-game.html:703` `house()`, `:708` `tree()`, `:716` `thing()` (plane at `:758`, cloud at `:761`)
- `buzz-along.html:682` PETALS → `flower-N.webp` (`:717`)
- How-to: `sound-game.html:219` `#demo`, `:1074` `tonebee-seen-<game>`
- Brand pipeline:
  - `ops/brand/build/logo-note.mjs` (icons)
  - `ops/brand/build/key.py` (sprite cutter: magenta #FF00FF background, distance < 90, 3 px edge band)
  - `ops/brand/build/text2path_shaped.py` (niqqud wordmark)
  - `ops/brand/README.md`

## Gotchas found the hard way
- `key.py` needs Pillow and numpy, which the system Python doesn't have. Use a venv.
- Gemini, driven through Claude in Chrome:
  - Ask for sprites on a flat #FF00FF background.
  - Its CSP blocks fetch to localhost. Get images out with zoom capture plus `save_to_disk`, and send files in through hidden file inputs.
  - Attachments: `.txt` works, `.tsv` doesn't.
  - The default model sometimes hangs; switch to 3.1 Pro.
- SVG elements ignore `.hidden`. Use `toggleAttribute("hidden")`.
- Don't stretch a sprite non-uniformly (the high cloud was `scale(1.5 .7)`).
- A hidden Browser pane throttles rAF, so timing in tests looks slow and isn't a real bug. Audio needs a real click.
- Test hooks (with `?test=1`): `testSound`, `testBuzz`, `testTone`, `testGap`. Mic games: hide `#overlay` to see the scene.
- Cloudflare's edge can serve a stale copy for a minute after deploy. Check with `?cb=<time>`.
- `npx wrangler deploy` may stop at "Ok to proceed? (y)" when a new wrangler version installs.
- The repo is public: no secrets or personal details. Claude never creates accounts or enters passwords; Guy does.

## Open questions for Guy
1. Push `ops/` to a **private** GitHub repo? Today it exists only on this Mac, and it was lost once before.
2. What operator name and address go on the privacy page? Stores require the page.
3. `ops/content/` (teacher kit): review and commit it, and rebuild the parent letter with the niqqud logo now?

## Next action
Once Guy says the Apple/Google developer accounts exist, start store prep. Add Capacitor in a new folder (not `app/`), with PostHog stripped from the store build. Then put the app on Guy's real iPhone and test the microphone and audio routing first: iOS 26.4/27 sends playback to the earpiece while the mic is open.
