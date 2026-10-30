# IPTV Accross Borders

A sharp-edged live TV browser built with Next.js, React, and Tailwind. Browse the real iptv-org catalog, preview streams, inspect available programme data, and save browser recordings.

```sh
pnpm install
pnpm dev
```

Development runs on port 8443. See [DEPLOYMENT.md](DEPLOYMENT.md) for Vercel deployment, private access, runtime limits, and recording requirements. The application requires a Next.js server; static GitHub Pages hosting is no longer supported.

- `pnpm typecheck` — TypeScript checks
- `pnpm test` — catalog, recording, and proxy policy tests
- `pnpm test:e2e` — browser WASM recording checks (dev server and native ffmpeg/ffprobe required; see `tests/VERIFICATION.md`)
- `pnpm build` — production application and same-origin FFmpeg assets
- `pnpm start` — production server

Catalog data and programme availability are documented in [DATA-SOURCES.md](DATA-SOURCES.md). Browser recordings need an active tab and sufficient device memory; save completed files before leaving.
