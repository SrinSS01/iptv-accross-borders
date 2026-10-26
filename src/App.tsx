import ChannelFilters from "./ChannelFilters"
import { RecordButton, RecordingLibrary, useRecording } from "./recording"
import Hls from "hls.js"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from "react"

const API = "https://iptv-org.github.io/api"

type ChannelSource = {
  id: string
  name: string
  country: string
  categories: string[]
  is_nsfw: boolean
  network: string | null
}

type StreamSource = {
  channel: string | null
  title: string
  url: string
  referrer: string | null
  user_agent: string | null
  quality: string | null
  labels: string[]
}

type LogoSource = {
  channel: string
  in_use: boolean
  tags: string[]
  url: string
}

type CountrySource = {
  name: string
  code: string
}

type Channel = ChannelSource & {
  stream: StreamSource
  streams: StreamSource[]
  logo?: string
  logoUrls: string[]
  countryName: string
}

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

const icons = {
  home: (
    <Icon className="size-5">
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v11h14V10M9 21v-7h6v7" />
    </Icon>
  ),
  compass: (
    <Icon className="size-5">
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-2 4-4 2 2-4 4-2Z" />
    </Icon>
  ),
  heart: (
    <Icon className="size-5">
      <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />
    </Icon>
  ),
  record: (
    <Icon className="size-5">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </Icon>
  ),
  search: (
    <Icon className="size-5">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </Icon>
  ),
  play: (
    <Icon className="size-5" fill="currentColor" strokeWidth="0">
      <path d="m8 5 11 7-11 7V5Z" />
    </Icon>
  ),
  chevron: (
    <Icon className="size-4">
      <path d="m9 18 6-6-6-6" />
    </Icon>
  ),
  close: (
    <Icon className="size-5">
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  ),
}

function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError("")
      try {
        const [channelRes, streamRes, logoRes, countryRes] = await Promise.all(
          ["channels", "streams", "logos", "countries"].map((endpoint) =>
            fetch(`${API}/${endpoint}.json`, { signal: controller.signal }),
          ),
        )
        if (!channelRes.ok || !streamRes.ok || !logoRes.ok || !countryRes.ok) {
          throw new Error("The channel catalog is temporarily unavailable.")
        }

        const [channelData, streamData, logoData, countryData] =
          await Promise.all([
            channelRes.json() as Promise<ChannelSource[]>,
            streamRes.json() as Promise<StreamSource[]>,
            logoRes.json() as Promise<LogoSource[]>,
            countryRes.json() as Promise<CountrySource[]>,
          ])

        const streams = new Map<string, StreamSource[]>()
        for (const stream of streamData) {
          if (!stream.channel || !stream.url.startsWith("https://")) continue
          const channelStreams = streams.get(stream.channel) ?? []
          channelStreams.push(stream)
          streams.set(stream.channel, channelStreams)
        }
        for (const channelStreams of streams.values()) {
          channelStreams.sort((a, b) => {
            const score = (stream: StreamSource) =>
              (stream.url.includes(".m3u8") ? 8 : 0) +
              (!stream.referrer && !stream.user_agent ? 4 : 0) +
              (!stream.labels.includes("Geo-blocked") ? 2 : 0) +
              (!stream.labels.includes("Not 24/7") ? 1 : 0)
            return score(b) - score(a)
          })
        }

        const logos = new Map<string, string[]>()
        // Keep available alternates, prefer readable marks on the light logo tile.
        const rankedLogos = [...logoData]
          .filter((logo) => logo.in_use && logo.url.startsWith("https://"))
          .sort(
            (a, b) =>
              Number(a.tags.includes("white")) -
              Number(b.tags.includes("white")),
          )
        for (const logo of rankedLogos) {
          const urls = logos.get(logo.channel) ?? []
          if (!urls.includes(logo.url)) urls.push(logo.url)
          logos.set(logo.channel, urls)
        }

        const countries = new Map(
          countryData.map((country) => [country.code, country.name]),
        )
        const joined = channelData
          .filter(
            (channel) =>
              !channel.is_nsfw &&
              !channel.id.toLowerCase().includes("adult") &&
              streams.has(channel.id),
          )
          .map((channel) => ({
            ...channel,
            stream: streams.get(channel.id)![0],
            streams: streams.get(channel.id)!,
            logo: logos.get(channel.id)?.[0],
            logoUrls: logos.get(channel.id) ?? [],
            countryName: countries.get(channel.country) ?? channel.country,
          }))

        setChannels(joined)
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") {
          setError((reason as Error).message || "Unable to load live channels.")
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [reloadKey])

  return {
    channels,
    loading,
    error,
    retry: () => setReloadKey((key) => key + 1),
  }
}

function Player({
  channel,
  onClose,
}: {
  channel: Channel
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [streamIndex, setStreamIndex] = useState(0)
  const [status, setStatus] = useState("Connecting to live stream…")
  const [failed, setFailed] = useState(false)
  const [needsPlay, setNeedsPlay] = useState(false)
  const activeStream = channel.streams[streamIndex] ?? channel.stream

  useEffect(() => {
    setStreamIndex(0)
  }, [channel.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const source = activeStream.url
    let hls: Hls | null = null
    setFailed(false)
    setNeedsPlay(false)
    setStatus("Connecting to live stream…")

    const fail = () => {
      if (streamIndex < channel.streams.length - 1) {
        setStatus("Trying another source…")
        setStreamIndex((index) => index + 1)
      } else {
        setFailed(true)
        setStatus(
          activeStream.labels.includes("Geo-blocked")
            ? "This stream may not be available in your region."
            : "The broadcaster is not responding right now.",
        )
      }
    }
    const markPlaying = () => {
      setStatus("")
      setNeedsPlay(false)
      setFailed(false)
    }
    const requestPlayback = () => {
      video.play().catch(() => {
        setNeedsPlay(true)
        setStatus("Ready when you are.")
      })
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source
      video.addEventListener("error", fail)
      video.addEventListener("playing", markPlaying)
      requestPlayback()
    } else if (Hls.isSupported() && source.includes(".m3u8")) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      hls.loadSource(source)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        requestPlayback()
      })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) fail()
      })
      video.addEventListener("playing", markPlaying)
    } else {
      video.src = source
      video.addEventListener("error", fail)
      video.addEventListener("playing", markPlaying)
      requestPlayback()
    }

    return () => {
      video.removeEventListener("error", fail)
      video.removeEventListener("playing", markPlaying)
      hls?.destroy()
      video.removeAttribute("src")
      video.load()
    }
  }, [activeStream, channel.streams.length, streamIndex])

  function startPlayback() {
    const video = videoRef.current
    if (!video) return
    setStatus("Starting live stream…")
    setNeedsPlay(false)
    video.play().catch(() => {
      setFailed(true)
      setStatus("Playback was blocked. Use the play control below.")
    })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#05080ce8] p-4 backdrop-blur-md">
      <button
        aria-label="Close player"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section className="relative z-10 w-full max-w-5xl overflow-hidden  border border-white/10 bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <ChannelLogo channel={channel} compact />
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-white">
                {channel.name}
              </h2>
              <p className="truncate text-xs text-white/60">
                {channel.countryName} · {activeStream.quality || "Live"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className=" border border-white/10 p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Close player"
          >
            {icons.close}
          </button>
        </div>
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            className="h-full w-full"
            controls
            playsInline
          />
          {status && (
            <div className="absolute inset-0 grid place-items-center bg-black/55">
              <div className="max-w-sm px-5 text-center">
                {!failed && !needsPlay && (
                  <span className="mb-4 inline-block size-8 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
                )}
                <p className="text-sm text-white/70">{status}</p>
                {needsPlay && (
                  <button
                    onClick={startPlayback}
                    className="mt-4 inline-flex items-center gap-2  bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
                  >
                    {icons.play} Start live stream
                  </button>
                )}
                {failed && channel.streams.length > 1 && (
                  <button
                    onClick={() => setStreamIndex(0)}
                    className="mt-4  border border-white/20 px-5 py-2.5 text-xs font-semibold text-white"
                  >
                    Retry sources
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-xs text-white/60">
            Streams are provided by their respective broadcasters.
          </p>
          <RecordButton channel={channel} />
        </div>
      </section>
    </div>
  )
}

function ChannelPreview({
  channel,
  favorite,
  onClose,
  onFavorite,
  onWatch,
}: {
  channel: Channel
  favorite: boolean
  onClose: () => void
  onFavorite: () => void
  onWatch: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [streamIndex, setStreamIndex] = useState(0)
  const [status, setStatus] = useState("Loading preview…")
  const activeStream = channel.streams[streamIndex] ?? channel.stream

  useEffect(() => {
    setStreamIndex(0)
  }, [channel.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let hls: Hls | null = null
    const fail = () => {
      if (streamIndex < channel.streams.length - 1) {
        setStatus("Trying another source…")
        setStreamIndex((index) => index + 1)
      } else {
        setStatus("Live preview unavailable")
      }
    }
    const play = () => {
      video.play().catch(() => setStatus("Preview paused"))
    }
    const ready = () => setStatus("")

    setStatus("Loading preview…")
    video.muted = true

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = activeStream.url
      video.addEventListener("loadedmetadata", play)
    } else if (Hls.isSupported() && activeStream.url.includes(".m3u8")) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      hls.loadSource(activeStream.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, play)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) fail()
      })
    } else {
      video.src = activeStream.url
      video.addEventListener("loadedmetadata", play)
    }

    video.addEventListener("playing", ready)
    video.addEventListener("error", fail)
    return () => {
      video.removeEventListener("loadedmetadata", play)
      video.removeEventListener("playing", ready)
      video.removeEventListener("error", fail)
      hls?.destroy()
      video.removeAttribute("src")
      video.load()
    }
  }, [activeStream, channel.streams.length, streamIndex])

  const category = channel.categories[0]
    ? channel.categories[0][0].toUpperCase() + channel.categories[0].slice(1)
    : "General"
  const showTitle =
    activeStream.title &&
    activeStream.title.toLowerCase() !== channel.name.toLowerCase()
      ? activeStream.title
      : `Live ${category} programming`

  return (
    <>
      <button
        aria-label="Close channel preview"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/55 backdrop-blur-sm lg:bg-black/20 lg:backdrop-blur-none"
      />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[430px] flex-col overflow-y-auto border-l border-white/10 bg-[var(--surface)] shadow-[-24px_0_70px_#05080c80]">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff6b61]">
              Channel preview
            </p>
            <h2 className="mt-1 text-sm font-semibold text-white/75">
              See what’s on now
            </h2>
          </div>
          <button
            onClick={onClose}
            className=" border border-white/10 p-2 text-white/55 transition hover:bg-white/8 hover:text-white"
            aria-label="Close channel preview"
          >
            {icons.close}
          </button>
        </div>

        <div className="p-4">
          <div className="relative aspect-video overflow-hidden  bg-black">
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              muted
              playsInline
            />
            {status && (
              <div className="absolute inset-0 grid place-items-center bg-black/60">
                <div className="text-center">
                  {status !== "Live preview unavailable" && (
                    <span className="mb-3 inline-block size-7 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
                  )}
                  <p className="text-xs text-white/60">{status}</p>
                </div>
              </div>
            )}
            {!status && (
              <div className="absolute bottom-3 left-3 flex items-center gap-2  bg-black/65 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur">
                <span className="size-1.5 animate-pulse  bg-[#49d68b]" />
                Live preview · Muted
              </div>
            )}
          </div>

          <div className="mt-6 flex items-start gap-4">
            <ChannelLogo channel={channel} />
            <div className="min-w-0 flex-1 pt-1">
              <h2 className="truncate text-xl font-bold tracking-tight">
                {channel.name}
              </h2>
              <p className="mt-1 text-xs text-white/60">
                {channel.countryName} · {activeStream.quality || "Live"}
              </p>
            </div>
            <button
              onClick={onFavorite}
              aria-label={
                favorite ? "Remove from favorites" : "Add to favorites"
              }
              className={` border p-2.5 transition ${
                favorite
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-white/10 text-white/65 hover:text-white"
              }`}
            >
              <Icon
                className="size-4"
                fill={favorite ? "currentColor" : "none"}
              >
                <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />
              </Icon>
            </button>
          </div>

          <div className="mt-7  border border-white/8 bg-white/[0.035] p-5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#49d68b]">
                On now
              </p>
              <span className=" bg-white/6 px-2.5 py-1 text-[10px] text-white/60">
                {category}
              </span>
            </div>
            <h3 className="mt-3 text-lg font-semibold leading-snug text-white">
              {showTitle}
            </h3>
            <p className="mt-2 text-xs leading-5 text-white/60">
              Live schedule information is supplied by the broadcaster when
              available.
            </p>
          </div>

          <button
            onClick={onWatch}
            className="mt-6 flex w-full items-center justify-center gap-2  bg-[var(--accent)] px-6 py-3.5 text-sm font-semibold text-white  transition hover:bg-[#ff6b61]"
          >
            {icons.play} Watch full screen
          </button>
          <div className="mt-3 flex justify-center">
            <RecordButton channel={channel} />
          </div>
        </div>
      </aside>
    </>
  )
}

// Avoid retrying known failures when the same channel opens in another surface.
const failedLogos = new Set<string>()
function ChannelImage({
  channel,
  className,
  compact = false,
}: {
  channel: Channel
  className: string
  compact?: boolean
}) {
  const [, retry] = useState(0)
  const url = channel.logoUrls.find((source) => !failedLogos.has(source))
  if (!url)
    return (
      <span
        className={`channel-logo-placeholder ${compact ? "is-compact" : ""}`}
        role="img"
        aria-label={`Logo unavailable for ${channel.name}`}
      >
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <rect
            x="5"
            y="10"
            width="30"
            height="22"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="m14 4 6 6 6-6M14 36h12"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="m17 16 9 5-9 5V16Z" fill="currentColor" />
        </svg>
        {!compact && <span>Logo unavailable</span>}
      </span>
    )
  return (
    <img
      key={url}
      src={url}
      alt=""
      loading="lazy"
      className={className}
      onError={() => {
        failedLogos.add(url)
        retry((value) => value + 1)
      }}
    />
  )
}

function ChannelLogo({
  channel,
  compact = false,
}: {
  channel: Channel
  compact?: boolean
}) {
  return (
    <div
      className={`${
        compact ? "size-10 " : "h-16 w-20 "
      } grid shrink-0 place-items-center overflow-hidden border border-black/5 bg-white p-2`}
    >
      <ChannelImage
        channel={channel}
        compact
        className="max-h-full max-w-full object-contain"
      />
    </div>
  )
}

function ChannelCard({
  channel,
  favorite,
  onFavorite,
  onSelect,
}: {
  channel: Channel
  favorite: boolean
  onFavorite: () => void
  onSelect: () => void
}) {
  return (
    <article className="channel-card group border border-white/8 bg-[var(--surface)] p-3 transition duration-300 hover:border-white/30">
      <div className="relative mb-4 flex aspect-[1.7] items-center justify-center overflow-hidden  bg-[#e9edf0]">
        <ChannelImage
          channel={channel}
          className="h-20 w-4/6 object-contain transition duration-500 group-hover:scale-105"
        />
        <button
          onClick={onFavorite}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          className={`absolute right-3 top-3 z-10  p-2.5 shadow-sm backdrop-blur transition ${
            favorite
              ? "bg-[var(--accent)] text-white"
              : "bg-white/80 text-[#17202a] hover:bg-white"
          }`}
        >
          <Icon className="size-4" fill={favorite ? "currentColor" : "none"}>
            <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />
          </Icon>
        </button>
        <button
          onClick={onSelect}
          aria-label={`Preview ${channel.name}`}
          className="absolute inset-0 grid place-items-center bg-[#0b101600] transition group-hover:bg-[#0b10162d]"
        >
          <span className="grid size-12 translate-y-2 place-items-center  bg-[var(--accent)] pl-0.5 text-white opacity-100 sm:opacity-0 shadow-lg transition duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {icons.play}
          </span>
        </button>
      </div>
      <button onClick={onSelect} className="block w-full text-left">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold text-white">{channel.name}</h3>
          <span className="mt-1.5 size-2 shrink-0  bg-[#49d68b] shadow-[0_0_0_4px_#49d68b1c]" />
        </div>
        <p className="truncate text-xs text-white/60">
          {channel.countryName} ·{" "}
          {channel.categories[0]
            ? channel.categories[0][0].toUpperCase() +
              channel.categories[0].slice(1)
            : "General"}
        </p>
      </button>
    </article>
  )
}

function Skeletons() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse  border border-white/5 bg-[var(--surface)] p-3"
        >
          <div className="aspect-[1.7]  bg-white/6" />
          <div className="mt-4 h-4 w-3/5 rounded bg-white/8" />
          <div className="mt-2 h-3 w-2/5 rounded bg-white/5" />
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const recording = useRecording()
  const { channels, loading, error, retry } = useChannels()
  const [active, setActive] = useState("Home")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [country, setCountry] = useState("all")
  const [visible, setVisible] = useState(20)
  const [selected, setSelected] = useState<Channel | null>(null)
  const [playing, setPlaying] = useState<Channel | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem("streamly-favorites") || "[]"),
      )
    } catch {
      return new Set()
    }
  })

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    channels.forEach((channel) =>
      channel.categories.forEach((item) =>
        counts.set(item, (counts.get(item) || 0) + 1),
      ),
    )
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [channels])

  const countries = useMemo(() => {
    const counts = new Map<string, number>()
    channels.forEach((channel) =>
      counts.set(
        channel.countryName,
        (counts.get(channel.countryName) || 0) + 1,
      ),
    )
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [channels])

  const featured = useMemo(() => {
    const preferred = [
      "BloombergTV.us",
      "NASA.cs",
      "France24English.fr",
      "DWEnglish.de",
    ]
    return (
      preferred
        .map((id) => channels.find((channel) => channel.id === id))
        .find(Boolean) ||
      channels.find((channel) => channel.logo && channel.stream.quality) ||
      channels[0]
    )
  }, [channels])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return channels.filter((channel) => {
      if (active === "Favorites" && !favorites.has(channel.id)) return false
      if (category !== "all" && !channel.categories.includes(category))
        return false
      if (country !== "all" && channel.countryName !== country) return false
      if (
        needle &&
        !`${channel.name} ${channel.countryName} ${channel.network || ""}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false
      }
      return true
    })
  }, [active, category, channels, country, favorites, query])

  useEffect(() => setVisible(20), [active, category, country, query])

  function toggleFavorite(id: string) {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem("streamly-favorites", JSON.stringify([...next]))
      return next
    })
  }

  const nav = [
    ["Home", icons.home],
    ["Discover", icons.compass],
    ["Favorites", icons.heart],
    ["Recordings", icons.record],
  ] as const

  return (
    <div className="min-h-screen bg-[var(--background)] text-white selection:bg-[var(--accent)] selection:text-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/8 bg-[var(--background)] px-5 py-7 lg:flex">
        <button
          onClick={() => setActive("Home")}
          className="mb-11 flex items-center gap-3 px-2"
        >
          <span className="grid size-9 place-items-center  bg-[var(--accent)] ">
            <Icon className="size-5" strokeWidth="2.2">
              <path d="m6 5 13 7-13 7V5Z" />
            </Icon>
          </span>
          <span className="text-xl font-bold tracking-tight">Streamly</span>
        </button>
        <nav className="space-y-2">
          {nav.map(([label, icon]) => (
            <button
              key={label}
              onClick={() => {
                setActive(label)
                if (label !== "Discover") {
                  setCategory("all")
                  setCountry("all")
                  setQuery("")
                }
              }}
              className={`flex w-full items-center gap-3  px-4 py-3 text-sm font-medium transition ${
                active === label
                  ? "bg-white/8 text-white"
                  : "text-white/60 hover:bg-white/4 hover:text-white/80"
              }`}
            >
              <span className={active === label ? "text-[#ff6a5f]" : ""}>
                {icon}
              </span>
              {label}
              {label === "Favorites" && favorites.size > 0 && (
                <span className="ml-auto  bg-white/8 px-2 py-0.5 text-[10px] text-white/65">
                  {favorites.size}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto  border border-white/8 bg-white/[0.035] p-4">
          <p className="text-xs font-semibold text-white/70">Open-source TV</p>
          <p className="mt-2 text-[11px] leading-5 text-white/60">
            Community-maintained links to publicly available broadcasts.
          </p>
          <a
            href="https://github.com/iptv-org/iptv"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#ff7167] hover:text-[#ff8a82]"
          >
            View source {icons.chevron}
          </a>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-60">
        <header className="sticky top-0 z-20 flex h-20 items-center gap-3 border-b border-white/6 bg-[#101112e8] px-4 backdrop-blur-xl sm:px-7 lg:px-10">
          <button
            onClick={() => setActive("Home")}
            className="mr-auto flex items-center gap-2 lg:hidden"
          >
            <span className="grid size-8 place-items-center  bg-[var(--accent)]">
              {icons.play}
            </span>
            <span className="font-bold">Streamly</span>
          </button>
          <label className="relative hidden w-full max-w-md sm:block lg:mr-auto">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60">
              {icons.search}
            </span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                if (event.target.value) setActive("Discover")
              }}
              aria-label="Search channels"
              placeholder="Search channels, countries, networks…"
              className="h-11 w-full  border border-white/8 bg-white/[0.045] pl-12 pr-10 text-sm text-white outline-none transition placeholder:text-white/60 focus:border-white/20 focus:bg-white/[0.065]"
            />
            {query && (
              <button
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2"
                onClick={(event) => {
                  setQuery("")
                  event.currentTarget.parentElement
                    ?.querySelector("input")
                    ?.focus()
                }}
              >
                ×
              </button>
            )}
          </label>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-2  border border-white/8 px-3 py-2 text-xs text-white/60 md:flex">
              <span className="size-2  bg-[#49d68b]" />
              {loading
                ? "Syncing catalog"
                : `${channels.length.toLocaleString()} channels`}
            </span>
            <button
              onClick={() => setActive("Recordings")}
              className="header-record"
              aria-label="Open recordings"
            >
              {icons.record}
              <span className="hidden sm:inline">Recordings</span>
            </button>
          </div>
        </header>

        {(recording.job || recording.message) && (
          <div className="record-banner" role="status">
            <span>
              {recording.job
                ? `${
                    recording.job.state === "recording"
                      ? "● Recording"
                      : recording.job.state
                  } · ${recording.job.channel.name}`
                : recording.message}
            </span>
            <button onClick={() => setActive("Recordings")}>
              View recordings ↗
            </button>
            {recording.job && (
              <button
                disabled={recording.job.state === "saving"}
                onClick={recording.stop}
              >
                {recording.job.state === "scheduled"
                  ? "Cancel schedule"
                  : recording.job.state === "connecting"
                    ? "Cancel recording"
                    : recording.job.state === "saving"
                      ? "Saving…"
                      : "End recording"}
              </button>
            )}
          </div>
        )}
        <div className="mx-auto max-w-[1580px] px-4 pb-28 pt-6 sm:px-7 lg:px-10 lg:pb-14">
          <label className="relative mb-5 block sm:hidden">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60">
              {icons.search}
            </span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                if (event.target.value) setActive("Discover")
              }}
              aria-label="Search channels"
              placeholder="Search live channels…"
              className="h-11 w-full  border border-white/8 bg-white/[0.045] pl-12 pr-10 text-sm outline-none"
            />
            {query && (
              <button
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2"
                onClick={(event) => {
                  setQuery("")
                  event.currentTarget.parentElement
                    ?.querySelector("input")
                    ?.focus()
                }}
              >
                ×
              </button>
            )}
          </label>

          {active === "Home" && featured && !loading && (
            <section className="hero-grid relative mb-10 overflow-hidden  border border-white/8 bg-[var(--surface)] px-6 py-8 sm:px-9 sm:py-10">
              <div className="relative z-10 max-w-xl">
                <span className="mb-5 inline-flex items-center gap-2  bg-black/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/65">
                  <span className="size-1.5 animate-pulse  bg-[#49d68b]" />
                  ON AIR / WORLDWIDE
                </span>
                <p className="mb-2 text-sm font-medium text-[#ff766d]">
                  One world. A thousand perspectives.
                </p>
                <h1 className="hero-title">
                  TV WITHOUT
                  <br />
                  BORDERS<span className="accent">.</span>
                </h1>
                <p className="mt-4 max-w-lg text-sm leading-6 text-white/65 sm:text-base">
                  News. Culture. Sport. A world of public broadcasts. Find your
                  channel, tune in, and make it yours.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <button
                    onClick={() => setSelected(featured)}
                    className="inline-flex items-center gap-2  bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white  transition hover:bg-[#ff6b61]"
                  >
                    {icons.play} Preview {featured.name}
                  </button>
                  <button
                    onClick={() => setActive("Discover")}
                    className="inline-flex items-center gap-2  border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
                  >
                    Browse channels {icons.chevron}
                  </button>
                </div>
              </div>
              <div className="broadcast-mark" aria-hidden="true">
                <div className="broadcast-lines">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="broadcast-label">
                  LIVE SIGNAL
                  <br />
                  <strong>WORLDWIDE</strong>
                </div>
              </div>
            </section>
          )}

          {active === "Recordings" ? (
            <RecordingLibrary />
          ) : (
            <>
              <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#ff6f65]">
                    {active === "Home" ? "On now" : active}
                  </p>
                  <h2 className="text-2xl font-bold tracking-tight">
                    {active === "Home"
                      ? "Explore live channels"
                      : active === "Favorites"
                        ? "Your saved channels"
                        : "Discover broadcasts"}
                  </h2>
                </div>
                {!loading && (
                  <p className="text-xs text-white/60">
                    {filtered.length.toLocaleString()} results
                  </p>
                )}
              </div>

              <ChannelFilters
                categories={categories}
                countries={countries}
                category={category}
                country={country}
                onCategory={setCategory}
                onCountry={setCountry}
                loading={loading}
              />

              {loading ? (
                <Skeletons />
              ) : error ? (
                <div className=" border border-white/8 bg-[var(--surface)] px-6 py-16 text-center">
                  <p className="font-semibold">Couldn’t tune the catalog</p>
                  <p className="mt-2 text-sm text-white/60">{error}</p>
                  <button
                    onClick={retry}
                    className="mt-5  bg-white px-5 py-2.5 text-xs font-bold text-[var(--surface)]"
                  >
                    Try again
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className=" border border-dashed border-white/10 py-20 text-center">
                  <p className="font-semibold text-white/70">
                    {active === "Favorites"
                      ? "No favorite channels yet"
                      : "No channels found"}
                  </p>
                  <p className="mt-2 text-sm text-white/60">
                    {active === "Favorites"
                      ? "Save channels with the heart button to find them here."
                      : "Try a different search or filter."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {filtered.slice(0, visible).map((channel) => (
                      <ChannelCard
                        key={channel.id}
                        channel={channel}
                        favorite={favorites.has(channel.id)}
                        onFavorite={() => toggleFavorite(channel.id)}
                        onSelect={() => setSelected(channel)}
                      />
                    ))}
                  </div>
                  {visible < filtered.length && (
                    <div className="mt-8 text-center">
                      <button
                        onClick={() => setVisible((count) => count + 20)}
                        className=" border border-white/10 px-6 py-3 text-xs font-semibold text-white/60 transition hover:border-white/25 hover:text-white"
                      >
                        Load more channels
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>

      <nav className="fixed inset-x-3 bottom-3 z-30 flex justify-around  border border-white/10 bg-[#191b1deF] p-2 shadow-2xl backdrop-blur-xl lg:hidden">
        {nav.map(([label, icon]) => (
          <button
            key={label}
            onClick={() => setActive(label)}
            className={`flex min-w-14 flex-col items-center gap-1  px-3 py-2 text-[9px] font-semibold ${
              active === label ? "bg-white/8 text-[#ff6b61]" : "text-white/60"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>

      {selected && (
        <ChannelPreview
          channel={selected}
          favorite={favorites.has(selected.id)}
          onClose={() => setSelected(null)}
          onFavorite={() => toggleFavorite(selected.id)}
          onWatch={() => {
            setPlaying(selected)
            setSelected(null)
          }}
        />
      )}
      {playing && <Player channel={playing} onClose={() => setPlaying(null)} />}
    </div>
  )
}
