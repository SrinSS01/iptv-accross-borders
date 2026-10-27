type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

export function hasDirectCapture() {
  const video = document.createElement("video") as CapturableVideo
  return typeof video.captureStream === "function" || typeof video.mozCaptureStream === "function"
}

export function canCaptureStream() {
  return typeof MediaRecorder !== "undefined" && (hasDirectCapture() || (
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    typeof AudioContext !== "undefined"
  ))
}

// Resume in the submit gesture, before playback/network awaits consume activation.
export function prepareCaptureAudio(): AudioContext | null {
  if (hasDirectCapture()) return null
  const audio = new AudioContext()
  void audio.resume().catch(() => {})
  return audio
}

export function captureVideo(
  video: CapturableVideo,
  audio: AudioContext | null,
  onError: (message: string) => void,
): { stream: MediaStream; dispose: () => void } {
  const direct = video.captureStream || video.mozCaptureStream
  if (direct) {
    const stream = direct.call(video)
    return { stream, dispose: () => stream.getTracks().forEach((track) => track.stop()) }
  }
  if (!audio || audio.state !== "running")
    throw new Error("Audio capture could not start. Keep this tab active and start the recording again.")
  const canvas = document.createElement("canvas")
  // Bound encoding work on phones, maintaining the source aspect ratio.
  const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight)
  canvas.width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2)
  canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("This browser cannot prepare video frames for recording.")
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  // Fail explicitly for a tainted canvas instead of producing an empty recording.
  context.getImageData(0, 0, 1, 1)
  const stream = canvas.captureStream(24)
  let source: MediaElementAudioSourceNode | undefined
  let destination: MediaStreamAudioDestinationNode | undefined
  let frame = 0
  let disposed = false
  const dispose = () => {
    disposed = true
    cancelAnimationFrame(frame)
    stream.getTracks().forEach((track) => track.stop())
    source?.disconnect()
    destination?.disconnect()
  }
  try {
    source = audio.createMediaElementSource(video)
    destination = audio.createMediaStreamDestination()
    // Route audio to the recorder only, avoiding duplicate playback through speakers.
    source.connect(destination)
    video.muted = false
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track))
    let previous = 0
    const draw = (now: number) => {
      if (disposed) return
      try {
        if (now - previous >= 1000 / 24 && video.readyState >= 2) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          previous = now
        }
        frame = requestAnimationFrame(draw)
      } catch {
        onError("The stream stopped allowing video capture. Any captured video is available below.")
      }
    }
    frame = requestAnimationFrame(draw)
    return { stream, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
