// Development-only browser fixture; not imported by the production entrypoint.
// Uses real canvas video, MediaRecorder, captureStream and decoded saved output.
import { useEffect, useState } from "react"
import {
  RecordingProvider,
  RecordButton,
  RecordingLibrary,
  useRecording,
} from "../src/recording"
import "../src/index.css"

const nativeCapture = (HTMLVideoElement.prototype as HTMLVideoElement & {
  captureStream?: () => MediaStream
}).captureStream
if (new URLSearchParams(location.search).has("fallback")) {
  Object.defineProperty(HTMLVideoElement.prototype, "captureStream", { value: undefined, configurable: true })
  Object.defineProperty(HTMLVideoElement.prototype, "mozCaptureStream", { value: undefined, configurable: true })
}

function Fixture() {
  const [url, setUrl] = useState("")
  const [preparing, setPreparing] = useState(false)
  const [result, setResult] = useState("")
  const { saved } = useRecording()
  useEffect(() => {
    if (!saved.length) return
    const video = document.createElement("video")
    video.muted = true
    video.onloadeddata = () => {
      video.play().catch(() => setResult("FAIL: playback blocked"))
    }
    video.onplaying = async () => {
      const bytes = await (await fetch(saved[0].url)).arrayBuffer()
      const captured = nativeCapture?.call(video)
      const audio = new AudioContext()
      try {
        const decoded = await audio.decodeAudioData(bytes.slice(0))
        let peak = 0
        for (const sample of decoded.getChannelData(0)) peak = Math.max(peak, Math.abs(sample))
        setResult(
          `${peak > 0.01 ? "PASS" : "FAIL"}: saved video plays at ${video.videoWidth}×${video.videoHeight}; ${bytes.byteLength} bytes; audio peak ${peak.toFixed(3)}`,
        )
      } catch {
        setResult("FAIL: saved recording audio could not be decoded")
      } finally {
        captured?.getTracks().forEach((track) => track.stop())
        void audio.close()
      }
    }
    video.onerror = () => setResult("FAIL: recorded video does not decode")
    video.src = saved[0].url
    return () => {
      video.removeAttribute("src")
      video.load()
    }
  }, [saved])
  async function prepare() {
    setPreparing(true)
    const canvas = document.createElement("canvas")
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext("2d")!
    const stream = canvas.captureStream(12)
    const audio = new AudioContext()
    await audio.resume()
    const oscillator = audio.createOscillator()
    const destination = audio.createMediaStreamDestination()
    oscillator.connect(destination)
    oscillator.start()
    destination.stream
      .getAudioTracks()
      .forEach((track) => stream.addTrack(track))
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    recorder.onstop = () => {
      setUrl(URL.createObjectURL(new Blob(chunks, { type: "video/webm" })))
      setPreparing(false)
      stream.getTracks().forEach((t) => t.stop())
      oscillator.stop()
      void audio.close()
    }
    let frame = 0
    const paint = setInterval(() => {
      ctx.fillStyle = frame++ % 2 ? "#ff4655" : "#101112"
      ctx.fillRect(0, 0, 320, 180)
      ctx.fillStyle = "white"
      ctx.font = "24px sans-serif"
      ctx.fillText(`Broadcast frame ${frame}`, 20, 100)
    }, 80)
    recorder.start()
    setTimeout(() => {
      clearInterval(paint)
      recorder.stop()
    }, 6000)
  }
  return (
    <main style={{ padding: 24 }}>
      <button
        className="record-button"
        disabled={preparing || !!url}
        onClick={prepare}
      >
        {preparing ? "Preparing…" : "Prepare test broadcast"}
      </button>
      {url && (
        <RecordButton
          channel={{
            id: "fixture",
            name: "Local test broadcast",
            streams: [{ url }],
          }}
        />
      )}
      <output style={{ display: "block", padding: 16 }}>{result}</output>
      <RecordingLibrary />
    </main>
  )
}
export default function RecordingFixture() {
  return <RecordingProvider><Fixture /></RecordingProvider>
}
