import LiveThumbnail from "./LiveThumbnail"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { Channel } from "./catalog"
import { useProgrammes, type Programme } from "./programmes"
import "./catalog-views.css"

const failures = new Set<string>()
let artwork = new Map<string, number>()
const listeners = new Set<() => void>()
function report(id: string, score: number) {
  if ((artwork.get(id) ?? 0) >= score) return
  artwork = new Map(artwork).set(id, score)
  listeners.forEach((listener) => listener())
}
export function useArtworkRanking() {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    () => artwork,
  )
}
export function ChannelLogo({
  channel,
  compact = false,
}: {
  channel: Channel
  compact?: boolean
}) {
  const [, update] = useState(0)
  const url = channel.logoUrls.find((source) => !failures.has(source))
  return (
    <span className={`channel-mark ${compact ? "compact" : ""}`}>
      {url ? (
        <img
          key={url}
          src={url}
          alt=""
          loading="lazy"
          onLoad={() => report(channel.id, 1)}
          onError={() => {
            failures.add(url)
            update((value) => value + 1)
          }}
        />
      ) : (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          aria-label="Channel logo unavailable"
          role="img"
        >
          <path
            d="M4 8h24v17H4zM11 29h10M11 3l5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      )}
    </span>
  )
}
export function programmeTime(programme: Programme) {
  const format = (time: number) =>
    new Date(time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  return `${format(programme.start)} – ${format(programme.end)}`
}
function Artwork({
  programme,
  channel,
  loading,
}: {
  programme?: Programme
  channel: Channel
  loading: boolean
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [programme?.thumbnail])
  return (
    <div className="programme-artwork">
      {loading ? (
        <div
          className="media-skeleton"
          aria-label="Loading programme artwork"
        />
      ) : programme?.thumbnail && !failed ? (
        <img
          src={programme.thumbnail}
          alt={programme.title}
          loading="lazy"
          onLoad={() => report(channel.id, 2)}
          onError={() => setFailed(true)}
        />
      ) : (
        <LiveThumbnail channel={channel} onLoaded={() => report(channel.id, 2)} />
      )}
    </div>
  )
}
function Favorite({
  favorite,
  onToggle,
}: {
  favorite: boolean
  onToggle: () => void
}) {
  return (
    <button
      className="channel-favorite"
      aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={favorite}
      onClick={onToggle}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={favorite ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />
      </svg>
    </button>
  )
}
function ProgrammeText({
  programme,
  loading,
  unavailable,
}: {
  programme?: Programme
  loading: boolean
  unavailable?: string
}) {
  if (loading)
    return (
      <div className="programme-skeleton" aria-label="Loading programme">
        <span />
        <span />
      </div>
    )
  return (
    <div className="programme-copy">
      <strong>
        {programme?.title ?? unavailable ?? "Programme guide unavailable"}
      </strong>
      {programme && (
        <time dateTime={new Date(programme.start).toISOString()}>
          {programmeTime(programme)}
        </time>
      )}
    </div>
  )
}
export function ProgrammeDetails({ channel }: { channel: Channel }) {
  const guide = useProgrammes(channel)
  return (
    <div className="programme-detail">
      <section>
        <p className="eyebrow">On now</p>
        <ProgrammeText
          programme={guide.current}
          loading={guide.loading}
          unavailable={guide.error || "No current programme published"}
        />
        {guide.current?.description && (
          <p className="muted">{guide.current.description}</p>
        )}
      </section>
      <section>
        <p className="eyebrow">Up next</p>
        <ProgrammeText
          programme={guide.next}
          loading={guide.loading}
          unavailable={
            guide.error
              ? "Upcoming schedule unavailable"
              : "No upcoming programme published"
          }
        />
        {guide.next?.description && (
          <p className="muted">{guide.next.description}</p>
        )}
      </section>
      {guide.error && channel.guides.length > 0 && (
        <button className="text-action" onClick={guide.retry}>
          Retry programme guide
        </button>
      )}
      {(guide.current || guide.next) && (
        <p className="programme-timezone">
          Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
      )}
      <details className="channel-data">
        <summary>Broadcast details</summary>
        <dl>
          <dt>Country</dt>
          <dd>{channel.countryName}</dd>
          {channel.languages.length > 0 && (
            <>
              <dt>Languages</dt>
              <dd>{channel.languages.join(", ")}</dd>
            </>
          )}
          {channel.broadcastAreas.length > 0 && (
            <>
              <dt>Broadcast areas</dt>
              <dd>{channel.broadcastAreas.join(", ")}</dd>
            </>
          )}
          {channel.timezones.length > 0 && (
            <>
              <dt>Broadcast timezones</dt>
              <dd>{channel.timezones.join(", ")}</dd>
            </>
          )}
          {channel.categoryDetails.length > 0 && (
            <>
              <dt>Categories</dt>
              <dd>
                {channel.categoryDetails.map((item) => (
                  <p key={item.id}>
                    <strong>{item.name}</strong>
                    {item.description ? ` — ${item.description}` : ""}
                  </p>
                ))}
              </dd>
            </>
          )}
          <dt>Streams</dt>
          <dd>{channel.streams.length}</dd>
          <dt>Feeds</dt>
          <dd>{channel.feeds.length}</dd>
          {channel.network && (
            <>
              <dt>Network</dt>
              <dd>{channel.network}</dd>
            </>
          )}
        </dl>
        {channel.website?.startsWith("https://") && (
          <a href={channel.website} target="_blank" rel="noreferrer">
            Broadcaster website ↗
          </a>
        )}
      </details>
    </div>
  )
}
function CatalogItem({
  channel,
  favorite,
  onFavorite,
  onSelect,
  view,
  start,
}: {
  channel: Channel
  favorite: boolean
  onFavorite: () => void
  onSelect: () => void
  view: string
  start: number
}) {
  const guide = useProgrammes(channel)
  const end = start + 6 * 3600000
  const programmes = guide.programmes.filter(
    (item) => item.end > start && item.start < end,
  )
  if (view === "timeline")
    return (
      <div className="timeline-row">
        <button className="timeline-channel" onClick={onSelect}>
          <ChannelLogo channel={channel} compact />
          <span>
            {channel.name}
            <small>{channel.countryName}</small>
          </span>
        </button>
        <div className="timeline-track">
          {guide.loading ? (
            <div className="media-skeleton" aria-label="Loading schedule" />
          ) : programmes.length ? (
            programmes.map((item) => (
              <button
                key={item.id}
                className="timeline-programme"
                onClick={onSelect}
                style={{
                  left: `${Math.max(0, ((item.start - start) / (end - start)) * 100)}%`,
                  width: `${((Math.min(end, item.end) - Math.max(start, item.start)) / (end - start)) * 100}%`,
                }}
                title={`${item.title} · ${programmeTime(item)}`}
              >
                <strong>{item.title}</strong>
                <span>{programmeTime(item)}</span>
              </button>
            ))
          ) : (
            <span className="timeline-unavailable">
              {guide.error || "No programmes published for this time range"}
            </span>
          )}
        </div>
      </div>
    )
  return (
    <article
      className={`broadcast-card ${
        view === "list" ? "broadcast-list-row" : ""
      }`}
    >
      <button
        className="programme-preview"
        onClick={onSelect}
        aria-label={`Preview ${channel.name}`}
      >
        <Artwork
          channel={channel}
          programme={guide.current}
          loading={guide.loading}
        />
        <span className="preview-play" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="lucide lucide-play preview-icon"><path d="M5 3L21 12L5 21Z"/></svg></span>
      </button>
      <div className="broadcast-body">
        <div className="broadcast-identity">
          <ChannelLogo channel={channel} compact />
          <button onClick={onSelect}>
            <h3>{channel.name}</h3>
            <p>
              {channel.countryName}
              {channel.categories.length
                ? ` · ${channel.categories.join(", ")}`
                : ""}
            </p>
          </button>
          <Favorite favorite={favorite} onToggle={onFavorite} />
        </div>
        <ProgrammeText
          programme={guide.current}
          loading={guide.loading}
          unavailable={guide.error || "No current programme published"}
        />
        {view === "list" && guide.next && (
          <p className="list-up-next">
            Next: {guide.next.title} · {programmeTime(guide.next)}
          </p>
        )}
      </div>
    </article>
  )
}
export function ViewSwitch({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="view-switch" role="group" aria-label="Channel layout">
      {["grid", "list", "timeline"].map((view) => (
        <button
          key={view}
          aria-pressed={value === view}
          onClick={() => onChange(view)}
        >
          <svg
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            {view === "grid" ? (
              <path d="M2 2h6v6H2zM12 2h6v6h-6zM2 12h6v6H2zM12 12h6v6h-6z" />
            ) : view === "list" ? (
              <path d="M2 4h16M2 10h16M2 16h16" />
            ) : (
              <path d="M2 3v14M5 5h8v4H5zM9 12h9v4H9z" />
            )}
          </svg>
          {view.charAt(0).toUpperCase() + view.slice(1)}
        </button>
      ))}
    </div>
  )
}
export default function CatalogViews({
  channels,
  view,
  favorites,
  onFavorite,
  onSelect,
}: {
  channels: Channel[]
  view: string
  favorites: Set<string>
  onFavorite: (id: string) => void
  onSelect: (channel: Channel) => void
}) {
  const [now, setNow] = useState(Date.now())
  const [start, setStart] = useState(() => Math.floor(Date.now() / 1800000) * 1800000 - 1800000)
  const [follow, setFollow] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const currentPosition = (now - start) / 3600000 * 240
  useEffect(() => {
    if (view !== "timeline") return
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [view])
  useEffect(() => {
    if (now >= start + 5 * 3600000 || now < start) {
      setStart(Math.floor(now / 1800000) * 1800000 - 1800000)
    }
  }, [now, start])
  useEffect(() => {
    if (view !== "timeline" || !follow || !scroller.current) return
    scroller.current.scrollLeft = Math.max(0, currentPosition - 80)
  }, [view, follow, currentPosition])
  return (
    <div>
      {view === "timeline" && (
        <div className="timeline-controls">
          <p className="programme-timezone">Programme guide · {new Date(now).toLocaleDateString()} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
          <button className="record-button" aria-pressed={follow} onClick={() => { setNow(Date.now()); setFollow(value => !value) }}>{follow ? "Following now · Pause" : "Follow now"}</button>
        </div>
      )}
      <div ref={scroller} className={view === "timeline" ? "timeline-scroll" : ""} tabIndex={view === "timeline" ? 0 : undefined} aria-label={view === "timeline" ? "Programme timeline; scroll horizontally to browse" : undefined}
        onWheel={event => { if (Math.abs(event.deltaX) > 0 || event.shiftKey) setFollow(false) }}
        onTouchMove={() => setFollow(false)}
        onPointerDown={event => { if (event.target === event.currentTarget) setFollow(false) }}
        onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) setFollow(false) }}>
      <div className={`catalog-${view}`}>
        {view === "timeline" && <div className="timeline-now-line" style={{ left: 180 + currentPosition }} aria-label={`Current time ${new Date(now).toLocaleTimeString()}`}><span>Now {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>}
        {view === "timeline" && (
          <div className="timeline-heading">
            <span>Channel</span>
            <div>
              {Array.from({ length: 12 }, (_, index) => (
                <time key={index}>
                  {new Date(start + index * 1800000).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              ))}
            </div>
          </div>
        )}
        {channels.map((channel) => (
          <CatalogItem
            key={channel.id}
            channel={channel}
            view={view}
            start={start}
            favorite={favorites.has(channel.id)}
            onFavorite={() => onFavorite(channel.id)}
            onSelect={() => onSelect(channel)}
          />
        ))}
      </div>
      </div>
    </div>
  )
}
