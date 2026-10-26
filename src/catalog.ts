import { useEffect, useState } from "react"

export const API = "https://iptv-org.github.io/api"
export const CATALOG_ENDPOINTS = [
  "channels",
  "feeds",
  "logos",
  "streams",
  "guides",
  "categories",
  "languages",
  "countries",
  "subdivisions",
  "cities",
  "regions",
  "timezones",
  "blocklist",
] as const
export type EndpointName = typeof CATALOG_ENDPOINTS[number]
export type EndpointStatus = {
  state: "loading" | "ready" | "error"
  count: number
  error?: string
}
export type StreamSource = {
  channel: string | null
  feed?: string | null
  title: string
  url: string
  referrer: string | null
  user_agent: string | null
  quality: string | null
  labels: string[]
}
export type GuideSource = {
  channel: string | null
  feed: string | null
  site: string
  site_id: string
  site_name: string
  lang: string
  sources: {
    host: string
    url: string
    format: string
  }[]
}
export type FeedSource = {
  channel: string
  id: string
  name: string
  is_main: boolean
  broadcast_area: string[]
  timezones: string[]
  languages: string[]
  format: string
}
export type CategorySource = {
  id: string
  name: string
  description: string
}
type ChannelSource = {
  id: string
  name: string
  country: string
  categories: string[]
  is_nsfw: boolean
  network: string | null
  alt_names?: string[]
  website?: string | null
  closed?: string | null
}
type CountrySource = {
  code: string
  name: string
  flag: string
  languages: string[]
}
type LogoSource = {
  channel: string
  feed: string | null
  in_use: boolean
  tags: string[]
  url: string
}
type LanguageSource = {
  code: string
  name: string
}
type SubdivisionSource = {
  code: string
  name: string
  country: string
  parent: string | null
}
type CitySource = {
  code: string
  name: string
  country: string
  subdivision: string | null
}
type RegionSource = {
  code: string
  name: string
  countries: string[]
}
type TimezoneSource = {
  id: string
  utc_offset: string
  countries: string[]
}
type BlockedSource = {
  channel: string
  reason: string
  ref: string
}
export type Channel = ChannelSource & {
  stream: StreamSource
  streams: StreamSource[]
  logo?: string
  logoUrls: string[]
  countryName: string
  countryFlag?: string
  feeds: FeedSource[]
  languages: string[]
  broadcastAreas: string[]
  timezones: string[]
  categoryDetails: CategorySource[]
  guides: GuideSource[]
}
export type CatalogData = {
  channels: ChannelSource[]
  feeds: FeedSource[]
  logos: LogoSource[]
  streams: StreamSource[]
  guides: GuideSource[]
  categories: CategorySource[]
  languages: LanguageSource[]
  countries: CountrySource[]
  subdivisions: SubdivisionSource[]
  cities: CitySource[]
  regions: RegionSource[]
  timezones: TimezoneSource[]
  blocklist: BlockedSource[]
}
const unique = (values: string[]) => [...new Set(values)]
function groupByChannel<T extends { channel: string | null }>(rows: T[]) {
  const map = new Map<string, T[]>()
  for (const row of rows)
    if (row.channel)
      map.set(row.channel, [...(map.get(row.channel) ?? []), row])
  return map
}

/** Every endpoint has a join or exclusion role; no guessed programme metadata. */
export function joinCatalog(data: CatalogData): Channel[] {
  const countries = new Map(data.countries.map((item) => [item.code, item]))
  const languages = new Map(
    data.languages.map((item) => [item.code, item.name]),
  )
  const subdivisions = new Map(
    data.subdivisions.map((item) => [item.code, item]),
  )
  const cities = new Map(data.cities.map((item) => [item.code, item]))
  const regions = new Map(data.regions.map((item) => [item.code, item]))
  const timezones = new Map(data.timezones.map((item) => [item.id, item]))
  const categories = new Map(data.categories.map((item) => [item.id, item]))
  const blocked = new Set(data.blocklist.map((item) => item.channel))
  const streams = groupByChannel(
    data.streams.filter((item) => item.url.startsWith("https://")),
  )
  const feeds = groupByChannel(data.feeds)
  const guides = groupByChannel(data.guides)
  const logos = groupByChannel(
    data.logos.filter((item) => item.in_use && item.url.startsWith("https://")),
  )
  function areaLabel(area: string): string | undefined {
    const [kind, code] = area.split("/")
    if (kind === "c") return countries.get(code)?.name
    if (kind === "r") return regions.get(code)?.name
    if (kind === "s") {
      const subdivision = subdivisions.get(code)
      return subdivision
        ? [subdivision.name, countries.get(subdivision.country)?.name]
            .filter(Boolean)
            .join(", ")
        : undefined
    }
    if (kind === "ct") {
      const city = cities.get(code)
      return city
        ? [
            city.name,
            city.subdivision
              ? subdivisions.get(city.subdivision)?.name
              : undefined,
            countries.get(city.country)?.name,
          ]
            .filter(Boolean)
            .join(", ")
        : undefined
    }
    return undefined
  }
  const streamScore = (item: StreamSource) =>
    (item.url.includes(".m3u8") ? 8 : 0) +
    (!item.referrer && !item.user_agent ? 4 : 0) +
    (!item.labels.includes("Geo-blocked") ? 2 : 0) +
    (!item.labels.includes("Not 24/7") ? 1 : 0)
  return data.channels
    .filter(
      (channel) =>
        !channel.is_nsfw && !blocked.has(channel.id) && streams.has(channel.id),
    )
    .map((channel) => {
      const channelStreams = streams
        .get(channel.id)!
        .sort((a, b) => streamScore(b) - streamScore(a))
      const channelFeeds = (feeds.get(channel.id) ?? []).sort(
        (a, b) =>
          Number(b.id === channelStreams[0].feed) -
            Number(a.id === channelStreams[0].feed) ||
          Number(b.is_main) - Number(a.is_main),
      )
      const activeFeed =
        channelFeeds.find((feed) => feed.id === channelStreams[0].feed) ??
        channelFeeds.find((feed) => feed.is_main)
      const channelLogos = (logos.get(channel.id) ?? []).sort(
        (a, b) =>
          Number(b.feed === activeFeed?.id) -
            Number(a.feed === activeFeed?.id) ||
          Number(b.tags.includes("white")) - Number(a.tags.includes("white")),
      )
      const logoUrls = unique(channelLogos.map((logo) => logo.url))
      const metadataFeeds = activeFeed ? [activeFeed] : channelFeeds
      const guideList = (guides.get(channel.id) ?? []).filter(
        (guide) => !activeFeed || !guide.feed || guide.feed === activeFeed.id,
      )
      return {
        ...channel,
        stream: channelStreams[0],
        streams: channelStreams,
        logo: logoUrls[0],
        logoUrls,
        countryName: countries.get(channel.country)?.name ?? channel.country,
        countryFlag: countries.get(channel.country)?.flag,
        feeds: channelFeeds,
        languages: unique(
          metadataFeeds
            .flatMap((feed) => feed.languages)
            .map((code) => languages.get(code))
            .filter((name): name is string => !!name),
        ),
        broadcastAreas: unique(
          metadataFeeds
            .flatMap((feed) => feed.broadcast_area)
            .map(areaLabel)
            .filter((name): name is string => !!name),
        ),
        timezones: unique(
          metadataFeeds
            .flatMap((feed) => feed.timezones)
            .filter((id) => timezones.has(id)),
        ),
        categoryDetails: channel.categories
          .map((id) => categories.get(id))
          .filter((category): category is CategorySource => !!category),
        guides: guideList,
      }
    })
}

const initialStatuses = () =>
  Object.fromEntries(
    CATALOG_ENDPOINTS.map((name) => [name, { state: "loading", count: 0 }]),
  ) as Record<EndpointName, EndpointStatus>
export function useCatalog() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [categoryDefinitions, setCategoryDefinitions] =
    useState<CategorySource[]>([])
  const [endpointStatus, setEndpointStatus] = useState(initialStatuses)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)
    let active = true
    setLoading(true)
    setError("")
    setEndpointStatus(initialStatuses())
    const data: Partial<CatalogData> = {}
    async function load() {
      await Promise.all(
        CATALOG_ENDPOINTS.map(async (endpoint) => {
          try {
            const response = await fetch(`${API}/${endpoint}.json`, {
              signal: controller.signal,
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const rows: unknown = await response.json()
            if (!Array.isArray(rows))
              throw new Error("Unexpected catalog response")
            Object.assign(data, { [endpoint]: rows })
            if (active)
              setEndpointStatus((current) => ({
                ...current,
                [endpoint]: { state: "ready", count: rows.length },
              }))
          } catch (reason) {
            if (active)
              setEndpointStatus((current) => ({
                ...current,
                [endpoint]: {
                  state: "error",
                  count: 0,
                  error: controller.signal.aborted
                    ? "Request timed out"
                    : (reason as Error).message,
                },
              }))
          }
        }),
      )
      clearTimeout(timeout)
      if (!active) return
      // Do not publish channels if the upstream exclusions could not be loaded.
      if (!data.channels || !data.streams || !data.blocklist) {
        setError(
          "The channel catalog or its exclusion list could not be loaded. Please retry.",
        )
      } else {
        const complete = Object.fromEntries(
          CATALOG_ENDPOINTS.map((name) => [name, data[name] ?? []]),
        ) as CatalogData
        try {
          setChannels(joinCatalog(complete))
          setCategoryDefinitions(complete.categories)
        } catch {
          setError(
            "The catalog contains unsupported metadata. Please retry after the upstream catalog updates.",
          )
        }
      }
      setLoading(false)
    }
    void load()
    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [reload])
  return {
    channels,
    categoryDefinitions,
    endpointStatus,
    loading,
    error,
    retry: () => setReload((value) => value + 1),
  }
}
