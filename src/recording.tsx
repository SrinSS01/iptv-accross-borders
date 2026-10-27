import "./recording-updates.css"
import { scheduleAction, validateSchedule } from "./recording-policy"
import Hls from "hls.js"
import { canCaptureStream, prepareCaptureAudio, captureVideo } from "./stream-capture"
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

type RecordChannel = {
  id: string
  name: string
  streams: { url: string }[]
}
type Job = {
  channel: RecordChannel
  start: number
  end?: number
  state: "scheduled" | "connecting" | "recording" | "saving"
  bytes: number
}
type Saved = {
  channelId: string
  id: string
  name: string
  url: string
  size: number
  filename: string
  partial: boolean
}
type RecordingNavigation = {
  id: string
  sequence: number
}
const RecordingContext = createContext<{
  open: (channel: RecordChannel) => void
  job: Job | null
  saved: Saved[]
  stop: () => void
  message: string
  remove: (id: string) => void
  viewSaved: (id: string) => void
  navigateRequest: RecordingNavigation | null
  highlightedId: string | null
} | null>(null)
export function useRecording() {
  return useContext(RecordingContext)!
}
const MAX_BYTES = 512 * 1024 * 1024

export function RecordingProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<RecordChannel | null>(null)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [error, setError] = useState("")
  const [job, setJob] = useState<Job | null>(null)
  const [saved, setSaved] = useState<Saved[]>([])
  const [message, setMessage] = useState("")
  const [navigateRequest, setNavigateRequest] =
    useState<RecordingNavigation | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const stopRef = useRef<() => void>(() => {})
  const urls = useRef<string[]>([])
  const captureAudio = useRef<AudioContext | null>(null)
  const jobRef = useRef(job)
  jobRef.current = job

  useEffect(() => {
    if (target) dialog.current?.showModal()
  }, [target])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (jobRef.current || urls.current.length) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", unload)
    return () => {
      window.removeEventListener("beforeunload", unload)
      urls.current.forEach(URL.revokeObjectURL)
    }
  }, [])

  // One independent media pipeline survives navigation and player dismissal.
  const identity = job ? `${job.channel.id}:${job.start}` : null
  useEffect(() => {
    const initial = jobRef.current
    if (!initial) return
    let disposed = false,
      started = false,
      finishing = false,
      partial = false
    let hls: Hls | null = null,
      recorder: MediaRecorder | null = null,
      capture: MediaStream | null = null
    let bytes = 0,
      sourceIndex = 0,
      attempt = 0
    let recorderStarted = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const chunks: Blob[] = []
    const audio = captureAudio.current
    let disposeCapture: (() => void) | undefined
    const video = document.createElement("video") as HTMLVideoElement & {
      captureStream?: () => MediaStream
      mozCaptureStream?: () => MediaStream
    }
    video.muted = true
    video.playsInline = true
    video.crossOrigin = "anonymous"
    const cleanupMedia = () => {
      clearTimeout(timeout)
      hls?.destroy()
      hls = null
      disposeCapture?.()
      capture?.getTracks().forEach((track) => track.stop())
      if (audio) audio.onstatechange = null
      if (audio && audio.state !== "closed") void audio.close().catch(() => {})
      if (captureAudio.current === audio) captureAudio.current = null
      video.pause()
      video.removeAttribute("src")
      video.load()
    }
    const finish = (reason = "") => {
      if (finishing || disposed) return
      finishing = true
      clearTimeout(timeout)
      clearInterval(timer)
      if (reason) {
        partial = true
        setMessage(reason)
      }
      if (recorder && recorderStarted) {
        setJob((current) => current && { ...current, state: "saving" })
        if (recorder.state !== "inactive") recorder.stop()
        // An inactive recorder after an error still dispatches final data and stop.
      } else {
        cleanupMedia()
        setJob(null)
        if (!reason)
          setMessage(
            started
              ? "Recording canceled before video was captured."
              : "Scheduled recording canceled.",
          )
      }
    }
    stopRef.current = () => finish()
    const fail = () => {
      if (disposed || finishing) return
      if (recorder) {
        finish(
          "The stream was interrupted. Any captured video is available below.",
        )
        return
      }
      if (++sourceIndex < initial.channel.streams.length) connect()
      else
        finish(
          "Could not record this channel. The stream may be offline or may block browser capture. Try another channel.",
        )
    }
    const record = () => {
      if (disposed || finishing || recorder) return
      clearTimeout(timeout)
      try {
        const captured = captureVideo(video, audio, finish)
        capture = captured.stream
        disposeCapture = captured.dispose
        if (!capture.getVideoTracks().length)
          throw new Error(
            "This stream does not expose a video track for recording. Try another channel.",
          )
        const mimeType = [
          "video/webm;codecs=vp8,opus",
          "video/webm",
          "video/mp4",
        ].find((type) => MediaRecorder.isTypeSupported(type))
        if (!mimeType)
          throw new Error(
            "No supported video recording format was found in this browser.",
          )
        recorder = new MediaRecorder(capture, { mimeType })
        recorder.ondataavailable = (event) => {
          if (!event.data.size || disposed) return
          chunks.push(event.data)
          bytes += event.data.size
          setJob((current) => current && { ...current, bytes })
          if (bytes >= MAX_BYTES)
            finish(
              "The 512 MB browser recording limit was reached. Save this recording, then start a new one.",
            )
        }
        recorder.onerror = () =>
          finish(
            "Recording encountered an error. Any captured video is available below.",
          )
        recorder.onstop = () => {
          if (disposed) return
          finishing = true
          clearInterval(timer)
          if (bytes > 0) {
            const blob = new Blob(chunks, { type: recorder!.mimeType })
            const url = URL.createObjectURL(blob)
            urls.current.push(url)
            const extension = blob.type.includes("mp4") ? "mp4" : "webm"
            const name = initial.channel.name.replace(/[^a-z0-9]+/gi, "-")
            const filename = `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`
            setSaved((current) => [
              {
                channelId: initial.channel.id,
                id: url,
                name: initial.channel.name,
                url,
                size: bytes,
                filename,
                partial,
              },
              ...current,
            ])
            if (!partial)
              setMessage(
                "Recording ready. Save the video before closing this tab.",
              )
          } else
            setMessage(
              "No video was captured. Try another channel or record for longer.",
            )
          cleanupMedia()
          setJob(null)
        }
        recorder.start(1000)
        recorderStarted = true
        setJob((current) => current && { ...current, state: "recording" })
        setMessage("")
      } catch (reason) {
        finish((reason as Error).name === "SecurityError"
          ? "This broadcaster blocks browser recording. Try another channel."
          : (reason as Error).message)
      }
    }
    function connect() {
      if (disposed || finishing) return
      const currentAttempt = ++attempt
      clearTimeout(timeout)
      hls?.destroy()
      hls = null
      const source = initial!.channel.streams[sourceIndex]?.url
      if (!source) {
        finish("No stream source is available for this channel.")
        return
      }
      timeout = setTimeout(fail, 20000)
      const play = () => video.play().catch((reason: DOMException) => {
          if (
            currentAttempt !== attempt ||
            disposed ||
            finishing ||
            reason.name === "AbortError"
          )
            return
          if (reason.name === "NotAllowedError")
            finish(
              "Playback was blocked by the browser. Start a new recording while this tab is active.",
            )
          else fail()
        })
      if (Hls.isSupported() && source.includes(".m3u8")) {
        hls = new Hls({ enableWorker: true })
        hls.loadSource(source)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, play)
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal && currentAttempt === attempt) fail()
        })
      } else {
        video.src = source
        play()
      }
    }
    video.onplaying = () => {
      clearTimeout(timeout)
      record()
    }
    video.onpause = () => {
      if (audio && recorderStarted && !finishing && !disposed)
        finish("The browser paused capture. Keep this tab active and start a new recording. Any captured video is available below.")
    }
    video.onerror = fail
    video.onended = () =>
      finish("The broadcast ended. Any captured video is available below.")
    video.onwaiting = () => {
      if (recorder && !finishing) {
        clearTimeout(timeout)
        timeout = setTimeout(
          () =>
            finish(
              "The stream stalled. Any captured video is available below.",
            ),
          30000,
        )
      }
    }
    const tick = () => {
      if (finishing || disposed) return
      const now = Date.now()
      const action = scheduleAction(initial.start, initial.end, now, started)
      if (action === "stop") {
        finish()
        return
      }
      if (action === "missed-window") {
        finish("The recording window was missed while this tab was inactive.")
        return
      }
      if (action === "missed-start") {
        finish(
          "The scheduled start was missed while this tab was inactive. Start a new recording.",
        )
        return
      }
      if (action === "start") {
        started = true
        setJob((current) => current && { ...current, state: "connecting" })
        connect()
      }
    }
    if (audio) audio.onstatechange = () => {
      if (audio.state !== "running" && recorderStarted && !finishing && !disposed)
        finish("Audio capture was interrupted by the browser. Any captured video is available below.")
    }
    // Canvas frames cannot reliably advance in a background mobile tab.
    const visibilityChanged = () => {
      if (audio && document.hidden && recorderStarted)
        finish("Recording stopped when this tab became inactive. Any captured video is available below.")
    }
    document.addEventListener("visibilitychange", visibilityChanged)
    const timer = setInterval(tick, 500)
    tick()
    return () => {
      disposed = true
      document.removeEventListener("visibilitychange", visibilityChanged)
      clearInterval(timer)
      clearTimeout(timeout)
      if (recorder && recorder.state !== "inactive") recorder.stop()
      cleanupMedia()
      stopRef.current = () => {}
    }
  }, [identity])

  const open = (channel: RecordChannel) => {
    setStart("")
    setEnd("")
    setError("")
    setTarget(channel)
  }
  const close = () => {
    dialog.current?.close()
    setTarget(null)
  }
  return (
    <RecordingContext.Provider
      value={{
        open,
        job,
        saved,
        stop: () => stopRef.current(),
        message,
        navigateRequest,
        highlightedId,
        viewSaved: (id) => {
          setHighlightedId(id)
          setNavigateRequest((current) => ({
            id,
            sequence: (current?.sequence ?? 0) + 1,
          }))
        },
        remove: (id) => {
          URL.revokeObjectURL(id)
          urls.current = urls.current.filter((url) => url !== id)
          setSaved((current) => current.filter((item) => item.id !== id))
          setHighlightedId((current) => (current === id ? null : current))
        },
      }}
    >
      {children}
      {target && (
        <dialog
          ref={dialog}
          className="record-dialog"
          onCancel={close}
          aria-labelledby="record-title"
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              if (job) return
              const now = Date.now()
              const schedule = validateSchedule(start, end, now)
              if ("error" in schedule) {
                setError(schedule.error!)
                document.getElementById(schedule.field!)?.focus()
                return
              }
              const { from, to } = schedule
              if (!canCaptureStream()) {
                setError("This browser does not support video recording. Update your browser or try another device.")
                return
              }
              try {
                captureAudio.current = prepareCaptureAudio()
              } catch {
                setError("Audio capture could not be initialized. Reload this page and try again.")
                return
              }
              setMessage("")
              setJob({
                channel: target,
                start: from,
                end: to,
                state: from > now ? "scheduled" : "connecting",
                bytes: 0,
              })
              close()
            }}
          >
            <div className="record-heading">
              <span className="eyebrow">LOCAL RECORDING</span>
              <button
                type="button"
                onClick={close}
                aria-label="Close recording setup"
              >
                ✕
              </button>
            </div>
            <h2 id="record-title">Record {target.name}</h2>
            <p className="muted">
              Save a live broadcast as a video you can keep.
            </p>
            {job ? (
              <p role="status" className="record-notice">
                A recording is already {job.state}. End or cancel it in
                Recordings before starting another.
              </p>
            ) : (
              <>
                <label htmlFor="record-start">
                  Start time <span>optional · defaults to now</span>
                </label>
                <input
                  id="record-start"
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  aria-describedby="record-error record-help"
                  aria-invalid={!!error}
                />
                <label htmlFor="record-end">
                  End time <span>optional · stop manually anytime</span>
                </label>
                <input
                  id="record-end"
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  aria-describedby="record-error record-help"
                  aria-invalid={!!error}
                />
                <p id="record-help" className="record-notice">
                  Times use your device’s timezone (
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}). Keep this
                  tab visible and your device awake. Recordings stay in this
                  session until you save them. Maximum 512 MB per recording.
                </p>
                <p id="record-error" role="alert" className="record-error">
                  {error}
                </p>
                <button className="primary-action" type="submit">
                  {start ? "Schedule recording" : "Start recording"}{" "}
                  <RecordActionIcon state={start ? "schedule" : "start"} />
                </button>
              </>
            )}
          </form>
        </dialog>
      )}
    </RecordingContext.Provider>
  )
}

export function RecordActionIcon({
  state,
}: {
  state: "start" | "schedule" | "scheduled" | "connecting" | "recording" | "saving" | "saved"
}) {
  if (state === "saving")
    return <span className="record-saving-icon" aria-hidden="true" />
  return (
    <svg
      className="record-action-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {state === "start" ? (
        <>
          <circle cx="10" cy="10" r="7" />
          <circle cx="10" cy="10" r="3" fill="currentColor" stroke="none" />
        </>
      ) : state === "schedule" ? (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 5v5l3 2" />
        </>
      ) : state === "recording" ? (
        <rect
          x="4"
          y="4"
          width="12"
          height="12"
          fill="currentColor"
          stroke="none"
        />
      ) : state === "saved" ? (
        <>
          <path d="M7 4H3v13h13v-4M10 3h7v7M17 3l-9 9" />
        </>
      ) : (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="m7 7 6 6M13 7l-6 6" />
        </>
      )}
    </svg>
  )
}

export function RecordButton({ channel }: { channel: RecordChannel }) {
  const { open, job, stop, saved, viewSaved } = useRecording()
  const latest = saved.find((item) => item.channelId === channel.id)
  if (job?.channel.id === channel.id)
    return (
      <button
        className="record-button"
        disabled={job.state === "saving"}
        onClick={stop}
      >
        <RecordActionIcon state={job.state} />
        {job.state === "scheduled"
          ? "Cancel schedule"
          : job.state === "connecting"
            ? "Cancel recording"
            : job.state === "saving"
              ? "Saving…"
              : "End recording"}
      </button>
    )
  return (
    <div className="record-channel-actions">
      {latest && (
        <button
          className="record-button record-view-saved"
          onClick={() => viewSaved(latest.id)}
        >
          <RecordActionIcon state="saved" /> View saved recording
        </button>
      )}
      <button className="record-button" onClick={() => open(channel)}>
        <RecordActionIcon state="start" />
        {latest ? "Record again" : "Record channel"}
      </button>
    </div>
  )
}
export function RecordingLibrary() {
  const { job, saved, stop } = useRecording()
  return (
    <section className="record-library">
      <p className="eyebrow">YOUR BROADCAST ARCHIVE</p>
      <h1>
        Recordings<span className="accent">.</span>
      </h1>
      <p className="muted">Watch now. Keep it for later.</p>
      <p className="record-library-description">
        Choose Record channel from any preview or player. Start now or schedule
        a time. Keep this tab visible and your device awake, then save your
        finished video before leaving.
      </p>
      {job && (
        <article className="record-item">
          <div>
            <p className="eyebrow">
              <span className="record-dot" /> {job.state}
            </p>
            <h2>{job.channel.name}</h2>
            <p className="muted">
              {new Date(job.start).toLocaleString()} →{" "}
              {job.end ? new Date(job.end).toLocaleString() : "Until you stop"}
            </p>
            <p className="muted">
              {(job.bytes / 1048576).toFixed(1)} MB captured
            </p>
          </div>
          <button
            className="record-button"
            disabled={job.state === "saving"}
            onClick={stop}
          >
            <RecordActionIcon state={job.state} />
            {job.state === "scheduled"
              ? "Cancel schedule"
              : job.state === "connecting"
                ? "Cancel recording"
                : job.state === "saving"
                  ? "Saving…"
                  : "End recording"}
          </button>
        </article>
      )}
      {!job && !saved.length && (
        <div className="record-empty">
          <span aria-hidden="true">◉</span>
          <h2>Your next broadcast, saved.</h2>
          <p className="muted">
            Finished recordings will appear here, ready to save as video files.
          </p>
        </div>
      )}
      {saved.map((item) => (
        <SavedRecording key={item.id} item={item} />
      ))}
    </section>
  )
}

function SavedRecording({ item }: { item: Saved }) {
  const { remove, highlightedId, navigateRequest } = useRecording()
  const row = useRef<HTMLElement>(null)
  const highlighted = highlightedId === item.id
  useEffect(() => {
    if (!highlighted) return
    const frame = requestAnimationFrame(() => {
      row.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      row.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [highlighted, navigateRequest?.sequence])
  const [confirming, setConfirming] = useState(false)
  return (
    <article
      ref={row}
      tabIndex={-1}
      className={`record-item${highlighted ? " record-item-highlighted" : ""}`}
      aria-label={`Recording of ${item.name}${
        highlighted ? ", selected recording" : ""
      }`}
    >
      <div>
        <p className="eyebrow">
          {item.partial ? "PARTIAL RECORDING" : "READY TO SAVE"}
        </p>
        <h2>{item.name}</h2>
        <p className="muted">
          {(item.size / 1048576).toFixed(1)} MB ·{" "}
          {item.filename.endsWith("mp4") ? "MP4" : "WebM"} video
        </p>
        {confirming && (
          <p className="record-error" role="alert">
            Remove this recording from the tab? Save the video first if you want
            to keep it.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {confirming ? (
          <>
            <button
              className="record-button"
              onClick={() => setConfirming(false)}
            >
              Keep recording
            </button>
            <button className="record-button" onClick={() => remove(item.id)}>
              Remove recording
            </button>
          </>
        ) : (
          <>
            <a
              className="record-button"
              href={item.url}
              download={item.filename}
            >
              Save video ↗
            </a>
            <button
              className="record-button"
              onClick={() => setConfirming(true)}
            >
              Remove
            </button>
          </>
        )}
      </div>
    </article>
  )
}
