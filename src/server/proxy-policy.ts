import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { BlockList, isIP } from "node:net"

export class ProxyError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message)
  }
}

const blocked = new BlockList()
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4")
const publicV6 = new BlockList()
publicV6.addSubnet("2000::", 3, "ipv6")
const blockedV6 = new BlockList()
for (const [network, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blockedV6.addSubnet(network, prefix, "ipv6")

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, "ipv4")
  if (family === 6) return publicV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6")
  return false
}

export function validateUpstreamUrl(input: string): URL {
  let url: URL
  try { url = new URL(input) } catch { throw new ProxyError("INVALID_SOURCE", "The stream source URL is invalid.") }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 8192)
    throw new ProxyError("INVALID_SOURCE", "This stream source is not supported.")
  // Prevent unexpected egress to arbitrary services, including on public hosts.
  if (url.port && url.port !== "80" && url.port !== "443")
    throw new ProxyError("UNSUPPORTED_PORT", "The stream uses an unsupported network port.")
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || (isIP(host) && !isPublicAddress(host)))
    throw new ProxyError("BLOCKED_DESTINATION", "This stream destination is not allowed.", 403)
  url.hash = ""
  return url
}

export function validateRange(value: string | null): string | undefined {
  if (!value) return undefined
  if (!/^bytes=(?:\d+-\d*|-\d+)$/.test(value) || value.length > 80)
    throw new ProxyError("INVALID_RANGE", "Only one byte range is supported.", 416)
  const [start, end] = value.slice(6).split("-")
  if ((start && !Number.isSafeInteger(Number(start))) || (end && !Number.isSafeInteger(Number(end))) || (start && end && Number(end) < Number(start)) || (!start && Number(end) < 1))
    throw new ProxyError("INVALID_RANGE", "The requested byte range is invalid.", 416)
  return value
}

const secretKey = Symbol.for("iptv.proxy.developmentSecret")
const developmentGlobals = globalThis as typeof globalThis & { [secretKey]?: string }
const developmentSecret = developmentGlobals[secretKey] ??= randomBytes(32).toString("hex")
function signingSecret(): string {
  const secret = process.env.PROXY_SIGNING_SECRET
  if (secret && secret.length >= 32) return secret
  if (process.env.NODE_ENV !== "production") return developmentSecret
  throw new ProxyError("PROXY_NOT_CONFIGURED", "The stream proxy has not been configured.", 503)
}
export type ResourceGrant = { url: string; channel: string; expires: number; playlist?: boolean }
export function signResource(url: string, channel: string, now = Date.now(), playlist = false): string {
  validateUpstreamUrl(url)
  const data = Buffer.from(JSON.stringify({ url, channel, playlist, expires: Math.floor(now / 3_600_000) * 3_600_000 + 7 * 3_600_000 })).toString("base64url")
  const signature = createHmac("sha256", signingSecret()).update(data).digest("base64url")
  return `${data}.${signature}`
}
export function verifyResource(token: string, now = Date.now()): ResourceGrant {
  if (!token || token.length > 16000) throw new ProxyError("INVALID_TOKEN", "The stream resource link is invalid.", 403)
  const [data, signature, extra] = token.split(".")
  const expected = createHmac("sha256", signingSecret()).update(data ?? "").digest()
  const received = Buffer.from(signature ?? "", "base64url")
  if (extra !== undefined || received.length !== expected.length || !timingSafeEqual(received, expected))
    throw new ProxyError("INVALID_TOKEN", "The stream resource link is invalid.", 403)
  let grant: ResourceGrant
  try { grant = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) } catch { throw new ProxyError("INVALID_TOKEN", "The stream resource link is invalid.", 403) }
  if (!grant || typeof grant.url !== "string" || typeof grant.channel !== "string" || (grant.playlist !== undefined && typeof grant.playlist !== "boolean") || !Number.isFinite(grant.expires) || grant.expires <= now)
    throw new ProxyError("EXPIRED_TOKEN", "The stream link expired. Reopen the channel to reconnect.", 403)
  validateUpstreamUrl(grant.url)
  return grant
}

export function resourcePath(url: string, channel: string, playlist = false): string {
  return `/api/streams/resource?token=${encodeURIComponent(signResource(url, channel, Date.now(), playlist))}`
}

export function rewritePlaylist(text: string, baseUrl: string, channel: string): string {
  if (!text.trimStart().startsWith("#EXTM3U"))
    throw new ProxyError("INVALID_PLAYLIST", "The broadcaster did not return an HLS playlist.", 502)
  // Variable substitution and content-steering need semantic resolution; do not let
  // them accidentally escape the proxy or become an arbitrary-URL request surface.
  if (/#EXT-X-(DEFINE|CONTENT-STEERING):/.test(text) || /\{\$/.test(text))
    throw new ProxyError("UNSUPPORTED_PLAYLIST", "This playlist uses unsupported HLS extensions.", 422)
  const rewrite = (uri: string, playlist = false) => resourcePath(new URL(uri, baseUrl).href, channel, playlist)
  let nextIsPlaylist = false
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return line
    if (!trimmed.startsWith("#")) {
      const rewritten = rewrite(trimmed, nextIsPlaylist)
      nextIsPlaylist = false
      return rewritten
    }
    if (trimmed.startsWith("#EXT-X-STREAM-INF:")) nextIsPlaylist = true
    // A variant/rendition can have an extensionless URL and generic MIME type.
    // Preserve its playlist role in the signed grant so every nested URI is rewritten.
    const playlistReference = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(trimmed)
    return line.replace(/\bURI="([^"]*)"/g, (_, uri: string) => `URI="${rewrite(uri, playlistReference)}"`)
  }).join("\n")
}
