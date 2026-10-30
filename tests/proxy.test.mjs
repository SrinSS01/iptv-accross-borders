import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import ts from "typescript"

// These pure policies use only Node built-ins. No production URL bypass is added.
const source = fs.readFileSync(new URL("../src/server/proxy-policy.ts", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const policy = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`)
const { isPublicAddress, validateUpstreamUrl, validateRange, signResource, verifyResource, rewritePlaylist } = policy

test("proxy blocks local, private, reserved and IPv4-mapped IPv6 destinations", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::"]) assert.equal(isPublicAddress(ip), false, ip)
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip)
  for (const url of ["file:///etc/passwd", "https://localhost/live", "http://127.1/live", "http://2130706433/live", "https://[::1]/live", "https://foo.internal/live", "https://user:pass@example.com/live", "https://example.com:22/live"])
    assert.throws(() => validateUpstreamUrl(url))
})
test("proxy accepts only valid single ranges", () => {
  for (const range of ["bytes=0-1023", "bytes=100-", "bytes=-100"]) assert.equal(validateRange(range), range)
  for (const range of ["bytes=0-1,2-3", "bytes=3-2", "bytes=-0", "bytes=abc-", "bytes=999999999999999999999-"]) assert.throws(() => validateRange(range))
})
test("resource grants authenticate exact URLs and expire", () => {
  const token = signResource("https://example.com/live.ts", "test", 1000)
  assert.equal(verifyResource(token, 2000).url, "https://example.com/live.ts")
  assert.throws(() => verifyResource(`${token.slice(0, -3)}xxx`, 2000))
  const [data, signature] = token.split(".")
  const changed = JSON.parse(Buffer.from(data, "base64url").toString())
  changed.url = "https://different.example/live.ts"
  assert.throws(() => verifyResource(`${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`, 2000))
  assert.throws(() => verifyResource(token, 8 * 3_600_000))
})
test("playlist rewrites relative, absolute, audio, key and init references", () => {
  const playlist = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/list.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="/key"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nvideo/main.m3u8\n#EXTINF:6,\nhttps://cdn.example/segment.ts\n'
  const output = rewritePlaylist(playlist, "https://example.com/hls/master.m3u8", "test")
  const tokens = [...output.matchAll(/\/api\/streams\/resource\?token=([^"\s]+)/g)].map((match) => verifyResource(decodeURIComponent(match[1])).url)
  assert.deepEqual(tokens, ["https://example.com/hls/audio/list.m3u8", "https://example.com/key", "https://example.com/hls/init.mp4", "https://example.com/hls/video/main.m3u8", "https://cdn.example/segment.ts"])
  assert.throws(() => rewritePlaylist("<html>denied</html>", "https://example.com/x", "test"))
  assert.throws(() => rewritePlaylist('#EXTM3U\n#EXT-X-DEFINE:NAME="x",VALUE="y"', "https://example.com/x", "test"))
  assert.throws(() => rewritePlaylist("#EXTM3U\nhttp://127.0.0.1/private", "https://example.com/x", "test"))
})
