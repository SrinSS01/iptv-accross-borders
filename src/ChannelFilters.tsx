import { createPortal } from "react-dom"
import { useEffect, useId, useRef, useState } from "react"

type Option = {
  value: string
  label: string
  count?: number
}
function FilterPicker({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled: boolean
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 320,
    maxHeight: 420,
  })
  const selected = options.find((option) => option.value === value)
  const matches = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  function close(restoreFocus = true) {
    dialog.current?.close()
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  function choose(next: string) {
    onChange(next)
    close()
  }
  useEffect(() => {
    if (!open) return
    function place() {
      const rect = trigger.current!.getBoundingClientRect()
      const viewport = window.visualViewport
      const height = viewport?.height ?? window.innerHeight
      const width = viewport?.width ?? window.innerWidth
      if (width < 640) {
        const maxHeight = Math.min(480, height - 32)
        setPosition({
          left: 16,
          top: Math.max(16, (height - maxHeight) / 2),
          width: width - 32,
          maxHeight,
        })
      } else {
        const below = height - rect.bottom - 16
        const above = rect.top - 16
        const maxHeight = Math.min(420, Math.max(below, above))
        setPosition({
          left: Math.max(16, Math.min(rect.left, width - rect.width - 16)),
          top:
            below >= Math.min(320, maxHeight)
              ? rect.bottom + 6
              : Math.max(16, rect.top - maxHeight - 6),
          width: rect.width,
          maxHeight,
        })
      }
    }
    place()
    dialog.current?.show()
    search.current?.focus()
    function outside(event: PointerEvent) {
      if (
        !dialog.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        close()
      }
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    window.visualViewport?.addEventListener("resize", place)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
      window.visualViewport?.removeEventListener("resize", place)
    }
  }, [open])
  return (
    <div className="filter-field">
      <span id={`${id}-label`} className="filter-label">
        {label}
      </span>
      <button
        ref={trigger}
        className="filter-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setQuery("")
          setOpen(true)
        }}
      >
        <span id={`${id}-value`}>
          {selected?.label ?? `All ${label.toLowerCase()}s`}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="filter-picker"
          style={position}
          aria-modal="false"
          aria-labelledby={`${id}-title`}
          onCancel={(event) => {
            event.preventDefault()
            close()
          }}
          onClick={(event) => {
            if (event.target === dialog.current) {
              const bounds = dialog.current.getBoundingClientRect()
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              )
                close()
            }
          }}
        >
          <div className="filter-picker-heading">
            <h3 id={`${id}-title`}>Choose {label.toLowerCase()}</h3>
            <button
              aria-label={`Close ${label.toLowerCase()} filter`}
              onClick={() => close()}
            >
              ×
            </button>
          </div>
          <div className="filter-search">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="6" />
              <path d="m15 15 5 5" />
            </svg>
            <input
              ref={search}
              aria-label={`Search ${
                label.toLowerCase() === "country" ? "countries" : "categories"
              }`}
              placeholder={
                label === "Country"
                  ? "Search country name…"
                  : "Search categories…"
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  matches.length
                ) {
                  event.preventDefault()
                  choose(matches[0].value)
                }
              }}
            />
            {query && (
              <button
                aria-label={`Clear ${label.toLowerCase()} search`}
                onClick={() => {
                  setQuery("")
                  search.current?.focus()
                }}
              >
                ×
              </button>
            )}
          </div>
          <div className="filter-options">
            {matches.length ? (
              matches.map((option) => (
                <button
                  key={option.value}
                  className="filter-option"
                  aria-pressed={value === option.value}
                  onClick={() => choose(option.value)}
                >
                  <span className="filter-option-check" aria-hidden="true">
                    {value === option.value ? "✓" : ""}
                  </span>
                  <span>{option.label}</span>
                  {option.count !== undefined && (
                    <span className="filter-option-count">
                      {option.count.toLocaleString()}
                    </span>
                  )}
                </button>
              ))
            ) : (
              <p className="filter-no-results" role="status">
                No matches for “{query}”.
                <br />
                <button
                  onClick={() => {
                    setQuery("")
                    search.current?.focus()
                  }}
                >
                  Clear search
                </button>
              </p>
            )}
          </div>
          <p className="filter-picker-footer">
            Channel counts from the full catalog
          </p>
        </dialog>,
        document.body,
      )}
    </div>
  )
}

export default function ChannelFilters({
  categories,
  countries,
  category,
  country,
  onCategory,
  onCountry,
  loading,
}: {
  categories: [string, number][]
  countries: [string, number][]
  category: string
  country: string
  onCategory: (value: string) => void
  onCountry: (value: string) => void
  loading: boolean
}) {
  const titleCase = (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1)
  const hasFilters = category !== "all" || country !== "all"
  return (
    <section className="channel-filters" aria-label="Filter channels">
      <div className="filter-bar">
        <div className="filter-intro">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M3 7h18M3 17h18" />
            <path d="M8 4v6M16 14v6" />
          </svg>
          <span>Refine channels</span>
        </div>
        <FilterPicker
          label="Category"
          value={category}
          options={[
            { value: "all", label: "All categories" },
            ...categories.map(([name, count]) => ({
              value: name,
              label: titleCase(name),
              count,
            })),
          ]}
          onChange={onCategory}
          disabled={loading}
        />
        <FilterPicker
          label="Country"
          value={country}
          options={[
            { value: "all", label: "All countries" },
            ...countries.map(([name, count]) => ({
              value: name,
              label: name,
              count,
            })),
          ]}
          onChange={onCountry}
          disabled={loading}
        />
        <button
          className="filter-reset"
          disabled={!hasFilters}
          onClick={() => {
            onCategory("all")
            onCountry("all")
          }}
        >
          Reset filters
        </button>
      </div>
      {hasFilters && (
        <div className="filter-summary">
          <span>Filtering by</span>
          {category !== "all" && (
            <button
              onClick={() => onCategory("all")}
              aria-label={`Remove ${category} category filter`}
            >
              {titleCase(category)}
              <span aria-hidden="true">×</span>
            </button>
          )}
          {country !== "all" && (
            <button
              onClick={() => onCountry("all")}
              aria-label={`Remove ${country} country filter`}
            >
              {country}
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}
