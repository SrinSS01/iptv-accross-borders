import { useEffect, useRef, useState } from "react"
import Hls from "hls.js"
import type { Channel } from "./catalog"
import { getStreamUrl } from "./stream-url"

/** Decorative live video; never competes with the foreground player for audio. */
export default function HeroStream({
  channel,
  suspended,
}: {
  channel: Channel
  suspended: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HTMLCanvasElement>(null)
  const [hasFrame, setHasFrame] = useState(false)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [sourceIndex, setSourceIndex] = useState(0)
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener("change", update)
    const video = videoRef.current!
    let intersecting = false
    const sync = () => setVisible(intersecting && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting
      sync()
    })
    observer.observe(video)
    document.addEventListener("visibilitychange", sync)
    return () => {
      observer.disconnect()
      media.removeEventListener("change", update)
      document.removeEventListener("visibilitychange", sync)
    }
  }, [])
  useEffect(() => {
    setSourceIndex(0)
    setHasFrame(false)
  }, [channel.id])
  useEffect(() => {
    const video = videoRef.current!
    setPlaying(false)
    if (paused || reducedMotion || suspended || !visible) return
    const stream = channel.streams[sourceIndex]
    if (!stream) return
    let disposed = false
    let failed = false
    let hls: Hls | undefined
    const fail = () => {
      if (disposed || failed) return
      failed = true
      setPlaying(false)
      setSourceIndex((index) => index + 1)
    }
    const play = () => {
      if (!disposed) void video.play().catch((error: DOMException) => {
          if (disposed) return
          if (error.name === "NotAllowedError") setPaused(true)
          else if (error.name !== "AbortError") fail()
        })
    }
    const ready = () => setPlaying(true)
    video.muted = true
    video.addEventListener("playing", ready)
    video.addEventListener("error", fail)
    const source = getStreamUrl(channel.id, sourceIndex, stream.url)
    if (
      !video.canPlayType("application/vnd.apple.mpegurl") &&
      Hls.isSupported() &&
      source.includes(".m3u8")
    ) {
      hls = new Hls({
        capLevelToPlayerSize: true,
        startLevel: 0,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
      })
      hls.on(Hls.Events.MANIFEST_PARSED, play)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) fail()
      })
      hls.loadSource(source)
      hls.attachMedia(video)
    } else {
      video.src = source
      play()
    }
    return () => {
      disposed = true
      // Preserve the decoded frame before releasing the live connection.
      const canvas = frameRef.current
      if (canvas && video.readyState >= 2 && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const context = canvas.getContext("2d")
        if (context) {
          context.drawImage(video, 0, 0)
          setHasFrame(true)
        }
      }
      video.removeEventListener("playing", ready)
      video.removeEventListener("error", fail)
      hls?.destroy()
      video.pause()
      video.removeAttribute("src")
      video.load()
    }
  }, [channel, sourceIndex, paused, reducedMotion, suspended, visible])
  return (
    <>
      <div
        className="hero-stream pointer-events-none absolute inset-0"
        aria-hidden="true"
        data-playing={playing || hasFrame}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          disablePictureInPicture
          tabIndex={-1}
          className="size-full object-cover"
        />
        <canvas
          ref={frameRef}
          className="absolute inset-0 size-full object-cover"
          style={{ visibility: hasFrame && !playing ? "visible" : "hidden" }}
        />
        <div className="hero-stream-shade absolute inset-0" />
      </div>
      {!reducedMotion && sourceIndex < channel.streams.length && (
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className="absolute right-4 top-4 z-20 border border-white/20 bg-black/60 px-3 py-2 text-xs text-white/80 hover:bg-black/80"
          aria-label={
            paused ? "Resume background stream" : "Pause background stream"
          }
        >
          {paused ? "Resume background" : "Pause background"}
        </button>
      )}
    </>
  )
}
