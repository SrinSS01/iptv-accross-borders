import { useEffect, useMemo, useState } from "react"
import type { Channel, GuideSource } from "./catalog"

export type Programme = {
  id: string
  title: string
  description?: string
  start: number
  end: number
  thumbnail?: string
}
type ParsedGuide = {
  programmes: Map<string, Programme[]>
  names: Map<string, string[]>
}
type GuideResult = {
  programmes: Programme[]
  sourceUrl?: string
  error: string
}
const MAX_GUIDE_BYTES = 12 * 1024 * 1024
const CACHE_MS = 5 * 60 * 1000
const cache = new Map<string, {
  until: number
  data: Promise<ParsedGuide>
}>()
let activeFetches = 0
const queue: Array<() => void> = []
function limited<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeFetches++
      work()
        .then(resolve, reject)
        .finally(() => {
          activeFetches--
          queue.shift()?.()
        })
    }
    if (activeFetches < 4) run()
    else queue.push(run)
  })
}

/** XMLTV timestamps without an explicit zone are UTC per XMLTV's date specification. */
export function parseXmltvTime(value: string | null): number | undefined {
  if (!value) return undefined
  const match =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2})(\d{2})|\s*(?:Z|UTC|GMT))?$/.exec(
      value.trim(),
    )
  if (!match) return undefined
  const [, year, month, day, hour, minute, second, sign, zoneHour, zoneMinute] =
    match
  const [y, m, d, h, min, sec] = [
    year,
    month,
    day,
    hour,
    minute,
    second ?? "00",
  ].map(Number)
  const date = new Date(Date.UTC(y, m - 1, d, h, min, sec))
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d ||
    h > 23 ||
    min > 59 ||
    sec > 59
  )
    return undefined
  if (zoneHour && (Number(zoneHour) > 23 || Number(zoneMinute) > 59))
    return undefined
  return (
    date.getTime() -
    (sign
      ? (Number(zoneHour) * 60 + Number(zoneMinute)) *
        60000 *
        (sign === "+" ? 1 : -1)
      : 0)
  )
}
function safeImage(value: string | null, base: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value, base)
    return url.protocol === "https:" ? url.href : undefined
  } catch {
    return undefined
  }
}
function normal(value: string) {
  return value.trim().toLocaleLowerCase()
}
export function parseXmltv(
  xml: string,
  sourceUrl: string,
  now = Date.now(),
): ParsedGuide {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml))
    throw new Error("Unsupported XML entity declarations in programme guide")
  // XMLTV commonly includes an external DTD. Strip that declaration; never load it.
  const safeXml = xml.replace(/<!DOCTYPE[^>]*>/gi, "")
  const document = new DOMParser().parseFromString(safeXml, "application/xml")
  if (
    document.querySelector("parsererror") ||
    document.documentElement.tagName !== "tv"
  )
    throw new Error("The programme source did not return valid XMLTV")
  const names = new Map<string, string[]>()
  for (const channel of document.querySelectorAll("tv > channel")) {
    const id = channel.getAttribute("id")
    if (!id) continue
    for (const element of channel.querySelectorAll("display-name")) {
      const name = normal(element.textContent ?? "")
      if (name) names.set(name, [...new Set([...(names.get(name) ?? []), id])])
    }
  }
  const programmes = new Map<string, Programme[]>()
  for (const element of document.querySelectorAll("tv > programme")) {
    const channelId = element.getAttribute("channel")
    const child = (name: string) =>
      [...element.children].find((item) => item.tagName === name)
    const title = child("title")?.textContent?.trim()
    const start = parseXmltvTime(element.getAttribute("start"))
    const end = parseXmltvTime(element.getAttribute("stop"))
    if (
      !channelId ||
      !title ||
      start === undefined ||
      end === undefined ||
      end <= start ||
      end <= now - 3600000 ||
      start > now + 48 * 3600000
    )
      continue
    const programme: Programme = {
      id: `${channelId}:${start}:${end}`,
      title,
      description: child("desc")?.textContent?.trim() || undefined,
      start,
      end,
      thumbnail: safeImage(
        child("icon")?.getAttribute("src") ??
          [...element.children]
            .find(
              (item) =>
                item.tagName === "image" &&
                item.getAttribute("type") === "backdrop",
            )
            ?.textContent?.trim() ??
          child("image")?.textContent?.trim() ??
          null,
        sourceUrl,
      ),
    }
    const entries = programmes.get(channelId) ?? []
    if (!entries.some((item) => item.id === programme.id))
      entries.push(programme)
    programmes.set(channelId, entries)
  }
  for (const entries of programmes.values())
    entries.sort((a, b) => a.start - b.start)
  return { programmes, names }
}
async function readLimited(response: Response) {
  if (Number(response.headers.get("content-length")) > MAX_GUIDE_BYTES)
    throw new Error("Programme guide exceeds the browser size limit")
  if (!response.body) throw new Error("Empty programme response")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_GUIDE_BYTES) {
        await reader.cancel()
        throw new Error("Programme guide exceeds the browser size limit")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  // Fetch already decodes Content-Encoding. Only decompress a gzip file if magic bytes remain.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined")
      throw new Error("Compressed guides are not supported in this browser")
    return readLimited(
      new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      ),
    )
  }
  return new TextDecoder().decode(bytes)
}
function loadDocument(
  url: string,
  callerSignal: AbortSignal,
): Promise<ParsedGuide> {
  const existing = cache.get(url)
  if (existing && existing.until > Date.now()) return existing.data
  const data = limited(async () => {
    if (callerSignal.aborted) throw new DOMException("Canceled", "AbortError")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 18000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok)
        throw new Error(`Programme source returned HTTP ${response.status}`)
      return parseXmltv(await readLimited(response), url)
    } finally {
      clearTimeout(timeout)
    }
  })
  cache.set(url, { until: Date.now() + CACHE_MS, data })
  // Keep failed responses briefly, rather than hammering a CORS-blocked host from every card.
  void data.catch((reason) => {
    if (cache.get(url)?.data === data) {
      if ((reason as Error).name === "AbortError") cache.delete(url)
      else cache.set(url, { until: Date.now() + 60000, data })
    }
  })
  if (cache.size > 16) cache.delete(cache.keys().next().value!)
  return data
}
function candidates(channel: Channel) {
  const list: {
    guide: GuideSource
    url: string
  }[] = []
  for (const guide of channel.guides) {
    for (const source of guide.sources ?? []) {
      if (
        source.url.startsWith("https://") &&
        /xml|gz/i.test(source.format ?? source.url)
      )
        list.push({ guide, url: source.url })
    }
  }
  return list.slice(0, 8)
}
async function getProgrammes(
  channel: Channel,
  signal: AbortSignal,
): Promise<GuideResult> {
  const sources = candidates(channel)
  if (!sources.length)
    return {
      programmes: [],
      error: "No programme guide source is published for this channel.",
    }
  let reachedSource = false
  for (const { guide, url } of sources) {
    if (signal.aborted) throw new DOMException("Canceled", "AbortError")
    try {
      const parsed = await loadDocument(url, signal)
      reachedSource = true
      const unambiguous = (name: string) => {
        const ids = parsed.names.get(normal(name)) ?? []
        return ids.length === 1 ? ids : []
      }
      const ids = [
        ...new Set([
          guide.feed ? `${channel.id}@${guide.feed}` : channel.id,
          channel.id,
          guide.site_id,
          ...unambiguous(guide.site_name),
          ...unambiguous(channel.name),
        ]),
      ]
      for (const id of ids) {
        const programmes = parsed.programmes
          .get(id)
          ?.filter((item) => item.end > Date.now())
        if (programmes?.length) return { programmes, sourceUrl: url, error: "" }
      }
    } catch (reason) {
      if (signal.aborted) throw reason
    }
  }
  return {
    programmes: [],
    error: reachedSource
      ? "The published guide has no current or upcoming schedule for this channel."
      : "The programme guide could not be loaded. Its host may be offline or block browser access.",
  }
}
export function useProgrammes(channel: Channel | null, enabled = true) {
  const [result, setResult] = useState<GuideResult>({
    programmes: [],
    error: "",
  })
  const [loading, setLoading] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])
  const refreshBucket = Math.floor(now / CACHE_MS)
  useEffect(() => {
    const controller = new AbortController()
    if (!channel || !enabled) {
      setLoading(false)
      setResult({ programmes: [], error: "" })
      return () => controller.abort()
    }
    setLoading(true)
    setResult({ programmes: [], error: "" })
    const timeout = setTimeout(() => {
      setResult({
        programmes: [],
        error: "The programme guide request timed out. Try again.",
      })
      setLoading(false)
      controller.abort()
    }, 30000)
    void getProgrammes(channel, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResult(value)
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ programmes: [], error: "Programme guide unavailable." })
      })
      .finally(() => {
        clearTimeout(timeout)
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [channel, enabled, retryKey, refreshBucket])
  const current = useMemo(
    () =>
      result.programmes
        .filter((item) => item.start <= now && item.end > now)
        .at(-1),
    [result.programmes, now],
  )
  const next = useMemo(
    () => result.programmes.find((item) => item.start > now),
    [result.programmes, now],
  )
  return {
    ...result,
    current,
    next,
    loading,
    retry: () => {
      if (channel) for (const { url } of candidates(channel)) cache.delete(url)
      setRetryKey((value) => value + 1)
    },
  }
}
