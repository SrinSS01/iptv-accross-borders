import type { FFmpeg } from "@ffmpeg/ffmpeg"
import {
  buildLocalPlaylist, chooseVariant, MAX_RECORDING_BYTES, MAX_RESOURCE_BYTES,
  parsePlaylist, resourceIdentity, pendingSegments, UnsupportedHlsError,
  type ByteRange, type HlsPlaylist, type HlsSegment,
} from "./hls-policy"

export type RecordingPart = { blob: Blob; extension: "mp4" | "mkv"; part: number }
type StoredSegment = HlsSegment & { file: string; mapFile?: string }
type Track = { url: string; kind: "video" | "audio"; playlist: HlsPlaylist; stored: StoredSegment[]; lastSequence?: number; ended: boolean; initial: boolean }

function abortError() { return new DOMException("Recording canceled", "AbortError") }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Recording failed." }
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    const done = () => { signal.removeEventListener("abort", canceled); resolve() }
    const timer = setTimeout(done, ms)
    const canceled = () => { clearTimeout(timer); signal.removeEventListener("abort", canceled); reject(abortError()) }
    signal.addEventListener("abort", canceled, { once: true })
  })
}

export class HlsRecorder {
  private ffmpeg: FFmpeg | null = null
  private tracks: Track[] = []
  private files = new Map<string, Uint8Array>()
  private maps = new Map<string, string>()
  private collection = new AbortController()
  private lifetime = new AbortController()
  private stopReason = ""
  private stopped = false
  private disposed = false
  private fileSequence = 0
  private bytes = 0
  private rootUrl: string
  constructor(url: string) { this.rootUrl = url }
  get byteLength() { return this.bytes }

  private async read(url: string, range?: ByteRange, manifest = false): Promise<Uint8Array> {
    const parsed = new URL(url, location.href)
    if (parsed.origin !== location.origin || !parsed.pathname.startsWith("/api/streams/"))
      throw new Error("Recording requires a same-origin stream proxy URL.")
    const timeout = AbortSignal.timeout(20000)
    const signal = AbortSignal.any([this.collection.signal, this.lifetime.signal, timeout])
    const response = await fetch(parsed, { signal, cache: "no-store", headers: range ? { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` } : undefined })
    if (!response.ok) {
      let detail = ""
      if (response.headers.get("content-type")?.includes("application/json")) {
        const error = await response.json().catch(() => null)
        if (typeof error?.error === "string") detail = ` ${error.error}`
      }
      throw new Error(`Stream request failed (${response.status}).${detail}`)
    }
    if (range) {
      const contentRange = response.headers.get("content-range")
      const match = contentRange?.match(/^bytes (\d+)-(\d+)\/(?:\d+|\*)$/)
      if (response.status !== 206 || !match || Number(match[1]) !== range.offset || Number(match[2]) !== range.offset + range.length - 1) {
        await response.body?.cancel()
        throw new Error("The broadcaster did not honor a required byte-range request.")
      }
    }
    const limit = manifest ? 2 * 1024 * 1024 : Math.min(MAX_RESOURCE_BYTES, MAX_RECORDING_BYTES - this.bytes)
    const declared = Number(response.headers.get("content-length"))
    if (declared > limit) { await response.body?.cancel(); throw new Error("The recording size limit was reached. Complete segments will be saved.") }
    const reader = response.body?.getReader()
    if (!reader) throw new Error("The stream response was empty.")
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) throw new Error("The recording size limit was reached. Complete segments will be saved.")
        chunks.push(value)
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error }
    if (range && size !== range.length) throw new Error("A media byte range was incomplete.")
    const output = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
    return output
  }
  private async playlist(url: string) {
    return parsePlaylist(new TextDecoder().decode(await this.read(url, undefined, true)), url)
  }
  private async resolveTracks() {
    let url = new URL(this.rootUrl, location.href).href
    let playlist = await this.playlist(url)
    let audioUrl: string | undefined
    for (let depth = 0; playlist.variants.length; depth++) {
      if (depth >= 3) throw new UnsupportedHlsError("This stream has too many nested playlists.")
      const variant = chooseVariant(playlist.variants)
      const group = variant.audio ? playlist.audioGroups[variant.audio] : undefined
      if (group?.length) {
        const audio = group.find((track) => track.default) ?? group.find((track) => track.autoselect) ?? group[0]
        audioUrl = audio.uri
      }
      url = variant.uri
      playlist = await this.playlist(url)
    }
    const tracks: Track[] = [{ url, playlist, kind: "video", stored: [], ended: false, initial: true }]
    if (audioUrl) {
      const audio = await this.playlist(audioUrl)
      if (audio.variants.length) throw new UnsupportedHlsError("Nested audio variants are not supported by segment recording.")
      tracks.push({ url: audioUrl, playlist: audio, kind: "audio", stored: [], ended: false, initial: true })
    }
    return tracks
  }
  private async load() {
    if (this.disposed) throw abortError()
    const { FFmpeg } = await import("@ffmpeg/ffmpeg")
    if (this.disposed) throw abortError()
    const ffmpeg = new FFmpeg()
    this.ffmpeg = ffmpeg
    let timeout: ReturnType<typeof setTimeout> | undefined
    const canceled = () => ffmpeg.terminate()
    this.lifetime.signal.addEventListener("abort", canceled, { once: true })
    try {
      await Promise.race([
        ffmpeg.load({ classWorkerURL: new URL("/ffmpeg/worker/worker.js", location.origin).href, coreURL: new URL("/ffmpeg/ffmpeg-core.js", location.origin).href, wasmURL: new URL("/ffmpeg/ffmpeg-core.wasm", location.origin).href }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { ffmpeg.terminate(); reject(new Error("Recording tools took too long to load. Check your connection and try again.")) }, 60000) }),
      ])
      if (this.disposed) throw abortError()
    } catch (error) {
      ffmpeg.terminate()
      if (this.ffmpeg === ffmpeg) this.ffmpeg = null
      throw error
    } finally {
      clearTimeout(timeout)
      this.lifetime.signal.removeEventListener("abort", canceled)
    }
  }
  async prepare() {
    // Validate the source before paying the WASM download/memory cost.
    await this.resolveTracks()
    await this.load()
  }
  async collect(onBytes: (bytes: number) => void): Promise<string> {
    try {
      // Refresh signed URLs at the actual start, including for future schedules.
      this.tracks = await this.resolveTracks()
      while (!this.stopped) {
        // Collect one complete segment from the least-advanced track per round.
        // This avoids consuming the entire video budget before separate audio.
        const available = this.tracks.map((track) => ({ track,
          segments: pendingSegments(track.playlist, track.lastSequence, track.initial),
          duration: track.stored.reduce((sum, segment) => sum + segment.duration, 0),
        }))
        for (const item of available) item.track.ended = item.track.playlist.endList && !item.segments.length
        const next = available.filter((item) => item.segments.length).sort((a, b) => a.duration - b.duration)[0]
        if (next) {
            const { track } = next
            const segment = next.segments[0]
            track.initial = false
            const key = segment.map ? `${track.kind}:${segment.timeline}:${resourceIdentity(segment.map.uri, segment.map.range)}` : ""
            let mapFile: string | undefined
            if (segment.map) {
              // One initialization map per discontinuity epoch; HLS requires a discontinuity for codec changes.
              mapFile = this.maps.get(key)
              if (!mapFile) {
                const data = await this.read(segment.map.uri, segment.map.range)
                mapFile = `init-${++this.fileSequence}.mp4`
                this.files.set(mapFile, data)
                this.maps.set(key, mapFile)
                this.bytes += data.byteLength
              }
            }
            const data = await this.read(segment.uri, segment.range)
            const file = `segment-${++this.fileSequence}.${mapFile ? "m4s" : "ts"}`
            this.files.set(file, data)
            this.bytes += data.byteLength
            track.stored.push({ ...segment, file, mapFile })
            track.lastSequence = segment.sequence
            onBytes(this.bytes)
            if (this.bytes >= MAX_RECORDING_BYTES) this.stop("The 128 MB source-data limit was reached. Complete segments will be saved.")
            continue
        }
        if (this.tracks.every((track) => track.ended)) break
        await delay(Math.max(500, Math.min(...this.tracks.map((track) => track.playlist.targetDuration)) * 500), this.collection.signal)
        for (const track of this.tracks) if (!track.ended) track.playlist = await this.playlist(track.url)
      }
    } catch (error) {
      if (!this.stopped && !this.disposed) this.stopReason = errorMessage(error)
    }
    if (this.disposed) throw abortError()
    if (!this.tracks.some((track) => track.kind === "video" && track.stored.length))
      throw new Error(this.stopReason || "No complete video segment was captured. Record for longer and try again.")
    return this.stopReason
  }
  stop(reason = "") {
    if (this.stopped) return
    this.stopReason = reason
    this.stopped = true
    this.collection.abort()
  }
  async finalize(): Promise<RecordingPart[]> {
    if (this.disposed) throw abortError()
    if (!this.ffmpeg) await this.load()
    const ffmpeg = this.ffmpeg!
    const video = this.tracks.find((track) => track.kind === "video")!
    const audio = this.tracks.find((track) => track.kind === "audio")
    const timelines = [...new Set(video.stored.map((segment) => segment.timeline))]
    const output: RecordingPart[] = []
    const written: string[] = []
    try {
      for (const [part, timeline] of timelines.entries()) {
        const videoSegments = video.stored.filter((segment) => segment.timeline === timeline)
        const audioSegments = audio?.stored.filter((segment) => segment.timeline === timeline)
        if (audio && !audioSegments?.length) throw new Error("The matching audio segment has not been captured; a silent recording will not be produced.")
        for (const segment of [...videoSegments, ...(audioSegments ?? [])]) {
          for (const name of [segment.mapFile, segment.file]) {
            if (!name || written.includes(name)) continue
            // FFmpeg transfers buffers to its worker. Keep the source copy for retry.
            await ffmpeg.writeFile(name, this.files.get(name)!.slice())
            written.push(name)
          }
        }
        const videoList = `video-${part}.m3u8`
        await ffmpeg.writeFile(videoList, buildLocalPlaylist(videoSegments)); written.push(videoList)
        const inputs = ["-protocol_whitelist", "file,crypto,data", "-allowed_extensions", "ALL", "-i", videoList]
        if (audioSegments?.length) {
          const audioList = `audio-${part}.m3u8`
          await ffmpeg.writeFile(audioList, buildLocalPlaylist(audioSegments)); written.push(audioList)
          inputs.push("-protocol_whitelist", "file,crypto,data", "-allowed_extensions", "ALL", "-i", audioList)
        }
        const maps = audio ? ["-map", "0:v:0", "-map", "1:a:0"] : ["-map", "0:v:0", "-map", "0:a?"]
        const base = ["-hide_banner", "-y", ...inputs, ...maps, "-c", "copy", "-avoid_negative_ts", "make_zero", ...(audio ? ["-shortest"] : [])]
        let extension: "mp4" | "mkv" = "mp4"
        let name = `recording-${part}.mp4`
        written.push(name)
        let status = await ffmpeg.exec([...base, "-movflags", "+faststart", name], 120000)
        if (status !== 0) {
          extension = "mkv"; name = `recording-${part}.mkv`; written.push(name)
          status = await ffmpeg.exec([...base, name], 120000)
        }
        if (status !== 0) throw new Error("The recording could not be finalized. Your source segments are retained; retry or discard the recording.")
        const bytes = await ffmpeg.readFile(name)
        if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error("FFmpeg produced an empty recording. Retry finalization or discard it.")
        output.push({ blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: extension === "mp4" ? "video/mp4" : "video/x-matroska" }), extension, part: part + 1 })
        // Release each part's worker files before processing the next discontinuity.
        for (const file of written.splice(0)) await ffmpeg.deleteFile(file).catch(() => {})
      }
      return output
    } catch (error) {
      // A failed/terminated core may be unusable. Retry starts a fresh worker with retained input.
      ffmpeg.terminate()
      if (this.ffmpeg === ffmpeg) this.ffmpeg = null
      throw error
    } finally {
      if (this.ffmpeg === ffmpeg) for (const file of written) await ffmpeg.deleteFile(file).catch(() => {})
    }
  }
  dispose() {
    this.disposed = true
    this.lifetime.abort()
    this.collection.abort()
    this.ffmpeg?.terminate()
    this.ffmpeg = null
    this.files.clear()
    this.maps.clear()
    this.tracks = []
    this.bytes = 0
  }
}
