import { API, type EndpointName, type EndpointStatus } from "./catalog"

const groups: { title: string; names: EndpointName[] }[] = [
  { title: "Broadcast catalog", names: ["channels", "feeds", "streams", "logos", "guides"] },
  { title: "Geography", names: ["countries", "subdivisions", "cities", "regions", "timezones"] },
  { title: "Reference data", names: ["categories", "languages", "blocklist"] },
]

export default function DataSources({ statuses }: { statuses: Record<EndpointName, EndpointStatus> }) {
  const entries = Object.values(statuses)
  const ready = entries.filter((status) => status.state === "ready").length
  return (
    <section id="data-sources" tabIndex={-1} className="data-sources" aria-labelledby="data-sources-title">
      <div className="data-sources-heading">
        <div>
          <span className="eyebrow">Behind the broadcast</span>
          <h2 id="data-sources-title">iptv-org data sources</h2>
        </div>
        <span className="data-sources-health">{ready} / {entries.length} sources loaded</span>
      </div>
      <p className="data-sources-note">Public datasets powering this catalog. Counts reflect source records, before channel filtering.</p>
      <div className="data-sources-grid">
        {groups.map((group) => (
          <section className="data-source-group" key={group.title} aria-label={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.names.map((name) => {
                const status = statuses[name]
                return (
                  <div className="data-source-row" key={name}>
                    <dt><a href={`${API}/${name}.json`} target="_blank" rel="noreferrer" aria-label={`Open ${name} source JSON in a new tab`}>{name}<span aria-hidden="true">↗</span></a></dt>
                    <dd>
                      {status.state === "ready" ? <><strong>{status.count.toLocaleString()}</strong><span className="data-source-state">records · Loaded</span></> : status.state === "loading" ? <><span className="data-source-skeleton" aria-hidden="true" /><span className="data-source-state">Loading…</span></> : <span className="data-source-unavailable">Unavailable</span>}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        ))}
      </div>
      <p className="data-sources-footnote">Guide records identify schedule sources; they do not guarantee that programme times or artwork are available.</p>
    </section>
  )
}
