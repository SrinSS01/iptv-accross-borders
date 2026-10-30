# Next.js migration with private Vercel hosting and FFmpeg WASM recording

Status: implemented locally; final verification recorded in tests/VERIFICATION.md. Vercel account connection, protected preview deployment, and production promotion are pending user-provided tooling. No migration changes have been pushed or deployed yet.

## Summary

Migrate the existing app to Next.js App Router, preserve all current UI changes, and deploy on Vercel. Use free **Vercel Authentication → All Deployments** protection, including production. Do not build an app login.

Record compatible HLS streams by downloading their original segments through a controlled server proxy, then remuxing them in the browser with FFmpeg WASM. Keep the existing capture recorder as a fallback.

## Application and hosting

- Replace Vite entrypoints and build configuration with Next.js, retaining React, Tailwind, branding, catalog views, filters, navigation, and recordings UI.
- Keep browser-dependent playback and recording inside client components; initialize persisted preferences safely after mounting to avoid hydration differences.
- Preserve all 13 catalog datasets and existing real-data behavior.
- Replace the GitHub Pages publishing workflow with typecheck, tests, and Next.js build checks. Use Vercel's Git integration for deployment.
- Serve WASM and worker assets from the same deployment, loaded only when recording requires them. Use the single-thread FFmpeg core without cross-origin-isolation requirements.
- Configure protection for every deployment URL and use relative API URLs so Vercel authentication cookies apply automatically. Do not expose protection-bypass credentials to the browser.
- Existing favorites remain on the old origin; document that they will not automatically transfer to the Vercel domain.

## Stream proxy

- Add a channel-based stream endpoint accepting a catalog channel ID and source index, rather than arbitrary user-supplied URLs.
- Resolve sources against the server's catalog and blocklist. Rewrite HLS playlist references—including variant playlists, audio, initialization segments, and media segments—to signed proxy URLs.
- Stream resource responses with cancellation, timeouts, byte-range support, and bounded resource sizes; avoid buffering entire videos in a Vercel function.
- Validate destinations and redirects, reject private/local network addresses, and enforce DNS-safe outbound connections. Never forward application cookies or authorization headers to broadcasters.
- Use the proxy for HLS playback, preview snapshots, and recording. Preserve direct playback for other supported formats.
- Return distinguishable errors for unavailable sources, upstream rejection, unsupported resources, and deployment limits. The proxy does not bypass DRM or broadcaster authentication.

## Recording behavior

- Introduce a recorder interface shared by the HLS/WASM and existing capture implementations. Expose preparation, scheduled, recording, finalizing, completed, canceled, and failed states.
- Load and prepare FFmpeg before accepting a recording or schedule. Use a maintained HLS parser to select a fixed rendition at or below 720p where available and its default audio rendition.
- Collect complete segments from the live edge, refresh playlists, deduplicate by media sequence, and preserve initialization data, byte ranges, and separate audio. Start/end times are approximate to segment boundaries.
- Support unencrypted MPEG-TS and fragmented-MP4 HLS initially. Reject unsupported encryption, DRM, or playlist features before recording and offer the existing capture fallback explicitly.
- Stop and finalize on manual stop, scheduled end, or the **128 MiB combined source-data cap**. Stop collection when the tab becomes hidden; preserve complete segments already collected.
- Remux locally with FFmpeg stream-copy into MP4 when compatible. Use Matroska for supported codecs that cannot be copied into MP4; do not silently transcode on mobile.
- Finalize discontinuities as separate downloadable parts rather than risk a corrupt combined file. Preserve collected data for retry after finalization failure and provide cancellation that terminates the worker and releases memory.
- Retain saved-recording navigation and highlighting. Clearly show preparation, recorded bytes, finalization status, output format, and partial-recording reasons.
- Scheduling remains browser-owned: it requires the tab to stay visible and the device awake. No server storage, background recording service, or native FFmpeg process is introduced.

## Validation and rollout

- Test HLS master/media playlists, separate audio, relative URLs, byte ranges, repeated segments, discontinuities, unsupported encryption, network interruption, size limits, cancellation, and scheduled stop.
- Test proxy signature validation, blocked destinations, redirects, range responses, cancellation, and upstream failures.
- Verify downloaded recordings contain moving video and non-silent audio with expected duration; test both WASM and capture paths.
- Use Playwright to check desktop/mobile UI, preserved navigation and search, loading/error states, and absence of hydration errors.
- Run Chromium and WebKit recording checks where available; explicitly report physical iPhone/Android coverage rather than equating browser emulation with device validation.
- Deploy a protected preview first. Verify unauthenticated access is blocked for the page, API, and recording assets, then verify playback and recording after Vercel authentication.
- Promote only after production build and preview checks pass. Confirm the account offers free All Deployments protection; if unavailable, use the user-authorized public, login-free fallback and clearly report the change without enabling a paid add-on.

## Assumptions and limits

Vercel Hobby is the target; no paid hosting upgrade or additional storage service is authorized. Recording is one job per tab, with a 128 MiB source limit. WASM needs additional working memory, so this cap cannot guarantee success on every phone. Broadcaster availability, server access restrictions, browser suspension, and Vercel quotas remain applicable.

## Current verification and references

Before this migration, the canvas/Web Audio fallback and direct capture both passed Chromium recording checks with playable video and non-silent audio. Typecheck, production build, and 11 policy/catalog tests passed. Safari/iPhone compatibility remains unverified: Playwright WebKit could not launch because host libraries were missing. The Android SDK has no configured emulator or connected device; hardware acceleration was unavailable.

Recheck hosting capabilities and limits when resuming:

- https://vercel.com/docs/deployment-protection#all-deployments
- https://vercel.com/docs/functions/limitations
- https://nextjs.org/docs/app/getting-started/deploying
- https://ffmpegwasm.netlify.app/docs/overview/
- https://ffmpegwasm.netlify.app/docs/performance/
