# GitHub Pages deployment

The static app is ready for the existing `SrinSS01/iptv-accross-borders` repository. The workflow is `.github/workflows/deploy-pages.yml` and deploys pushes to `main`, or a manual **Run workflow**.

## First deployment

1. In the repository, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
2. Push these changes to `main`.
3. Open **Actions → Deploy IPTV Accross Borders to Pages**. The deploy job reports the actual site URL when successful.

The expected project-site address is `https://srinss01.github.io/iptv-accross-borders/`. This document does not establish that the site has been deployed. A custom domain, if configured later, can change the address.

The build uses Node 22 and pnpm 10.34.3, installs the lockfile, checks TypeScript, tests recording scheduling, and uploads only `dist`. Deployment uses GitHub's Pages artifact and OIDC flow, with write permissions limited to the deploy job. It needs no manually-created deployment secret.

## Base paths

The workflow supplies `VITE_BASE_PATH` from GitHub's configured Pages base path. Vite uses it before the Figma preview base. This supports the repository subdirectory and root/custom-domain deployments without hardcoding a GitHub username into the application.

To check the project-site build locally:

```sh
VITE_BASE_PATH=/iptv-accross-borders/ pnpm build
pnpm preview
```

Open the preview host with `/iptv-accross-borders/` appended. Local development continues at `/` when `VITE_BASE_PATH` is unset. Public assets must respect Vite's base; avoid root-relative runtime URLs for app-owned files. The brand component renders inline SVG, so its mark works at either base.

## Runtime limits

GitHub Pages hosts static files. Streams, logos and programme guides still depend on their providers' availability, HTTPS and browser cross-origin policies. Pages does not proxy streams or bypass those policies. Browser recording requires an open tab and awake device; the workflow does not run scheduled recordings. Save completed recordings before leaving the tab.

References: [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Vite Pages deployment](https://vite.dev/guide/static-deploy.html#github-pages).
