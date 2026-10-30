# Next.js deployment on Vercel

This application now requires a Node.js Next.js runtime for its stream proxy. GitHub Pages and `output: "export"` cannot run it. The GitHub workflow checks the application; Vercel's Git integration owns deployment.

## Local development

Use Node.js 22.19 or newer and pnpm 10.34.3:

```sh
pnpm install
pnpm dev
```

The development URL defaults to `http://localhost:8443`. `pnpm build` creates the production application, and `pnpm start` starts it (port 3000 by default, or the `PORT` environment variable). `pnpm typecheck` and `pnpm test` run the source checks. With the dev server running, `BROWSER_PATH=/path/to/chromium pnpm test:e2e` generates test media and verifies real WASM recording; this requires native ffmpeg/ffprobe. Omit BROWSER_PATH if Playwright Chromium is installed.

Installation/build copies the pinned single-thread FFmpeg core into `public/ffmpeg/`. These generated files are ignored by Git but included in the deployed site. The browser downloads them only when preparing WASM recording. The module worker and its imports are copied to `/ffmpeg/worker/` to preserve browser-native dynamic core loading. Keep the worker, core JavaScript, and WASM files on the application's origin so Vercel's authentication cookie applies. No cross-origin-isolation headers or exposed protection bypass tokens are required.

## Vercel setup

1. Import this repository into Vercel, choose the **Next.js** framework, and retain the package-managed install/build commands. Use Node.js 22 or newer.
2. Set the server-only `PROXY_SIGNING_SECRET` (at least 32 characters; see `.env.example`) to a randomly generated value. Do not prefix it with `NEXT_PUBLIC_` or commit its value.
3. Under **Settings → Deployment Protection**, enable **Vercel Authentication → All Deployments**. Confirm both preview and production domains are protected, not only the generated preview URLs. This uses the owner's Vercel login; the application has no separate login screen.
4. Deploy a preview. Before production promotion, confirm an unauthenticated session cannot load its page, API, or FFmpeg assets. In an authenticated session, check stream playback, snapshots, and a short recording with audible audio.
5. Connect `main` as the production branch once validation passes. Do not enable paid add-ons or a Pro trial merely to implement this setup.

Vercel's current documentation says All Deployments protection is available on all plans. Recheck the account's available settings at deployment time. If it is not offered free, the user has authorized a public, login-free fallback; explicitly report this change rather than implying a public site is private. The proxy's catalog restriction and outbound address validation must remain active in either mode.

A deployment URL is not established by this document. Deployment requires the project owner's Vercel access or an authenticated CLI session.

## Runtime and migration limits

The proxy handles individual playlists and media resources, not long-running server recording jobs. Hosting duration, transfer, and response limits still apply; free deployment protection does not imply unlimited streaming bandwidth. Upstream authentication, DRM, outages, and server-side blocking are not bypassed.

Recordings run in the browser, require a visible tab and awake device, and remain in the current session until saved. The WASM recorder caps combined source data at 128 MiB; the browser needs additional memory to finalize a file. There is no persistent storage or server scheduler.

Favorites and view preferences remain local to the browser origin. Existing preferences from the old GitHub Pages domain do not automatically transfer to the new Vercel domain. Old Pages deployment artifacts are removed from this repository; disable the old Pages site separately when it is no longer needed.

Development-only recording checks are available at `/test/recording`, `/test/recording?fallback`, and `/test/wasm` (the latter needs the Playwright-generated HLS fixture at the proxy boundary). These routes return 404 in production. Generated test media is not used as runtime catalog or programme data.

References: [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying), [Vercel protection](https://vercel.com/docs/deployment-protection#all-deployments), [Vercel function limits](https://vercel.com/docs/functions/limitations), [FFmpeg WASM](https://ffmpegwasm.netlify.app/docs/overview/).
