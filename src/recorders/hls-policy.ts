import { Parser } from "m3u8-parser"

export const MAX_RECORDING_BYTES = 128 * 1024 * 1024
export const MAX_RESOURCE_BYTES = 32 * 1024 * 1024
export type ByteRange = { offset: number; length: number }
export type HlsSegment = {
  uri: string
  sequence: number
  duration: number
  timeline: number
  range?: ByteRange
  map?: { uri: string; range?: ByteRange }
  programDateTime?: number
}
export type HlsPlaylist = {
  variants: { uri: string; height: number; bandwidth: number; audio?: string }[]
  audioGroups: Record<string, { uri?: string; default?: boolean; autoselect?: boolean }[]>
  segments: HlsSegment[]
  targetDuration: number
  endList: boolean
  mediaSequence: number
}
export class UnsupportedHlsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsupportedHlsError"
  }
}
export function parsePlaylist(text: string, base: string): HlsPlaylist {
  if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("The stream did not return an HLS playlist.")
  if (/#EXT-X-(?:SESSION-KEY|DEFINE|SKIP|I-FRAMES-ONLY)[:\r\n]/.test(text))
    throw new UnsupportedHlsError("This HLS playlist uses features not supported by segment recording. Try browser capture.")
  const parser = new Parser()
  parser.push(text)
  parser.end()
  const manifest = parser.manifest
  const absolute = (uri: string) => new URL(uri, base).href
  const segments: HlsSegment[] = []
  let previousUri: string | undefined, nextOffset = 0
  let previousMapUri: string | undefined, nextMapOffset = 0
  let lastMap: HlsSegment["map"]
  for (const [index, segment] of (manifest.segments ?? []).entries()) {
    if (segment.key && segment.key.method !== "NONE")
      throw new UnsupportedHlsError("This stream is encrypted. Segment recording cannot record it; browser capture may also be restricted.")
    if (!segment.uri || !Number.isFinite(segment.duration) || segment.duration <= 0)
      throw new UnsupportedHlsError("This playlist contains incomplete or invalid media segments.")
    if ((segment as unknown as { gap?: boolean }).gap)
      throw new UnsupportedHlsError("This playlist contains missing media segments. Try another stream.")
    const uri = absolute(segment.uri)
    let range: ByteRange | undefined
    if (segment.byterange) {
      const length = segment.byterange.length
      const offset = segment.byterange.offset ?? (previousUri === uri ? nextOffset : NaN)
      if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(offset) || offset < 0)
        throw new UnsupportedHlsError("The stream contains an invalid byte range.")
      range = { offset, length }
      nextOffset = offset + length
    }
    previousUri = uri
    let map: HlsSegment["map"]
    if (segment.map) {
      const mapUri = absolute(segment.map.uri)
      let mapRange: ByteRange | undefined
      if (segment.map.byterange) {
        const length = segment.map.byterange.length
        // The same init tag is carried on every parser segment; do not advance it twice.
        const offset = segment.map.byterange.offset ?? (lastMap?.uri === mapUri ? lastMap.range?.offset : previousMapUri === mapUri ? nextMapOffset : 0)
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length <= 0 || offset! < 0)
          throw new UnsupportedHlsError("The stream contains an invalid initialization range.")
        mapRange = { offset: offset!, length }
        nextMapOffset = offset! + length
      }
      previousMapUri = mapUri
      map = { uri: mapUri, range: mapRange }
      lastMap = map
    }
    const date = (segment as unknown as { dateTimeObject?: Date }).dateTimeObject
    segments.push({ uri, sequence: (manifest.mediaSequence ?? 0) + index,
      duration: segment.duration, timeline: segment.timeline ?? manifest.discontinuitySequence ?? 0,
      range, map, programDateTime: date?.getTime() })
  }
  if (!manifest.playlists?.length && !segments.length)
    throw new UnsupportedHlsError("No complete media segments are available yet. Try recording again shortly.")
  const audioGroups: HlsPlaylist["audioGroups"] = {}
  for (const [group, tracks] of Object.entries(manifest.mediaGroups?.AUDIO ?? {})) {
    audioGroups[group] = Object.values(tracks).map((track) => ({
      uri: track.uri ? absolute(track.uri) : undefined,
      default: track.default, autoselect: track.autoselect,
    }))
  }
  return {
    variants: (manifest.playlists ?? []).map((variant) => ({
      uri: absolute(variant.uri), height: variant.attributes.RESOLUTION?.height ?? 0,
      bandwidth: variant.attributes.BANDWIDTH ?? 0, audio: variant.attributes.AUDIO,
    })), audioGroups, segments, targetDuration: Math.max(1, manifest.targetDuration ?? 6),
    endList: !!manifest.endList, mediaSequence: manifest.mediaSequence ?? 0,
  }
}
export function chooseVariant(variants: HlsPlaylist["variants"]) {
  const bounded = variants.filter((variant) => variant.height > 0 && variant.height <= 720)
  if (bounded.length) return [...bounded].sort((a,b) => b.height - a.height || b.bandwidth - a.bandwidth)[0]
  return [...variants].sort((a,b) => a.bandwidth - b.bandwidth)[0]
}
export function segmentIdentity(segment: HlsSegment) {
  // Proxy URL signatures change when a playlist is refreshed; sequence is the stable identity.
  return `${segment.timeline}:${segment.sequence}`
}
export function resourceIdentity(uri: string, range?: ByteRange) {
  // Only used for de-duplication, never authorization. Signed URLs are refreshed
  // each playlist request; the embedded upstream URL is stable across signatures.
  let identity = uri
  try {
    const token = new URL(uri).searchParams.get("token")
    if (token) {
      const encoded = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")
      const grant = JSON.parse(atob(encoded))
      if (typeof grant.url === "string") identity = grant.url
    }
  } catch { /* Ordinary fixture URLs and unknown tokens keep their full identity. */ }
  return `${identity}|${range?.offset ?? ""}:${range?.length ?? ""}`
}
export function buildLocalPlaylist(segments: { duration: number; file: string; mapFile?: string }[]) {
  const maxDuration = Math.ceil(Math.max(1, ...segments.map((segment) => segment.duration)))
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", `#EXT-X-TARGETDURATION:${maxDuration}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD"]
  let previousMap: string | undefined
  for (const segment of segments) {
    if (segment.mapFile && segment.mapFile !== previousMap) {
      lines.push(`#EXT-X-MAP:URI="${segment.mapFile}"`)
      previousMap = segment.mapFile
    }
    lines.push(`#EXTINF:${segment.duration.toFixed(6)},`, segment.file)
  }
  lines.push("#EXT-X-ENDLIST")
  return lines.join("\n") + "\n"
}

export function pendingSegments(playlist: HlsPlaylist, lastSequence: number | undefined, initial: boolean): HlsSegment[] {
  const all = playlist.segments
  if (lastSequence !== undefined) {
    if (all[0]?.sequence > lastSequence + 1)
      throw new Error("The stream advanced past a missing segment. The captured portion will be saved.")
    if (all.length && all[all.length - 1].sequence < lastSequence)
      throw new Error("The stream sequence restarted. The captured portion will be saved.")
    return all.filter((segment) => segment.sequence > lastSequence)
  }
  return initial && !playlist.endList ? all.slice(-1) : all
}
