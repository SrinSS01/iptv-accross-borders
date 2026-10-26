import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import ts from "typescript"
async function loadTs(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8")
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
  const code = outputText.replaceAll('from "react"', `from ${JSON.stringify(import.meta.resolve("react"))}`)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)
}
const { joinCatalog, CATALOG_ENDPOINTS } = await loadTs("../src/catalog.ts")
const { parseXmltvTime } = await loadTs("../src/programmes.ts")
function fixture() {
  const data = Object.fromEntries(CATALOG_ENDPOINTS.map(name => [name, []]))
  data.channels = [{ id: "Fixture.xx", name: "Fixture", country: "XX", categories: ["news"], is_nsfw: false, network: null }]
  data.streams = [{ channel: "Fixture.xx", feed: "Main", title: "Fixture", url: "https://example.invalid/live.m3u8", referrer: null, user_agent: null, quality: "720p", labels: [] }]
  data.countries = [{ code: "XX", name: "Example country", languages: ["eng"], flag: "" }]
  data.feeds = [{ channel: "Fixture.xx", id: "Main", name: "Main", is_main: true, broadcast_area: ["ct/EXCITY", "s/XX-A", "r/EXREGION", "c/XX"], timezones: ["Etc/UTC"], languages: ["eng"], format: "720p" }]
  data.languages = [{ code: "eng", name: "English" }]
  data.timezones = [{ id: "Etc/UTC", utc_offset: "+00:00", countries: ["XX"] }]
  data.subdivisions = [{ code: "XX-A", name: "Example subdivision", country: "XX", parent: null }]
  data.cities = [{ code: "EXCITY", name: "Example city", country: "XX", subdivision: "XX-A" }]
  data.regions = [{ code: "EXREGION", name: "Example region", countries: ["XX"] }]
  data.categories = [{ id: "news", name: "News", description: "News coverage" }]
  data.logos = [{ channel: "Fixture.xx", feed: "Main", in_use: true, tags: [], url: "https://example.invalid/logo.svg" }]
  data.guides = [{ channel: "Fixture.xx", feed: "Main", site: "example.invalid", site_id: "fixture", site_name: "Fixture", lang: "en", sources: [] }]
  return data
}
test("joins all documented catalog metadata without inventing programme data", () => {
  const [channel] = joinCatalog(fixture())
  assert.equal(CATALOG_ENDPOINTS.length, 13)
  assert.equal(channel.countryName, "Example country")
  assert.deepEqual(channel.languages, ["English"])
  assert.deepEqual(channel.timezones, ["Etc/UTC"])
  assert.equal(channel.broadcastAreas.length, 4)
  assert.equal(channel.categoryDetails[0].description, "News coverage")
  assert.equal(channel.guides[0].site_id, "fixture")
  assert.equal(channel.logoUrls.length, 1)
  assert.equal(channel.current, undefined)
})
test("blocklist and adult flags exclude channels", () => {
  const data = fixture()
  data.blocklist = [{ channel: "Fixture.xx", reason: "dmca", ref: "https://example.invalid/request" }]
  assert.equal(joinCatalog(data).length, 0)
  data.blocklist = []; data.channels[0].is_nsfw = true
  assert.equal(joinCatalog(data).length, 0)
})
test("no fake logo, language or schedule is added when metadata is absent", () => {
  const data = fixture(); data.logos = []; data.feeds = []; data.guides = []
  const [channel] = joinCatalog(data)
  assert.equal(channel.logo, undefined)
  assert.deepEqual(channel.languages, [])
  assert.deepEqual(channel.guides, [])
})
test("XMLTV time conversion honors offsets and rejects malformed calendar values", () => {
  assert.equal(parseXmltvTime("20261026120000 +0530"), Date.parse("2026-10-26T06:30:00Z"))
  assert.equal(parseXmltvTime("20261026120000 -0400"), Date.parse("2026-10-26T16:00:00Z"))
  assert.equal(parseXmltvTime("202610261200 +0530"), Date.parse("2026-10-26T06:30:00Z"))
  assert.equal(parseXmltvTime("20261026120000"), Date.parse("2026-10-26T12:00:00Z"))
  assert.equal(parseXmltvTime("20260230120000 +0000"), undefined)
  assert.equal(parseXmltvTime("20261026250000 +0000"), undefined)
  assert.equal(parseXmltvTime(null), undefined)
})
