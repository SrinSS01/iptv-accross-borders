import Hls from "hls.js"
import { useEffect, useRef, useState } from "react"
import type { Channel } from "./catalog"

type Frame = { url: string; captured: number }
const cache = new Map<string, Frame>()
let active = 0
const pending: Array<() => void> = []
function acquire(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const run = () => {
      signal.removeEventListener("abort", cancel)
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return }
      active++
      let released = false
      resolve(() => { if (released) return; released = true; active--; pending.shift()?.() })
    }
    const cancel = () => { const index = pending.indexOf(run); if (index >= 0) pending.splice(index, 1); reject(new DOMException("Aborted", "AbortError")) }
    if (signal.aborted) { cancel(); return }
    if (active < 3) run()
    else { pending.push(run); signal.addEventListener("abort", cancel, { once: true }) }
  })
}
async function capture(url: string, signal: AbortSignal): Promise<string> {
  const release = await acquire(signal)
  try {
    return await new Promise<string>((resolve, reject) => {
      const video = document.createElement("video")
      video.muted = true; video.playsInline = true; video.crossOrigin = "anonymous"
      let hls: Hls | undefined
      let settled = false
      const finish = (image?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal.removeEventListener("abort", abort)
        video.onloadeddata = null; video.onplaying = null; video.onerror = null
        hls?.destroy(); video.pause(); video.removeAttribute("src"); video.load()
        if (image) resolve(image); else reject(new Error("Stream frame unavailable"))
      }
      const abort = () => finish()
      const timeout = setTimeout(() => finish(), 10000)
      const frame = () => {
        if (!video.videoWidth || video.readyState < 2) return
        try {
          const canvas = document.createElement("canvas")
          canvas.width = 480; canvas.height = Math.round(480 * video.videoHeight / video.videoWidth)
          canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height)
          finish(canvas.toDataURL("image/jpeg", .75))
        } catch { finish() }
      }
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) { finish(); return }
      video.onloadeddata = frame; video.onplaying = frame; video.onerror = () => finish()
      const play = () => { void video.play().catch(() => { if (video.readyState >= 2) frame(); else finish() }) }
      if (Hls.isSupported() && url.includes(".m3u8")) {
        hls = new Hls({ enableWorker: true, maxBufferLength: 4, maxMaxBufferLength: 8, manifestLoadingMaxRetry: 0, levelLoadingMaxRetry: 0, fragLoadingMaxRetry: 0 })
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) finish() })
        hls.on(Hls.Events.MANIFEST_PARSED, play)
        hls.loadSource(url); hls.attachMedia(video)
      } else { video.src = url; play() }
    })
  } finally { release() }
}

export default function LiveThumbnail({ channel, onLoaded }: { channel: Channel; onLoaded: () => void }) {
  const element = useRef<HTMLDivElement>(null)
  const callback = useRef(onLoaded)
  callback.current = onLoaded
  const [frame, setFrame] = useState<Frame | undefined>(() => cache.get(channel.id))
  const [status, setStatus] = useState("Waiting for live preview")
  useEffect(() => {
    const controller = new AbortController()
    const cached = cache.get(channel.id)
    if (cached && Date.now() - cached.captured < 300000) { setFrame(cached); callback.current(); return }
    let started = false
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || started) return
      started = true; observer.disconnect(); setStatus("Loading live preview")
      void (async () => {
        for (const stream of channel.streams.slice(0, 2)) {
          if (controller.signal.aborted) return
          try {
            const url = await capture(stream.url, controller.signal)
            if (controller.signal.aborted) return
            const result = { url, captured: Date.now() }
            cache.set(channel.id, result)
            if (cache.size > 100) cache.delete(cache.keys().next().value!)
            setFrame(result); callback.current(); return
          } catch { /* Try the next real broadcaster source. */ }
        }
        if (!controller.signal.aborted) setStatus("Live preview unavailable")
      })()
    })
    if (element.current) observer.observe(element.current)
    return () => { observer.disconnect(); controller.abort() }
  }, [channel.id, channel.streams])
  return <div ref={element} className="live-thumbnail">
    {frame ? <><img src={frame.url} alt={`Stream snapshot of ${channel.name}`} /><span className="snapshot-label">Stream snapshot · {new Date(frame.captured).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></> : status === "Live preview unavailable" ? <div className="no-programme-art"><span>{status}</span></div> : <><div className="media-skeleton" /><span className="snapshot-label">{status}</span></>}
  </div>
}
