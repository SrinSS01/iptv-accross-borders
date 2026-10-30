import Brand from "./Brand"
import { getStreamUrl } from "./stream-url"
import DataSources from "./DataSources"
import { useCatalog, type Channel } from "./catalog"
import CatalogViews, {
  ChannelLogo,
  ProgrammeDetails,
  ViewSwitch,
  useArtworkRanking,
} from "./CatalogViews"
import ChannelFilters from "./ChannelFilters"
import {
  RecordButton,
  RecordingLibrary,
  RecordActionIcon,
  useRecording,
} from "./recording"
import Hls from "hls.js"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from "react"

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
  data: (
    <Icon className="size-5">
      <path d="M3 3v18h18M7 16v-5M12 16V7M17 16v-8" />
    </Icon>
  ),
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

    const source = getStreamUrl(channel.id, streamIndex, activeStream.url)
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
  }, [activeStream, channel.id, channel.streams.length, streamIndex])

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
      <section className="relative z-10 w-full max-w-5xl max-h-[calc(100dvh-32px)] overflow-y-auto border border-white/10 bg-[var(--surface)] shadow-2xl">
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
                  <span
                    className="mb-4 block h-20 w-56 animate-pulse bg-white/5"
                    aria-label="Loading stream"
                  />
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

    const source = getStreamUrl(channel.id, streamIndex, activeStream.url)
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
      video.src = source
      video.addEventListener("loadedmetadata", play)
    } else if (Hls.isSupported() && source.includes(".m3u8")) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      hls.loadSource(source)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, play)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) fail()
      })
    } else {
      video.src = source
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
  }, [activeStream, channel.id, channel.streams.length, streamIndex])

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
                    <span
                      className="mb-3 block h-16 w-48 animate-pulse bg-white/5"
                      aria-label="Loading preview"
                    />
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

          <ProgrammeDetails channel={channel} />

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
  const { channels, loading, error, retry, endpointStatus } = useCatalog()
  const artwork = useArtworkRanking()
  const [prioritizeArtwork, setPrioritizeArtwork] = useState(true)
  const [view, setView] = useState(() => {
    try {
      const saved = localStorage.getItem("iptv-view")
      return saved && ["grid", "list", "timeline"].includes(saved)
        ? saved
        : "grid"
    } catch {
      return "grid"
    }
  })
  const [active, setActive] = useState("Home")
  const [dataSourcesSelected, setDataSourcesSelected] = useState(false)
  const selectedNav = dataSourcesSelected ? "Data sources" : active
  const [query, setQuery] = useState("")
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const searchToggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (mobileSearchOpen) searchInput.current?.focus()
  }, [mobileSearchOpen])
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
    return channels
      .filter((channel) => {
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
      .sort((a, b) =>
        prioritizeArtwork
          ? (artwork.get(b.id) ?? 0) - (artwork.get(a.id) ?? 0)
          : 0,
      )
  }, [
    active,
    category,
    channels,
    country,
    favorites,
    query,
    artwork,
    prioritizeArtwork,
  ])

  useEffect(() => setVisible(20), [active, category, country, query])

  useEffect(() => {
    if (!recording.navigateRequest) return
    setSelected(null)
    setPlaying(null)
    setDataSourcesSelected(false)
    setActive("Recordings")
  }, [recording.navigateRequest])

  function navigate(label: string) {
    setDataSourcesSelected(label === "Data sources")
    if (label === "Data sources") {
      setMobileSearchOpen(false)
      const panel = document.getElementById("data-sources")
      panel?.focus({ preventScroll: true })
      panel?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" })
      return
    }
    setActive(label)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (label === "Discover")
          document
            .getElementById("channels")
            ?.scrollIntoView({ behavior: "smooth", block: "start" })
        else window.scrollTo({ top: 0, behavior: "smooth" })
      }),
    )
  }

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
    ["Data sources", icons.data],
  ] as const

  return (
    <div className="min-h-screen bg-[var(--background)] text-white selection:bg-[var(--accent)] selection:text-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/8 bg-[var(--background)] px-5 py-7 lg:flex">
        <button
          onClick={() => navigate("Home")}
          className="mb-11 flex items-center gap-3 px-2"
        >
          <Brand />
        </button>
        <nav className="space-y-2">
          {nav.map(([label, icon]) => (
            <button
              key={label}
              onClick={() => navigate(label)}
              className={`flex w-full items-center gap-3  px-4 py-3 text-sm font-medium transition ${
                selectedNav === label
                  ? "bg-white/8 text-white"
                  : "text-white/60 hover:bg-white/4 hover:text-white/80"
              }`}
            >
              <span className={selectedNav === label ? "text-[#ff6a5f]" : ""}>
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
        <header className="sticky top-0 z-20 grid grid-cols-[1fr_auto_auto] h-20 items-center gap-2 sm:flex sm:gap-3 border-b border-white/6 bg-[#101112e8] px-4 backdrop-blur-xl sm:px-7 lg:px-10">
          <button
            onClick={() => navigate("Home")}
            className="mr-auto flex items-center gap-2 lg:hidden"
          >
            <Brand />
          </button>
          <button
            ref={searchToggle}
            className="mobile-search-toggle sm:hidden"
            aria-label={mobileSearchOpen ? "Close search" : "Open search"}
            aria-expanded={mobileSearchOpen}
            aria-controls="channel-search"
            onClick={() => setMobileSearchOpen((open) => !open)}
          >{mobileSearchOpen ? icons.close : icons.search}</button>
          <label id="channel-search" className={`channel-search relative w-full max-w-md lg:mr-auto ${mobileSearchOpen ? "is-open" : ""}`}>

            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60">
              {icons.search}
            </span>
            <input
              ref={searchInput}
              onKeyDown={(event) => {
                if (event.key === "Escape" && mobileSearchOpen) {
                  setMobileSearchOpen(false)
                  searchToggle.current?.focus()
                }
              }}
              value={query}
              onChange={(event) => {
                setDataSourcesSelected(false)
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
              onClick={() => navigate("Recordings")}
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
            <button onClick={() => navigate("Recordings")}>
              View recordings ↗
            </button>
            {recording.job && (
              <button
                onClick={recording.stop}
              >
                <RecordActionIcon state={recording.job.state} />
                {recording.job.state === "scheduled"
                  ? "Cancel schedule"
                  : recording.job.state === "connecting"
                    ? "Cancel recording"
                    : recording.job.state === "saving"
                      ? "Cancel finalization"
                      : recording.job.state === "failed"
                        ? "Discard recording"
                        : "End recording"}
              </button>
            )}
          </div>
        )}
        <div className="mx-auto max-w-[1580px] px-4 pb-28 pt-6 sm:px-7 lg:px-10 lg:pb-14">
          {(active === "Home" || active === "Discover") &&
            featured &&
            !loading && (
              <section
                id="home"
                className="hero-grid relative mb-10 overflow-hidden  border border-white/8 bg-[var(--surface)] px-6 py-8 sm:px-9 sm:py-10"
              >
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
                    News. Culture. Sport. A world of public broadcasts. Find
                    your channel, tune in, and make it yours.
                  </p>
                  <div className="mt-7 flex flex-wrap gap-3">
                    <button
                      onClick={() => setSelected(featured)}
                      className="inline-flex items-center gap-2  bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white  transition hover:bg-[#ff6b61]"
                    >
                      {icons.play} Preview {featured.name}
                    </button>
                    <button
                      onClick={() => navigate("Discover")}
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
              <div
                id="channels"
                className="catalog-section mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"
              >
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#ff6f65]">
                    {active === "Favorites" ? "Favorites" : "Channel directory"}
                  </p>
                  <h2 className="text-2xl font-bold tracking-tight">
                    {active === "Favorites"
                      ? "Your saved channels"
                      : "Explore live channels"}
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

              <div className="catalog-toolbar">
                <ViewSwitch
                  value={view}
                  onChange={(value) => {
                    setView(value)
                    try {
                      localStorage.setItem("iptv-view", value)
                    } catch {}
                  }}
                />
                <label className="artwork-sort">
                  <input
                    type="checkbox"
                    checked={prioritizeArtwork}
                    onChange={(event) =>
                      setPrioritizeArtwork(event.target.checked)
                    }
                  />
                  Prioritize successfully loaded artwork
                </label>
              </div>
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
                  <CatalogViews
                    channels={filtered.slice(0, visible)}
                    view={view}
                    favorites={favorites}
                    onFavorite={toggleFavorite}
                    onSelect={setSelected}
                  />
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
          <DataSources statuses={endpointStatus} />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-white/10 bg-[#191b1d] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
        {nav.map(([label, icon]) => (
          <button
            key={label}
            onClick={() => navigate(label)}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[9px] font-semibold ${
              selectedNav === label ? "bg-white/8 text-[#ff6b61]" : "text-white/60"
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
