// BROWSER_PATH=/usr/bin/brave node tests/playback-e2e.mjs (requires dev server + ffmpeg)
import { chromium, devices } from "playwright"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, basename } from "node:path"
import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"

const dir = await mkdtemp(join(tmpdir(), "iptv-playback-"))
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "12", "-c:v", "libx264", "-preset", "ultrafast", "-g", "48", "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod", join(dir, "index.m3u8")])
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, args: ["--no-sandbox"] })
try {
  for (const scenario of ["permission", "fallback", "retry"]) {
    const page = await browser.newPage({ ...devices["Pixel 7"] })
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    const streams = Array.from({ length: scenario === "fallback" ? 2 : 1 }, (_, index) => ({ channel: "Fixture.xx", feed: null, title: "Fixture", url: `https://example.invalid/${index}.m3u8`, referrer: null, user_agent: null, quality: "180p", labels: [] }))
    await page.route("https://iptv-org.github.io/api/*.json", route => {
      const name = basename(new URL(route.request().url()).pathname, ".json")
      const rows = name === "channels" ? [{ id: "Fixture.xx", name: "Playback fixture", country: "XX", categories: [], is_nsfw: false, network: null }] : name === "streams" ? streams : []
      return route.fulfill({ json: rows })
    })
    await page.route("**/api/streams/**", async route => {
      const url = new URL(route.request().url())
      const path = url.pathname
      if (scenario === "fallback" && url.searchParams.get("source") === "1") await page.evaluate(() => { window.__allowFixturePlayback = true })
      const file = path.endsWith(".ts") ? basename(path) : "index.m3u8"
      let body = await readFile(join(dir, file))
      if (file.endsWith(".m3u8")) body = Buffer.from(body.toString().replace(/^index\d+\.ts$/gm, name => `/api/streams/fixture/${name}`))
      return route.fulfill({ body, contentType: file.endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl" })
    })
    await page.addInitScript(scenario => {
      const original = HTMLMediaElement.prototype.play
      window.__allowFixturePlayback = false
      document.addEventListener("click", event => {
        const label = event.target.closest?.("button")?.textContent || ""
        if (/Start live stream|Retry sources/.test(label)) window.__allowFixturePlayback = true
      }, true)
      HTMLMediaElement.prototype.play = function () {
        if (scenario === "fallback" && this.src.includes("source=1")) window.__allowFixturePlayback = true
        if (this.hasAttribute("controls") && !window.__allowFixturePlayback) {
          return Promise.reject(new DOMException("Injected browser rejection", scenario === "permission" ? "NotAllowedError" : "NotSupportedError"))
        }
        return original.call(this)
      }
    }, scenario)
    await page.goto(process.env.TEST_ORIGIN || "http://localhost:8443", { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "Preview Playback fixture", exact: true }).first().click()
    await page.getByRole("button", { name: "Watch full screen", exact: true }).click()
    if (scenario === "permission") {
      await page.getByRole("button", { name: "Start live stream", exact: true }).click()
    } else if (scenario === "retry") {
      await page.getByText("This stream could not be loaded or played on this device. Try the sources again.", { exact: true }).waitFor()
      await page.getByRole("button", { name: "Retry sources", exact: true }).click()
    }
    if (scenario === "fallback") {
      // The replacement source can require a fresh gesture on mobile.
      await page.waitForFunction(() => document.querySelector("video[controls]")?.currentTime > 0 || [...document.querySelectorAll("button")].some(b => b.textContent.includes("Start live stream")))
      const start = page.getByRole("button", { name: "Start live stream", exact: true })
      if (await start.isVisible()) await start.click()
    }
    await page.waitForFunction(() => {
      const video = document.querySelector("video[controls]")
      return video && video.currentTime > 0 && video.videoWidth === 320 && !video.paused
    }).catch(async error => {
      console.error(scenario, (await page.locator("body").innerText()).slice(-1800))
      console.error(await page.locator("video[controls]").evaluate(v => ({src:v.currentSrc,time:v.currentTime,ready:v.readyState,error:v.error?.message,allowed:window.__allowFixturePlayback})))
      throw error
    })
    assert.equal(await page.getByText(/Playback was blocked/).count(), 0)
    assert.deepEqual(errors, [])
    console.log("PASS", scenario, "→ decoded mobile playback")
    await page.close()
  }
} finally { await browser.close() }
