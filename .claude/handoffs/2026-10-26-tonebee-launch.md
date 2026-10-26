# Tonebee launch: brand, domain, email, ready for teachers
tonebee.app is live (cache tonebee-v39). Two newer commits on `main` (link preview, analytics, teacher links, www redirect) are pushed but **not deployed yet**. Email works both ways. Logo is paused.

## Goal
Turn Guy's classroom brass app into a few hundred USD/month without him selling or showing his face. Engine: teachers use it free in class → kids play at home → parents pay (later, in the App Store / Google Play via a Capacitor wrapper). Israel (Hebrew) is the proof and the teacher channel. English (US beginning band) is the main revenue market, Spanish after that.

## Decisions made
- **Name: Tonebee / טונבי** (tone + the bee from the buzzing game). Rejected "toot" names: Nuvo's TOOT trademark covers beginner wind instruments, and "toot" is fart slang.
- **Domain tonebee.app only** (Cloudflare Registrar). Rejected buying tonebee.com ($2,488).
- **Hosting: Cloudflare Workers static assets.** Rejected Vercel Hobby (no commercial use) and GitHub Pages (being retired; it now only forwards to tonebee.app with the device's settings).
- **Stores: wrap the same code with Capacitor, no native rewrite.** The pitch, mic and audio code is about 10k lines of tuned work.
- **No ads.** Kids audience; store kids rules.
- **Paywall not decided.** Guy's "10 free minutes a day" is on hold until there's data on real practice minutes.
- **Store accounts as an individual developer**, not a company. Guy accepts the publisher details stores show publicly. EU storefronts are included at launch.
- **Analytics (decided on the other computer, supersedes the old ops/DECISIONS row):** PostHog, in the "Default project" of the "The Shed App" org. The free plan allows one project, so every event has `app:"tonebee"`. Anonymous, no cookies, recordings or autocapture. **Web only:** the store builds must strip it (Apple 5.1.4 and Google Families rules).
- **Logo: paused by Guy.** He rejected Claude's own logo (option A, currently live as the icon). He also rejected Claude's traced rebuild of Gemini's first concept ("not good enough"). He wants Gemini to lead on design, and the icon must say MUSIC at a glance. The best candidate is Gemini's SVG concept 5, the bee as the head of an eighth note.

## State
- **Done:**
  - Rename to Tonebee (COMMON `brand`); icons; Cloudflare deploy.
  - Old-address handover: `index.html:30`, the same block on every page.
  - Email: hello@tonebee.app forwards to Guy's Gmail (Cloudflare Email Routing). Gmail filter `to:(@tonebee.app)` adds label Tonebee and never sends to spam.
  - SPF includes `_spf.google.com`; DMARC `p=none`. Gmail "Send mail as Tonebee <hello@tonebee.app>" is verified.
- **Pushed, not deployed:** `8b5d75e` (www redirect, README) and `1f22ede` (Open Graph `icons/og.png`, PostHog on every page, `?t=<teacher>` links, coming-soon taps, shorter home screen, CACHE tonebee-v40).
- **Business docs: only on Guy's first Mac** in `../ops/`, a local git repo with no remote:
  - `STATE.md`, `PLAN.md`, `DECISIONS.md`
  - `research/{market-competitors,stores-legal-tech,distribution-content}.md`
  - `brand/` (naming, Gemini concepts, `build/` scripts, `avatar/`)
- **Not started:**
  - Teacher outreach texts and the parent letter with a QR code.
  - Privacy page.
  - Real-iPhone audio test.
  - Instagram account.
  - Capacitor, the stores, the paywall.

## Key locations
- `index.html:30` old-address handover · `:160` analytics block + `tbTrack` · `:479` TEXT · `:525` INSTRUMENTS.
- `worker.js:6` www → bare domain; `/` → `index.html` (assets use `html_handling: "none"`, so `.html` URLs never redirect).
- `wrangler.jsonc` routes for tonebee.app + www; `.assetsignore` hides repo files from the site.
- `CLAUDE.md:7` analytics rules · `:8` regenerating the link preview · `sw.js:3` CACHE.

## Gotchas found the hard way
- **Deploying needs `npx wrangler login`** on that computer. The first Mac is logged in; the other computer probably isn't, which may be why the new commits aren't live.
- **www.tonebee.app doesn't resolve yet.** It gets created by the custom-domain route on the next deploy.
- **The repo is public.** Don't commit secrets or personal details. Plan: make it private after about 2026-11-21, once students have moved over.
- **Gemini web UI strips raw SVG from its answers.** Ask it to write `<` as `[[` and `>` as `]]`, read the answer with get_page_text, and decode it with `ops/brand/build/decode.mjs`. Gemini's own sound lines come out broken; its drawn bees are good.
- **Gmail's "Add another email address" popup expires** while the user is creating an App Password. Fully reload Gmail before reopening it.
- **Claude may not create accounts or enter passwords or App Passwords.** Guy does those steps.
- **Open WebKit bugs on iOS 26.4/27:** playback drops to the earpiece or loses quality while the mic is open. Test on a real iPhone before building on Capacitor.

## Open questions for Guy
1. Deploy the two pending commits to tonebee.app now? (On the first Mac it works as-is; on the other computer run `npx wrangler login` first.)
2. Push `ops/` to a **private** GitHub repo so both computers have the plan, research and brand files?
3. Logo: refine Gemini's eighth-note bee (concept 5), or pay a Fiverr designer about $20–60?

## Next action
From `app/` on `main`: `npx wrangler deploy`. Then verify:
- `curl -s https://tonebee.app/ | grep -c tbTrack` is 1 or more.
- `https://tonebee.app/icons/og.png` returns 200.
- `https://www.tonebee.app/` returns 301.
- `sw.js` shows `tonebee-v40`.
- A `$pageview` with `app=tonebee` appears in PostHog.
