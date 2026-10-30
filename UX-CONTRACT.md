# IPTV Accross Borders interaction contract

Source: user requests for current/future recording and the accepted NEXTJS-MIGRATION-PLAN.md. The Next.js server proxies authorized catalog stream resources; recording and saved files remain browser-owned. There is no app account, persistent recording storage, or server scheduler.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | ChannelFilters.tsx dialog picker | DESIGN.md | searchable dialog with native buttons | search, selection, dismissal, mobile review |
| Date | recording.tsx datetime-local | DESIGN.md | native | schedule validation |
| Form | RecordingProvider | User recording request | immediate, scheduled | typecheck, recording checks |
| Scrollbar | index.css | DESIGN.md | global | CSS review |
| Toast | RecordingProvider message | UX-CONTRACT.md | status, error | library status checks |
| Dialog | RecordingProvider dialog | DESIGN.md | modal | focus and Escape review |


Recording uses one independent pipeline per tab, surviving app navigation and player dismissal. One recording at a time. HLS preparation validates the playlist and loads the WASM engine before a schedule is accepted. Collection, finalization, completion, and recoverable finalization failure are distinct states. Scheduled starts require a visible tab and awake device; missed starts beyond one minute fail explicitly. Timers use wall-clock comparisons.

The HLS recorder collects original unencrypted segments and remuxes them without re-encoding, with a 128 MiB combined source-data limit. Unsupported playlists offer the existing browser capture fallback explicitly. Captured media may be re-encoded; it must not be described as original segment bytes. Output format reflects the actual engine result. Interruption saves complete collected segments where possible; finalization failure retains data for retry, while discard/cancel releases workers and memory. Files are held in this tab until saved. Reload/close warns about session recordings, and schedules do not survive reload.

The deployment is intended to use Vercel Authentication on all deployment URLs, with no separate application login. Deployment protection is a hosting setting, not assumed from application code.

Catalog filters remain transient in-memory state, preserving this app's existing behavior. Favorites persist in localStorage. New recording forms do not change catalog selection. Search is local and immediate; no remote search debounce needed. Recordings page is available on mobile and desktop. Date popup geometry/locale remains platform-owned. Catalog filter pickers use non-modal dialog semantics with ordinary buttons (not a custom ARIA combobox/listbox). Search filters the options locally; Enter picks the first match, Tab reaches options, Escape dismisses and returns focus; outside pointer dismisses without stealing focus. The popup follows scrolling and sits below the header. Country and category lists are alphabetical and include all catalog values. Counts describe the full catalog. Reset filters preserves the separate channel search.
