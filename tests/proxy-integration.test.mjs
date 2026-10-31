import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import ts from "typescript"
import { Readable } from "node:stream"

// Replace only module dependencies in the test loader; the production transport
// has no environment flag or route that permits fetching private addresses.
function compile(file, imports = {}) {
  let source = fs.readFileSync(new URL(file, import.meta.url), "utf8")
  for (const [name, replacement] of Object.entries(imports)) {
    source = source.replace(new RegExp(`import \\{([^}]+)\\} from ["']${name.replaceAll(".", "\\.")}["']`), (_, names) => `const {${names}} = ${replacement}`)
  }
  return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`
}
const policyUrl = compile("../src/server/proxy-policy.ts")
const policy = await import(policyUrl)
const key = `__iptvProxyTest${Date.now()}`
const dependencies = globalThis[key] = { policy }
const dependency = (name) => `globalThis[${JSON.stringify(key)}].${name}`
const calls = []
let dnsResults = [{ address: "93.184.216.34", family: 4 }]
let responses = []
let agentOptions
let destroyed = 0
function upstreamBody(chunks = []) {
  return Readable.from(chunks)
}
dependencies.dns = { lookup: async (...args) => { calls.push(["dns", ...args]); return dnsResults } }
dependencies.undici = {
  Agent: class { constructor(options) { agentOptions = options } async destroy() { destroyed++ } },
  request: async (url, options) => { calls.push(["request", url.href, options]); return responses.shift() },
}
const transport = await import(compile("../src/server/upstream.ts", {
  "node:dns/promises": dependency("dns"), undici: dependency("undici"), "./proxy-policy": dependency("policy"),
}))
let responseValue
let closed = 0
const proxyRequests = []
dependencies.transport = { ...transport, openUpstream: async (...args) => { proxyRequests.push(args); return responseValue } }
const responseModule = await import(compile("../src/server/stream-response.ts", { "./proxy-policy": dependency("policy"), "./upstream": dependency("transport") }))
const catalog = await import(compile("../src/server/stream-catalog.ts", { "./proxy-policy": dependency("policy"), "./upstream": dependency("transport") }))
function fixture({ status = 200, headers = {}, chunks = [new Uint8Array([1, 2, 3])], url = "https://cdn.example/segment.ts" } = {}) {
  closed = 0
  responseValue = { statusCode: status, headers, body: upstreamBody(chunks), finalUrl: url, cleanup() { closed++ } }
  return responseValue
}

test("transport pins the socket to validated DNS and never forwards client credentials", async () => {
  calls.length = 0; destroyed = 0
  dnsResults = [{ address: "93.184.216.34", family: 4 }]
  responses = [{ statusCode: 200, headers: {}, body: upstreamBody() }]
  const result = await transport.openUpstream("https://cdn.example/segment.ts", "bytes=0-2")
  assert.equal(agentOptions.connect.autoSelectFamily, false)
  let pinned
  agentOptions.connect.lookup("cdn.example", {}, (error, address, family) => { assert.equal(error, null); pinned = { address, family } })
  assert.deepEqual(pinned, dnsResults[0])
  assert.deepEqual(calls.find(([kind]) => kind === "request")[2].headers, { accept: "*/*", "accept-encoding": "identity", range: "bytes=0-2" })
  result.cleanup()
  assert.equal(destroyed, 1)
})
test("transport rejects mixed public/private DNS answers before opening a socket", async () => {
  calls.length = 0
  dnsResults = [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]
  await assert.rejects(transport.openUpstream("https://cdn.example/segment.ts"), { code: "BLOCKED_DESTINATION" })
  assert.equal(calls.some(([kind]) => kind === "request"), false)
})
test("transport revalidates redirects and refuses a private redirect", async () => {
  calls.length = 0
  dnsResults = [{ address: "93.184.216.34", family: 4 }]
  const body = upstreamBody()
  responses = [{ statusCode: 302, headers: { location: "http://169.254.169.254/latest/meta-data" }, body }]
  await assert.rejects(transport.openUpstream("https://cdn.example/index.m3u8"), { code: "BLOCKED_DESTINATION" })
  assert.equal(calls.filter(([kind]) => kind === "request").length, 1)
  assert.equal(body.destroyed, true)
})
test("bounded reader rejects resources whose actual size exceeds the declared budget", async () => {
  await assert.rejects(transport.readBounded(upstreamBody([new Uint8Array(3), new Uint8Array(3)]), 5), { code: "RESOURCE_TOO_LARGE" })
})
test("proxy streams ranges and closes transport when consumed", async () => {
  const upstream = fixture({ status: 206, headers: { "content-type": "video/mp2t", "content-length": "3", "content-range": "bytes 0-2/12" } })
  const response = await responseModule.proxyStream(new Request("https://app.example/resource", { headers: { range: "bytes=0-2" } }), upstream.finalUrl, "test")
  assert.equal(response.status, 206)
  assert.equal(response.headers.get("content-range"), "bytes 0-2/12")
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3])
  assert.equal(upstream.body.destroyed, true)
  assert.equal(closed, 1)
})
test("proxy neutralizes executable MIME types and cancels upstream on client cancellation", async () => {
  const upstream = fixture({ headers: { "content-type": "text/html" } })
  const response = await responseModule.proxyStream(new Request("https://app.example/resource"), upstream.finalUrl, "test")
  assert.equal(response.headers.get("content-type"), "application/octet-stream")
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'")
  await response.body.cancel()
  assert.equal(upstream.body.destroyed, true)
  assert.equal(closed, 1)
})
test("proxy rejects oversized advertised resources without downloading them", async () => {
  const upstream = fixture({ headers: { "content-length": String(transport.MAX_RESOURCE_BYTES + 1) } })
  await assert.rejects(responseModule.proxyStream(new Request("https://app.example/resource"), upstream.finalUrl, "test"), { code: "RESOURCE_TOO_LARGE" })
  assert.equal(upstream.body.destroyed, true)
})
test("signed extensionless playlist roles trigger nested URI rewriting", async () => {
  const text = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio?id=1"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvideo?id=2\n'
  const rewritten = policy.rewritePlaylist(text, "https://cdn.example/master", "test")
  const grants = [...rewritten.matchAll(/token=([^"\s]+)/g)].map((match) => policy.verifyResource(decodeURIComponent(match[1])))
  assert.equal(grants.length, 2)
  assert.equal(grants.every((grant) => grant.playlist), true)
  const upstream = fixture({ headers: { "content-type": "application/octet-stream" }, chunks: [new TextEncoder().encode('#EXTM3U\n#EXTINF:2,\nseg.ts\n')], url: grants[1].url })
  const response = await responseModule.proxyStream(new Request("https://app.example/resource"), upstream.finalUrl, "test", grants[1].playlist)
  assert.match(response.headers.get("content-type"), /mpegurl/)
  assert.match(await response.text(), /\/api\/streams\/resource\?token=/)
})
test("server source indexes match catalog preference and exclude blocked/adult sources", () => {
  const streams = [
    { channel: "ok", url: "https://cdn.example/low.m3u8", labels: ["Geo-blocked"] },
    { channel: "ok", url: "https://cdn.example/high.m3u8", labels: [] },
    { channel: "ok", url: "http://cdn.example/insecure.m3u8", labels: [] },
    { channel: "blocked", url: "https://cdn.example/blocked.m3u8", labels: [] },
    { channel: "adult", url: "https://cdn.example/adult.m3u8", labels: [] },
  ]
  const result = catalog.indexStreams([{ id: "ok", is_nsfw: false }, { id: "blocked", is_nsfw: false }, { id: "adult", is_nsfw: true }], streams, [{ channel: "blocked" }])
  assert.deepEqual([...result.keys()], ["ok"])
  assert.deepEqual(result.get("ok").map((row) => row.url), ["https://cdn.example/high.m3u8", "https://cdn.example/low.m3u8"])
})

test("mobile playlist range probes return complete rewritten manifests without forwarding Range", async () => {
  for (const url of ["https://cdn.example/live.m3u8", "https://cdn.example/manifest"]) {
    proxyRequests.length = 0
    fixture({ url, chunks: [new TextEncoder().encode("#EXTM3U\n#EXTINF:2,\nseg.ts\n")] })
    const response = await responseModule.proxyStream(new Request("https://app.example/stream", { headers: { range: "bytes=0-1" } }), url, "test", true)
    assert.equal(response.status, 200)
    assert.equal(proxyRequests[0][1], undefined)
    assert.equal(response.headers.get("content-range"), null)
    assert.match(await response.text(), /^#EXTM3U\n#EXTINF:2,\n\/api\/streams\/resource\?token=/)
  }
})
test("MIME-discovered playlists are fetched again without a range before rewriting", async () => {
  proxyRequests.length = 0
  const upstream = fixture({ status: 206, headers: { "content-type": "application/vnd.apple.mpegurl" }, chunks: [new TextEncoder().encode("#EXTM3U\n#EXTINF:2,\nseg.ts\n")], url: "https://cdn.example/manifest" })
  // The second open must receive a fresh body, as a real HTTP request would.
  upstream.cleanup = () => { closed++; responseValue = { ...upstream, body: upstreamBody([new TextEncoder().encode("#EXTM3U\n#EXTINF:2,\nseg.ts\n")]), cleanup() {} } }
  const response = await responseModule.proxyStream(new Request("https://app.example/stream", { headers: { range: "bytes=0-1" } }), upstream.finalUrl, "test")
  assert.deepEqual(proxyRequests.map((args) => args[1]), ["bytes=0-1", undefined])
  assert.equal(response.status, 200)
  assert.match(await response.text(), /^#EXTM3U/)
})
test("unread redirect and rejected bodies can emit abort errors without uncaught exceptions", async () => {
  dnsResults = [{ address: "93.184.216.34", family: 4 }]
  for (const statusCode of [302, 416]) {
    const body = new Readable({ read() {}, destroy(_error, callback) { callback(Object.assign(new Error("Request aborted"), { code: "UND_ERR_ABORTED" })) } })
    responses = [{ statusCode, headers: { location: "http://127.0.0.1/private" }, body }]
    if (statusCode === 302) {
      await assert.rejects(transport.openUpstream("https://cdn.example/live.m3u8"), { code: "BLOCKED_DESTINATION" })
    } else {
      responseValue = await transport.openUpstream("https://cdn.example/seg.ts")
      await assert.rejects(responseModule.proxyStream(new Request("https://app.example/resource"), "https://cdn.example/seg.ts", "test"), { code: "INVALID_RANGE" })
    }
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(body.destroyed, true)
    assert(body.listenerCount("error") > 0)
  }
})
test("observing body errors does not hide an actual download failure", async () => {
  dnsResults = [{ address: "93.184.216.34", family: 4 }]
  const body = new Readable({ read() { this.destroy(new Error("connection lost")) } })
  responses = [{ statusCode: 200, headers: {}, body }]
  const upstream = await transport.openUpstream("https://cdn.example/seg.ts")
  try { await assert.rejects(transport.readBounded(upstream.body, 1024), /connection lost/) }
  finally { upstream.cleanup() }
})

test("catalog fetches bounded gzip data without changing media range transport", async () => {
  const { gzipSync } = await import("node:zlib")
  const datasets = {
    channels: [{ id: "compressed", is_nsfw: false }],
    streams: [{ channel: "compressed", url: "https://cdn.example/live.m3u8", labels: [] }],
    blocklist: [],
  }
  dependencies.transport.openUpstream = async (url, range, signal, encoding) => {
    assert.equal(encoding, "gzip")
    const name = new URL(url).pathname.split("/").pop().replace(".json", "")
    return { statusCode: 200, headers: { "content-encoding": "gzip" }, body: upstreamBody([gzipSync(JSON.stringify(datasets[name]))]), cleanup() {} }
  }
  // Recompile with a distinct binding to isolate the catalog cache from other cases.
  const compressed = await import(compile("../src/server/stream-catalog.ts", { "./proxy-policy": dependency("policy"), "./upstream": `({...${dependency("transport")}})` }))
  assert.equal(await compressed.resolveSource("compressed", 0), "https://cdn.example/live.m3u8")
})
