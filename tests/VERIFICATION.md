# Verification — 2026-10-26

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
