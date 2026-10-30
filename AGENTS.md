# IPTV Accross Borders

Next.js App Router + React + Tailwind CSS v4 application.

## Development

`pnpm dev` starts Next.js on port 8443 using webpack for recording-worker compatibility. Check whether it is already running before starting another server. `pnpm build` creates the production app; `pnpm start` serves it using `PORT` or port 3000.

Use Node.js 22.19+ and pnpm 10.34.3. `pnpm install` and `pnpm build` prepare ignored FFmpeg assets under `public/ffmpeg/`; do not commit generated WASM binaries.

## Structure

- `src/app/layout.tsx` imports global CSS and defines metadata.
- `src/app/page.tsx` mounts the client-only browser application through `client-app.tsx` and `browser-app.tsx`.
- `src/App.tsx` owns the existing browsing UI; preserve its design and navigation behavior.
- `src/app/api/` contains server-only stream proxy routes.
- `src/server/` contains outbound validation, catalog authorization and proxy helpers.
- `src/recording.tsx` owns recording UI/lifecycle; browser recording engines are separate modules.
- `src/index.css` owns global CSS and Tailwind v4 tokens.
- `public/` contains static branding; `scripts/copy-ffmpeg.mjs` prepares same-origin recording dependencies.

## Quality and deployment

Run `pnpm typecheck`, `pnpm test`, and `pnpm build` for material changes. Development-only test routes must return 404 in production. Use real catalog data in runtime UI; synthetic media belongs only in explicit test fixtures.

Keep browser APIs behind the client boundary and never include server secrets in client bundles. The stream proxy must not become an arbitrary URL fetcher. Deployment requires Vercel or another Next.js server; GitHub Pages/static export is unsupported. Read `DEPLOYMENT.md` before deployment changes.

Use Tailwind utilities in JSX and global CSS in `src/index.css`; keep CSS imports first. Preserve sharp, square components. Keep JSX balanced and use double quotes for strings containing apostrophes.
