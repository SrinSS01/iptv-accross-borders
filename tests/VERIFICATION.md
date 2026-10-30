# Next.js / FFmpeg WASM verification — 2026-10-30

## Automated checks

- `pnpm typecheck`: passed.
- `pnpm test`: 31 tests passed (catalog, scheduling, HLS parsing/selection, live deduplication, ranges, proxy grants, DNS pinning, redirects, cancellation, bounds and gzip catalog transport).
- `pnpm build`: optimized Next.js 16.4.3 production build passed with TypeScript and route generation.
- `git diff --check`: passed.

## Recording browser checks

`tests/recording-e2e.mjs` uses Playwright with installed Brave/Chromium at 390×844,
native FFmpeg-generated test media, the real browser WASM worker, and ffprobe/audio
sample analysis on downloaded outputs. Only upstream fixture responses are mocked.

Thirteen scenarios passed: TS VOD, live manual stop, fragmented MP4 with byte ranges,
separate default audio, discontinuities saved as separate parts, retry after forced
finalization failure, encrypted-source rejection with explicit capture selection,
Matroska fallback, cancel during finalization, network interruption preserving a
partial clip, oversized resource preserving a partial clip, scheduled start/end,
and tab-hidden stop. Saved recordings had video and non-silent audio (peaks above
0.01). Full fixtures produced approximately 12-second files; discontinuities
produced two approximately 6-second files. No page errors were observed.

`/test/recording` and `/test/recording?fallback` additionally passed direct capture
and canvas/Web Audio capture checks with 320×180 decoded video and non-silent audio.

Reproduce with the dev server running and native ffmpeg/ffprobe installed:

```sh
BROWSER_PATH=/usr/bin/brave pnpm test:e2e
BROWSER_PATH=/usr/bin/brave node tests/ui-e2e.mjs
```

Use `SCENARIOS=live,retry` to run selected recording cases. Omit BROWSER_PATH when
Playwright Chromium is installed. Screenshots and generated media go to temporary
folders, never the runtime catalog.

## Production checks

- Desktop 1440×1000 and mobile 390×844: navigation, 13-source panel, mobile search expansion/collapse, sticky positioning, query retention and focus passed. No horizontal overflow or page errors.
- Production `/test/recording` and `/test/wasm`: HTTP 404.
- Same-origin worker, core JS and WASM assets: HTTP 200 with appropriate MIME types.
- Invalid signed resource grant: HTTP 403.
- Real France24.fr request through the built proxy: HTTP 200 playlist and 6,539,768-byte MPEG-TS segment; ffprobe identified H.264 video and AAC audio. Initial catalog loading took about 13 seconds after enabling bounded gzip catalog transport. This is one live-source check, not a guarantee for every broadcaster.

## Remaining external validation

Vercel deployment/protection checks await user-provided tooling; nothing has been
deployed or pushed for this migration. Physical Android/iPhone testing is pending.
Playwright WebKit previously could not launch because this host lacks required
libraries; Chromium emulation does not establish Safari compatibility. Browser
memory, tab suspension, upstream restrictions and Vercel quotas remain constraints.

---

# Archived verification — 2026-10-26

This records the earlier Vite build. It is historical evidence, not verification of the Next.js/WASM migration. Current browser fixtures use `/test/recording` and `/test/wasm`; the former HTML entrypoints no longer apply.

## Automated checks

- `pnpm exec tsc --noEmit`: passed.
- `node --test tests/recording-policy.test.mjs`: passed. Covers default-now, invalid/past times, end ordering, cross-midnight scheduling, single start, exact/end deadlines and missed schedules.
- `pnpm build`: passed. Vite reports the existing large-bundle class of warning (HLS is included in the main bundle).
- Repository oxfmt: changed TypeScript files formatted; subsequent run unchanged.
- Premium strict static audit: zero findings, recorded in `premium-audit.json`.

## Real browser checks

Run using the REA Playwright browser-scenario provider with installed Chromium 155 (Brave executable), against the user's running Vite server.

- Desktop 1440×1000: catalog, sidebar, hero, filters and cards inspected by screenshot. Broken external logo images led to a fallback fix.
- Mobile 390×844: home and navigation inspected by screenshot; recording modal fits viewport with accessible labels and native date fields.
- Invalid end time: actual form submission displayed “End time must be after the start time.” No page errors.
- Recording integration fixture `/tests/recording-browser.html`: generated a real canvas video + oscillator audio source; recorded via the production provider, stopped manually and decoded the resulting Blob. Observed 129,564 bytes, 320×180 playback, one audio track.
- Future schedule + optional end: observed scheduled state, automatic start, automatic stop, and a decoded 175,473-byte recording with 320×180 video and one audio track. No page errors.
- Save video triggered the browser download event with a `.webm` filename. The scenario provider intentionally canceled the download, so OS file persistence was not verified; Blob decoding was verified independently.
- Remove → explicit confirmation removed the saved item from the session.
- Bloomberg was still connecting after 12 seconds. That run established navigation-independent recorder lifetime, not successful capture from that broadcaster.
- An additional search/clear smoke scenario was canceled while waiting for its selectors; search interaction coverage is not claimed.

Evidence IDs: desktop `ev_5cfa6a3623e1701a6ffc3bfa42617b252daca535cf76bf68d5ffc6a68ff90d20`; mobile `ev_5ce7d6028849054531c31e66897904849e3703a6f0f36817497ff218ed114c20`; manual capture `ev_cb7689163e3c62385fd310b7cf0705fcf936596267c78ad0ad1a6955f29998ae`. Scheduled capture evidence remains in the session's browser-scenario output.

## Limits

Recording is browser-local, one active job at a time, capped at 512 MB per recording. Keep the tab open/device awake and save output before reload. Finished recordings can be removed to release memory. Browser capture support and broadcaster CORS/availability affect success. Firefox/Safari and live HLS audio capture were not verified. The fixture is development-only and is not imported by the production entrypoint.

## Expanded catalog and branding update

- All 13 iptv-org metadata endpoints integrated with meaningful join/exclusion roles; live guide endpoint checked: 180,678 guide records, zero nonempty source URL lists on 2026-10-26.
- Direct Playwright with Chromium: desktop catalog rendering, searchable India country selection, List and Timeline switching passed. Mobile 390px picker and Discover anchor navigation passed, document width 380px (no horizontal document overflow).
- Real browser DOMParser fixture: all 9 XMLTV checks passed.
- Node suite: all 11 tests passed (catalog joins/exclusions, timestamps, schedule policies).
- TypeScript check and GitHub project-base Vite build passed. Build retains large main-bundle warning.
- GitHub Actions deployment prepared, not published; see DEPLOYMENT.md. Production consumes real API data only. Synthetic programme fixtures are restricted to tests and are not bundled.
