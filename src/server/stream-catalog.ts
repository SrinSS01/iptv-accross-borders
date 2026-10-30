import { gunzipSync } from "node:zlib"
import { ProxyError } from "./proxy-policy"
import { openUpstream, readBounded } from "./upstream"

type CatalogStream = {
  channel: string | null
  url: string
  referrer?: string | null
  user_agent?: string | null
  labels?: string[]
}
type CatalogChannel = { id: string; is_nsfw: boolean }
type CatalogBlock = { channel: string }
const API = "https://iptv-org.github.io/api"
let cached: { expires: number; sources: Map<string, CatalogStream[]> } | undefined
let pending: Promise<Map<string, CatalogStream[]>> | undefined

// Keep ordering identical to joinCatalog in src/catalog.ts. Indexes refer to
// the user-visible sorted source list, not the order of the raw API dataset.
export function scoreStream(stream: CatalogStream): number {
  return (stream.url.includes(".m3u8") ? 8 : 0) +
    (!stream.referrer && !stream.user_agent ? 4 : 0) +
    (!(stream.labels ?? []).includes("Geo-blocked") ? 2 : 0) +
    (!(stream.labels ?? []).includes("Not 24/7") ? 1 : 0)
}
export function indexStreams(channels: CatalogChannel[], streams: CatalogStream[], blocklist: CatalogBlock[]) {
  const blocked = new Set(blocklist.map((row) => row.channel))
  const allowed = new Set(channels.filter((row) => !row.is_nsfw && !blocked.has(row.id)).map((row) => row.id))
  const sources = new Map<string, CatalogStream[]>()
  for (const stream of streams) {
    if (!stream.channel || !allowed.has(stream.channel) || typeof stream.url !== "string" || !stream.url.startsWith("https://")) continue
    const entries = sources.get(stream.channel) ?? []
    entries.push(stream)
    sources.set(stream.channel, entries)
  }
  for (const entries of sources.values()) entries.sort((a, b) => scoreStream(b) - scoreStream(a))
  return sources
}
async function dataset<T>(name: string): Promise<T[]> {
  const response = await openUpstream(`${API}/${name}.json`, undefined, undefined, "gzip")
  try {
    if (response.statusCode !== 200) throw new Error("catalog unavailable")
    const bytes = await readBounded(response.body, 32 * 1024 * 1024)
    const encoding = response.headers["content-encoding"]
    if (encoding && encoding !== "identity" && encoding !== "gzip") throw new Error("unsupported catalog encoding")
    const decoded = encoding === "gzip" ? gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }) : bytes
    const data = JSON.parse(new TextDecoder().decode(decoded))
    if (!Array.isArray(data)) throw new Error("invalid catalog")
    return data
  } finally { response.body.destroy(); response.cleanup() }
}
async function catalog(): Promise<Map<string, CatalogStream[]>> {
  if (cached && cached.expires > Date.now()) return cached.sources
  if (!pending) pending = Promise.all([
    dataset<CatalogChannel>("channels"), dataset<CatalogStream>("streams"), dataset<CatalogBlock>("blocklist"),
  ]).then(([channels, streams, blocklist]) => {
    const sources = indexStreams(channels, streams, blocklist)
    cached = { sources, expires: Date.now() + 5 * 60_000 }
    return sources
  }).catch(() => { throw new ProxyError("CATALOG_UNAVAILABLE", "The stream catalog could not be verified. Try again shortly.", 503) })
    .finally(() => { pending = undefined })
  return pending
}
export async function resolveSource(channel: string, index: number): Promise<string> {
  if (!channel || channel.length > 250 || !Number.isSafeInteger(index) || index < 0)
    throw new ProxyError("INVALID_CHANNEL", "The channel or stream selection is invalid.")
  const source = (await catalog()).get(channel)?.[index]
  if (!source) throw new ProxyError("CHANNEL_UNAVAILABLE", "This channel or stream is unavailable in the current catalog.", 404)
  return source.url
}
export async function assertChannelAllowed(channel: string): Promise<void> {
  if (!(await catalog()).has(channel))
    throw new ProxyError("CHANNEL_UNAVAILABLE", "This channel is unavailable in the current catalog.", 404)
}
